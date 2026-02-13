import { BarChart3 } from 'lucide-react';

interface WelcomeScreenProps {
  onPromptClick: (text: string) => void;
}

const PROMPT_CARDS = [
  'How is Glossier perceived on Instagram and TikTok?',
  'What are people saying about AI tools on Reddit?',
  'Compare sentiment: Nike vs Adidas this quarter',
  'What content themes are trending in skincare?',
];

export function WelcomeScreen({ onPromptClick }: WelcomeScreenProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-8">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/10">
        <BarChart3 className="h-6 w-6 text-accent" />
      </div>
      <h2 className="mt-4 text-xl font-semibold text-text-primary">
        What do you want to know about your market?
      </h2>
      <p className="mt-2 text-sm text-text-secondary">
        Add sources on the left, then ask questions — or just start typing.
      </p>

      <div className="mt-8 grid max-w-lg grid-cols-2 gap-3">
        {PROMPT_CARDS.map((prompt) => (
          <button
            key={prompt}
            onClick={() => onPromptClick(prompt)}
            className="rounded-2xl border border-border-default/50 bg-bg-surface p-4 text-left text-sm text-text-secondary shadow-sm transition-all hover:border-accent/30 hover:text-text-primary hover:shadow-md"
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}
