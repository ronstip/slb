import { Search, ArrowRight } from 'lucide-react';

interface WelcomeScreenProps {
  onPromptClick: (text: string) => void;
}

const SUGGESTIONS = [
  'What is TikTok saying about Ozempic right now?',
  'Show me how people feel about Tesla on Reddit and Twitter',
  'Who are the top voices in sustainable fashion on Instagram?',
  'What topics are blowing up in the gaming community this week?',
];

export function WelcomeScreen({ onPromptClick }: WelcomeScreenProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-8">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
        <Search className="h-5 w-5 text-primary" />
      </div>
      <h2 className="mt-4 text-lg font-medium text-foreground">
        What's the conversation around your topic?
      </h2>
      <p className="mt-1.5 max-w-sm text-center text-sm text-muted-foreground/70">
        Describe what you're researching and I'll collect and analyze real social media posts for you.
      </p>

      <div className="mt-8 flex max-w-md flex-col gap-1">
        <p className="mb-1 px-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/40">
          Try asking
        </p>
        {SUGGESTIONS.map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => onPromptClick(prompt)}
            className="group flex items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] text-muted-foreground/70 transition-colors hover:bg-secondary/60 hover:text-foreground"
          >
            <ArrowRight className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" />
            <span className="-ml-5 transition-[margin] group-hover:ml-0">{prompt}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
