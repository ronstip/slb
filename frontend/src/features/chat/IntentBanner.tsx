import { Target } from 'lucide-react';

interface IntentBannerProps {
  text: string;
}

export function IntentBanner({ text }: IntentBannerProps) {
  return (
    <div className="mb-2 flex items-start gap-2 rounded-lg border border-accent-vibrant/20 bg-accent-vibrant/5 px-3 py-2">
      <Target className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-vibrant/70" />
      <span className="text-xs leading-relaxed text-muted-foreground">
        {text}
      </span>
    </div>
  );
}
