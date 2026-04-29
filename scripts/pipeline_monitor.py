"""Pipeline monitoring TUI.

Usage:
    uv run python scripts/pipeline_monitor.py                    # launch TUI
    uv run python scripts/pipeline_monitor.py <collection_id>    # launch TUI focused on a collection

Requires USE_PIPELINE_V2=true in .env for new collections.
"""

import os
import sys
import threading
import time
from datetime import datetime, timezone

_project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _project_root)

from dotenv import load_dotenv
load_dotenv(os.path.join(_project_root, ".env"))

os.environ.setdefault("USE_PIPELINE_V2", "true")

from textual import work
from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import Horizontal, Vertical, VerticalScroll
from textual.reactive import reactive
from textual.widgets import (
    Button,
    DataTable,
    Footer,
    Header,
    Input,
    Label,
    ProgressBar,
    Select,
    Static,
    Switch,
)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

PLATFORMS = ["tiktok", "youtube", "reddit", "instagram", "twitter", "linkedin"]

# State display config: (label, color) — order matches pipeline flow
STATE_DISPLAY = {
    "collected_with_media": ("DL Queue", "cyan"),
    "downloading": ("DL Now", "cyan"),
    "ready_for_enrichment": ("Enr Queue", "blue"),
    "enriching": ("Enr Now", "blue"),
    "enriched": ("Embed", "magenta"),
    "done": ("Done", "green"),
    "missing_media": ("No Media", "yellow"),
    "download_failed": ("DL Fail", "red"),
    "enrichment_failed": ("Enr Fail", "red"),
    "embedding_failed": ("Emb Fail", "red"),
}

TERMINAL_STATES = {"done", "missing_media", "download_failed", "enrichment_failed", "embedding_failed"}
COLLECTION_TERMINAL = {"completed", "completed_with_errors", "failed", "cancelled", "monitoring"}


# ---------------------------------------------------------------------------
# CSS
# ---------------------------------------------------------------------------

CSS = """
Screen {
    layout: horizontal;
}

#sidebar {
    width: 42;
    border-right: solid $surface-lighten-2;
    padding: 1;
}

#main {
    width: 1fr;
    padding: 1 2;
}

#form-title {
    text-style: bold;
    margin-bottom: 1;
}

.form-label {
    margin-top: 1;
    color: $text-muted;
}

#btn-start {
    margin-top: 1;
    width: 100%;
}

#recent-title {
    text-style: bold;
    margin-top: 2;
    margin-bottom: 1;
}

#collection-list {
    height: auto;
    max-height: 20;
}

#no-selection {
    margin-top: 4;
    text-align: center;
    color: $text-muted;
}

#dash-header {
    text-style: bold;
    margin-bottom: 1;
}

#status-line {
    margin-bottom: 1;
}

#progress-section {
    margin-bottom: 1;
    height: auto;
}

#progress-bar {
    width: 100%;
}

#dag-section {
    margin-bottom: 1;
    height: auto;
}

#dag-visual {
    height: auto;
    margin: 1 0;
}

#crawlers-section {
    margin-bottom: 1;
    height: auto;
}

#crawler-table {
    height: auto;
    max-height: 10;
}

#posts-section {
    height: auto;
}

#state-table {
    height: auto;
    max-height: 12;
}

.section-title {
    text-style: bold;
    margin-bottom: 1;
}

#retry-bar {
    layout: horizontal;
    height: 3;
    margin-top: 1;
}

#retry-bar Button {
    margin-right: 1;
}
"""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_fs():
    from config.settings import get_settings
    from workers.shared.firestore_client import FirestoreClient
    return FirestoreClient(get_settings())


def _get_recent_collections(fs, limit: int = 15) -> list[dict]:
    """Fetch most recent collections from Firestore."""
    db = fs._db
    ref = db.collection("collection_status")
    docs = ref.order_by("created_at", direction="DESCENDING").limit(limit).stream()
    results = []
    for doc in docs:
        data = doc.to_dict()
        data["collection_id"] = doc.id
        results.append(data)
    return results


def _format_time(dt) -> str:
    if not dt:
        return ""
    if hasattr(dt, "isoformat"):
        return dt.strftime("%m/%d %H:%M")
    return str(dt)[:16]


