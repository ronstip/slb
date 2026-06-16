import type { DashboardPost } from '../../../api/types.ts';
import type { FieldKey } from './types-social-dashboard.ts';
import { CUSTOM_DIM_PREFIX } from './types-social-dashboard.ts';

/**
 * Distinct raw values present for a {@link FieldKey} across the loaded posts,
 * mirroring how `dashboard-aggregations.ts` `getDimensionKeys` reads each field:
 *  - `brands`   → `post.detected_brands[]`
 *  - `entities` → `post.entities[]`
 *  - `themes`   → `post.themes[]`
 *  - scalar built-ins (sentiment / emotion / platform / language /
 *    content_type / channel_type) → `post[field]`
 *  - `custom:<name>` → `post.custom_fields[name]` (scalar or `string[]`; object
 *    values are skipped, matching the aggregator's element-as-unit handling).
 *
 * Returns sorted, unique, non-empty strings. Used to populate the
 * canonicalization member picker and the value-color rows.
 */
export function distinctFieldValues(posts: DashboardPost[], field: FieldKey): string[] {
  const seen = new Set<string>();

  const push = (raw: unknown) => {
    if (raw == null) return;
    if (typeof raw === 'object') return; // skip object leaves (list[object])
    const s = String(raw).trim();
    if (s !== '') seen.add(s);
  };

  for (const p of posts) {
    if (field === 'brands') {
      for (const v of p.detected_brands ?? []) push(v);
    } else if (field === 'entities') {
      for (const v of p.entities ?? []) push(v);
    } else if (field === 'themes') {
      for (const v of p.themes ?? []) push(v);
    } else if (field.startsWith(CUSTOM_DIM_PREFIX)) {
      const name = field.slice(CUSTOM_DIM_PREFIX.length);
      const dot = name.indexOf('.');
      if (dot >= 0) {
        // Object leaf `custom:<field>.<leaf>`: read each element's leaf value.
        const outer = name.slice(0, dot);
        const leaf = name.slice(dot + 1);
        const raw = p.custom_fields?.[outer];
        if (!Array.isArray(raw)) continue;
        for (const el of raw) {
          if (el && typeof el === 'object' && !Array.isArray(el)) {
            push((el as Record<string, unknown>)[leaf]);
          }
        }
        continue;
      }
      const raw = p.custom_fields?.[name];
      if (raw == null) continue;
      if (Array.isArray(raw)) {
        for (const v of raw) push(v);
      } else {
        push(raw);
      }
    } else {
      // Scalar built-in field read straight off the post.
      push((p as unknown as Record<string, unknown>)[field]);
    }
  }

  return [...seen].sort((a, b) => a.localeCompare(b));
}
