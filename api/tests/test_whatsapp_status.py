"""Phase 2-status — outbound delivery-status persistence (spec §8a)."""

from channels.message import StatusUpdate
from workers.whatsapp.status import apply_status_update, resolve_status

from api.tests._wa_fakes import FakeFirestore


# --- pure monotonic resolver ------------------------------------------------


def test_resolve_status_advances():
    assert resolve_status("sent", "delivered") == "delivered"
    assert resolve_status("delivered", "read") == "read"
    assert resolve_status(None, "sent") == "sent"


def test_resolve_status_never_regresses():
    assert resolve_status("read", "delivered") is None
    assert resolve_status("delivered", "delivered") is None


def test_resolve_status_failed_terminal():
    assert resolve_status("sent", "failed") == "failed"
    assert resolve_status("failed", "delivered") is None
    assert resolve_status("failed", "failed") is None


# --- orchestrator -----------------------------------------------------------


def _seed_outbound(fs, conv_id="conv1", wamid="wamid.out", status="sent"):
    fs.conversations[conv_id] = {"conv_id": conv_id, "wa_id": "447700900123"}
    fs.messages[(conv_id, wamid)] = {"wamid": wamid, "direction": "outbound", "status": status}
    fs.outbound_index[wamid] = conv_id


def test_apply_status_advances_stored_message():
    fs = FakeFirestore()
    _seed_outbound(fs, status="sent")
    out = apply_status_update(
        StatusUpdate(wamid="wamid.out", status="delivered", timestamp="2026-01-01T00:00:00Z"),
        fs,
    )
    assert out == "applied"
    assert fs.messages[("conv1", "wamid.out")]["status"] == "delivered"


def test_apply_status_ignores_regression():
    fs = FakeFirestore()
    _seed_outbound(fs, status="read")
    out = apply_status_update(
        StatusUpdate(wamid="wamid.out", status="delivered", timestamp="2026-01-01T00:00:00Z"),
        fs,
    )
    assert out == "ignored"
    assert fs.messages[("conv1", "wamid.out")]["status"] == "read"


def test_apply_status_failed_records_error():
    fs = FakeFirestore()
    _seed_outbound(fs, status="sent")
    out = apply_status_update(
        StatusUpdate(wamid="wamid.out", status="failed", timestamp="2026-01-01T00:00:00Z",
                     error="Undeliverable"),
        fs,
    )
    assert out == "applied"
    assert fs.messages[("conv1", "wamid.out")]["status"] == "failed"
    assert fs.messages[("conv1", "wamid.out")]["error"] == "Undeliverable"


def test_apply_status_unknown_wamid_is_missing_no_create():
    fs = FakeFirestore()
    out = apply_status_update(
        StatusUpdate(wamid="ghost", status="read", timestamp="2026-01-01T00:00:00Z"), fs
    )
    assert out == "missing"
    assert fs.messages == {}
