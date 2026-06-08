/**
 * Tolerant lookup for per-label overrides (seriesColors / seriesLabels).
 *
 * Overrides are keyed by the chart's exact raw label, but the co-author agent
 * (and humans) routinely produce a near-miss key — different case, spacing, or
 * separators ("Fan Vlog" / "fan_vlog" vs the data's "fan vlog"). An exact-only
 * lookup turns that into a silent no-op: the agent reports success, the chart
 * doesn't change. We match exact first, then fall back to a normalized form so
 * a near-miss still lands. We deliberately do NOT strip plurals or do fuzzy
 * distance matching — that would risk coloring the wrong category.
 */

/** Normalize a label for tolerant matching: trim, lowercase, collapse runs of
 *  whitespace / underscores / hyphens to a single space. */
export function normalizeLabelKey(label: string): string {
  return label.trim().toLowerCase().replace(/[\s_-]+/g, ' ');
}

/** Build a lookup that resolves an override value for a data label, exact key
 *  first then normalized. Returns undefined when nothing matches.
 *
 * The normalized index is built once per overrides object. On a normalized-key
 * collision the FIRST entry wins (stable, insertion order) — overrides with
 * genuinely distinct raw keys that normalize equal are pathological and rare. */
export function makeOverrideResolver(
  overrides: Record<string, string> | undefined,
): (label: string) => string | undefined {
  if (!overrides) return () => undefined;
  const normIndex = new Map<string, string>();
  for (const [k, v] of Object.entries(overrides)) {
    const nk = normalizeLabelKey(k);
    if (!normIndex.has(nk)) normIndex.set(nk, v);
  }
  return (label: string): string | undefined => {
    const exact = overrides[label];
    if (exact != null && exact !== '') return exact;
    const viaNorm = normIndex.get(normalizeLabelKey(label));
    return viaNorm != null && viaNorm !== '' ? viaNorm : undefined;
  };
}
