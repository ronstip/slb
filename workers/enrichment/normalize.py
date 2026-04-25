"""Label normalization for enrichment output.

Lowercases, strips diacritics, collapses whitespace, and dedupes labels so
trivial variants collapse (e.g. "Hermès" / "hermes" / "  HERMES  " all become
"hermes"). Does NOT solve semantic duplicates like "USA" vs "United States" —
that requires a separate canonicalization pass.
"""

import re
import unicodedata

_WHITESPACE_RE = re.compile(r"\s+")


def normalize_label(s: str) -> str:
    if not s:
        return ""
    nfkd = unicodedata.normalize("NFKD", s)
    no_marks = "".join(c for c in nfkd if not unicodedata.combining(c))
    collapsed = _WHITESPACE_RE.sub(" ", no_marks.strip())
    return collapsed.lower()


def normalize_labels(items: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for item in items:
        norm = normalize_label(item)
        if not norm or norm in seen:
            continue
        seen.add(norm)
        out.append(norm)
    return out
