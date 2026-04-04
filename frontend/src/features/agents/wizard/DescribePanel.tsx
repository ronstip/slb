import { ChevronRight } from 'lucide-react';
import { Textarea } from '../../../components/ui/textarea.tsx';
import { cn } from '../../../lib/utils.ts';

interface DescribePanelProps {
  description: string;
  onDescriptionChange: (value: string) => void;
  onQuickPrompt: (prompt: string) => void;
}

const QUICK_PROMPTS = [
  { label: 'Track my brand', prompt: 'Track what people are saying about my brand across social media' },
  { label: 'Compare competitors', prompt: 'Compare my brand against competitors on social media' },
  { label: 'Measure a campaign', prompt: 'Measure how our latest campaign is performing on social media' },
  { label: 'Monitor for crises', prompt: 'Monitor social media for any negative sentiment or crisis around my brand' },
];

export function DescribePanel({ description, onDescriptionChange, onQuickPrompt }: DescribePanelProps) {
  return (
    <div className="flex flex-col rounded-2xl border border-primary/20 bg-card p-6 shadow-sm">
      <div className="flex items-center gap-2.5 mb-4">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
          1
        </span>
        <h3 className="text-lg font-semibold text-primary tracking-tight">
          Describe what you need
        </h3>
      </div>

      <p className="text-[13px] text-muted-foreground mb-4">
        Tell us what you want to monitor, track, or analyze
      </p>

      <Textarea
        value={description}
        onChange={(e) => onDescriptionChange(e.target.value)}
        placeholder="e.g., Track what people are saying about Apple Vision Pro across all social platforms..."
        className="min-h-[100px] resize-none text-sm"
      />

      <div className="mt-4 space-y-1.5">
        <p className="text-[11px] font-medium text-muted-foreground/60 uppercase tracking-wider">
          Quick start
        </p>
        {QUICK_PROMPTS.map(({ label, prompt }) => (
          <button
            key={label}
            type="button"
            onClick={() => onQuickPrompt(prompt)}
            className={cn(
              'group flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-all',
              'hover:bg-primary/5',
              description === prompt && 'bg-primary/10',
            )}
          >
            <span className="flex-1 text-[13px] text-foreground/70 group-hover:text-primary">
              {label}
            </span>
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/30 group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
          </button>
        ))}
      </div>
    </div>
  );
}
