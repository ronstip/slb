import { describe, it, expect, vi } from 'vitest';
import { sliceDatalabelsPlugin } from './SocialChartWidget.tsx';

/** Minimal fake of the Chart.js objects the plugin touches, so we can assert
 *  the plugin draws the right text at finite coordinates without a canvas. */
function makeChart(opts: {
  display?: string;
  values: number[];
  labels?: string[];
  arcs: Array<{ startAngle: number; endAngle: number; innerRadius: number; outerRadius: number; x?: number; y?: number }>;
  visibility?: boolean[];
}) {
  const calls: Array<{ text: string; x: number; y: number }> = [];
  const ctx = {
    save: vi.fn(), restore: vi.fn(),
    fillText: (text: string, x: number, y: number) => calls.push({ text, x, y }),
    measureText: () => ({ width: 10 }),
    set font(_v: string) {}, set fillStyle(_v: string) {}, set textAlign(_v: string) {},
    set textBaseline(_v: string) {}, set shadowColor(_v: string) {}, set shadowBlur(_v: number) {},
  };
  const chart = {
    ctx,
    options: { plugins: { sliceDatalabels: { display: opts.display } } },
    data: { labels: opts.labels, datasets: [{ data: opts.values }] },
    getDatasetMeta: () => ({ data: opts.arcs.map((a) => ({ x: 100, y: 100, ...a })) }),
    getDataVisibility: (i: number) => opts.visibility?.[i] ?? true,
  };
  return { chart, calls };
}

const wide = { startAngle: 0, endAngle: 1.5, innerRadius: 40, outerRadius: 80 };

describe('sliceDatalabelsPlugin', () => {
  it('draws a label per visible slice at finite coordinates', () => {
    const { chart, calls } = makeChart({
      display: 'abs',
      values: [30, 70],
      arcs: [{ ...wide, startAngle: 0, endAngle: 1.5 }, { ...wide, startAngle: 1.5, endAngle: 3 }],
    });
    sliceDatalabelsPlugin.afterDatasetsDraw(chart as never);
    expect(calls.map((c) => c.text)).toEqual(['30', '70']);
    for (const c of calls) {
      expect(Number.isFinite(c.x)).toBe(true);
      expect(Number.isFinite(c.y)).toBe(true);
    }
  });

  it('shows percent of the total shown when display=pct', () => {
    const { chart, calls } = makeChart({
      display: 'pct',
      values: [25, 75],
      arcs: [wide, { ...wide, startAngle: 1.5, endAngle: 3 }],
    });
    sliceDatalabelsPlugin.afterDatasetsDraw(chart as never);
    expect(calls.map((c) => c.text)).toEqual(['25%', '75%']);
  });

  it('draws the category name when display=name', () => {
    const { chart, calls } = makeChart({
      display: 'name',
      values: [30, 70],
      labels: ['Isracard', 'Cal'],
      arcs: [wide, { ...wide, startAngle: 1.5, endAngle: 3 }],
    });
    sliceDatalabelsPlugin.afterDatasetsDraw(chart as never);
    expect(calls.map((c) => c.text)).toEqual(['Isracard', 'Cal']);
  });

  it('draws nothing when display is none/unset', () => {
    const { chart, calls } = makeChart({ display: 'none', values: [1, 1], arcs: [wide, wide] });
    sliceDatalabelsPlugin.afterDatasetsDraw(chart as never);
    expect(calls).toHaveLength(0);
  });

  it('skips slivers and hidden slices', () => {
    const { chart, calls } = makeChart({
      display: 'abs',
      values: [50, 1, 49],
      arcs: [
        wide,
        { startAngle: 1.5, endAngle: 1.6, innerRadius: 40, outerRadius: 80 }, // ~0.1rad sliver → skip
        { startAngle: 1.6, endAngle: 3, innerRadius: 40, outerRadius: 80 },
      ],
      visibility: [true, true, false], // 3rd hidden via legend toggle
    });
    sliceDatalabelsPlugin.afterDatasetsDraw(chart as never);
    expect(calls.map((c) => c.text)).toEqual(['50']); // only the first wide+visible slice
  });
});
