import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2, X, Combine, Palette, Sigma, ChevronDown } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '../../../../components/ui/dialog.tsx';
import { Button } from '../../../../components/ui/button.tsx';
import { Input } from '../../../../components/ui/input.tsx';
import { Label } from '../../../../components/ui/label.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../components/ui/select.tsx';
import { cn } from '../../../../lib/utils.ts';
import type { DashboardPost, CustomFieldDef } from '../../../../api/types.ts';
import type {
  ReportConfig,
  CanonGroup,
  ComputedField,
  FieldKey,
  IfElseCase,
  FilterCondition,
  FilterConditionField,
  FilterConditionOperator,
  AnyMetric,
} from '../types-social-dashboard.ts';
import {
  CONDITION_FIELD_OPTIONS,
  conditionFieldKind,
  operatorsForConditionField,
  OPERATOR_LABELS,
  CUSTOM_DIM_PREFIX,
} from '../types-social-dashboard.ts';
import { distinctFieldValues } from '../report-config-values.ts';
import { parseExpr, exprToString } from '../report-expr-parse.ts';
import { exprLeafRefs } from '../report-expr.ts';

// ─── Props (do not change — other code is wired to this contract) ──────────────

export interface ReportConfigDialogProps {
  open: boolean;
  onClose: () => void;
  value: ReportConfig | null;
  /** Called whenever the user applies a change; upstream persists it. */
  onChange: (next: ReportConfig | null) => void;
  /** Posts currently loaded (already canonical for the saved config). */
  allPosts: DashboardPost[];
  /** Agent custom-field definitions, may be undefined. */
  customFieldDefs?: CustomFieldDef[];
}

// ─── Field vocabularies ────────────────────────────────────────────────────────

/** Built-in canonicalizable / colorable fields with human labels. */
const BUILTIN_FIELDS: Array<{ value: FieldKey; label: string }> = [
  { value: 'sentiment', label: 'Sentiment' },
  { value: 'emotion', label: 'Emotion' },
  { value: 'platform', label: 'Platform' },
  { value: 'language', label: 'Language' },
  { value: 'content_type', label: 'Content Type' },
  { value: 'channel_type', label: 'Channel Type' },
  { value: 'themes', label: 'Themes' },
  { value: 'entities', label: 'Entities' },
  { value: 'brands', label: 'Brands' },
];

/** Numeric leaf metrics usable in an `expr` computed field. */
const EXPR_METRIC_LEAVES: Array<{ value: AnyMetric; label: string }> = [
  { value: 'post_count', label: 'Post Count' },
  { value: 'like_count', label: 'Likes' },
  { value: 'view_count', label: 'Views' },
  { value: 'comment_count', label: 'Comments' },
  { value: 'share_count', label: 'Shares' },
  { value: 'engagement_total', label: 'Total Engagement' },
];

/** Identifier set the formula input accepts as bare field refs; anything else is
 *  flagged as an unknown reference (a warning, not a parse error). */
const KNOWN_EXPR_REFS = new Set<string>(EXPR_METRIC_LEAVES.map((m) => m.value as string));

