import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { useUIStore, type PollData } from '../../../stores/ui-store.ts';

interface QuickChoicePollProps {
  poll: PollData;
  onSubmit: (selection: string) => void;
}

export function QuickChoicePoll({ poll, onSubmit }: QuickChoicePollProps) {
  const dismissPoll = useUIStore((s) => s.dismissPoll);
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismissPoll();
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [dismissPoll]);

  const handleSelect = (value: string) => {
    if (poll.type === 'multi') {
      setSelected((prev) =>
        prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
      );
    } else {
      setSelected([value]);
    }
  };

  const handleSubmit = () => {
    if (selected.length === 0) return;
    onSubmit(selected.join(', '));
    dismissPoll();
  };

  return (
    <div className="mx-4 mb-2 rounded-lg border border-border-default bg-bg-surface p-4 shadow-sm">
      <div className="flex items-start justify-between">
        <p className="text-sm font-medium text-text-primary">{poll.question}</p>
        <button
          onClick={dismissPoll}
          className="rounded p-0.5 text-text-tertiary hover:text-text-secondary"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mt-3 flex flex-col gap-2">
        {poll.options.map((opt) => (
          <label
            key={opt.value}
            className="flex cursor-pointer items-center gap-2 rounded-md border border-border-default px-3 py-2 text-sm transition-colors hover:border-accent/30"
          >
            <input
              type={poll.type === 'multi' ? 'checkbox' : 'radio'}
              name="poll"
              checked={selected.includes(opt.value)}
              onChange={() => handleSelect(opt.value)}
              className="text-accent focus:ring-accent"
            />
            <span className="text-text-primary">{opt.label}</span>
          </label>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-between">
        <button
          onClick={handleSubmit}
          disabled={selected.length === 0}
          className="rounded-md bg-accent px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
        >
          Submit
        </button>
        <span className="text-xs text-text-tertiary">Esc to skip</span>
      </div>
    </div>
  );
}
