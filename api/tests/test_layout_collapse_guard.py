"""Server-side guard against persisting a collapsed mobile layout.

The dashboard layout doc is shared across local/dev/prod and read live by both
the editor and the public share endpoint. A frontend bug (react-grid-layout
firing onLayoutChange with the 2-col xs layout while the breakpoint state was
still a stale 'lg') once persisted the COMPACT layout into the canonical desktop
slot - every widget at x=0 with w<=2, rendering as one long narrow column on
desktop and on the shared link.

`_is_collapsed_mobile_layout` is the backend backstop: even a stale/buggy client
(or a phone-sized editor) must not be able to poison the shared layout doc. It
fires only on the unmistakable signature - 3+ widgets, ALL at x=0, none wider
than the small (sm) breakpoint - so it never catches a real desktop layout
(which uses horizontal space) or a Story Mode narrative (full-width w=12 stack).
"""

from api.routers.dashboard_layouts import _COMPACT_MAX_W, _is_collapsed_mobile_layout
from api.routers.dashboard_schema import SocialDashboardWidget


def _w(i: str, x: int, w: int, y: int = 0, h: int = 4) -> SocialDashboardWidget:
    return SocialDashboardWidget(
        i=i, x=x, y=y, w=w, h=h,
        aggregation="custom", chartType="bar", title=i,
    )


def test_collapsed_xs_layout_is_rejected():
    """The exact corruption: every widget x=0, w<=2, stacked vertically."""
    layout = [_w(f"w{n}", x=0, w=2, y=n * 2) for n in range(14)]
    assert _is_collapsed_mobile_layout(layout) is True


def test_normal_desktop_layout_is_allowed():
    """A real layout uses horizontal space - some widget sits at x>0."""
    layout = [
        _w("a", x=0, w=4, y=0),
        _w("b", x=4, w=4, y=0),
        _w("c", x=8, w=4, y=0),
        _w("d", x=0, w=12, y=4),
    ]
    assert _is_collapsed_mobile_layout(layout) is False


def test_story_mode_full_width_stack_is_allowed():
    """Story Mode stacks full-width (x=0, w=12) narrative widgets - legitimate."""
    layout = [_w(f"s{n}", x=0, w=12, y=n * 5) for n in range(5)]
    assert _is_collapsed_mobile_layout(layout) is False


def test_widths_up_to_sm_cols_are_treated_as_collapsed():
    """The leaderboard in the real incident kept w=3; the guard must still fire."""
    layout = [
        _w("lead", x=0, w=3, y=0),
        _w("a", x=0, w=2, y=8),
        _w("b", x=0, w=2, y=10),
    ]
    assert _COMPACT_MAX_W >= 3
    assert _is_collapsed_mobile_layout(layout) is True


def test_small_layouts_are_not_flagged():
    """1-2 widgets can legitimately be a single narrow column on a new dashboard."""
    layout = [_w("a", x=0, w=2, y=0), _w("b", x=0, w=2, y=2)]
    assert _is_collapsed_mobile_layout(layout) is False


def test_empty_layout_is_not_flagged():
    assert _is_collapsed_mobile_layout([]) is False
