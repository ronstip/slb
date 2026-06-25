"""WhatsApp ``IdentityResolver`` (spec §2a): `number → User | Lobby`.

A single keyed read of `wa_number_index/{e164}`. A bound number resolves to
the owning User + the Organization data scope it inherits (ADR 0001); an
unrecognized number resolves to a Lobby.
"""

from channels.interfaces import IdentityResolver, ResolvedIdentity
from channels.whatsapp.client import normalize_e164


class WhatsAppIdentityResolver(IdentityResolver):
    def __init__(self, fs):
        self._fs = fs

    def resolve(self, wa_id: str) -> ResolvedIdentity:
        e164 = normalize_e164(wa_id)
        record = self._fs.resolve_wa_number(e164)
        if record and record.get("uid"):
            return ResolvedIdentity(
                kind="user", uid=record["uid"], org_id=record.get("org_id")
            )
        return ResolvedIdentity(kind="lobby")
