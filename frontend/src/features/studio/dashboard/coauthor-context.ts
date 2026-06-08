/**
 * Pure helpers for the "attach widgets to a co-author message" flow.
 *
 * The report-editor agent (mode: "report_editor") already receives the active
 * dashboard id + a widget summary in its system context, and can call
 * `read_dashboard` to see every widget. When the user pins specific widgets on
 * the grid, we don't change the protocol - we prepend a short focus preamble to
 * the message naming the pinned widgets by their `i` (the exact handle the agent
 * passes to read_dashboard / update_dashboard). This keeps the backend untouched
 * while letting the user scope a request to "these widgets".
 */

/** A widget the user has pinned to the next co-author message. */
export interface AttachedWidget {
  /** Widget id (the `i` field) - the handle update_dashboard patches by. */
  i: string;
  /** Current widget title, shown to the user as a chip and to the agent for
   *  disambiguation. May be empty for never-titled widgets. */
  title: string;
  /** Exact COLORABLE labels this chart renders (the keys `styleOverrides.seriesColors`
   *  tints). For a grouped/stacked chart these are the SERIES (e.g. brands), not
   *  the x-axis categories. Lets the agent build a per-slice color map for "make
   *  it colorful" requests it otherwise couldn't, being blind to data-derived
   *  labels. Empty / absent for non-chart widgets. */
  labels?: string[];
  /** Exact RENAMABLE labels this chart renders (the keys `styleOverrides.seriesLabels`
   *  can rewrite). Superset of `labels` for grouped charts: includes the x-axis
   *  categories (e.g. content types) AND the series. Lets the agent clean up
   *  category text ("Ugc" → "UGC") instead of falsely claiming it can't rename
   *  raw labels. Empty / absent for widgets with no renamable labels. */
  renamableLabels?: string[];
}

/**
 * Build the message string sent to the report_editor agent.
 *
 * With no attachments this returns the trimmed text unchanged, so ordinary
 * co-author requests are byte-for-byte identical to before this feature.
 */
export function buildCoAuthorMessage(
  text: string,
  attached: AttachedWidget[],
): string {
  const trimmed = text.trim();
  if (attached.length === 0) return trimmed;

  const count = attached.length;
  const noun = count === 1 ? 'widget' : 'widgets';
  const them = count === 1 ? 'it' : 'them';
  const lines = attached
    .map((w) => {
      const head = `- ${w.i} — "${w.title.trim() || 'Untitled widget'}"`;
      const parts: string[] = [head];
      // Colorable series = exact keys for styleOverrides.seriesColors, so the
      // agent can color each slice without guessing data-derived names.
      if (w.labels && w.labels.length > 0) {
        parts.push(`colorable series (exact seriesColors keys): ${w.labels.join(', ')}`);
      }
      // Renamable labels = exact keys for styleOverrides.seriesLabels. Only list
      // when they add something beyond the colorable set (the x-axis categories);
      // otherwise the same names already shown double as seriesLabels keys.
      const renamable = w.renamableLabels ?? [];
      const extraRenamable = renamable.filter((l) => !(w.labels ?? []).includes(l));
      if (renamable.length > 0 && extraRenamable.length > 0) {
        parts.push(`renamable labels (exact seriesLabels keys): ${renamable.join(', ')}`);
      } else if (renamable.length > 0 && (!w.labels || w.labels.length === 0)) {
        parts.push(`renamable labels (exact seriesLabels keys): ${renamable.join(', ')}`);
      }
      return parts.join('; ');
    })
    .join('\n');

  const hasLabels = attached.some((w) => w.labels && w.labels.length > 0);
  const hasRenamable = attached.some((w) => (w.renamableLabels ?? []).length > 0);
  const colorHint = hasLabels
    ? ' For recolor requests, use the listed colorable-series names as exact `styleOverrides.seriesColors` keys.'
    : '';
  const renameHint = hasRenamable
    ? ' To clean up category TEXT (e.g. "Ugc" → "UGC"), set `styleOverrides.seriesLabels` using the listed labels as exact keys — you CAN rename data-derived labels this way.'
    : '';

  const preamble =
    `[The user pinned ${count} ${noun} on the dashboard to focus on. Apply this ` +
    `request to ${them} unless the message says otherwise. Pass these widget ids ` +
    `(the "i" field) to read_dashboard / update_dashboard:\n${lines}]${colorHint}${renameHint}`;

  return `${preamble}\n\n${trimmed}`;
}

/** Toggle a widget's membership in the pinned list, matching by id. Returns a
 *  new array; never mutates the input. */
export function toggleAttachedWidget(
  list: AttachedWidget[],
  w: AttachedWidget,
): AttachedWidget[] {
  return list.some((x) => x.i === w.i)
    ? list.filter((x) => x.i !== w.i)
    : [...list, w];
}
