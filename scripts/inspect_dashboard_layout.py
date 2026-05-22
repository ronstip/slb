"""Read a dashboard_layouts doc straight from Firestore for diagnosis.

Usage:
    uv run python scripts/inspect_dashboard_layout.py <layout_id>
"""

import json
import os
import sys
from pathlib import Path

_project_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_project_root))

_env_file = _project_root / ".env"
if _env_file.exists():
    for line in _env_file.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))

from api.deps import get_fs  # noqa: E402


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("usage: inspect_dashboard_layout.py <layout_id>")
    layout_id = sys.argv[1]
    fs = get_fs()
    doc = fs._db.collection("dashboard_layouts").document(layout_id).get()
    if not doc.exists:
        print(f"NOT FOUND: dashboard_layouts/{layout_id}")
        return
    data = doc.to_dict() or {}
    layout = data.get("layout") or []
    meta = {k: v for k, v in data.items() if k != "layout"}
    print(f"dashboard_layouts/{layout_id}")
    print(f"  widget_count: {len(layout)}")
    print(f"  meta: {json.dumps(meta, default=str, indent=2)}")
    print("  widgets:")
    for w in layout:
        keys = sorted(w.keys())
        print(f"    - i={w.get('i')} agg={w.get('aggregation')} chart={w.get('chartType')} title={w.get('title')!r} keys={keys}")


if __name__ == "__main__":
    main()
