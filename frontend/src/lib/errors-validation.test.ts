import { describe, it, expect } from 'vitest';
import { parseError } from './errors.ts';
import { mapError } from './notify.ts';
import { ApiError } from '../api/client.ts';

// FastAPI request-validation failures (422) return `detail` as an ARRAY of
// per-field errors, not the `{ error, message }` object our handlers use. The
// old code stringified that array into the toast, so users saw a wall of raw
// Pydantic JSON (e.g. when saving a layout with a field the backend rejects).
// parseError must not surface the raw body, and mapError must show a friendly
// line for any 422.

const VALIDATION_BODY = JSON.stringify({
  detail: [
    {
      type: 'literal_error',
      loc: ['body', 'layout', 6, 'chartType'],
      msg: "Input should be 'bar', 'pie', ...",
      input: 'heatmap',
    },
    {
      type: 'string_pattern_mismatch',
      loc: ['body', 'layout', 6, 'customConfig', 'dimension'],
      msg: "String should match pattern '^custom:[^\\s]+$'",
      input: 'hour_of_day',
    },
  ],
});

describe('parseError - FastAPI 422 (array detail)', () => {
  it('keeps the status but never surfaces the raw JSON body as the message', () => {
    const p = parseError(new ApiError(422, VALIDATION_BODY));
    expect(p.status).toBe(422);
    expect(p.message).not.toContain('literal_error');
    expect(p.message).not.toContain('{');
    expect(p.message.length).toBeLessThan(120);
  });
});

describe('mapError - 422', () => {
  it('maps a validation error to a short, human message (not raw JSON)', () => {
    const plan = mapError(parseError(new ApiError(422, VALIDATION_BODY)));
    expect(plan.silent).toBe(false);
    expect(plan.title).not.toContain('literal_error');
    expect(plan.title).not.toContain('{');
    expect(plan.title.length).toBeGreaterThan(0);
    expect(plan.title.length).toBeLessThan(120);
  });
});
