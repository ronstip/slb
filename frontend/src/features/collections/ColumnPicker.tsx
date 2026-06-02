// Popover that lets the user pick which columns the posts table renders and
// in what order. Reads the FieldDef[] registry so custom fields show up
// automatically.

import { useState, useRef } from 'react';
import { Columns3, GripVertical, RotateCcw } from 'lucide-react';
import {
  Popover, PopoverContent, PopoverTrigger,
} from '../../components/ui/popover.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Checkbox } from '../../components/ui/checkbox.tsx';
import { cn } from '../../lib/utils.ts';
import type { FieldDef } from './fieldRegistry.ts';

export interface ColumnPref {
  key: string;
  visible: boolean;
}

interface ColumnPickerProps {
  registry: FieldDef[];
  prefs: ColumnPref[];
  onChange: (next: ColumnPref[]) => void;
  onReset: () => void;
}

export function ColumnPicker({ registry, prefs, onChange, onReset }: ColumnPickerProps) {
  const visibleCount = prefs.filter((p) => p.visible).length;
  const labelByKey = new Map(registry.map((f) => [f.key, f.label]));
  const sourceByKey = new Map(registry.map((f) => [f.key, f.source]));

  const dragIdxRef = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  function toggle(key: string) {
    onChange(prefs.map((p) => (p.key === key ? { ...p, visible: !p.visible } : p)));
  }
  function moveItem(from: number, to: number) {
    if (from === to) return;
    const next = [...prefs];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onChange(next);
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs">
          <Columns3 className="h-3.5 w-3.5" />
          Columns
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {visibleCount}/{prefs.length}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0 max-h-[26rem] flex flex-col">
        <div className="shrink-0 flex items-center justify-between border-b border-border/40 px-3 py-2">
          <span className="text-xs font-semibold">Customize columns</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 text-[10px] text-muted-foreground"
            onClick={onReset}
          >
            <RotateCcw className="h-3 w-3" /> Reset
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1">
          {prefs.map((p, idx) => {
            const label = labelByKey.get(p.key) ?? p.key;
            const isCustom = sourceByKey.get(p.key) === 'custom';
            return (
              <div
                key={p.key}
                draggable
                onDragStart={(e) => {
                  dragIdxRef.current = idx;
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(idx);
                  e.dataTransfer.dropEffect = 'move';
                }}
                onDragLeave={() => setDragOver((cur) => (cur === idx ? null : cur))}
                onDrop={(e) => {
                  e.preventDefault();
                  const from = dragIdxRef.current;
                  dragIdxRef.current = null;
                  setDragOver(null);
                  if (from != null) moveItem(from, idx);
                }}
                onDragEnd={() => { dragIdxRef.current = null; setDragOver(null); }}
                className={cn(
                  'group flex items-center gap-1.5 rounded px-1.5 py-1 text-xs cursor-move',
                  dragOver === idx && 'bg-primary/10',
                  'hover:bg-accent/60',
                )}
              >
                <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50 group-hover:text-muted-foreground" />
                <Checkbox
                  checked={p.visible}
                  onCheckedChange={() => toggle(p.key)}
                  className="h-3.5 w-3.5 shrink-0"
                />
                <span className="flex-1 truncate" title={label}>{label}</span>
                {isCustom && (
                  <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-primary">
                    custom
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ------------------------------------------------------------------
// Helpers used by the page to load / persist / merge prefs

const STORAGE_PREFIX = 'tableColumns:';

/** Columns shown by default, in their default order. Keys must match
 *  fieldRegistry built-in keys. Anything not listed defaults to hidden
 *  (the user can opt in via the picker). */
export const DEFAULT_VISIBLE_KEYS = [
  'platform',         // platform icon + label
  'channel_handle',   // @handle (split out from the old "Source" column)
  'ai_summary',
  'posted_at',
  'views',
  'likes',
  'sentiment',
  'channel_type',
  'entities',
] as const;

/** Order fields with agent custom fields first (so they're prominent in the
 *  picker and lead the table), built-ins after - each group in registry order. */
function customFirst(registry: FieldDef[]): FieldDef[] {
  return [
    ...registry.filter((f) => f.source === 'custom'),
    ...registry.filter((f) => f.source !== 'custom'),
  ];
}

export function defaultPrefsFor(registry: FieldDef[]): ColumnPref[] {
  const defaults = new Set<string>(DEFAULT_VISIBLE_KEYS);
  return customFirst(registry).map((f) => ({ key: f.key, visible: defaults.has(f.key) }));
}

/** Merge a saved prefs list with the current registry: keep the saved order
 *  for keys we still know about, append any new fields (default-hidden, except
 *  the canonical default-visible set when no saved entry exists yet). */
export function mergeColumnPrefs(
  saved: ColumnPref[] | null,
  registry: FieldDef[],
): ColumnPref[] {
  if (!saved || saved.length === 0) return defaultPrefsFor(registry);
  const knownKeys = new Set(registry.map((f) => f.key));
  const defaults = new Set<string>(DEFAULT_VISIBLE_KEYS);
  const result: ColumnPref[] = [];
  const seen = new Set<string>();
  for (const p of saved) {
    if (!knownKeys.has(p.key)) continue; // drop stale (e.g. removed custom field)
    if (seen.has(p.key)) continue;
    result.push(p);
    seen.add(p.key);
  }
  // Append any field not seen yet.
  for (const f of registry) {
    if (!seen.has(f.key)) {
      result.push({ key: f.key, visible: defaults.has(f.key) });
    }
  }
  // Float custom fields to the top (stable - relative order within each group is
  // preserved), so they lead the picker even for users with older saved prefs.
  const sourceByKey = new Map(registry.map((f) => [f.key, f.source]));
  return [
    ...result.filter((p) => sourceByKey.get(p.key) === 'custom'),
    ...result.filter((p) => sourceByKey.get(p.key) !== 'custom'),
  ];
}

export function loadColumnPrefs(scopeId: string): ColumnPref[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + scopeId);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    // Light-weight validation: each entry must look like ColumnPref
    return parsed
      .filter((e: unknown): e is ColumnPref =>
        !!e && typeof e === 'object' && typeof (e as ColumnPref).key === 'string'
          && typeof (e as ColumnPref).visible === 'boolean')
      .map((e: ColumnPref) => ({ key: e.key, visible: e.visible }));
  } catch {
    return null;
  }
}

export function saveColumnPrefs(scopeId: string, prefs: ColumnPref[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_PREFIX + scopeId, JSON.stringify(prefs));
  } catch {
    // localStorage may be unavailable (private mode, quota) - silently skip;
    // prefs revert to defaults on next load. Not worth surfacing.
  }
}

export function clearColumnPrefs(scopeId: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_PREFIX + scopeId);
  } catch {
    // ignore
  }
}
