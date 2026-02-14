import { BarChart3 } from 'lucide-react';
import { Card } from '../../components/ui/card.tsx';

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
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
        <BarChart3 className="h-6 w-6 text-primary" />
      </div>
      <h2 className="mt-4 text-xl font-semibold text-foreground">
        What do you want to know about your market?
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Add sources on the left, then ask questions — or just start typing.
      </p>

      <div className="mt-8 grid max-w-lg grid-cols-2 gap-3">
        {PROMPT_CARDS.map((prompt) => (
          <Card
            key={prompt}
            className="cursor-pointer p-4 text-left text-sm text-muted-foreground transition-all hover:border-primary/30 hover:text-foreground hover:shadow-md"
            onClick={() => onPromptClick(prompt)}
          >
            {prompt}
          </Card>
        ))}
      </div>
    </div>
  );
}
