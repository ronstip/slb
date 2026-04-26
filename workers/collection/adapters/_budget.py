"""Shared per-task pagination budget helper for collection adapters.

`collection_service` derives a per-task budget (`max_posts_per_keyword`) from
`n_posts / (platforms * keywords)`. Adapters that paginate API calls themselves
(Vetric, X API) must size pages so they don't over-fetch — each returned post
is either a billable read (X API PAYG) or wasted bandwidth.

BrightData passes the budget straight to its server-side API and doesn't need
this helper.
"""


def derive_pagination(
    per_task_budget: int | None,
    *,
    page_max: int,
    page_min: int = 1,
    fallback_calls: int = 2,
) -> tuple[int, int, int | None]:
    """Compute (page_size, max_calls, hard_cap) for a single task.

    - `per_task_budget`: target posts for this task (None or <=0 = uncapped).
    - `page_max` / `page_min`: vendor-imposed page-size bounds.
    - `fallback_calls`: pages to fetch when no budget is set.

    Returns:
        page_size — value to send as `max_results` (or equivalent).
        max_calls — number of pages to fetch.
        hard_cap  — truncate the parsed post list to this; None when uncapped.

    Examples:
        derive_pagination(25, page_max=100, page_min=10) → (25, 1, 25)
        derive_pagination(150, page_max=100, page_min=10) → (100, 2, 150)
        derive_pagination(5, page_max=100, page_min=10) → (10, 1, 5)
        derive_pagination(None, page_max=100, page_min=10) → (100, 2, None)
    """
    if not per_task_budget or per_task_budget <= 0:
        return page_max, fallback_calls, None
    page_size = max(page_min, min(page_max, per_task_budget))
    max_calls = max(1, -(-per_task_budget // page_size))  # ceil division
    return page_size, max_calls, per_task_budget
