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
      {/* Animated logo with pulsing rings */}
      <div className="relative flex items-center justify-center">
        <div className="pulse-ring-1 absolute h-24 w-24 rounded-full border border-primary/20" />
        <div className="pulse-ring-2 absolute h-36 w-36 rounded-full border border-primary/10" />
        <div className="pulse-ring-3 absolute h-48 w-48 rounded-full border border-primary/5" />
        <Logo size="lg" showText={false} />
      </div>

      <h2 className="mt-6 text-2xl font-semibold tracking-tight text-foreground">
        Every trend starts with a whisper. Find It.
      </h2>
      <p className="mt-1.5 text-sm text-muted-foreground/60">
        Real-time social intelligence across every platform
      </p>

      <div className="mt-10 w-full max-w-2xl">
        <MessageInput onSend={onSend} centered />
      </div>

      <div className="mt-8 flex flex-wrap justify-center gap-2.5">
        {USE_CASES.map(({ icon: Icon, label, prompt }) => (
          <button
            key={label}
            type="button"
            onClick={() => onPromptClick(prompt)}
            className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card px-4 py-2 text-xs font-medium text-muted-foreground/70 transition-all hover:border-primary/30 hover:bg-primary/5 hover:text-foreground hover:shadow-sm"
          >
            <Icon className="h-3.5 w-3.5 text-primary/50" />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
