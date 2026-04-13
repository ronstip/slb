import type { ChatRequest, SSEEvent } from '../types.ts';
import { streamChat } from '../sse-client.ts';

export function sendMessage(
  body: ChatRequest,
  signal: AbortSignal,
): AsyncGenerator<SSEEvent> {
  return streamChat(body, signal);
}
