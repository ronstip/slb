# Authentication, Authorization & Session Persistence — Spec & Implementation

## Overview

The Social Listening Platform uses **Google Sign-In via Firebase** as its sole authentication mechanism. The backend verifies Firebase ID tokens on every request, provisions users on first login, and enforces user-scoped access control. Agent chat sessions persist across server restarts using Firestore.

---

## Architecture

```
Browser                     Backend (FastAPI)                Firestore
  |                              |                              |
  |-- Google Sign-In popup -->   |                              |
  |   (Firebase JS SDK)         |                              |
  |                              |                              |
  |-- API request ------------->|                              |
  |   Authorization: Bearer     |                              |
  |   <firebase_id_token>       |                              |
  |                              |-- verify_id_token() ------->|
  |                              |   (Firebase Admin SDK)       |
  |                              |                              |
  |                              |-- get/create user doc ------>|
  |                              |   users/{uid}                |
  |                              |                              |
  |                              |-- check collection access -->|
  |                              |   collection.user_id == uid  |
  |                              |                              |
  |<---- response --------------|                              |
```

### Dev Mode Bypass

When `settings.is_dev == True` and no `Authorization` header is provided, the backend returns a default user (`uid="default_user"`) without token verification. This preserves access to existing test data during development.

---

## Data Model

### Firestore Collections

#### `users/{firebase_uid}`

| Field          | Type           | Description                            |
|----------------|----------------|----------------------------------------|
| email          | string         | User's Google email                    |
| display_name   | string \| null | Display name from Google profile       |
| photo_url      | string \| null | Profile photo URL                      |
| org_id         | string \| null | Organization ID (null = personal)      |
| org_role       | string \| null | `"owner"`, `"admin"`, or `"member"`    |
| created_at     | timestamp      | First login timestamp                  |
| last_login_at  | timestamp      | Most recent login timestamp            |

#### `organizations/{auto_id}`

| Field      | Type           | Description                                     |
|------------|----------------|-------------------------------------------------|
| name       | string         | Organization display name                       |
| slug       | string         | URL-friendly unique name                        |
| owner_uid  | string         | Firebase UID of the org creator                 |
| domain     | string \| null | Email domain for auto-join (e.g. `"acme.com"`)  |
| created_at | timestamp      | Creation timestamp                              |

#### `sessions/{session_id}`

| Field            | Type    | Description                          |
|------------------|---------|--------------------------------------|
| session_id       | string  | Unique session identifier            |
| app_name         | string  | ADK application name                 |
| user_id          | string  | Firebase UID (verified on read)      |
| state            | map     | ADK session state                    |
| events_json      | array   | Serialized ADK event history         |
| last_update_time | float   | Timestamp of last update             |

#### `collection_status/{collection_id}`

Added fields (existing collection):

| Field   | Type           | Description                    |
|---------|----------------|--------------------------------|
| user_id | string         | Creator's Firebase UID         |
| org_id  | string \| null | Creator's org at creation time |

### BigQuery Schema Change

`collections` table gained an `org_id STRING` column:

```sql
ALTER TABLE `social-listening-pl.social_listening.collections` ADD COLUMN org_id STRING;
```

---

## Access Control Rules

### Current (v1) — User-Scoped Only

A user can see a collection if `collection.user_id == user.uid`.

The `org_id` is stored on collections for future org-wide sharing, but listing/access queries filter by `user_id` only. This prevents users from being overwhelmed by teammates' collections before proper filtering UI is built.

### Future (v2) — Organization Sharing

When org-wide sharing is enabled, the access rule will expand to:

```
collection.user_id == user.uid OR collection.org_id == user.org_id
```

---

## Backend Implementation

### Files

| File | Purpose |
|------|---------|
| `api/auth/__init__.py` | Package init |
| `api/auth/firebase_init.py` | One-time `firebase_admin.initialize_app()` |
| `api/auth/dependencies.py` | `CurrentUser` dataclass + `get_current_user` FastAPI dependency |
| `api/auth/session_service.py` | `FirestoreSessionService` — persistent ADK sessions |
| `api/main.py` | Routes with `Depends(get_current_user)` |
| `workers/shared/firestore_client.py` | User/org CRUD methods |

### `CurrentUser` Dataclass

```python
@dataclass
class CurrentUser:
    uid: str
    email: str
    display_name: str | None
    org_id: str | None
    org_role: str | None
```

### `get_current_user` Dependency

Injected via `Depends(get_current_user)` on all authenticated routes:

1. **Dev mode** (no auth header + `is_dev`): returns `CurrentUser(uid="default_user", ...)`
2. **Production**: extracts `Bearer` token, calls `firebase_admin.auth.verify_id_token()`, then lazy-provisions the user in Firestore via `_get_or_create_user()`

### Lazy User Provisioning (`_get_or_create_user`)

On first login:
1. Check if `users/{uid}` doc exists in Firestore
2. If exists: update `last_login_at`, return existing doc
3. If new user:
   - Extract email domain
   - Check if any organization has a matching `domain` field
   - If match found: set `org_id` and `org_role="member"` (domain auto-join)
   - Create user doc with Google profile data (email, display name, photo URL)

### Session Persistence (`FirestoreSessionService`)

Implements ADK's `BaseSessionService`:

- **`create_session()`**: Creates a Firestore doc at `sessions/{session_id}`
- **`get_session()`**: Reads from Firestore, verifies `user_id` matches the caller
- **`list_sessions()`**: Lists sessions filtered by `app_name` and `user_id`
- **`delete_session()`**: Deletes the session doc
- **`append_event()`**: Delegates to base class for state delta processing, then persists