# ---------------------------------------------------------------------------
# Pipeline DAG Widget
# ---------------------------------------------------------------------------

class DagVisual(Static):
    """ASCII representation of the pipeline DAG with live counts."""

    counts: reactive[dict] = reactive(dict, recompose=True)
    total: reactive[int] = reactive(0)

    def render(self) -> str:
        c = self.counts or {}
        total = self.total or 0

        dl = c.get("collected_with_media", 0) + c.get("downloading", 0)
        enr = c.get("ready_for_enrichment", 0) + c.get("enriching", 0)
        emb = c.get("enriched", 0)
        done = c.get("done", 0)

        miss = c.get("missing_media", 0)
        dl_f = c.get("download_failed", 0)
        enr_f = c.get("enrichment_failed", 0)
        emb_f = c.get("embedding_failed", 0)

        terminal = done + miss + dl_f + enr_f + emb_f
        pct = f"{terminal/total*100:.0f}%" if total > 0 else "0%"

        lines = [
            f"  Crawl --> [Download: {dl}] --> [Enrich: {enr}] --> [Embed: {emb}] --> Done: {done}",
            f"                 |                    |                   |",
            f"            fail: {dl_f:<4}          fail: {enr_f:<4}         fail: {emb_f:<4}",
            f"          no media: {miss:<4}",
            f"",
            f"  Total: {total}   Terminal: {terminal}   Progress: {pct}",
        ]
        return "\n".join(lines)


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

