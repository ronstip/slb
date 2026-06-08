"""update_dashboard silently dropped unrecognized patch fields (extra="ignore"
on the widget model), so an LLM that patched a made-up color field like
`colors`/`palette` got a clean success and no visual change. These tests pin the
helper that surfaces those dropped fields so the tool can warn instead.
"""

from api.agent.tools.dashboard_report import unrecognized_patch_fields


def test_real_widget_fields_are_recognized():
    # accent + styleOverrides are the actual color levers - must NOT be flagged.
    assert unrecognized_patch_fields({"title": "Hi", "accent": "#abc"}) == []
    assert unrecognized_patch_fields(
        {"styleOverrides": {"accent": "#abc", "seriesColors": {"positive": "#0f0"}}}
    ) == []


def test_invented_color_fields_are_flagged():
    flagged = unrecognized_patch_fields(
        {"colors": ["#f00"], "palette": "rainbow", "colorScheme": "vivid"}
    )
    assert set(flagged) == {"colors", "palette", "colorScheme"}


def test_mixed_patch_flags_only_the_unknown_keys():
    flagged = unrecognized_patch_fields({"accent": "#abc", "palette": "rainbow"})
    assert flagged == ["palette"]


def test_empty_patch_has_nothing_to_flag():
    assert unrecognized_patch_fields({}) == []