function humanize(name: string): string {
  return name.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Local id generator — mirrors the nanoid-ish helper used elsewhere in the
 *  dashboard (SocialDashboardView). Kept self-contained so this file has no
 *  new dependency. */
function genId(): string {
  return Math.random().toString(36).slice(2, 11);
}

/** True when a report config has no meaningful content (→ persist as null). */
function isEmptyConfig(c: ReportConfig): boolean {
  const noCanon = !c.canonicalization || c.canonicalization.length === 0;
  const noColors =
    !c.valueColors ||
    Object.values(c.valueColors).every((m) => !m || Object.keys(m).length === 0);
  const noComputed = !c.computedFields || c.computedFields.length === 0;
  return noCanon && noColors && noComputed;
}

/** Strip in-progress entries before persisting. The editor keeps half-built
 *  groups/fields in local state so the user can finish them, but the backend
 *  rejects an empty `canonical` (min_length=1) and an empty computed-field
 *  `name`. Only entries that are complete enough to be valid AND do something
 *  are sent; the rest stay in the local draft until finished. */
function sanitizeForPersist(c: ReportConfig): ReportConfig {
  const canonicalization = (c.canonicalization ?? []).filter(
    (g) => g.canonical.trim() !== '' && g.members.length > 0 && g.fields.length > 0,
  );
  const computedFields = (c.computedFields ?? []).filter((f) => f.name.trim() !== '');
  return {
    canonicalization: canonicalization.length ? canonicalization : undefined,
    valueColors: c.valueColors,
    computedFields: computedFields.length ? computedFields : undefined,
  };
}

// ─── Sidebar sections ──────────────────────────────────────────────────────────

type SectionId = 'canonicalization' | 'colors' | 'computed';

const SECTIONS: Array<{
  id: SectionId;
  label: string;
  desc: string;
  icon: LucideIcon;
}> = [
  {
    id: 'canonicalization',
    label: 'Canonicalization',
    desc: 'Merge raw values into one canonical value across chosen fields.',
    icon: Combine,
  },
  {
    id: 'colors',
    label: 'Value Colors',
    desc: 'Assign report-wide colors to values; per-widget overrides win.',
    icon: Palette,
  },
  {
    id: 'computed',
    label: 'Computed Fields',
    desc: 'Define new fields from an expression or a multi-case if/else rule.',
    icon: Sigma,
  },
];

// ─── Component ─────────────────────────────────────────────────────────────────

export function ReportConfigDialog(props: ReportConfigDialogProps): JSX.Element {
  const { open, onClose, value, onChange, allPosts, customFieldDefs } = props;

  // Local draft, seeded from `value` only on the open transition. The dialog
  // owns the draft while open — re-seeding on every `value` change would wipe an
  // in-progress group the moment a keystroke persists a sanitized (smaller)
  // config back as the new `value`.
  const [draft, setDraft] = useState<ReportConfig>(() => value ?? {});
  const [section, setSection] = useState<SectionId>('canonicalization');
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) setDraft(value ?? {});
    wasOpen.current = open;
  }, [open, value]);

  // The full field vocabulary = built-ins + every custom enrichment field that
  // carries a scalar / categorical value. Gathered from BOTH the declared defs
  // AND the keys present on the loaded posts (so undeclared / no-agent fields
  // still show). For list[object] custom fields, the object's LEAVES are added
  // as `custom:<field>.<leaf>` (the object itself has no scalar value). Numeric
  // and object-of-object leaves are skipped — nothing to canonicalize/color.
  const fieldOptions = useMemo<Array<{ value: FieldKey; label: string }>>(() => {
    const seen = new Set<string>();
    const customs: Array<{ value: FieldKey; label: string }> = [];
    const add = (key: string, label: string) => {
      if (seen.has(key)) return;
      seen.add(key);
      customs.push({ value: `${CUSTOM_DIM_PREFIX}${key}` as FieldKey, label });
    };
    const addLeaf = (outer: string, leaf: string) =>
      add(`${outer}.${leaf}`, `${humanize(outer)} · ${humanize(leaf)}`);

    // Declared defs: scalar fields directly; object fields contribute their
    // categorical leaves (str / literal / bool).
    const objectNames = new Set<string>();
    for (const d of customFieldDefs ?? []) {
      if (d.type === 'list[object]') {
        objectNames.add(d.name);
        for (const ef of d.element_fields ?? []) {
          if (ef.type === 'str' || ef.type === 'literal' || ef.type === 'bool') {
            addLeaf(d.name, ef.name);
          }
        }
      } else {
        add(d.name, humanize(d.name));
      }
    }

    // Discover from the data: scalar custom fields, plus string leaves of any
    // list[object] field (covers undeclared fields and defs without leaves).
    for (const p of allPosts) {
      const cf = p.custom_fields;
      if (!cf) continue;
      for (const [k, v] of Object.entries(cf)) {
        const arr = Array.isArray(v) ? v : null;
        const objects = arr?.filter((el) => el !== null && typeof el === 'object' && !Array.isArray(el)) ?? [];
        if (objects.length > 0) {
          for (const el of objects) {
            for (const [leaf, lv] of Object.entries(el as Record<string, unknown>)) {
              if (typeof lv === 'string' && lv.trim() !== '') addLeaf(k, leaf);
            }
          }
        } else if (!(v !== null && typeof v === 'object')) {
          add(k, humanize(k)); // scalar or array of scalars
        }
      }
    }

    customs.sort((a, b) => a.label.localeCompare(b.label));
    return [...BUILTIN_FIELDS, ...customs];
  }, [customFieldDefs, allPosts]);

  const apply = (next: ReportConfig) => {
    setDraft(next);
    // Persist only complete entries; keep the in-progress draft locally so the
    // user can finish a half-built group/field without the save 422-ing.
    const clean = sanitizeForPersist(next);
    onChange(isEmptyConfig(clean) ? null : clean);
  };

  // ── Canonicalization handlers ────────────────────────────────────────────
  const canon = draft.canonicalization ?? [];
  const setCanon = (groups: CanonGroup[]) =>
    apply({ ...draft, canonicalization: groups.length ? groups : undefined });

  const addCanonGroup = () =>
    setCanon([
      ...canon,
      { id: genId(), canonical: '', members: [], fields: [] },
    ]);

  const updateCanonGroup = (id: string, patch: Partial<CanonGroup>) =>
    setCanon(canon.map((g) => (g.id === id ? { ...g, ...patch } : g)));

  const removeCanonGroup = (id: string) =>
    setCanon(canon.filter((g) => g.id !== id));

  // ── Colors handlers ──────────────────────────────────────────────────────
  const colors = draft.valueColors ?? {};
  const setColor = (field: FieldKey, val: string, hex: string | undefined) => {
    const fieldMap = { ...(colors[field] ?? {}) };
    if (hex === undefined) delete fieldMap[val];
    else fieldMap[val] = hex;
    const nextColors = { ...colors };
    if (Object.keys(fieldMap).length > 0) nextColors[field] = fieldMap;
    else delete nextColors[field];
    apply({
      ...draft,
      valueColors: Object.keys(nextColors).length > 0 ? nextColors : undefined,
    });
  };

  // ── Computed fields handlers ─────────────────────────────────────────────
  const computed = draft.computedFields ?? [];
  const setComputed = (fields: ComputedField[]) =>
    apply({ ...draft, computedFields: fields.length ? fields : undefined });

  const active = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0];

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        className="flex h-[85vh] max-w-4xl gap-0 overflow-hidden p-0 sm:max-w-4xl"
      >
        {/* Sidebar nav */}
        <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-muted/30">
          <div className="border-b border-border px-4 py-4">
            <DialogTitle className="text-sm font-semibold">Report Config</DialogTitle>
            <DialogDescription className="mt-0.5 text-[11px] leading-snug">
              Report-level defaults applied above per-widget config. Affects the
              dashboard and shareable reports.
            </DialogDescription>
          </div>
          <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
            {SECTIONS.map((s) => {
              const Icon = s.icon;
              const isActive = s.id === section;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSection(s.id)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-xs font-medium transition-colors',
                    isActive
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:bg-background/60 hover:text-foreground',
                  )}
                >
                  <Icon className={cn('h-4 w-4 shrink-0', isActive ? 'text-primary' : 'text-muted-foreground')} />
                  {s.label}
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Content pane */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <header className="shrink-0 border-b border-border px-6 py-4 pr-12">
            <h3 className="text-sm font-semibold">{active.label}</h3>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{active.desc}</p>
          </header>

          <div className="flex-1 overflow-y-auto px-6 py-4">
            {section === 'canonicalization' && (
              <CanonicalizationTab
                groups={canon}
                fieldOptions={fieldOptions}
                allPosts={allPosts}
                onAdd={addCanonGroup}
                onUpdate={updateCanonGroup}
                onRemove={removeCanonGroup}
              />
            )}
            {section === 'colors' && (
              <ColorsTab
                colors={colors}
                fieldOptions={fieldOptions}
                allPosts={allPosts}
                onSetColor={setColor}
              />
            )}
            {section === 'computed' && (
              <ComputedFieldsTab
                fields={computed}
                customFieldDefs={customFieldDefs}
                onChange={setComputed}
              />
            )}
          </div>

          <footer className="flex shrink-0 justify-end border-t border-border px-6 py-3">
            <Button variant="outline" size="sm" onClick={onClose}>
              Done
            </Button>
          </footer>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Canonicalization tab ──────────────────────────────────────────────────────

function CanonicalizationTab({
  groups,
  fieldOptions,
  allPosts,
  onAdd,
  onUpdate,
  onRemove,
}: {
  groups: CanonGroup[];
  fieldOptions: Array<{ value: FieldKey; label: string }>;
  allPosts: DashboardPost[];
  onAdd: () => void;
  onUpdate: (id: string, patch: Partial<CanonGroup>) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Merge raw values into one canonical value (e.g. “cal”, “CAL” → “Cal”) for
        the chosen fields. Merging can only collapse buckets, never inflate counts.
      </p>
      {groups.length === 0 && (
        <p className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
          No groups yet.
        </p>
      )}
      <div className="space-y-3">
        {groups.map((g) => (
          <CanonGroupCard
            key={g.id}
            group={g}
            fieldOptions={fieldOptions}
            allPosts={allPosts}
            onUpdate={(patch) => onUpdate(g.id, patch)}
            onRemove={() => onRemove(g.id)}
          />
        ))}
      </div>
      <Button variant="outline" size="sm" onClick={onAdd} className="gap-1.5">
        <Plus className="h-3.5 w-3.5" />
        Add group
      </Button>
    </div>
  );
}

function CanonGroupCard({
  group,
  fieldOptions,
  allPosts,
  onUpdate,
  onRemove,
}: {
  group: CanonGroup;
  fieldOptions: Array<{ value: FieldKey; label: string }>;
  allPosts: DashboardPost[];
  onUpdate: (patch: Partial<CanonGroup>) => void;
  onRemove: () => void;
}) {
  const [filter, setFilter] = useState('');
  // Collapsible: a freshly added (unnamed) group starts open so it can be
  // filled in; existing named groups start collapsed to keep the list compact.
  const [open, setOpen] = useState(() => group.canonical.trim() === '');

  // Distinct values across all selected fields (union), excluding values already
  // chosen as members so the picker only shows addable values.
  const memberSet = new Set(group.members);
  const distinct = useMemo(() => {
    const all = new Set<string>();
    for (const f of group.fields) {
      for (const v of distinctFieldValues(allPosts, f)) all.add(v);
    }
    return [...all].sort((a, b) => a.localeCompare(b));
  }, [group.fields, allPosts]);

  const visibleValues = distinct.filter(
    (v) => !memberSet.has(v) && v.toLowerCase().includes(filter.toLowerCase()),
  );

  const toggleField = (field: FieldKey) => {
    const has = group.fields.includes(field);
    onUpdate({
      fields: has ? group.fields.filter((f) => f !== field) : [...group.fields, field],
    });
  };

  const addMember = (val: string) =>
    onUpdate({ members: [...group.members, val] });
  const removeMember = (val: string) =>
    onUpdate({ members: group.members.filter((m) => m !== val) });

  return (
    <div className="rounded-lg border border-border">
      {/* Collapsible header */}
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-1 text-left hover:bg-muted/50"
          aria-expanded={open}
        >
          <ChevronDown
            className={cn(
              'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
              !open && '-rotate-90',
            )}
          />
          <span className="truncate text-xs font-medium">
            {group.canonical.trim() || (
              <span className="italic text-muted-foreground">Untitled group</span>
            )}
          </span>
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {group.members.length} value{group.members.length === 1 ? '' : 's'} ·{' '}
            {group.fields.length} field{group.fields.length === 1 ? '' : 's'}
          </span>
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
          title="Delete group"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {open && (
        <div className="space-y-3 border-t border-border p-3">
          {/* Canonical value */}
          <div className="space-y-1">
            <Label className="text-xs">Canonical value</Label>
            <Input
              value={group.canonical}
              placeholder="e.g. Cal"
              onChange={(e) => onUpdate({ canonical: e.target.value })}
              className="h-8 text-xs"
            />
          </div>

          {/* Target fields */}
          <div className="space-y-1.5">
            <Label className="text-xs">Applies to fields</Label>
            <div className="flex flex-wrap gap-1.5">
              {fieldOptions.map((f) => {
                const active = group.fields.includes(f.value);
                return (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => toggleField(f.value)}
                    className={cn(
                      'rounded-full border px-2 py-0.5 text-[11px] transition-colors',
                      active
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:border-primary/40',
                    )}
                  >
                    {f.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Members */}
          <div className="space-y-1.5">
            <Label className="text-xs">Members ({group.members.length})</Label>
            {group.members.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {group.members.map((m) => (
                  <span
                    key={m}
                    className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px]"
                  >
                    {m}
                    <button
                      type="button"
                      onClick={() => removeMember(m)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {group.fields.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                Pick a field above to list its values.
              </p>
            ) : (
              <>
                <Input
                  value={filter}
                  placeholder="Search values…"
                  onChange={(e) => setFilter(e.target.value)}
                  className="h-7 text-xs"
                />
                <div className="max-h-36 overflow-y-auto rounded-md border border-border">
                  {visibleValues.length === 0 ? (
                    <p className="p-2 text-[11px] text-muted-foreground">
                      No more values.
                    </p>
                  ) : (
                    visibleValues.map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => addMember(v)}
                        className="flex w-full items-center justify-between px-2 py-1 text-left text-xs hover:bg-muted"
                      >
                        <span className="truncate">{v}</span>
                        <Plus className="h-3 w-3 shrink-0 text-muted-foreground" />
                      </button>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Colors tab ────────────────────────────────────────────────────────────────

function ColorsTab({
  colors,
  fieldOptions,
  allPosts,
  onSetColor,
}: {
  colors: Record<string, Record<string, string>>;
  fieldOptions: Array<{ value: FieldKey; label: string }>;
  allPosts: DashboardPost[];
  onSetColor: (field: FieldKey, val: string, hex: string | undefined) => void;
}) {
  const [field, setField] = useState<FieldKey>(fieldOptions[0]?.value ?? 'sentiment');

  const values = useMemo(() => distinctFieldValues(allPosts, field), [allPosts, field]);
  const fieldColors = colors[field] ?? {};

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Field</Label>
        <Select value={field} onValueChange={(v) => setField(v as FieldKey)}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {fieldOptions.map((f) => (
              <SelectItem key={f.value} value={f.value} className="text-xs">
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {values.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
          No values present for this field.
        </p>
      ) : (
        <div className="space-y-1.5">
          {values.map((v) => {
            const hex = fieldColors[v];
            return (
              <div key={v} className="flex items-center gap-2">
                <Input
                  type="color"
                  className="h-7 w-10 shrink-0 cursor-pointer p-0.5"
                  value={hex ?? '#4A7C8F'}
                  onChange={(e) => onSetColor(field, v, e.target.value)}
                />
                <span className="flex-1 min-w-0 truncate text-xs" title={v}>
                  {v}
                </span>
                {hex ? (
                  <button
                    type="button"
                    onClick={() => onSetColor(field, v, undefined)}
                    className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    Clear
                  </button>
                ) : (
                  <span className="shrink-0 text-[10px] text-muted-foreground/60">auto</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Computed fields tab ───────────────────────────────────────────────────────

function ComputedFieldsTab({
  fields,
  customFieldDefs,
  onChange,
}: {
  fields: ComputedField[];
  customFieldDefs?: CustomFieldDef[];
  onChange: (fields: ComputedField[]) => void;
}) {
  const addExpr = () =>
    onChange([
      ...fields,
      {
        id: genId(),
        name: '',
        kind: 'expr',
        output: 'metric',
        expr: {
          t: 'bin',
          op: '/',
          l: { t: 'field', ref: 'engagement_total' },
          r: { t: 'field', ref: 'view_count' },
        },
      },
    ]);

  const addIfElse = () =>
    onChange([
      ...fields,
      {
        id: genId(),
        name: '',
        kind: 'ifelse',
        output: 'dimension',
        cases: [{ when: [], value: '' }],
        elseValue: '',
      },
    ]);

  const update = (id: string, next: ComputedField) =>
    onChange(fields.map((f) => (f.id === id ? next : f)));
  const remove = (id: string) => onChange(fields.filter((f) => f.id !== id));

  return (
    <div className="space-y-3">
      {fields.length === 0 && (
        <p className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
          No computed fields yet.
        </p>
      )}

      <div className="space-y-3">
        {fields.map((f) =>
          f.kind === 'expr' ? (
            <ExprFieldCard
              key={f.id}
              field={f}
              onChange={(next) => update(f.id, next)}
              onRemove={() => remove(f.id)}
            />
          ) : (
            <IfElseFieldCard
              key={f.id}
              field={f}
              customFieldDefs={customFieldDefs}
              onChange={(next) => update(f.id, next)}
              onRemove={() => remove(f.id)}
            />
          ),
        )}
      </div>

      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={addExpr} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          Expression
        </Button>
        <Button variant="outline" size="sm" onClick={addIfElse} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          If / else
        </Button>
      </div>
    </div>
  );
}

function CardHeader({
  name,
  badge,
  placeholder,
  onName,
  onRemove,
}: {
  name: string;
  badge: string;
  placeholder: string;
  onName: (v: string) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-start gap-2">
      <div className="flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <Label className="text-xs">Name</Label>
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            {badge}
          </span>
        </div>
        <Input
          value={name}
          placeholder={placeholder}
          onChange={(e) => onName(e.target.value)}
          className="h-8 text-xs"
        />
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="mt-6 rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
        title="Delete field"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

function ExprFieldCard({
  field,
  onChange,
  onRemove,
}: {
  field: Extract<ComputedField, { kind: 'expr' }>;
  onChange: (next: Extract<ComputedField, { kind: 'expr' }>) => void;
  onRemove: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  // Local formula text, seeded once from the saved AST. We keep it local while
  // editing so an in-progress (unparseable) formula doesn't get pushed up — the
  // last valid AST stays persisted until the text parses again.
  const [text, setText] = useState(() => exprToString(field.expr));
  const parsed = useMemo(() => parseExpr(text), [text]);
  const error = 'error' in parsed ? parsed.error : null;

  // Refs in a valid formula that aren't known metric leaves → typo warning.
  const unknownRefs = useMemo(() => {
    if (error || !('node' in parsed)) return [];
    return exprLeafRefs(parsed.node)
      .map((r) => String(r))
      .filter((r) => !KNOWN_EXPR_REFS.has(r));
  }, [parsed, error]);

  const commit = (next: string) => {
    setText(next);
    const r = parseExpr(next);
    if ('node' in r) onChange({ ...field, expr: r.node });
  };

  const insertToken = (token: string) => {
    const el = inputRef.current;
    const cur = text;
    const at = el ? el.selectionStart ?? cur.length : cur.length;
    const before = cur.slice(0, at);
    const after = cur.slice(at);
    // Pad with a space so adjacent tokens don't fuse (`a` + `b` → `a b`).
    const pad = before && !before.endsWith(' ') && !before.endsWith('(') ? ' ' : '';
    const next = `${before}${pad}${token}${after}`;
    commit(next);
    // Restore focus + caret after the inserted token.
    requestAnimationFrame(() => {
      const pos = before.length + pad.length + token.length;
      el?.focus();
      el?.setSelectionRange(pos, pos);
    });
  };

  return (
    <div className="rounded-lg border border-border p-3 space-y-3">
      <CardHeader
        name={field.name}
        badge="Expr"
        placeholder="e.g. Engagement Rate"
        onName={(v) => onChange({ ...field, name: v })}
        onRemove={onRemove}
      />
      <div className="space-y-1.5">
        <Label className="text-xs">Formula (metric)</Label>
        <Input
          ref={inputRef}
          value={text}
          placeholder="(like_count + comment_count) / view_count * 100"
          onChange={(e) => commit(e.target.value)}
          className={cn(
            'h-8 font-mono text-xs',
            error && text.trim() !== '' && 'border-destructive focus-visible:ring-destructive',
          )}
          spellCheck={false}
        />

        {/* Insert chips: metrics + operators/functions */}
        <div className="flex flex-wrap gap-1">
          {EXPR_METRIC_LEAVES.map((m) => (
            <button
              key={m.value as string}
              type="button"
              onClick={() => insertToken(m.value as string)}
              className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground hover:border-primary/40 hover:text-foreground"
              title={`Insert ${m.label}`}
            >
              {m.value as string}
            </button>
          ))}
          {['+', '-', '*', '/', '(', ')', 'min(', 'max(', 'abs('].map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => insertToken(t)}
              className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground hover:border-primary/40 hover:text-foreground"
            >
              {t}
            </button>
          ))}
        </div>

        {error && text.trim() !== '' ? (
          <p className="text-[11px] text-destructive">{error}</p>
        ) : unknownRefs.length > 0 ? (
          <p className="text-[11px] text-amber-600 dark:text-amber-500">
            Unknown field{unknownRefs.length === 1 ? '' : 's'}: {unknownRefs.join(', ')} — will
            evaluate to nothing unless it’s a valid metric.
          </p>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            Arithmetic over metric fields: <code>+ - * /</code>, parentheses,{' '}
            <code>min/max/abs</code>, constants. Evaluated over per-bucket aggregated values (sum ÷
            sum), so ratios stay statistically correct.
          </p>
        )}
      </div>
    </div>
  );
}

// ─── If/else computed field ────────────────────────────────────────────────────

/** Condition field options: base numeric/date/text + categorical built-ins +
 *  custom fields. Mirrors the augmentation done by WidgetFilterForm. */
function useConditionFieldOptions(
  customFieldDefs?: CustomFieldDef[],
): Array<{ value: FilterConditionField; label: string }> {
  return useMemo(() => {
    const categorical: Array<{ value: FilterConditionField; label: string }> = [
      { value: 'sentiment', label: 'Sentiment' },
      { value: 'emotion', label: 'Emotion' },
      { value: 'platform', label: 'Platform' },
      { value: 'language', label: 'Language' },
      { value: 'content_type', label: 'Content Type' },
      { value: 'channel_type', label: 'Channel Type' },
      { value: 'channel_handle', label: 'Channel' },
      { value: 'themes', label: 'Themes' },
      { value: 'entities', label: 'Entities' },
      { value: 'brands', label: 'Brands' },
    ];
    const customs = (customFieldDefs ?? [])
      .filter((d) => d.type !== 'list[object]')
      .map((d) => ({
        value: `${CUSTOM_DIM_PREFIX}${d.name}` as FilterConditionField,
        label: humanize(d.name),
      }));
    return [...CONDITION_FIELD_OPTIONS, ...categorical, ...customs];
  }, [customFieldDefs]);
}

function ConditionRow({
  cond,
  fieldOptions,
  customFieldDefs,
  onChange,
  onRemove,
}: {
  cond: FilterCondition;
  fieldOptions: Array<{ value: FilterConditionField; label: string }>;
  customFieldDefs?: CustomFieldDef[];
  onChange: (next: FilterCondition) => void;
  onRemove: () => void;
}) {
  const operators = operatorsForConditionField(cond.field, customFieldDefs);
  const kind = conditionFieldKind(cond.field, customFieldDefs);
  const isMulti = cond.operator === 'isAnyOf' || cond.operator === 'isNoneOf';
  const noValue = cond.operator === 'isEmpty' || cond.operator === 'isNotEmpty';

  const setField = (f: FilterConditionField) => {
    const ops = operatorsForConditionField(f, customFieldDefs);
    onChange({ ...cond, field: f, operator: ops[0], value: '', value2: undefined, values: undefined });
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Select value={cond.field} onValueChange={(v) => setField(v as FilterConditionField)}>
        <SelectTrigger className="h-7 w-32 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {fieldOptions.map((f) => (
            <SelectItem key={f.value} value={f.value} className="text-xs">
              {f.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={cond.operator}
        onValueChange={(v) => onChange({ ...cond, operator: v as FilterConditionOperator })}
      >
        <SelectTrigger className="h-7 w-28 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {operators.map((o) => (
            <SelectItem key={o} value={o} className="text-xs">
              {OPERATOR_LABELS[o]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {!noValue && (
        isMulti ? (
          <Input
            value={(cond.values ?? []).join(', ')}
            placeholder="a, b, c"
            onChange={(e) =>
              onChange({
                ...cond,
                values: e.target.value
                  .split(',')
                  .map((s) => s.trim())
                  .filter((s) => s !== ''),
              })
            }
            className="h-7 flex-1 min-w-[6rem] text-xs"
          />
        ) : (
          <Input
            type={kind === 'numeric' ? 'number' : kind === 'date' ? 'date' : 'text'}
            value={String(cond.value ?? '')}
            placeholder="value"
            onChange={(e) =>
              onChange({
                ...cond,
                value: kind === 'numeric' ? Number(e.target.value) : e.target.value,
              })
            }
            className="h-7 flex-1 min-w-[6rem] text-xs"
          />
        )
      )}

      <button
        type="button"
        onClick={onRemove}
        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
        title="Remove condition"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function IfElseFieldCard({
  field,
  customFieldDefs,
  onChange,
  onRemove,
}: {
  field: Extract<ComputedField, { kind: 'ifelse' }>;
  customFieldDefs?: CustomFieldDef[];
  onChange: (next: Extract<ComputedField, { kind: 'ifelse' }>) => void;
  onRemove: () => void;
}) {
  const fieldOptions = useConditionFieldOptions(customFieldDefs);
  const firstField = fieldOptions[0]?.value ?? 'like_count';

  const newCondition = (): FilterCondition => ({
    field: firstField,
    operator: operatorsForConditionField(firstField, customFieldDefs)[0],
    value: '',
  });

  const updateCase = (idx: number, next: IfElseCase) =>
    onChange({ ...field, cases: field.cases.map((c, i) => (i === idx ? next : c)) });
  const addCase = () =>
    onChange({ ...field, cases: [...field.cases, { when: [], value: '' }] });
  const removeCase = (idx: number) =>
    onChange({ ...field, cases: field.cases.filter((_, i) => i !== idx) });

  const coerce = (raw: string): string | number =>
    field.output === 'metric' && raw.trim() !== '' && !Number.isNaN(Number(raw))
      ? Number(raw)
      : raw;

  return (
    <div className="rounded-lg border border-border p-3 space-y-3">
      <CardHeader
        name={field.name}
        badge="If / else"
        placeholder="e.g. Audience Tier"
        onName={(v) => onChange({ ...field, name: v })}
        onRemove={onRemove}
      />

      <div className="space-y-1.5">
        <Label className="text-xs">Output</Label>
        <Select
          value={field.output}
          onValueChange={(v) => onChange({ ...field, output: v as 'dimension' | 'metric' })}
        >
          <SelectTrigger className="h-8 w-40 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="dimension" className="text-xs">Dimension (categorical)</SelectItem>
            <SelectItem value="metric" className="text-xs">Metric (numeric)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        {field.cases.map((c, idx) => (
          <div key={idx} className="rounded-md border border-border/70 p-2 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-muted-foreground">
                {idx === 0 ? 'IF' : 'ELSE IF'} (all conditions)
              </span>
              {field.cases.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeCase(idx)}
                  className="rounded px-1 text-[10px] text-muted-foreground hover:text-destructive"
                >
                  Remove case
                </button>
              )}
            </div>

            <div className="space-y-1.5">
              {c.when.length === 0 && (
                <p className="text-[11px] text-muted-foreground">No conditions (always matches).</p>
              )}
              {c.when.map((cond, ci) => (
                <ConditionRow
                  key={ci}
                  cond={cond}
                  fieldOptions={fieldOptions}
                  customFieldDefs={customFieldDefs}
                  onChange={(next) =>
                    updateCase(idx, {
                      ...c,
                      when: c.when.map((w, i) => (i === ci ? next : w)),
                    })
                  }
                  onRemove={() =>
                    updateCase(idx, { ...c, when: c.when.filter((_, i) => i !== ci) })
                  }
                />
              ))}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => updateCase(idx, { ...c, when: [...c.when, newCondition()] })}
                className="h-6 gap-1 text-[11px]"
              >
                <Plus className="h-3 w-3" />
                Condition
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <Label className="text-xs shrink-0">then</Label>
              <Input
                value={String(c.value ?? '')}
                placeholder={field.output === 'metric' ? 'number' : 'value'}
                onChange={(e) => updateCase(idx, { ...c, value: coerce(e.target.value) })}
                className="h-7 flex-1 text-xs"
              />
            </div>
          </div>
        ))}

        <Button variant="outline" size="sm" onClick={addCase} className="h-7 gap-1.5 text-xs">
          <Plus className="h-3.5 w-3.5" />
          Add case
        </Button>
      </div>

      <div className="flex items-center gap-2 border-t border-border pt-2">
        <Label className="text-xs shrink-0">else</Label>
        <Input
          value={String(field.elseValue ?? '')}
          placeholder={field.output === 'metric' ? 'number' : 'value'}
          onChange={(e) => onChange({ ...field, elseValue: coerce(e.target.value) })}
          className="h-7 flex-1 text-xs"
        />
      </div>
    </div>
  );
}
