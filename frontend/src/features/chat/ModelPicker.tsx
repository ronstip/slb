import { SlidersHorizontal, Check } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../../components/ui/popover.tsx';
import {
  useModelSettingsStore,
  MODEL_OPTIONS,
  THINKING_OPTIONS,
} from '../../stores/model-settings-store.ts';
import { cn } from '../../lib/utils.ts';

interface ModelPickerProps {
  compact?: boolean;
  disabled?: boolean;
}

export function ModelPicker({ compact = false, disabled = false }: ModelPickerProps) {
  const model = useModelSettingsStore((s) => s.model);
  const thinkingLevel = useModelSettingsStore((s) => s.thinkingLevel);
  const searchGrounding = useModelSettingsStore((s) => s.searchGrounding);
  const setModel = useModelSettingsStore((s) => s.setModel);
  const setThinkingLevel = useModelSettingsStore((s) => s.setThinkingLevel);
  const setSearchGrounding = useModelSettingsStore((s) => s.setSearchGrounding);

  const activeModel = MODEL_OPTIONS.find((o) => o.key === model) ?? MODEL_OPTIONS[0];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          title={`Model: ${activeModel.label} • Thinking: ${thinkingLevel} • Search: ${searchGrounding ? 'on' : 'off'}`}
          className={cn(
            'shrink-0 rounded-full text-muted-foreground hover:bg-muted flex items-center justify-center transition-colors disabled:opacity-30 disabled:pointer-events-none',
            compact ? 'h-6 w-6' : 'h-8 w-8',
          )}
        >
          <SlidersHorizontal className={cn(compact ? 'h-2.5 w-2.5' : 'h-3.5 w-3.5')} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-80 p-0">
        <div className="border-b border-border/60 px-3 py-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Model
          </div>
        </div>
        <div className="p-1">
          {MODEL_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setModel(opt.key)}
              className={cn(
                'flex w-full items-start gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted',
                model === opt.key && 'bg-muted/60',
              )}
            >
              <Check
                className={cn(
                  'mt-0.5 h-3.5 w-3.5 shrink-0 text-primary',
                  model === opt.key ? 'opacity-100' : 'opacity-0',
                )}
              />
              <div className="flex-1">
                <div className="text-sm font-medium">{opt.label}</div>
                <div className="text-xs text-muted-foreground">{opt.description}</div>
              </div>
            </button>
          ))}
        </div>

        <div className="border-y border-border/60 px-3 py-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Thinking
          </div>
        </div>
        <div className="grid grid-cols-5 gap-1 p-2">
          {THINKING_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setThinkingLevel(opt.key)}
              title={opt.description}
              className={cn(
                'rounded-md border px-1 py-1.5 text-[11px] font-medium transition-colors',
                thinkingLevel === opt.key
                  ? 'border-primary/40 bg-primary/10 text-primary'
                  : 'border-border/60 text-muted-foreground hover:bg-muted',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="border-t border-border/60 px-3 py-2">
          <label className="flex cursor-pointer items-center justify-between gap-2">
            <div className="flex-1">
              <div className="text-sm font-medium">Web search</div>
              <div className="text-xs text-muted-foreground">
                Use Google Search for current info.
              </div>
            </div>
            <input
              type="checkbox"
              checked={searchGrounding}
              onChange={(e) => setSearchGrounding(e.target.checked)}
              className="h-4 w-4 cursor-pointer accent-primary"
            />
          </label>
        </div>
      </PopoverContent>
    </Popover>
  );
}
