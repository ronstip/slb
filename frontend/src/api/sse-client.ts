import type { ChatRequest, SSEEvent } from './types.ts';
import { buildAuthHeaders } from './client.ts';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

/**
 * Global AbortController registry for in-flight chat SSE streams.
 * Lets impersonation start/stop (and sign-out) cancel every active stream
 * so they don't keep running with stale auth headers.
 */
const activeStreamControllers = new Set<AbortController>();

export function abortAllChatStreams(): void {
  for (const ctrl of activeStreamControllers) {
    try {
      ctrl.abort();
    } catch {
      // ignore
    }
  }
  activeStreamControllers.clear();
}

/**
 * POST-based SSE client using fetch + ReadableStream.
 * Native EventSource doesn't support POST or custom headers.
 *
 * Auth headers (including the `X-Impersonate-User-Id` header for "View as
 * User" sessions) come from the shared `buildAuthHeaders()` helper — do
 * NOT hand-roll them here, or SSE will bypass impersonation.
 */
export async function* streamChat(
  body: ChatRequest,
  externalSignal: AbortSignal,
): AsyncGenerator<SSEEvent> {
  // Wrap the caller's signal so we can also be aborted globally
  // (e.g. when impersonation toggles).
  const controller = new AbortController();
  const onExternalAbort = () => controller.abort();
  if (externalSignal.aborted) {
    controller.abort();
  } else {
    externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }
  activeStreamControllers.add(controller);

  try {
    const headers = await buildAuthHeaders({
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    });

    const response = await fetch(`${API_BASE}/chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Chat request failed: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';
    let pendingData = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.replace(/\r$/, '');
          if (trimmed.startsWith('event:')) {
            // Event type is embedded in the data JSON, skip
          } else if (trimmed.startsWith('data:')) {
            pendingData = trimmed.slice(5).trim();
          } else if (trimmed === '' && pendingData) {
            try {
              const parsed = JSON.parse(pendingData) as SSEEvent;
              yield parsed;
            } catch {
              console.warn('Failed to parse SSE data:', pendingData);
            }
            pendingData = '';
          }
        }
      }

      // Flush any remaining data when stream ends
      if (pendingData) {
        try {
          const parsed = JSON.parse(pendingData) as SSEEvent;
          yield parsed;
        } catch {
          console.warn('Failed to parse final SSE data:', pendingData);
        }
      }
    } finally {
      reader.releaseLock();
    }
  } finally {
    activeStreamControllers.delete(controller);
    externalSignal.removeEventListener('abort', onExternalAbort);
  }
}
