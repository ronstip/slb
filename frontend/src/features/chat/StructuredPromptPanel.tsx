import { useState, useRef, useEffect, useCallback, type KeyboardEvent } from 'react';
import { X, Check, Send } from 'lucide-react';
import { Badge } from '../../components/ui/badge.tsx';
import { Switch } from '../../components/ui/switch.tsx';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui/tabs.tsx';
import { PlatformIcon } from '../../components/PlatformIcon.tsx';
import { useChatStore } from '../../stores/chat-store.ts';
import type { StructuredPrompt, StructuredPromptResult } from '../../api/types.ts';

// ─── Types ───────────────────────────────────────────────────────────

type SelectionMap = Record<string, string[]>;
type ToggleMap = Record<string, boolean>;
type TagMap = Record<string, string[]>;
type OtherTextMap = Record<string, string>;

const OTHER_VALUE = '__other__';

interface StructuredPromptPanelProps {
  onSubmit: (text: string) => void;
  onCancel: () => void;
}

// ─── Main Component ──────────────────────────────────────────────────

export function StructuredPromptPanel({ onSubmit, onCancel }: StructuredPromptPanelProps) {
  const activePromptData = useChatStore((s) => s.activePromptData);
  const payload = activePromptData as StructuredPromptResult;
  const prompts = payload?.prompts ?? [];

  const [activeTab, setActiveTab] = useState(prompts[0]?.id ?? '');

  // Selection state per prompt
  const [selections, setSelections] = useState<SelectionMap>(() => {
    const init: SelectionMap = {};
    for (const p of prompts) {
      if (p.type === 'icon_grid' || p.type === 'pill_row' || p.type === 'card_select' || p.type === 'approval') {
        init[p.id] = p.preselected ?? [];
      }
    }
    return init;
  });

  const [toggles, setToggles] = useState<ToggleMap>(() => {
    const init: ToggleMap = {};
    for (const p of prompts) {
      if (p.type === 'toggle_row') {
        init[p.id] = p.default_value === true || p.default_value === 'true';
      }
    }
    return init;
  });

  const [tags, setTags] = useState<TagMap>(() => {
    const init: TagMap = {};
    for (const p of prompts) {
      if (p.type === 'tag_input') {
        init[p.id] = p.preselected ?? [];
      }
    }
    return init;
  });

  const [otherText, setOtherText] = useState<OtherTextMap>({});

  // Escape to cancel
  useEffect(() => {
    const handleEsc = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [onCancel]);

  // ── Helpers ──────────────────────────────────────────────────────

  const isPromptFilled = useCallback((p: StructuredPrompt): boolean => {
    if (p.type === 'icon_grid' || p.type === 'pill_row' || p.type === 'card_select') {
      const sel = selections[p.id] ?? [];
      if (sel.length === 0) return false;
      if (sel.includes(OTHER_VALUE) && !(otherText[p.id] ?? '').trim()) return false;
      return true;
    }
    if (p.type === 'approval') {
      const sel = selections[p.id] ?? [];
      if (sel.length === 0) return false;
      if (sel.includes('adjust') && !(otherText[p.id] ?? '').trim()) return false;
      return true;
    }
    if (p.type === 'tag_input') {
      return (tags[p.id] ?? []).length > 0;
    }
    // toggle_row is always filled (has default)
    return true;
  }, [selections, otherText, tags]);

  const canSubmit = useCallback(() => {
    return prompts.every((p) => isPromptFilled(p));
  }, [prompts, isPromptFilled]);

  const formatAnswer = useCallback((): string => {
    const parts: string[] = [];
    const structured: Record<string, unknown> = {};

    for (const p of prompts) {
      if (p.type === 'icon_grid' || p.type === 'pill_row' || p.type === 'card_select') {
        const selected = selections[p.id] ?? [];
        const resolved = selected.map((v) =>
          v === OTHER_VALUE ? (otherText[p.id] ?? '').trim() : v,
        ).filter(Boolean);
        structured[p.id] = resolved;
        const labels = resolved.map((v) => {
          const opt = p.options?.find((o) => o.value === v);
          return opt?.label ?? v;
        });
        if (labels.length > 0) {
          parts.push(`${promptLabel(p)}: ${labels.join(', ')}`);
        }
        // Include "other" annotation text for prompts with non-OTHER other text
        if (otherText[p.id]?.trim() && !selected.includes(OTHER_VALUE)) {
          structured[`${p.id}_note`] = otherText[p.id].trim();
        }
      } else if (p.type === 'approval') {
        const selected = selections[p.id] ?? [];
        structured[p.id] = selected;
        const label = selected[0] === 'approve' ? 'Approve & Run' : 'Adjust';
        if (selected[0] === 'adjust' && otherText[p.id]?.trim()) {
          structured[`${p.id}_feedback`] = otherText[p.id].trim();
          parts.push(`Plan: ${label} — ${otherText[p.id].trim()}`);
        } else {
          parts.push(`Plan: ${label}`);
        }
      } else if (p.type === 'tag_input') {
        const values = tags[p.id] ?? [];
        structured[p.id] = values;
        if (values.length > 0) {
          parts.push(`${promptLabel(p)}: ${values.join(', ')}`);
        }
      } else if (p.type === 'toggle_row') {
        const value = toggles[p.id] ?? false;
        structured[p.id] = value;
        parts.push(`${promptLabel(p)}: ${value ? 'Yes' : 'No'}`);
        if (otherText[p.id]?.trim()) {
          structured[`${p.id}_note`] = otherText[p.id].trim();
        }
      }
    }

    const readable = parts.join(' · ');
    const json = JSON.stringify(structured);
    return `${readable}\n<!-- structured_response: ${json} -->`;
  }, [prompts, selections, tags, toggles, otherText]);

  const handleSubmit = useCallback(() => {
    if (!canSubmit()) return;
    const text = formatAnswer();
    useChatStore.getState().setActivePrompt(null);
    useChatStore.getState().setActivePromptData(null);
    onSubmit(text);
  }, [canSubmit, formatAnswer, onSubmit]);

  const advanceTab = useCallback((fromPromptId: string) => {
    const idx = prompts.findIndex((p) => p.id === fromPromptId);
    if (idx < prompts.length - 1) {
      setTimeout(() => setActiveTab(prompts[idx + 1].id), 200);
    }
  }, [prompts]);

  const toggleSelection = (promptId: string, value: string, multiSelect?: boolean) => {
    setSelections((prev) => {
      const current = prev[promptId] ?? [];
      if (multiSelect) {
        const next = current.includes(value)
          ? current.filter((v) => v !== value)
          : [...current, value];
        return { ...prev, [promptId]: next };
      }
      return { ...prev, [promptId]: [value] };
    });

    // Auto-advance on single-select
    if (!multiSelect) {
      advanceTab(promptId);
    }
  };

  // ── Submit button label ─────────────────────────────────────────
  const getSubmitLabel = (): string => {
    const approvalPrompt = prompts.find((p) => p.type === 'approval');
    if (approvalPrompt) {
      const sel = selections[approvalPrompt.id] ?? [];
      if (sel.includes('approve')) return 'Approve & Run';
      if (sel.includes('adjust')) return 'Submit Adjustments';
    }
    return 'Submit';
  };

  if (!activePromptData || prompts.length === 0) return null;

  const singlePrompt = prompts.length === 1;

  // ── Render ─────────────────────────────────────────────────────

  return (
    <div className="flex justify-center px-6 pb-5 pt-2 animate-in fade-in slide-in-from-bottom-3 duration-200">
      <div className="w-full max-w-2xl rounded-2xl border border-border bg-card shadow-md overflow-hidden">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          {/* Tab bar + close (hidden for single-prompt panels) */}
          {!singlePrompt && (
            <div className="flex items-center gap-2 px-4 pt-1">
              <TabsList variant="line" className="h-9 flex-1 justify-start gap-0">
                {prompts.map((p) => {
                  const filled = isPromptFilled(p);
                  return (
                    <TabsTrigger key={p.id} value={p.id} className="gap-1.5 px-3 text-[11px] font-normal">
                      {promptLabel(p)}
                      {filled && (
                        <span className="h-1.5 w-1.5 rounded-full bg-accent-vibrant" />
                      )}
                    </TabsTrigger>
                  );
                })}
              </TabsList>
              <button
                onClick={onCancel}
                className="shrink-0 rounded-md p-1 text-muted-foreground/60 transition-colors hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Content */}
          <div className={`px-4 ${singlePrompt ? 'pt-4' : 'pt-3'}`}>
            {prompts.map((prompt) => (
              <TabsContent key={prompt.id} value={prompt.id} className="mt-0">
                <p className="mb-3 text-sm font-medium text-foreground">
                  {prompt.question}
                </p>
                <PromptRenderer
                  prompt={prompt}
                  selections={selections}
                  tags={tags}
                  toggles={toggles}
                  otherText={otherText}
                  onToggleSelection={toggleSelection}
                  onSetTags={(id, v) => setTags((prev) => ({ ...prev, [id]: v }))}
                  onSetToggle={(id, v) => {
                    setToggles((prev) => ({ ...prev, [id]: v }));
                    advanceTab(id);
                  }}
                  onSetOtherText={(id, v) => setOtherText((prev) => ({ ...prev, [id]: v }))}
                />
              </TabsContent>
            ))}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-4 pb-3 pt-2">
            <span className="text-[11px] text-muted-foreground/40">Esc to dismiss</span>
            <button
              type="button"
              disabled={!canSubmit()}
              onClick={handleSubmit}
              className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-medium transition-all ${
                canSubmit()
                  ? 'bg-accent-vibrant text-white hover:bg-accent-vibrant/90'
                  : 'bg-muted text-muted-foreground cursor-not-allowed'
              }`}
            >
              <Send className="h-3 w-3" />
              {getSubmitLabel()}
            </button>
          </div>
        </Tabs>
      </div>
    </div>
  );
}

// ─── Shared Other Input ─────────────────────────────────────────────

function OtherInput({
  active,
  value,
  onChange,
  onActivate,
  variant = 'pill',
}: {
  active: boolean;
  value: string;
  onChange: (value: string) => void;
  onActivate: () => void;
  variant?: 'pill' | 'block';
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (active) inputRef.current?.focus();
  }, [active]);

  if (variant === 'block') {
    return (
      <div className={`mt-2 flex items-center gap-2 rounded-lg border px-3 py-2 text-left transition-all ${
        active
          ? 'border-accent-vibrant bg-accent-vibrant/5'
          : 'border-dashed border-border/60 hover:border-foreground/20'
      }`}>
        {active ? (
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => { if (e.key === 'Escape') e.stopPropagation(); }}
            placeholder="Type your answer..."
            className="flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/50"
          />
        ) : (
          <button type="button" onClick={onActivate} className="flex-1 text-left text-xs text-muted-foreground">
            Other
          </button>
        )}
      </div>
    );
  }

  // pill variant (inline in flex-wrap rows)
  if (active) {
    return (
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') e.stopPropagation(); }}
        placeholder="Type here..."
        className="rounded-full border border-accent-vibrant bg-accent-vibrant/5 px-3 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground/50 w-32"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={onActivate}
      className="rounded-full border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground hover:border-foreground/20 hover:text-foreground"
    >
      Other
    </button>
  );
}

// ─── Prompt Renderer ─────────────────────────────────────────────────

interface PromptRendererProps {
  prompt: StructuredPrompt;
  selections: SelectionMap;
  tags: TagMap;
  toggles: ToggleMap;
  otherText: OtherTextMap;
  onToggleSelection: (id: string, value: string, multi?: boolean) => void;
  onSetTags: (id: string, values: string[]) => void;
  onSetToggle: (id: string, value: boolean) => void;
  onSetOtherText: (id: string, value: string) => void;
}

function PromptRenderer({ prompt, selections, tags, toggles, otherText, onToggleSelection, onSetTags, onSetToggle, onSetOtherText }: PromptRendererProps) {
  switch (prompt.type) {
    case 'icon_grid':
      return (
        <PromptIconGrid
          prompt={prompt}
          selected={selections[prompt.id] ?? []}
          otherValue={otherText[prompt.id] ?? ''}
          onToggle={(v) => onToggleSelection(prompt.id, v, prompt.multi_select ?? true)}
          onOtherChange={(v) => onSetOtherText(prompt.id, v)}
        />
      );
    case 'pill_row':
      return (
        <PromptPillRow
          prompt={prompt}
          selected={selections[prompt.id] ?? []}
          otherValue={otherText[prompt.id] ?? ''}
          onSelect={(v) => onToggleSelection(prompt.id, v, prompt.multi_select)}
          onOtherChange={(v) => onSetOtherText(prompt.id, v)}
        />
      );
    case 'tag_input':
      return (
        <PromptTagInput
          prompt={prompt}
          values={tags[prompt.id] ?? []}
          onChange={(v) => onSetTags(prompt.id, v)}
        />
      );
    case 'card_select':
      return (
        <PromptCardSelect
          prompt={prompt}
          selected={selections[prompt.id] ?? []}
          otherValue={otherText[prompt.id] ?? ''}
          onSelect={(v) => onToggleSelection(prompt.id, v, prompt.multi_select)}
          onOtherChange={(v) => onSetOtherText(prompt.id, v)}
        />
      );
    case 'toggle_row':
      return (
        <PromptToggleRow
          prompt={prompt}
          checked={toggles[prompt.id] ?? false}
          otherValue={otherText[prompt.id] ?? ''}
          onChange={(v) => onSetToggle(prompt.id, v)}
          onOtherChange={(v) => onSetOtherText(prompt.id, v)}
        />
      );
    case 'approval':
      return (
        <PromptApproval
          prompt={prompt}
          selected={selections[prompt.id] ?? []}
          adjustText={otherText[prompt.id] ?? ''}
          onSelect={(v) => onToggleSelection(prompt.id, v, false)}
          onAdjustTextChange={(v) => onSetOtherText(prompt.id, v)}
        />
      );
    default:
      return null;
  }
}

// ─── Icon Grid (platforms) — 3-column grid ───────────────────────────

function PromptIconGrid({
  prompt,
  selected,
  otherValue,
  onToggle,
  onOtherChange,
}: {
  prompt: StructuredPrompt;
  selected: string[];
  otherValue: string;
  onToggle: (value: string) => void;
  onOtherChange: (value: string) => void;
}) {
  const otherActive = selected.includes(OTHER_VALUE);
  const showOther = prompt.allow_other !== false;

  return (
    <div>
      <div className="grid grid-cols-3 gap-2">
        {prompt.options?.map((opt) => {
          const active = selected.includes(opt.value);
          const isPlatform = ['instagram', 'tiktok', 'twitter', 'reddit', 'youtube'].includes(opt.icon ?? '');
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onToggle(opt.value)}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-all ${
                active
                  ? 'border-accent-vibrant bg-accent-vibrant/5 text-foreground'
                  : 'border-border/60 text-muted-foreground hover:border-foreground/20 hover:text-foreground'
              }`}
            >
              {isPlatform ? (
                <PlatformIcon platform={opt.icon!} className="h-4 w-4" />
              ) : opt.icon ? (
                <span className="text-sm">{opt.icon}</span>
              ) : null}
              {opt.label}
            </button>
          );
        })}
      </div>
      {showOther && (
        <OtherInput
          active={otherActive}
          value={otherValue}
          onChange={onOtherChange}
          onActivate={() => onToggle(OTHER_VALUE)}
          variant="block"
        />
      )}
    </div>
  );
}

