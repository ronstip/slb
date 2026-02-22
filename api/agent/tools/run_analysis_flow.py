"""
Analysis Flow Tool — structured 4-phase analysis workflow.

This tool returns a protocol that guides the analyst agent through a
complete, multi-dimensional analysis: FRAME → PLAN → EXECUTE → SYNTHESIZE.

It is intentionally lightweight — it does not make LLM calls or run queries
itself. Instead, it returns a structured execution plan that the analyst agent
follows using its existing tools (execute_sql, create_chart, display_posts, etc.).
"""


def run_analysis_flow(question: str, collection_id: str) -> dict:
    """Trigger a structured multi-phase analysis workflow.

    Use this tool for complex, multi-dimensional analysis questions such as:
    "analyze positive posts for Sony", "give me a deep dive on brand sentiment",
    "what's the full picture of engagement trends?".

    Do NOT use for simple lookups or single-metric questions — use execute_sql
    or create_chart directly for those.

    Args:
        question: The user's analysis question, stated precisely.
        collection_id: The collection ID to analyze.

    Returns:
        A structured execution protocol for the analyst agent to follow.
    """
    protocol = f"""
## Analysis Flow Protocol

**Question:** {question}
**Collection:** `{collection_id}`

You are now running a structured Analysis Flow. Follow these 4 phases in order.
Do not skip phases. Do not summarize — execute each step fully.

---

### PHASE 1 — FRAME
Output a `## What We're Analyzing` section with:
- A 1-sentence restatement of the question as a research objective
- A bullet list of **3–5 analysis dimensions** you will explore (e.g., sentiment distribution,
  volume over time, top themes, highest-engagement posts, notable entities)
- For each dimension, note which tool you'll use (execute_sql + create_chart, display_posts, etc.)

This section is shown to the user. Make it crisp and directional.

---

### PHASE 2 — EXECUTE
For each dimension identified in Phase 1:

1. Write a `<!-- thinking: [what query you're running and why] -->` comment
2. Call the appropriate tool:
   - **execute_sql** for quantitative breakdowns (counts, distributions, ranked lists)
   - **create_chart** after execute_sql when the data maps to a chart type
   - **display_posts** when the query returns specific posts the user should see
   - **get_insights** if the user needs a full narrative report
3. Always filter by `collection_id = '{collection_id}'`
4. Run dimensions in logical order: quantitative baseline → thematic → qualitative examples

---

### PHASE 3 — SYNTHESIZE
After all queries and visualizations are complete, output the final analysis.

Follow this structure exactly:

```
[One-sentence thesis — the single most important finding from all data above]

[2-3 sentence executive summary tying together what the data showed]

## [Insight-named Section 1]
[1-sentence synthesis of this section's finding]
- [Opinionated bullet: stat + what it means]
- [Opinionated bullet]
- [Opinionated bullet]

---

## [Insight-named Section 2]
...

---

## Bottom Line
[2-3 punchy sentences. What should the user conclude or do next?]
```

Section headers must name the insight (e.g., `## Cinematic Content Dominates Sony's Positive Signal`),
not the category (e.g., `## Sentiment Analysis`).

---

Begin with PHASE 1 now.
"""

    return {
        "status": "ready",
        "protocol": protocol,
        "message": (
            f"Analysis Flow initialized for question: '{question}'. "
            "Follow the protocol above — begin with PHASE 1 (FRAME), then EXECUTE each dimension, "
            "then SYNTHESIZE. Do not ask the user for confirmation — proceed autonomously."
        ),
    }
