"""Shared in-memory fakes for WhatsApp channel tests (not collected by pytest
— leading underscore). Backs the real handler/sender/resolver/status code so
tests exercise production logic without Firestore or network."""

from datetime import datetime, timezone


class FakeFirestore:
    def __init__(self):
        self.conversations: dict[str, dict] = {}
        self.pointers: dict[str, str] = {}  # wa_id -> conv_id
        self.messages: dict[tuple[str, str], dict] = {}
        self.number_index: dict[str, dict] = {}  # e164 -> {uid, org_id}
        self.users: dict[str, dict] = {}
        self.outbound_index: dict[str, str] = {}  # wamid -> conv_id
        self.windows: list[tuple] = []
        self._seq = 0

    # identity / consent
    def resolve_wa_number(self, e164):
        return self.number_index.get(e164)

    def bind_wa_number(self, uid, e164, org_id=None):
        self.number_index[e164] = {"uid": uid, "org_id": org_id}
        self.users.setdefault(uid, {}).setdefault("wa_numbers", []).append({"e164": e164})

    def set_wa_opt_out(self, uid, opted_out):
        self.users.setdefault(uid, {})["wa_opt_out"] = opted_out

    def get_wa_opt_out(self, uid):
        return bool(self.users.get(uid, {}).get("wa_opt_out"))

    def get_user(self, uid):
        return self.users.get(uid)

    def set_conversation_session(self, conv_id, session_id):
        if conv_id in self.conversations:
            self.conversations[conv_id]["session_id"] = session_id

    # conversations
    def get_or_create_wa_conversation(self, wa_id, uid=None, org_id=None):
        if wa_id in self.pointers:
            return self.conversations[self.pointers[wa_id]]
        self._seq += 1
        conv_id = f"conv{self._seq}"
        bound = uid is not None
        now = datetime.now(timezone.utc)
        conv = {
            "conv_id": conv_id, "wa_id": wa_id, "user_id": uid, "org_id": org_id,
            "channel": "whatsapp",
            "attachment_state": "attached" if bound else "lobby",
            "responder": "concierge" if bound else "scripted",
            "window_open": False, "session_id": None,
            "purge_at": None if bound else now,  # tests set explicit purge_at
        }
        self.conversations[conv_id] = conv
        self.pointers[wa_id] = conv_id
        return conv

    def get_conversation(self, conv_id):
        return self.conversations.get(conv_id)

    def get_active_conversation(self, wa_id):
        cid = self.pointers.get(wa_id)
        return self.conversations.get(cid) if cid else None

    def append_channel_message(self, conv_id, msg):
        key = (conv_id, msg["wamid"])
        if key in self.messages:
            return False
        self.messages[key] = msg
        return True

    def set_window(self, conv_id, window_open, last_inbound_at=None):
        self.windows.append((conv_id, window_open, last_inbound_at))
        if conv_id in self.conversations:
            self.conversations[conv_id]["window_open"] = window_open
            self.conversations[conv_id]["last_inbound_at"] = last_inbound_at

    def attach_conversation_identity(self, conv_id, uid, org_id):
        conv = self.conversations[conv_id]
        conv.update({
            "user_id": uid, "org_id": org_id,
            "attachment_state": "attached", "responder": "concierge",
        })

    def list_orphaned_lobbies(self, now=None):
        cutoff = now or datetime.now(timezone.utc)
        out = []
        for conv in self.conversations.values():
            if conv.get("attachment_state") != "lobby":
                continue
            pa = conv.get("purge_at")
            if pa and pa < cutoff:
                out.append(conv)
        return out

    def delete_conversation(self, conv_id):
        conv = self.conversations.pop(conv_id, None)
        if conv:
            self.pointers.pop(conv.get("wa_id"), None)
        for key in [k for k in self.messages if k[0] == conv_id]:
            del self.messages[key]

    # outbound status
    def index_outbound_message(self, wamid, conv_id):
        self.outbound_index[wamid] = conv_id

    def get_outbound_conversation(self, wamid):
        return self.outbound_index.get(wamid)

    def get_message(self, conv_id, wamid):
        return self.messages.get((conv_id, wamid))

    def update_message_status(self, conv_id, wamid, status, error=None, ts=None):
        msg = self.messages.get((conv_id, wamid))
        if msg is not None:
            msg["status"] = status
            if error is not None:
                msg["error"] = error


class FakeClient:
    def __init__(self, wamid="wamid.out"):
        self.calls: list = []
        self._wamid = wamid

    def send_text(self, to, body):
        self.calls.append(("text", to, body))
        return self._wamid

    def send_template(self, to, name, language, components=None):
        self.calls.append(("template", to, name))
        return self._wamid


def text_payload(wamid="wamid.1", body="hello", frm="447700900123"):
    return {
        "object": "whatsapp_business_account",
        "entry": [
            {
                "changes": [
                    {
                        "field": "messages",
                        "value": {
                            "messages": [
                                {
                                    "from": frm,
                                    "id": wamid,
                                    "timestamp": "1700000000",
                                    "type": "text",
                                    "text": {"body": body},
                                }
                            ]
                        },
                    }
                ]
            }
        ],
    }


def status_payload(wamid="wamid.out", status="delivered"):
    return {
        "entry": [
            {
                "changes": [
                    {
                        "field": "messages",
                        "value": {
                            "statuses": [
                                {"id": wamid, "status": status, "timestamp": "1700000005"}
                            ]
                        },
                    }
                ]
            }
        ]
    }
