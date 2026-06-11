import { describe, it, expect } from 'vitest';
import type { CustomFieldDef } from '../../../api/types.ts';
import {
  isCustomFieldDimension,
  getDimensionMeta,
  conditionFieldKind,
  isPostCountCondition,
  operatorsForConditionField,
} from './types-social-dashboard.ts';

describe('isCustomFieldDimension', () => {
  it('returns true for custom-prefixed dimensions', () => {
    expect(isCustomFieldDimension('custom:my_field')).toBe(true);
  });

  it('returns false for standard dimensions', () => {
    expect(isCustomFieldDimension('platform')).toBe(false);
  });

  // Regression: malformed widget configs in saved layouts can have an
  // undefined `dimension`. Crashing here brought down the whole dashboard
  // (TypeError: Cannot read properties of undefined (reading 'startsWith')).
  it('does not crash on undefined/null', () => {
    expect(isCustomFieldDimension(undefined as never)).toBe(false);
    expect(isCustomFieldDimension(null as never)).toBe(false);
  });
});

describe('getDimensionMeta', () => {
  it('returns the standard meta for known dimensions', () => {
    expect(getDimensionMeta('platform').label).toBe('Platform');
  });

  it('returns a fallback meta for undefined/null instead of crashing', () => {
    expect(getDimensionMeta(undefined as never).label).toBeTruthy();
    expect(getDimensionMeta(null as never).label).toBeTruthy();
  });
});

describe('isPostCountCondition', () => {
  it('is true only for the post_count field', () => {
    expect(isPostCountCondition({ field: 'post_count', operator: 'greaterThan', value: 1 })).toBe(true);
    expect(isPostCountCondition({ field: 'like_count', operator: 'greaterThan', value: 1 })).toBe(false);
  });
});

describe('conditionFieldKind', () => {
  const defs: CustomFieldDef[] = [
    { name: 'score', type: 'int' } as CustomFieldDef,
    { name: 'note', type: 'str' } as CustomFieldDef,
    { name: 'tier', type: 'literal', options: ['a', 'b'] } as CustomFieldDef,
    { name: 'tags', type: 'list[str]' } as CustomFieldDef,
  ];

  it('classifies built-in field families', () => {
    expect(conditionFieldKind('like_count')).toBe('numeric');
    expect(conditionFieldKind('posted_at')).toBe('date');
    expect(conditionFieldKind('text')).toBe('text');
    expect(conditionFieldKind('post_count')).toBe('postCount');
    expect(conditionFieldKind('sentiment')).toBe('categorical');
    expect(conditionFieldKind('themes')).toBe('categorical');
  });

  it('resolves custom fields from their defs', () => {
    expect(conditionFieldKind('custom:score', defs)).toBe('numeric');
    expect(conditionFieldKind('custom:note', defs)).toBe('text');
    expect(conditionFieldKind('custom:tier', defs)).toBe('categorical');
    expect(conditionFieldKind('custom:tags', defs)).toBe('categorical');
  });

  it('falls back to categorical for object leaves and unknown custom fields', () => {
    expect(conditionFieldKind('custom:men.name', defs)).toBe('categorical');
    expect(conditionFieldKind('custom:unknown')).toBe('categorical');
  });

  it('maps kinds to operator sets', () => {
    expect(operatorsForConditionField('sentiment')).toEqual(['isAnyOf', 'isNoneOf']);
    expect(operatorsForConditionField('post_count')).toContain('greaterThan');
    expect(operatorsForConditionField('custom:note', defs)).toContain('contains');
  });
});
