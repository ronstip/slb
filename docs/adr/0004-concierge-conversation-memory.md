# Concierge conversation memory — persist, window, and a per-user memory block

The WhatsApp **Concierge** felt amnesiac: every message read as standalone, with no recollection of earlier ones in the same chat. Root cause was a missing persistence step, not a design choice — the Responder created/loaded an ADK **Session** and pinned its id on the Conversation, but never **flushed** it. The Runner's freshly-appended events lived only in memory and died with the worker process, so each inbound webhook loaded an empty Session. (Web chat flushes via `restore_and_flush`; the Concierge path did not.)

Fixing persistence alone replays the *entire* thread to the model every turn — slow, costly, and blind to topic. We reviewed the field (buffer/window, summarization buffer, vector recall, MemGPT/Letta self-editing memory blocks, topic-shift segmentation) and adopted a **layered hybrid** rather than a single knob. We explicitly rejected a fixed-time "reset the conversation after N hours" boundary as the primary mechanism: it discards good context and keeps stale context, blind to what the conversation is actually about.

## Decision

Three layers, smallest-blast-radius first:

- **Layer 0 — Persist.** Flush the Session at the end of each Concierge turn (`session_service.flush(session)`), so the next message sees prior turns. This is the actual bug fix.
- **Layer 1 — Window.** Replay only the last `_CONCIERGE_MAX_USER_TURNS` (=10) user turns to the LLM, trimming for the model but restoring the full prefix before persisting — history stored is always complete. Mirror of web chat's `window_events_for_llm`, kept local to the Concierge (its turn budget differs and it isn't agent-scoped).
- **Layer 2 — Per-user memory block.** A small distilled "what I know about this user" block (MemGPT-style *Human* block) on the user doc (`concierge_memory`), injected into the prompt every turn so durable facts (name, role, recurring interests, tracked brands/agents, stated preferences) survive windowing. A cheap, no-thinking distiller runs once per turn, best-effort, and merges new durable facts into the block — dropping one-off data questions and transient numbers. It runs **after the reply is sent** (in `ConciergeResponder.handle`, not inside the ADK run), so it adds **zero user-visible latency** — the distill still executes inside the same Cloud Tasks worker invocation (CPU allocated, no Cloud Run freeze risk), just off the time-to-reply path.

## Considered options

- **Fixed-time session reset (e.g. fresh thread after 24h idle)** — rejected as the primary boundary: clock-based forgetting ignores topic and context quality. May still be added later as a *soft* signal on top of windowing.
- **Replay full history every turn** — rejected: unbounded tokens/latency, and the low-thinking WhatsApp budget can't absorb it.
- **MemGPT-style self-editing memory via a tool the Concierge calls** — deferred: cleaner (zero extra call on turns with nothing to remember) but less deterministic under low thinking and mutates state mid-turn. The post-turn distiller is simpler and unit-testable now; revisit if latency from the extra call bites.

## Consequences

- The distiller adds one cheap LLM call per turn, but it runs *after* `send_text`, so it costs the user nothing in latency — only a bit of extra worker compute. If that compute cost matters later, fold the memory update into the Concierge's own reply generation (one call, dual output) or the tool-based approach above.
- `concierge_memory` is per-**User** (not per-Conversation), so it persists across re-links and is the natural home for cross-channel memory when Slack et al. arrive.
- The block is injected as background context, explicitly subordinate to the user's current message, to avoid it overriding live intent.
- Pure seams (windowing, distiller merge, block injection) are unit-tested in `api/tests/test_concierge_memory.py`; the live ADK flush is integration-only (no Vertex creds in CI), consistent with the existing Concierge run.
