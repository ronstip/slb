import { ArrowRight, Eye, Lightbulb, RefreshCw, Sparkles } from 'lucide-react';
import { Logo } from '../../components/Logo.tsx';
import { MessageInput } from './MessageInput.tsx';

interface WelcomeScreenProps {
  onSend: (text: string) => void;
}

/* ── Data ────────────────────────────────────────────────── */

const SUGGESTIONS = [
  {
    label: 'Catch me up — what did you find?',
    prompt: 'Give me a summary of what you found so far — key insights, highlights, anything I should know about',
    icon: Eye,
  },
  {
    label: 'Anything surprising in the data?',
    prompt: 'Look through the collected data and tell me if there is anything surprising, unexpected, or worth paying attention to',
    icon: Lightbulb,
  },
  {
    label: 'Run a fresh collection',
    prompt: 'Start a new data collection',
    icon: RefreshCw,
  },
  {
    label: 'What can you do for me?',
    prompt: 'What are all the things you can help me with? List your capabilities',
    icon: Sparkles,
  },
];

/* ── Main component ──────────────────────────────────────── */

export function WelcomeScreen({ onSend }: WelcomeScreenProps) {
  return (
    <div data-testid="welcome-screen" className="flex flex-1 flex-col items-center px-6 pt-16 pb-6">
      {/* Greeting */}
      <div className="flex flex-col items-center mb-10">
        <Logo size="lg" showText={false} />
        <h1 className="mt-5 text-[22px] font-bold tracking-tight text-foreground">
          I'm on it. Ask me anything.
        </h1>
        <p className="mt-2 text-sm text-muted-foreground/70">
          I have access to your data, collections, and tools — just say the word.
        </p>
      </div>

      {/* Input */}
      <div className="w-full max-w-2xl mb-10">
        <MessageInput onSend={onSend} centered />
      </div>

      {/* Conversational suggestions */}
      <div className="w-full max-w-[520px]">
        <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground/40 mb-3 px-1">
          Try asking
        </p>
        <div className="space-y-1.5">
          {SUGGESTIONS.map(({ label, prompt, icon: Icon }) => (
            <button
              key={label}
              type="button"
              onClick={() => onSend(prompt)}
              className="group flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition-all duration-200 hover:bg-primary/[0.04] cursor-pointer"
            >
              <Icon className="h-4 w-4 shrink-0 text-primary/40 transition-colors group-hover:text-primary/70" />
              <span className="text-[13.5px] text-foreground/70 transition-colors group-hover:text-foreground">
                {label}
              </span>
              <ArrowRight className="ml-auto h-3.5 w-3.5 shrink-0 text-transparent transition-all duration-200 group-hover:text-primary/50 group-hover:translate-x-0.5" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
