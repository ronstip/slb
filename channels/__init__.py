"""Channel-agnostic communication contracts.

The canonical message model and the three handling interfaces
(``IdentityResolver``, ``Responder``, ``OutboundSender``) that any
communication Channel (WhatsApp now, Slack later) reuses. See
``docs/whatsapp-channel-impl-spec.md``.

Top-level package (peer of ``config/``) because both the API service
(webhook) and the worker service (handler) import it.
"""
