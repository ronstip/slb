import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { useUIStore, type PollData } from '../../../stores/ui-store.ts';
import { Button } from '../../../components/ui/button.tsx';
import { Card } from '../../../components/ui/card.tsx';

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
    <Card className="mx-4 mb-2 p-4">
      <div className="flex items-start justify-between">
        <p className="text-sm font-medium text-foreground">{poll.question}</p>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={dismissPoll}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="mt-3 flex flex-col gap-2">
        {poll.options.map((opt) => (
          <label
            key={opt.value}
            className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm transition-colors hover:border-primary/30"
          >
            <input
              type={poll.type === 'multi' ? 'checkbox' : 'radio'}
              name="poll"
              checked={selected.includes(opt.value)}
              onChange={() => handleSelect(opt.value)}
              className="text-primary focus:ring-primary"
            />
            <span className="text-foreground">{opt.label}</span>
          </label>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-between">
        <Button size="sm" onClick={handleSubmit} disabled={selected.length === 0}>
          Submit
        </Button>
        <span className="text-xs text-muted-foreground">Esc to skip</span>
      </div>
    </Card>
  );
}
