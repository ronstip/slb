import { describe, it, expect } from 'vitest';
import { canPersistDesktopLayout, layoutHasGeometryChange, LG_MIN_WIDTH } from './layout-persist-guard.ts';

describe('canPersistDesktopLayout', () => {
  it('persists on a desktop-width container in edit mode', () => {
    expect(canPersistDesktopLayout(true, false, 1280)).toBe(true);
  });

  it('persists exactly at the lg threshold', () => {
    expect(canPersistDesktopLayout(true, false, LG_MIN_WIDTH)).toBe(true);
  });

  it('REFUSES to persist at an xs (mobile) width - the corruption case', () => {
    // RGL handed us the 2-col compact layout while currentBreakpoint was still
    // a stale 'lg'. Gating on width (360 < 600) blocks the bad write.
    expect(canPersistDesktopLayout(true, false, 360)).toBe(false);
  });

  it('refuses just below the lg threshold', () => {
    expect(canPersistDesktopLayout(true, false, LG_MIN_WIDTH - 1)).toBe(false);
  });

  it('never persists outside edit mode', () => {
    expect(canPersistDesktopLayout(false, false, 1280)).toBe(false);
  });

  it('never persists mid-drag', () => {
    expect(canPersistDesktopLayout(true, true, 1280)).toBe(false);
  });
});

describe('layoutHasGeometryChange', () => {
  const widgets = [
    { i: 'a', x: 0, y: 0, w: 6, h: 4 },
    { i: 'b', x: 6, y: 0, w: 6, h: 4 },
  ];

  it('is false when the layout matches the widgets (RGL no-op re-fire)', () => {
    // The infinite-loop case: RGL hands back the same geometry. Must NOT commit,
    // else widgets→layouts→RGL→onLayoutChange cycles to "Maximum update depth".
    expect(layoutHasGeometryChange(widgets, [
      { i: 'a', x: 0, y: 0, w: 6, h: 4 },
      { i: 'b', x: 6, y: 0, w: 6, h: 4 },
    ])).toBe(false);
  });

  it('is false when item order differs but coords match', () => {
    expect(layoutHasGeometryChange(widgets, [
      { i: 'b', x: 6, y: 0, w: 6, h: 4 },
      { i: 'a', x: 0, y: 0, w: 6, h: 4 },
    ])).toBe(false);
  });

  it('is true when a position changed', () => {
    expect(layoutHasGeometryChange(widgets, [
      { i: 'a', x: 0, y: 0, w: 6, h: 4 },
      { i: 'b', x: 6, y: 5, w: 6, h: 4 },
    ])).toBe(true);
  });

  it('is true when a size changed', () => {
    expect(layoutHasGeometryChange(widgets, [
      { i: 'a', x: 0, y: 0, w: 8, h: 4 },
      { i: 'b', x: 6, y: 0, w: 6, h: 4 },
    ])).toBe(true);
  });

  it('ignores ids missing from the layout payload (no false positive)', () => {
    expect(layoutHasGeometryChange(widgets, [
      { i: 'a', x: 0, y: 0, w: 6, h: 4 },
    ])).toBe(false);
  });
});