Events are serialized as JSON via Pydantic's `model_dump(mode="json")`.

### API Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/me` | Required | Returns current user profile |
| POST | `/chat` | Required | SSE agent chat stream |
| POST | `/collections` | Required | Create collection |
| GET | `/collections` | Required | List user's collections |
| GET | `/collections/{id}/posts` | Required | Paginated posts (access-checked) |
| GET | `/collection/{id}` | Required | Collection status (access-checked) |
| POST | `/orgs` | Required | Create organization |
| GET | `/orgs/me` | Required | Get org details + members |
| DELETE | `/orgs/me/leave` | Required | Leave organization |
| GET | `/health` | None | Health check |
| GET | `/media/{path}` | None | GCS media proxy |
| GET | `/media-proxy` | None | External URL media proxy |

### Organization Management

- **Create org**: `POST /orgs` with `{ name, domain? }`. Creator becomes owner. Only one org per user.
- **Auto-join**: When a new user's email domain matches an org's `domain` field, they are automatically assigned to that org as a `member`.
- **Leave org**: `DELETE /orgs/me/leave`. Owners cannot leave without transferring ownership.
- **No invite system**: Joining is via domain auto-join only.

---

## Frontend Implementation

### Files

| File | Purpose |
|------|---------|
| `frontend/src/auth/firebase.ts` | Firebase JS SDK initialization |
| `frontend/src/auth/AuthProvider.tsx` | React context provider — auth state, sign-in/out, profile, store resets |
| `frontend/src/auth/useAuth.ts` | `useAuth()` hook |
| `frontend/src/auth/SignInPage.tsx` | Google sign-in UI |
| `frontend/src/api/client.ts` | HTTP client with auto-injected Bearer token |
| `frontend/src/App.tsx` | Auth gate — renders `SignInPage` or `AppShell` |

### Auth Flow

1. **Firebase initialization** (`firebase.ts`): Conditionally initializes Firebase app and Google auth provider from `VITE_FIREBASE_*` env vars. If `VITE_FIREBASE_API_KEY` is not set, `isFirebaseConfigured = false` (dev mode).

2. **AuthProvider** wraps the app inside `QueryClientProvider`:
   - Registers a `tokenGetter` that calls `firebase.currentUser.getIdToken()`
   - Listens to `onAuthStateChanged` — on sign-in, fetches `GET /me` to get backend profile
   - Exposes: `user`, `profile`, `loading`, `signIn`, `signOut`, `getToken`, `refreshProfile`, `devMode`

3. **App.tsx** auth gate:
   - If `loading`: show spinner
   - If `devMode` or `user`: render `AppShell`
   - Otherwise: render `SignInPage`

4. **API client** (`client.ts`): The `setTokenGetter` function is called once by AuthProvider. All `apiGet`/`apiPost` calls automatically include `Authorization: Bearer <token>` when a token is available.

### State Reset on Sign-Out

When a user signs out, the following are cleared to prevent data leaking between sessions:

1. **Firebase auth**: `firebaseSignOut(auth)`
2. **User profile**: `setProfile(null)`
3. **Chat store**: messages, sessionId reset
4. **Session store**: session list cleared + `localStorage('slp-sessions')` removed
5. **Sources store**: sources array cleared
6. **Studio store**: artifacts, tabs, expanded state reset
7. **React Query cache**: `queryClient.clear()` drops all cached API responses

### Environment Variables (Frontend)

| Variable | Description |
|----------|-------------|
| `VITE_API_URL` | Backend URL (default: `http://localhost:8000`) |
| `VITE_FIREBASE_API_KEY` | Firebase Web API key |
| `VITE_FIREBASE_AUTH_DOMAIN` | Firebase auth domain |
| `VITE_FIREBASE_PROJECT_ID` | GCP/Firebase project ID |
| `VITE_FIREBASE_STORAGE_BUCKET` | Firebase storage bucket |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Firebase messaging sender ID |
| `VITE_FIREBASE_APP_ID` | Firebase web app ID |

---

## Configuration

### Backend

- **Firebase Admin SDK**: Uses `GOOGLE_APPLICATION_CREDENTIALS` env var or default GCP service account credentials. No Firebase-specific backend config needed.
- **`settings.is_dev`**: Controls whether the dev mode auth bypass is active.

### Firebase Console Setup

1. Firebase added to GCP project `social-listening-pl`
2. Identity Platform enabled (Google provider)
3. Web app registered (config in `frontend/.env`)
4. Authorized domains: `social-listening-pl.firebaseapp.com`, `localhost`

---

## Migration Notes

- All `org_id` columns/fields are nullable — existing data works without migration
- Dev mode bypass uses `uid="default_user"` matching existing test data
- Existing `default_user` collections remain accessible in dev mode
- New real users get Firebase UIDs; old test data stays orphaned but harmless

---

## Verification Checklist

1. **Dev mode**: Backend without Firebase config serves requests using `default_user` identity
2. **Sign-in flow**: Google sign-in popup → redirect → `GET /me` returns profile → app loads
3. **Collection scoping**: Each user sees only their own collections in `GET /collections`
4. **Access control**: User A gets 403 when accessing User B's collection posts
5. **User switch**: Sign out → sign in as different user → fresh state, no stale data
6. **Org creation**: Create org with domain → new user with matching email auto-joins
7. **Session persistence**: Send chat messages → restart backend → resume same conversation
