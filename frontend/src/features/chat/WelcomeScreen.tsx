import { BarChart3, Users, TrendingUp, MessageCircle } from 'lucide-react';
import { Logo } from '../../components/Logo.tsx';
import { MessageInput } from './MessageInput.tsx';

interface WelcomeScreenProps {
  onPromptClick: (text: string) => void;
  onSend: (text: string) => void;
}

const USE_CASES = [
  {
    icon: BarChart3,
    label: 'Brand Sentiment',
    prompt: 'Analyze the overall sentiment around our brand across TikTok and Instagram this week',
  },
  {
    icon: Users,
    label: 'Competitor Analysis',
    prompt: 'Compare how people talk about Tesla vs Rivian on Reddit and Twitter',
  },
  {
    icon: TrendingUp,
    label: 'Trending Topics',
    prompt: 'What topics are blowing up in the gaming community this week?',
  },
  {
    icon: MessageCircle,
    label: 'Audience Insights',
    prompt: 'Who are the top voices in sustainable fashion on Instagram?',
  },
];

export function WelcomeScreen({ onPromptClick, onSend }: WelcomeScreenProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-8">
      {/* Animated logo with glow + pulsing rings */}
      <div className="relative flex items-center justify-center">
        {/* Subtle radial glow behind logo */}
        <div className="absolute h-32 w-32 rounded-full bg-accent-vibrant/8 blur-2xl" />
        <div className="pulse-ring-1 absolute h-24 w-24 rounded-full border border-accent-vibrant/15" />
        <div className="pulse-ring-2 absolute h-36 w-36 rounded-full border border-accent-vibrant/8" />
        <Logo size="lg" showText={false} />
      </div>

      <h2 className="mt-8 text-3xl font-bold tracking-tight text-foreground">
        Every trend starts with a whisper
      </h2>
      <p className="mt-2 text-base text-muted-foreground">
        Real-time social intelligence across every platform
      </p>

      <div className="mt-10 w-full max-w-2xl">
        <MessageInput onSend={onSend} centered />
      </div>

      {/* Use case buttons — 2x2 grid */}
      <div className="mt-8 grid grid-cols-2 gap-2.5 max-w-lg">
        {USE_CASES.map(({ icon: Icon, label, prompt }) => (
          <button
            key={label}
            type="button"
            onClick={() => onPromptClick(prompt)}
            className="flex items-center gap-2.5 rounded-xl border border-border bg-card px-4 py-3 text-left text-xs font-medium text-muted-foreground transition-all hover:border-foreground/20 hover:bg-accent hover:text-foreground hover:shadow-sm"
          >
            <Icon className="h-4 w-4 shrink-0 text-accent-vibrant/70" />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