// ─── Pill Row (time range, geo, post count) ──────────────────────────

function PromptPillRow({
  prompt,
  selected,
  otherValue,
  onSelect,
  onOtherChange,
}: {
  prompt: StructuredPrompt;
  selected: string[];
  otherValue: string;
  onSelect: (value: string) => void;
  onOtherChange: (value: string) => void;
}) {
  const otherActive = selected.includes(OTHER_VALUE);
  const showOther = prompt.allow_other !== false;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {prompt.options?.map((opt) => {
        const active = selected.includes(opt.value);
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onSelect(opt.value)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
              active
                ? 'bg-accent-vibrant text-white'
                : 'border border-border text-muted-foreground hover:border-accent-vibrant/40'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
      {showOther && (
        <OtherInput
          active={otherActive}
          value={otherValue}
          onChange={onOtherChange}
          onActivate={() => onSelect(OTHER_VALUE)}
          variant="pill"
        />
      )}
    </div>
  );
}

// ─── Tag Input (keywords) ────────────────────────────────────────────

function PromptTagInput({
  prompt,
  values,
  onChange,
}: {
  prompt: StructuredPrompt;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const addTag = () => {
    const trimmed = input.trim();
    if (trimmed && !values.includes(trimmed)) {
      onChange([...values, trimmed]);
    }
    setInput('');
  };

  const removeTag = (tag: string) => {
    onChange(values.filter((v) => v !== tag));
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); addTag(); }
    if (e.key === 'Backspace' && !input && values.length > 0) {
      onChange(values.slice(0, -1));
    }
    if (e.key === 'Escape') { e.stopPropagation(); }
  };

  return (
    <div
      className="flex flex-wrap items-center gap-1.5 rounded-lg border border-input px-3 py-2 focus-within:border-foreground/20"
      onClick={() => inputRef.current?.focus()}
    >
      {values.map((tag) => (
        <Badge key={tag} variant="secondary" className="gap-1 bg-foreground/10 text-foreground text-xs">
          {tag}
          <button type="button" onClick={() => removeTag(tag)}>
            <X className="h-2.5 w-2.5" />
          </button>
        </Badge>
      ))}
      <input
        ref={inputRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={addTag}
        placeholder={values.length === 0 ? (prompt.placeholder ?? 'Type and press Enter') : ''}
        className="min-w-[100px] flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}

// ─── Card Select (research angles, custom choices) ───────────────────

function PromptCardSelect({
  prompt,
  selected,
  otherValue,
  onSelect,
  onOtherChange,
}: {
  prompt: StructuredPrompt;
  selected: string[];
  otherValue: string;
  onSelect: (value: string) => void;
  onOtherChange: (value: string) => void;
}) {
  const options = prompt.options ?? [];
  const gridCols = options.length >= 4 ? 'grid-cols-2' : 'grid-cols-1';
  const otherActive = selected.includes(OTHER_VALUE);
  const showOther = prompt.allow_other !== false;
  const otherRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (otherActive) otherRef.current?.focus();
  }, [otherActive]);

  return (
    <div className={`grid gap-1.5 ${gridCols}`}>
      {options.map((opt) => {
        const active = selected.includes(opt.value);
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onSelect(opt.value)}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left transition-all ${
              active
                ? 'border-accent-vibrant bg-accent-vibrant/5'
                : 'border-border/60 hover:border-foreground/20'
            }`}
          >
            <RadioDot active={active} />
            <div className="min-w-0">
              <span className="text-xs font-medium text-foreground">{opt.label}</span>
              {opt.description && (
                <span className="ml-1.5 text-[11px] text-muted-foreground">{opt.description}</span>
              )}
            </div>
          </button>
        );
      })}
      {/* Other option */}
      {showOther && (
        <button
          type="button"
          onClick={() => onSelect(OTHER_VALUE)}
          className={`col-span-full flex items-center gap-2 rounded-lg border px-3 py-2 text-left transition-all ${
            otherActive
              ? 'border-accent-vibrant bg-accent-vibrant/5'
              : 'border-dashed border-border/60 hover:border-foreground/20'
          }`}
        >
          <RadioDot active={otherActive} />
          {otherActive ? (
            <input
              ref={otherRef}
              value={otherValue}
              onChange={(e) => onOtherChange(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => { if (e.key === 'Escape') e.stopPropagation(); }}
              placeholder="Type your answer..."
              className="flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/50"
            />
          ) : (
            <span className="text-xs text-muted-foreground">Other</span>
          )}
        </button>
      )}
    </div>
  );
}

function RadioDot({ active }: { active: boolean }) {
  return (
    <div className={`flex h-3 w-3 shrink-0 items-center justify-center rounded-full border transition-colors ${
      active ? 'border-accent-vibrant bg-accent-vibrant' : 'border-muted-foreground/30'
    }`}>
      {active && <div className="h-1 w-1 rounded-full bg-white" />}
    </div>
  );
}

// ─── Toggle Row (include comments, ongoing) ──────────────────────────

function PromptToggleRow({
  prompt,
  checked,
  otherValue,
  onChange,
  onOtherChange,
}: {
  prompt: StructuredPrompt;
  checked: boolean;
  otherValue: string;
  onChange: (value: boolean) => void;
  onOtherChange: (value: string) => void;
}) {
  const showOther = prompt.allow_other !== false;
  const [otherActive, setOtherActive] = useState(false);

  return (
    <div>
      <div className={`flex items-center justify-between rounded-lg border px-3 py-2 transition-colors ${
        checked ? 'border-accent-vibrant/20 bg-accent-vibrant/5' : 'border-border/50'
      }`}>
        <span className="text-xs text-foreground">{prompt.question}</span>
        <Switch checked={checked} onCheckedChange={onChange} />
      </div>
      {showOther && (
        <OtherInput
          active={otherActive}
          value={otherValue}
          onChange={onOtherChange}
          onActivate={() => setOtherActive(true)}
          variant="block"
        />
      )}
    </div>
  );
}

// ─── Approval (approve/adjust with feedback textarea) ────────────────

function PromptApproval({
  prompt,
  selected,
  adjustText,
  onSelect,
  onAdjustTextChange,
}: {
  prompt: StructuredPrompt;
  selected: string[];
  adjustText: string;
  onSelect: (value: string) => void;
  onAdjustTextChange: (value: string) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isApprove = selected.includes('approve');
  const isAdjust = selected.includes('adjust');

  useEffect(() => {
    if (isAdjust) {
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }, [isAdjust]);

  return (
    <div>
      <div className="flex gap-2">
        {prompt.options?.map((opt) => {
          const active = selected.includes(opt.value);
          const isPrimary = opt.value === 'approve';
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onSelect(opt.value)}
              className={`flex-1 rounded-lg border px-4 py-2.5 text-xs font-medium transition-all ${
                active
                  ? isPrimary
                    ? 'border-accent-vibrant bg-accent-vibrant text-white'
                    : 'border-accent-vibrant bg-accent-vibrant/5 text-foreground'
                  : 'border-border/60 text-muted-foreground hover:border-foreground/20 hover:text-foreground'
              }`}
            >
              {active && isPrimary && <Check className="mr-1.5 inline h-3 w-3" />}
              {opt.label}
            </button>
          );
        })}
      </div>
      {isAdjust && (
        <textarea
          ref={textareaRef}
          value={adjustText}
          onChange={(e) => onAdjustTextChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') e.stopPropagation();
          }}
          placeholder="What would you like to change?"
          rows={3}
          className="mt-2 w-full rounded-lg border border-accent-vibrant/30 bg-accent-vibrant/5 px-3 py-2 text-xs text-foreground outline-none placeholder:text-muted-foreground/50 focus:border-accent-vibrant/60 resize-none"
        />
      )}
    </div>
  );
}

// ─── Summary (shown in AgentMessage after submission) ────────────────

export function PromptAnsweredSummary({ data }: { data: Record<string, unknown> }) {
  const payload = data as unknown as StructuredPromptResult;
  const prompts = payload?.prompts ?? [];

  return (
    <div className="mt-2 flex items-center gap-1.5">
      <span className="h-1.5 w-1.5 rounded-full bg-accent-vibrant" />
      <span className="text-[11px] text-muted-foreground">
        {prompts.length} question{prompts.length !== 1 ? 's' : ''} answered
      </span>
    </div>
  );
}

// ─── Utilities ───────────────────────────────────────────────────────

function promptLabel(p: StructuredPrompt): string {
  const labels: Record<string, string> = {
    platforms: 'Platforms',
    time_range: 'Time Range',
    keywords: 'Keywords',
    geo_scope: 'Geo',
    include_comments: 'Comments',
    posts_per_keyword: 'Posts/keyword',
    approve_plan: 'Approval',
  };
  return labels[p.id] ?? p.id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
