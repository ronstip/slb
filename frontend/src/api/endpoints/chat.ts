import type { ChatRequest, SSEEvent } from '../types.ts';
import { streamChat } from '../sse-client.ts';

export function sendMessage(
  body: ChatRequest,
  getToken: () => Promise<string | null>,
  signal: AbortSignal,
): AsyncGenerator<SSEEvent> {
  return streamChat(body, getToken, signal);
}
