"""Pipeline monitoring and debugging CLI.

Usage:
    uv run python scripts/pipeline_monitor.py status <collection_id>
    uv run python scripts/pipeline_monitor.py posts <collection_id> --state enrichment_failed
    uv run python scripts/pipeline_monitor.py retry <collection_id> --state download_failed
    uv run python scripts/pipeline_monitor.py crawlers <collection_id>
"""

import argparse
import os
import sys

# Ensure project root is on sys.path
_project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _project_root)

from dotenv import load_dotenv
load_dotenv(os.path.join(_project_root, ".env"))


def cmd_status(collection_id: str) -> None:
    """Show aggregate state counts for a collection."""
    from workers.pipeline_v2.state_manager import StateManager

    sm = StateManager(collection_id)
    counts = sm.get_counts()
    total = sm.get_total_posts()

    if not counts and total == 0:
        # Fall back to collection_status doc for v1 pipelines
        from workers.shared.firestore_client import FirestoreClient
        fs = FirestoreClient()
        status = fs.get_collection_status(collection_id)
        if not status:
            print(f"Collection {collection_id} not found")
            return
        print(f"Collection {collection_id}")
        print(f"  Status:          {status.get('status', '?')}")
        print(f"  Posts collected:  {status.get('posts_collected', 0)}")
        print(f"  Posts enriched:   {status.get('posts_enriched', 0)}")
        print(f"  Posts embedded:   {status.get('posts_embedded', 0)}")
        print(f"  (v1 pipeline — no per-post state tracking)")
        return

    terminal_count = 0
    non_terminal_count = 0

    print(f"\nCollection {collection_id}")
    print(f"{'─' * 45}")
    print(f"  {'State':<28} {'Count':>6}")
    print(f"  {'─' * 28} {'─' * 6}")

    from workers.pipeline_v2.post_state import TERMINAL_STATES, PostState

    # Non-terminal states first
    for state in PostState:
        if state.is_terminal:
            continue
        count = counts.get(state.value, 0)
        if count > 0:
            print(f"  {state.value:<28} {count:>6}")
            non_terminal_count += count

    # Then terminal states
    for state in PostState:
        if not state.is_terminal:
            continue
        count = counts.get(state.value, 0)
        if count > 0:
            marker = " *" if state != PostState.DONE else ""
            print(f"  {state.value:<28} {count:>6}{marker}")
            terminal_count += count

    print(f"  {'─' * 28} {'─' * 6}")
    print(f"  {'Total':<28} {total:>6}")
    print(f"  {'Terminal':<28} {terminal_count:>6}")
    if total > 0:
        pct = terminal_count / total * 100
        print(f"  {'Progress':<28} {pct:>5.1f}%")
    print()
    if non_terminal_count > 0:
        print("  Pipeline is still running.")
    else:
        print("  All posts have reached a terminal state.")
    print()


def cmd_posts(collection_id: str, state: str) -> None:
    """List posts in a specific state with content preview."""
    from workers.pipeline_v2.post_state import PostState
    from workers.pipeline_v2.state_manager import StateManager

    try:
        target_state = PostState(state)
    except ValueError:
        print(f"Unknown state: {state}")
        print(f"Valid states: {', '.join(s.value for s in PostState)}")
        return

    sm = StateManager(collection_id)
    posts = sm.get_posts_by_state([target_state], limit=50)

    if not posts:
        print(f"No posts in state '{state}' for collection {collection_id}")
        return

    print(f"\n{len(posts)} post(s) in state '{state}':")
    print()

    # Cross-reference with BQ for content preview
    from workers.shared.bq_client import BQClient
    bq = BQClient()
    post_ids = [p["post_id"] for p in posts]
    rows = bq.query(
        "SELECT post_id, platform, title, "
        "  SUBSTR(content, 0, 80) AS content_preview "
        "FROM social_listening.posts "
        "WHERE post_id IN UNNEST(@post_ids)",
        {"post_ids": post_ids},
    )
    row_map = {r["post_id"]: r for r in rows}

    for p in posts:
        pid = p["post_id"]
        row = row_map.get(pid, {})
        platform = row.get("platform", "?")
        title = row.get("title", "")
        preview = row.get("content_preview", "")
        display = title or preview or "(no content)"
        if len(display) > 70:
            display = display[:67] + "..."
        print(f"  [{platform:>8}] {pid[:12]}...  {display}")

    print()


def cmd_retry(collection_id: str, state: str) -> None:
    """Re-promote failed posts back to their input state for retry."""
    from workers.pipeline_v2.post_state import RETRY_MAP, PostState
    from workers.pipeline_v2.state_manager import StateManager

    try:
        target_state = PostState(state)
    except ValueError:
        print(f"Unknown state: {state}")
        return

    if target_state not in RETRY_MAP:
        print(f"State '{state}' is not retryable.")
        print(f"Retryable states: {', '.join(s.value for s in RETRY_MAP)}")
        return

    new_state = RETRY_MAP[target_state]
    sm = StateManager(collection_id)
    posts = sm.get_posts_by_state([target_state], limit=500)

    if not posts:
        print(f"No posts in state '{state}'")
        return

    transitions = [(p["post_id"], new_state) for p in posts]
    sm.transition_batch(transitions)

    print(f"Re-promoted {len(posts)} post(s): {state} → {new_state.value}")


def cmd_crawlers(collection_id: str) -> None:
    """Show per-crawler status and post counts."""
    from workers.shared.firestore_client import FirestoreClient

    fs = FirestoreClient()
    status = fs.get_collection_status(collection_id)
    if not status:
        print(f"Collection {collection_id} not found")
        return

    crawlers = status.get("crawlers", {})
    if not crawlers:
        print(f"No crawler data for collection {collection_id}")
        print(f"(Collection status: {status.get('status', '?')})")
        return

    print(f"\nCrawlers for {collection_id}:")
    print(f"  {'Name':<25} {'Status':<20} {'Posts':>6}")
    print(f"  {'─' * 25} {'─' * 20} {'─' * 6}")

    for name, data in crawlers.items():
        cstatus = data.get("status", "?")
        posts = data.get("posts", 0)
        error = data.get("error", "")
        print(f"  {name:<25} {cstatus:<20} {posts:>6}")
        if error:
            print(f"    Error: {error[:100]}")

    print()


def main():
    parser = argparse.ArgumentParser(description="Pipeline monitoring CLI")
    subparsers = parser.add_subparsers(dest="command")

    # status
    p_status = subparsers.add_parser("status", help="Show aggregate state counts")
    p_status.add_argument("collection_id")

    # posts
    p_posts = subparsers.add_parser("posts", help="List posts in a specific state")
    p_posts.add_argument("collection_id")
    p_posts.add_argument("--state", required=True, help="Pipeline state to filter by")

    # retry
    p_retry = subparsers.add_parser("retry", help="Re-promote failed posts for retry")
    p_retry.add_argument("collection_id")
    p_retry.add_argument("--state", required=True, help="Failed state to retry")

    # crawlers
    p_crawlers = subparsers.add_parser("crawlers", help="Show crawler statuses")
    p_crawlers.add_argument("collection_id")

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        return

    if args.command == "status":
        cmd_status(args.collection_id)
    elif args.command == "posts":
        cmd_posts(args.collection_id, args.state)
    elif args.command == "retry":
        cmd_retry(args.collection_id, args.state)
    elif args.command == "crawlers":
        cmd_crawlers(args.collection_id)


if __name__ == "__main__":
    main()
