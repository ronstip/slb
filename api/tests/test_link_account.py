"""Tests for `POST /auth/link-account` anonymous → real-account migration.

Regression: when an anonymous Firebase session is replaced by a *new* uid
(the `auth/credential-already-in-use` path on the client, or any flow where the
linked uid differs), the migration copied the anonymous user doc - whose
`email` is "" - to the new uid and only flipped `is_anonymous=False`. It never
backfilled the real email/display_name from the now-authenticated identity, so
the new-uid `users` doc kept a blank email. `/me` still looked fine (it reads
the email from the Firebase token, not Firestore), but the admin Users list -
which reads Firestore - showed a blank-email row that was easy to overlook.

The fix backfills identity from the authenticated `CurrentUser` during the copy.
"""

from __future__ import annotations

import asyncio

from api.auth import dependencies as auth_deps
from api.auth.dependencies import CurrentUser
from api.routers import auth as auth_router


class _FakeDocRef:
    def __init__(self, deleted: list[str], uid: str):
        self._deleted = deleted
        self._uid = uid

    def update(self, _fields):  # session.state rewrites - unused here
        pass

    def delete(self):
        self._deleted.append(self._uid)


class _FakeCollection:
    """Answers the two collections link_account touches: empty `sessions`
    query + `users/{uid}` doc refs (for the old-doc delete)."""

    def __init__(self, deleted: list[str]):
        self._deleted = deleted

    def where(self, *_a, **_kw):
        return self

    def stream(self):
        return iter(())  # no anonymous sessions to migrate

    def document(self, uid):
        return _FakeDocRef(self._deleted, uid)


class _FakeDB:
    def __init__(self, deleted: list[str]):
        self._deleted = deleted

    def collection(self, _name):
        return _FakeCollection(self._deleted)


class _MigrationFS:
    """Anonymous old-uid doc exists (email=""); new uid has no doc yet."""

    def __init__(self):
        self.deleted: list[str] = []
        self.created: dict | None = None
        self.created_uid: str | None = None
        self._db = _FakeDB(self.deleted)

    def get_user(self, uid):
        if uid == "old_anon_uid":
            return {"email": "", "is_anonymous": True, "org_id": None,
                    "plan": {"tier": "blocked"}}
        return None  # new uid not provisioned yet

    def create_user(self, uid, data):
        self.created_uid = uid
        self.created = dict(data)


def _run(coro):
    return asyncio.run(coro)


def test_link_account_backfills_real_email_on_new_uid(monkeypatch):
    fake = _MigrationFS()
    monkeypatch.setattr(auth_router, "get_fs", lambda: fake)

    user = CurrentUser(
        uid="new_real_uid",
        email="ron@scolto.com",
        display_name="Ron Neeman",
        org_id=None,
        org_role=None,
        is_anonymous=False,
    )
    body = auth_router.LinkAccountRequest(old_uid="old_anon_uid")

    result = _run(auth_router.link_account(body, user=user))

    assert result["migrated"] is True
    # The migrated doc must carry the REAL identity, not the anonymous email="".
    assert fake.created_uid == "new_real_uid"
    assert fake.created is not None
    assert fake.created["email"] == "ron@scolto.com"
    assert fake.created["display_name"] == "Ron Neeman"
    assert fake.created["is_anonymous"] is False
    # Old anonymous doc cleaned up.
    assert "old_anon_uid" in fake.deleted


class _BlankEmailFS:
    """A non-anonymous user doc that lost its email (e.g. migrated by an older
    link-account). `_get_or_create_user` must self-heal it from the token."""

    def __init__(self):
        self._existing = {"email": "", "is_anonymous": False, "org_id": None,
                          "display_name": None}
        self.updates: dict = {}

    def get_user(self, _uid):
        return dict(self._existing)

    def update_user(self, _uid, **fields):
        self.updates.update(fields)


def test_get_or_create_self_heals_blank_email_on_nonanon_doc(monkeypatch):
    fake = _BlankEmailFS()
    monkeypatch.setattr(auth_deps, "get_fs", lambda: fake)
    # Avoid a real last_login write throttling interfering.
    auth_deps._last_login_written.pop("uid_heal", None)

    auth_deps._get_or_create_user(
        "uid_heal",
        {"email": "ron@scolto.com", "name": "Ron Neeman", "picture": None},
        is_anonymous=False,
    )

    assert fake.updates.get("email") == "ron@scolto.com"
    assert fake.updates.get("display_name") == "Ron Neeman"
