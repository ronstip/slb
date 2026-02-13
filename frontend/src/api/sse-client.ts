import type { ChatRequest, SSEEvent } from './types.ts';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

/**
 * POST-based SSE client using fetch + ReadableStream.
 * Native EventSource doesn't support POST or custom headers.
 */
export async function* streamChat(
  body: ChatRequest,
  getToken: () => Promise<string | null>,
  signal: AbortSignal,
): AsyncGenerator<SSEEvent> {
  const token = await getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
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
}