class PipelineMonitor(App):
    TITLE = "Pipeline Monitor"
    CSS = CSS
    BINDINGS = [
        Binding("q", "quit", "Quit"),
        Binding("r", "refresh", "Refresh"),
    ]

    selected_id: reactive[str] = reactive("")
    _poll_active: bool = False

    def __init__(self, initial_collection_id: str | None = None):
        super().__init__()
        self._initial_id = initial_collection_id

    def compose(self) -> ComposeResult:
        yield Header()

        with Horizontal():
            # --- Sidebar: New Collection + Recent ---
            with Vertical(id="sidebar"):
                yield Label("New Collection", id="form-title")

                yield Label("Description", classes="form-label")
                yield Input(placeholder="e.g. Nike brand mentions", id="inp-desc")

                yield Label("Platforms (comma-sep)", classes="form-label")
                yield Input(placeholder="tiktok, youtube", id="inp-platforms", value="tiktok, youtube")

                yield Label("Keywords (comma-sep)", classes="form-label")
                yield Input(placeholder="nike, sneakers", id="inp-keywords")

                yield Label("Posts per platform", classes="form-label")
                yield Input(placeholder="100", id="inp-nposts", value="100")

                yield Button("Start Collection", id="btn-start", variant="success")

                yield Label("Recent Collections", id="recent-title")
                yield DataTable(id="collection-list", cursor_type="row")

            # --- Main panel: Dashboard ---
            with VerticalScroll(id="main"):
                yield Label("Select or start a collection", id="no-selection")

                yield Label("", id="dash-header")
                yield Label("", id="status-line")

                with Vertical(id="progress-section"):
                    yield Label("Pipeline Progress", classes="section-title")
                    yield ProgressBar(id="progress-bar", total=100, show_eta=False)

                with Vertical(id="dag-section"):
                    yield Label("Post DAG", classes="section-title")
                    yield DagVisual(id="dag-visual")

                with Vertical(id="crawlers-section"):
                    yield Label("Crawlers", classes="section-title")
                    yield DataTable(id="crawler-table")

                with Vertical(id="state-table-section", classes=""):
                    yield Label("State Breakdown", classes="section-title")
                    yield DataTable(id="state-table")

                with Horizontal(id="retry-bar"):
                    yield Button("Retry Failed Downloads", id="btn-retry-dl", variant="warning")
                    yield Button("Retry Failed Enrichments", id="btn-retry-enr", variant="warning")
                    yield Button("Retry Failed Embeddings", id="btn-retry-emb", variant="warning")

        yield Footer()

    def on_mount(self) -> None:
        # Hide dashboard elements initially
        self._set_dashboard_visible(False)

        # Setup tables
        cl = self.query_one("#collection-list", DataTable)
        cl.add_columns("ID", "Status", "Posts", "Created")

        ct = self.query_one("#crawler-table", DataTable)
        ct.add_columns("Crawler", "Status", "Posts", "Error")

        st = self.query_one("#state-table", DataTable)
        st.add_columns("State", "Count", "Type")

        # Load recent collections
        self._load_recent()

        # If launched with a collection ID, select it
        if self._initial_id:
            self.selected_id = self._initial_id

    def _set_dashboard_visible(self, visible: bool) -> None:
        self.query_one("#no-selection").display = not visible
        for sel in ("#dash-header", "#status-line", "#progress-section",
                    "#dag-section", "#crawlers-section", "#state-table-section", "#retry-bar"):
            self.query_one(sel).display = visible

    @work(thread=True)
    def _load_recent(self) -> None:
        try:
            fs = _get_fs()
            collections = _get_recent_collections(fs)
        except Exception as e:
            self.notify(f"Error loading collections: {e}", severity="error")
            return

        self.call_from_thread(self._populate_recent, collections)

    def _populate_recent(self, collections: list[dict]) -> None:
        cl = self.query_one("#collection-list", DataTable)
        cl.clear()
        for c in collections:
            cid = c.get("collection_id", "?")
            status = c.get("status", "?")
            posts = c.get("posts_collected", 0)
            created = _format_time(c.get("created_at"))
            cl.add_row(cid[:12] + "...", status, str(posts), created, key=cid)

    def on_data_table_row_selected(self, event: DataTable.RowSelected) -> None:
        if event.data_table.id == "collection-list" and event.row_key:
            self.selected_id = str(event.row_key.value)

    def watch_selected_id(self, value: str) -> None:
        if value:
            self._set_dashboard_visible(True)
            self.query_one("#dash-header", Label).update(f"Collection: {value[:20]}...")
            self._poll_active = True
            self._poll_status()
        else:
            self._set_dashboard_visible(False)
            self._poll_active = False

    @work(thread=True)
    def _poll_status(self) -> None:
        """Poll Firestore for collection status updates."""
        while self._poll_active and self.selected_id:
            cid = self.selected_id
            try:
                fs = _get_fs()
                status = fs.get_collection_status(cid)
                if status:
                    self.call_from_thread(self._update_dashboard, cid, status)

                    # Stop polling if collection is done
                    coll_status = status.get("status", "")
                    if coll_status in COLLECTION_TERMINAL:
                        # One final refresh then stop
                        break
            except Exception:
                pass

            time.sleep(2)

    def _update_dashboard(self, cid: str, status: dict) -> None:
        if cid != self.selected_id:
            return

        coll_status = status.get("status", "?")
        posts_collected = status.get("posts_collected", 0)
        config = status.get("config", {})
        if isinstance(config, str):
            import json
            try:
                config = json.loads(config)
            except Exception:
                config = {}

        desc = config.get("description", "") or status.get("original_question", "")
        platforms = config.get("platforms", [])

        # Status line
        status_text = (
            f"Status: [{self._status_color(coll_status)}]{coll_status}[/]  |  "
            f"Posts: {posts_collected}  |  "
            f"Platforms: {', '.join(platforms) if platforms else '?'}"
        )
        if desc:
            status_text += f"\n{desc[:80]}"
        self.query_one("#status-line", Label).update(status_text)

        # Counts / DAG
        counts = status.get("counts", {})
        total = status.get("total_posts_in_dag", 0)

        dag = self.query_one("#dag-visual", DagVisual)
        dag.counts = dict(counts)
        dag.total = total

        # Progress bar
        terminal = sum(counts.get(s, 0) for s in TERMINAL_STATES)
        pbar = self.query_one("#progress-bar", ProgressBar)
        pbar.total = max(total, 1)
        pbar.progress = terminal

        # Crawlers
        crawlers = status.get("crawlers", {})
        ct = self.query_one("#crawler-table", DataTable)
        ct.clear()
        for name, data in crawlers.items():
            ct.add_row(
                name,
                data.get("status", "?"),
                str(data.get("posts", 0)),
                (data.get("error", "") or "")[:40],
            )

        # State table
        st = self.query_one("#state-table", DataTable)
        st.clear()
        for state_val, (label, color) in STATE_DISPLAY.items():
            count = counts.get(state_val, 0)
            if count > 0 or state_val not in TERMINAL_STATES:
                stype = "terminal" if state_val in TERMINAL_STATES else "active"
                st.add_row(f"[{color}]{label}[/]", str(count), stype)

    def _status_color(self, status: str) -> str:
        return {
            "pending": "yellow",
            "collecting": "cyan",
            "processing": "blue",
            "completed": "green",
            "completed_with_errors": "yellow",
            "failed": "red",
            "cancelled": "red",
            "monitoring": "magenta",
        }.get(status, "white")

    # --- Actions ---

    def action_refresh(self) -> None:
        self._load_recent()
        if self.selected_id:
            self._poll_active = True
            self._poll_status()

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "btn-start":
            self._start_collection()
        elif event.button.id == "btn-retry-dl":
            self._retry_state("download_failed")
        elif event.button.id == "btn-retry-enr":
            self._retry_state("enrichment_failed")
        elif event.button.id == "btn-retry-emb":
            self._retry_state("embedding_failed")

    @work(thread=True)
    def _start_collection(self) -> None:
        desc = self.query_one("#inp-desc", Input).value.strip()
        platforms_raw = self.query_one("#inp-platforms", Input).value.strip()
        keywords_raw = self.query_one("#inp-keywords", Input).value.strip()
        nposts_raw = self.query_one("#inp-nposts", Input).value.strip()

        if not desc or not keywords_raw:
            self.notify("Description and keywords are required", severity="warning")
            return

        platforms = [p.strip().lower() for p in platforms_raw.split(",") if p.strip()]
        keywords = [k.strip() for k in keywords_raw.split(",") if k.strip()]
        n_posts = int(nposts_raw) if nposts_raw.isdigit() else 100

        if not platforms:
            platforms = ["tiktok", "youtube"]

        self.notify(f"Starting collection: {desc[:40]}...")

        try:
            from config.settings import get_settings
            get_settings.cache_clear()

            from api.schemas.requests import CreateCollectionRequest
            from api.services.collection_service import create_collection_from_request

            request = CreateCollectionRequest(
                description=desc,
                platforms=platforms,
                keywords=keywords,
                time_range_days=30,
                n_posts=n_posts,
                include_comments=True,
            )

            result = create_collection_from_request(
                request=request,
                user_id="monitor-tui",
                session_id="monitor-session",
            )

            cid = result["collection_id"]
            self.notify(f"Collection started: {cid[:12]}...", severity="information")

            # Refresh list and select the new collection
            time.sleep(1)
            self.call_from_thread(self._after_start, cid)

        except Exception as e:
            self.notify(f"Error: {e}", severity="error")

    def _after_start(self, cid: str) -> None:
        self._load_recent()
        self.selected_id = cid

    @work(thread=True)
    def _retry_state(self, state: str) -> None:
        cid = self.selected_id
        if not cid:
            return

        try:
            from workers.pipeline.post_state import RETRY_MAP, PostState
            from workers.pipeline.state_manager import StateManager

            target = PostState(state)
            if target not in RETRY_MAP:
                self.notify(f"State {state} not retryable", severity="warning")
                return

            new_state = RETRY_MAP[target]
            sm = StateManager(cid)
            posts = sm.get_posts_by_state([target], limit=500)

            if not posts:
                self.notify(f"No posts in {state}", severity="information")
                return

            transitions = [(p["post_id"], new_state) for p in posts]
            sm.transition_batch(transitions)

            self.notify(f"Retried {len(posts)} posts: {state} -> {new_state.value}")

            # Refresh dashboard
            self._poll_active = True
            self.call_from_thread(lambda: self._poll_status())

        except Exception as e:
            self.notify(f"Retry error: {e}", severity="error")


# ---------------------------------------------------------------------------
# CLI entry
# ---------------------------------------------------------------------------

def main():
    collection_id = None
    if len(sys.argv) > 1 and not sys.argv[1].startswith("-"):
        collection_id = sys.argv[1]

    app = PipelineMonitor(initial_collection_id=collection_id)
    app.run()


if __name__ == "__main__":
    main()
