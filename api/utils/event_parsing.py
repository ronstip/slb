"""Parse ADK events into the frontend-facing SSE dict shape.

The SSE consumer on the frontend (useSSEChat.ts, session-reconstructor.ts)
expects a specific JSON shape per event_type. This module owns that contract.
"""

import re


def extract_event_data(event, suppress_text: bool = False, suppress_thinking: bool = False) -> list[dict]:
    """Extract structured data from all parts of an ADK event.

    An event may contain multiple parts (e.g. a text/thinking part followed by
    a function_call in the same model turn). All parts are processed and
    returned as a list so downstream tool-result handling never drops a part.

    Args:
        event: The ADK event to process.
        suppress_text: Skip emitting 'text' events when text was already
            streamed via partial events (prevents duplication).
        suppress_thinking: Skip emitting 'thinking' events when thinking was
            already streamed via partial events.
    """
    if not event.content or not event.content.parts:
        return []

    results = []
    for part in event.content.parts:
        if part.text:
            if getattr(part, "thought", False):
                if not suppress_thinking:
                    thought_text = part.text.strip()
                    if thought_text:
                        results.append({
                            "event_type": "thinking",
                            "content": thought_text,
                            "author": event.author,
                        })
            else:
                clean = re.sub(r"<!--[\s\S]*?-->", "", part.text).strip()
                if clean and not suppress_text:
                    results.append({
                        "event_type": "text",
                        "content": clean,
                        "author": event.author,
                    })
        elif part.function_call:
            if part.function_call.name == "transfer_to_agent":
                continue
            results.append({
                "event_type": "tool_call",
                "content": part.function_call.name,
                "metadata": {
                    "name": part.function_call.name,
                    "args": dict(part.function_call.args) if part.function_call.args else {},
                },
                "author": event.author,
            })
        elif part.function_response:
            if part.function_response.name == "transfer_to_agent":
                continue
            response_data = {}
            if part.function_response.response:
                try:
                    response_data = dict(part.function_response.response)
                except (TypeError, ValueError):
                    response_data = {}
            results.append({
                "event_type": "tool_result",
                "content": part.function_response.name,
                "metadata": {
                    "name": part.function_response.name,
                    "result": response_data,
                },
                "author": event.author,
            })
    return results


def extract_final_text(event) -> str:
    """Extract text content from a final response event (excludes thought tokens)."""
    if not event.content or not event.content.parts:
        return ""
    texts = [
        part.text for part in event.content.parts
        if part.text and not getattr(part, "thought", False)
    ]
    return "\n".join(texts)
