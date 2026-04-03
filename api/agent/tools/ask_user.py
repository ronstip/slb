"""Structured prompt tool — ask the user interactive questions.

Provides predefined prompt templates for common collection-setup inputs
(platforms, time range, keywords, etc.) and supports custom prompts for
one-off questions (research angles, ad-hoc choices).
"""

import copy
import json
import logging

logger = logging.getLogger(__name__)

# ─── Predefined prompt templates ──────────────────────────────────────
# The LLM never generates these — it just references them by ID.
# Icons, labels, option lists live here as the single source of truth.

PROMPT_TEMPLATES: dict[str, dict] = {
    "platforms": {
        "id": "platforms",
        "type": "icon_grid",
        "question": "Which platforms should we monitor?",
        "options": [
            {"value": "instagram", "label": "Instagram", "icon": "instagram"},
            {"value": "tiktok", "label": "TikTok", "icon": "tiktok"},
            {"value": "twitter", "label": "X (Twitter)", "icon": "twitter"},
            {"value": "reddit", "label": "Reddit", "icon": "reddit"},
            {"value": "youtube", "label": "YouTube", "icon": "youtube"},
            {"value": "facebook", "label": "Facebook", "icon": "facebook"},
        ],
        "multi_select": True,
    },
    "time_range": {
        "id": "time_range",
        "type": "pill_row",
        "question": "How far back should we look?",
        "options": [
            {"value": "1", "label": "24 hours"},
            {"value": "7", "label": "7 days"},
            {"value": "14", "label": "14 days"},
            {"value": "30", "label": "30 days"},
            {"value": "90", "label": "90 days"},
            {"value": "365", "label": "1 year"},
        ],
    },
    "keywords": {
        "id": "keywords",
        "type": "tag_input",
        "question": "What keywords should we track?",
        "placeholder": "Type a keyword and press Enter",
        "multi_select": True,
    },
    "geo_scope": {
        "id": "geo_scope",
        "type": "pill_row",
        "question": "Geographic focus?",
        "options": [
            {"value": "global", "label": "Global", "recommended": True},
            {"value": "US", "label": "United States"},
            {"value": "EU", "label": "Europe"},
        ],
    },
    "include_comments": {
        "id": "include_comments",
        "type": "toggle_row",
        "question": "Include comment threads?",
        "default_value": True,
        "allow_other": False,
    },
    "posts_per_keyword": {
        "id": "posts_per_keyword",
        "type": "pill_row",
        "question": "Posts per keyword",
        "options": [
            {"value": "10", "label": "10"},
            {"value": "20", "label": "20", "recommended": True},
            {"value": "50", "label": "50"},
            {"value": "100", "label": "100"},
        ],
    },
    "approve_plan": {
        "id": "approve_plan",
        "type": "approval",
        "question": "Ready to proceed?",
        "options": [
            {"value": "approve", "label": "Approve & Run", "recommended": True},
            {"value": "adjust", "label": "Adjust"},
        ],
        "allow_other": False,
    },
}


def ask_user(
    prompt_ids: str = "",
    preselected: str = "",
    custom_questions: str = "",
    custom_prompts: str = "",
    title: str = "",
) -> dict:
    """Ask the user structured questions with interactive UI components.

    Uses predefined prompt templates for common inputs. The frontend renders
    rich interactive components (icon grids, pills, tag inputs, toggles).

    IMPORTANT: After calling this tool, STOP. Do not call other tools or
    generate more text. Wait for the user to respond.

    Args:
        prompt_ids: Comma-separated template IDs to display.
            Available templates: platforms, time_range, keywords, geo_scope,
            include_comments, posts_per_keyword.
            Example: "platforms,time_range,keywords"

        preselected: JSON object mapping prompt ID to preselected values.
            For multi-select (icon_grid, tag_input): list of values.
            For single-select (pill_row, card_select): list with one value.
            For toggle_row: not needed — use the template default.
            Example: '{"platforms": ["instagram", "tiktok"], "time_range": ["30"]}'

        custom_questions: JSON object mapping prompt ID to custom question text.
            Overrides the template's default question.
            Example: '{"platforms": "Where is this brand most discussed?"}'

        custom_prompts: JSON array for fully custom prompts not covered by
            templates. Each object needs: id, type, question, and options
            (for select types). Optional: multi_select, preselected,
            description (per option).
            Use sparingly — prefer templates when possible.
            Example: '[{"id":"angle","type":"card_select","question":"Research angle?","options":[{"value":"sentiment","label":"Sentiment Deep Dive","description":"How people feel about the brand"},{"value":"themes","label":"Theme Analysis","description":"What topics come up most"}]}]'

        title: Optional card header text displayed above the prompts.
            Example: "Collection Setup"

    Returns:
        A dict with status "needs_input" and hydrated prompt definitions,
        or status "error" with a message if inputs are invalid.
    """
    prompts: list[dict] = []

    # ── Hydrate templates ─────────────────────────────────────────────
    preselected_map: dict = {}
    if preselected:
        try:
            preselected_map = json.loads(preselected)
        except json.JSONDecodeError as e:
            logger.warning("ask_user: invalid preselected JSON: %s", e)

    questions_map: dict = {}
    if custom_questions:
        try:
            questions_map = json.loads(custom_questions)
        except json.JSONDecodeError as e:
            logger.warning("ask_user: invalid custom_questions JSON: %s", e)

    if prompt_ids:
        for pid in (p.strip() for p in prompt_ids.split(",") if p.strip()):
            template = PROMPT_TEMPLATES.get(pid)
            if not template:
                logger.warning("ask_user: unknown template '%s', skipping", pid)
                continue
            prompt = copy.deepcopy(template)
            # Apply preselected values
            if pid in preselected_map:
                prompt["preselected"] = preselected_map[pid]
            # Apply custom question text
            if pid in questions_map:
                prompt["question"] = questions_map[pid]
            prompts.append(prompt)

    # ── Append custom prompts ─────────────────────────────────────────
    if custom_prompts:
        try:
            custom_list = json.loads(custom_prompts)
            if isinstance(custom_list, list):
                for cp in custom_list:
                    if isinstance(cp, dict) and "id" in cp and "type" in cp and "question" in cp:
                        prompts.append(cp)
                    else:
                        logger.warning("ask_user: skipping invalid custom prompt: %s", cp)
            else:
                logger.warning("ask_user: custom_prompts must be a JSON array")
        except json.JSONDecodeError as e:
            logger.warning("ask_user: invalid custom_prompts JSON: %s", e)

    # ── Validate ──────────────────────────────────────────────────────
    if not prompts:
        return {
            "status": "blocked",
            "message": (
                "No valid prompts. Provide template IDs via prompt_ids "
                "(available: " + ", ".join(PROMPT_TEMPLATES.keys()) + ") "
                "or supply custom_prompts."
            ),
        }

    result: dict = {"status": "needs_input", "prompts": prompts}
    if title:
        result["title"] = title
    return result
