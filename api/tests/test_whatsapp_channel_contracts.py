"""Phase 0 — channel contracts: message model, signature verify, payload
normalization (spec/plan phase 0). Pure, no network, no Firestore."""

import hashlib
import hmac

from channels.message import STATUS_RANK, CanonicalMessage
from channels.whatsapp.client import (
    normalize_e164,
    normalize_inbound,
    parse_statuses,
    verify_signature,
)


# --- message model ----------------------------------------------------------


def test_canonical_message_roundtrips():
    msg = CanonicalMessage(
        wamid="wamid.ABC",
        channel="whatsapp",
        direction="inbound",
        type="text",
        text="hi",
        created_at="2026-01-01T00:00:00Z",
        received_at="2026-01-01T00:00:01Z",
    )
    dumped = msg.model_dump()
    again = CanonicalMessage.model_validate(dumped)
    assert again.wamid == "wamid.ABC"
    assert again.status == "received"  # default
    assert again.media == []


def test_status_rank_is_monotonic():
    assert STATUS_RANK["sent"] < STATUS_RANK["delivered"] < STATUS_RANK["read"]


# --- signature verification -------------------------------------------------


def _sign(body: bytes, secret: str) -> str:
    return "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


def test_verify_signature_accepts_good_hmac():
    body = b'{"object":"whatsapp_business_account"}'
    secret = "s3cr3t"
    assert verify_signature(body, _sign(body, secret), secret) is True


def test_verify_signature_rejects_bad_hmac():
    body = b'{"object":"whatsapp_business_account"}'
    assert verify_signature(body, _sign(body, "wrong"), "s3cr3t") is False


def test_verify_signature_rejects_missing_or_malformed():
    body = b"x"
    assert verify_signature(body, "", "s3cr3t") is False
    assert verify_signature(body, "deadbeef", "s3cr3t") is False  # no sha256= prefix
    assert verify_signature(body, _sign(body, "s"), "") is False  # no secret


def test_normalize_e164_strips_non_digits():
    assert normalize_e164("+44 770-090 0123") == "447700900123"
    assert normalize_e164(None) == ""


# --- inbound normalization --------------------------------------------------


def _text_payload(wamid="wamid.1", body="hello", frm="447700900123"):
    return {
        "object": "whatsapp_business_account",
        "entry": [
            {
                "id": "WABA",
                "changes": [
                    {
                        "field": "messages",
                        "value": {
                            "messaging_product": "whatsapp",
                            "metadata": {"phone_number_id": "PNID"},
                            "contacts": [{"wa_id": frm}],
                            "messages": [
                                {
                                    "from": frm,
                                    "id": wamid,
                                    "timestamp": "1700000000",
                                    "type": "text",
                                    "text": {"body": body},
                                }
                            ],
                        },
                    }
                ],
            }
        ],
    }


def test_normalize_inbound_text():
    msgs = normalize_inbound(_text_payload())
    assert len(msgs) == 1
    m = msgs[0]
    assert m.wamid == "wamid.1"
    assert m.type == "text"
    assert m.text == "hello"
    assert m.wa_id == "447700900123"
    assert m.direction == "inbound"
    assert m.channel == "whatsapp"
    assert m.raw is not None


def test_normalize_inbound_media_image():
    payload = _text_payload()
    payload["entry"][0]["changes"][0]["value"]["messages"][0] = {
        "from": "447700900123",
        "id": "wamid.img",
        "timestamp": "1700000000",
        "type": "image",
        "image": {
            "id": "MEDIA123",
            "mime_type": "image/jpeg",
            "sha256": "abc",
            "caption": "look",
        },
    }
    msgs = normalize_inbound(payload)
    assert len(msgs) == 1
    m = msgs[0]
    assert m.type == "image"
    assert m.text == "look"  # caption surfaces as text
    assert len(m.media) == 1
    assert m.media[0].wa_media_id == "MEDIA123"
    assert m.media[0].gcs_uri is None  # download deferred


def test_normalize_inbound_unknown_type_becomes_system():
    payload = _text_payload()
    payload["entry"][0]["changes"][0]["value"]["messages"][0] = {
        "from": "447700900123",
        "id": "wamid.loc",
        "timestamp": "1700000000",
        "type": "location",
        "location": {"latitude": 1, "longitude": 2},
    }
    msgs = normalize_inbound(payload)
    assert msgs[0].type == "system"


def test_normalize_inbound_ignores_status_only_payload():
    status_payload = {
        "object": "whatsapp_business_account",
        "entry": [
            {
                "changes": [
                    {
                        "field": "messages",
                        "value": {"statuses": [{"id": "x", "status": "read"}]},
                    }
                ]
            }
        ],
    }
    assert normalize_inbound(status_payload) == []


# --- status parsing ---------------------------------------------------------


def test_parse_statuses():
    payload = {
        "object": "whatsapp_business_account",
        "entry": [
            {
                "changes": [
                    {
                        "field": "messages",
                        "value": {
                            "statuses": [
                                {
                                    "id": "wamid.out",
                                    "status": "delivered",
                                    "timestamp": "1700000005",
                                    "recipient_id": "447700900123",
                                }
                            ]
                        },
                    }
                ]
            }
        ],
    }
    updates = parse_statuses(payload)
    assert len(updates) == 1
    assert updates[0].wamid == "wamid.out"
    assert updates[0].status == "delivered"
    assert updates[0].recipient_id == "447700900123"


def test_parse_statuses_failed_carries_error():
    payload = {
        "entry": [
            {
                "changes": [
                    {
                        "field": "messages",
                        "value": {
                            "statuses": [
                                {
                                    "id": "wamid.fail",
                                    "status": "failed",
                                    "timestamp": "1700000005",
                                    "errors": [{"code": 131026, "title": "Undeliverable"}],
                                }
                            ]
                        },
                    }
                ]
            }
        ]
    }
    updates = parse_statuses(payload)
    assert updates[0].status == "failed"
    assert updates[0].error == "Undeliverable"
