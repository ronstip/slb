import { ArrowRight } from 'lucide-react';

interface FollowUpChipsProps {
  suggestions: string[];
  onSelect: (suggestion: string) => void;
}

export function FollowUpChips({ suggestions, onSelect }: FollowUpChipsProps) {
  if (suggestions.length === 0) return null;

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {suggestions.map((suggestion, i) => (
        <button
          key={i}
          onClick={() => onSelect(suggestion)}
          className="group flex items-center gap-1.5 rounded-full border border-border/60 bg-background px-3 py-1.5 text-[11px] text-muted-foreground transition-all hover:border-primary/40 hover:bg-primary/5 hover:text-foreground"
        >
          <span>{suggestion}</span>
          <ArrowRight className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-60" />
        </button>
      ))}
    </div>
  );
}
