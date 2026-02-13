"""One-time Firebase Admin SDK initialization."""

import firebase_admin


def init_firebase() -> None:
    """Initialize Firebase Admin SDK if not already initialized.

    Uses GOOGLE_APPLICATION_CREDENTIALS env var or default GCP service account.
    """
    if not firebase_admin._apps:
        firebase_admin.initialize_app()
