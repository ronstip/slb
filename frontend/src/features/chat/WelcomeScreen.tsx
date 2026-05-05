import { ArrowRight, Eye, Lightbulb, RefreshCw, Sparkles } from 'lucide-react';
import { BotAvatar } from '../../components/BrandElements.tsx';
import { Logo } from '../../components/Logo.tsx';
import { useAgentStore } from '../../stores/agent-store.ts';
import { MessageInput } from './MessageInput.tsx';

interface WelcomeScreenProps {
  onSend: (text: string) => void;
}

const SUGGESTIONS = [
  {
    label: 'Catch me up — what did you find?',
    prompt:
      'Give me a summary of what you found so far — key insights, highlights, anything I should know about',
    icon: Eye,
  },
  {
    label: 'Anything surprising in the data?',
    prompt:
      'Look through the collected data and tell me if there is anything surprising, unexpected, or worth paying attention to',
    icon: Lightbulb,
  },
  {
    label: 'Gather fresh data',
    prompt: 'Start a new data search',
    icon: RefreshCw,
  },
  {
    label: 'What can you do for me?',
    prompt: 'What are all the things you can help me with? List your capabilities',
    icon: Sparkles,
  },
];

export function WelcomeScreen({ onSend }: WelcomeScreenProps) {
  const activeAgent = useAgentStore((s) => s.activeAgent);

  const greeting = activeAgent
    ? `Hi, I'm ${activeAgent.title}.`
    : "I'm on it. Ask me anything.";

  const subtitle = activeAgent
    ? 'I have access to this agent’s data and tools — just say the word.'
    : 'I have access to your data and tools — just say the word.';

  return (
    <div
      data-testid="welcome-screen"
      className="flex flex-1 flex-col items-center px-6 pt-16 pb-6"
    >
      {/* Greeting */}
      <div className="mb-10 flex flex-col items-center">
        {activeAgent ? (
          <BotAvatar
            seed={activeAgent.agent_id}
            size={72}
            className="shadow-lg ring-1 ring-border/40"
          />
        ) : (
          <Logo size="lg" showText={false} />
        )}
        <h1 className="mt-5 font-heading text-[22px] font-semibold tracking-tight text-foreground">
          {greeting}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground/80">{subtitle}</p>
      </div>

      {/* Input */}
      <div className="mb-10 w-full max-w-2xl">
        <MessageInput onSend={onSend} centered />
      </div>

      {/* Suggestions */}
      <div className="w-full max-w-[520px]">
        <p className="mb-3 px-1 text-[11px] font-medium uppercase tracking-widest text-muted-foreground/50">
          Try asking
        </p>
        <div className="space-y-1.5">
          {SUGGESTIONS.map(({ label, prompt, icon: Icon }) => (
            <button
              key={label}
              type="button"
              onClick={() => onSend(prompt)}
              className="group flex w-full cursor-pointer items-center gap-3 rounded-xl border border-transparent bg-card/40 px-4 py-3 text-left transition-all duration-200 hover:border-primary/20 hover:bg-primary/[0.06] hover:shadow-sm"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary/70 transition-colors group-hover:bg-primary/15 group-hover:text-primary">
                <Icon className="h-3.5 w-3.5" />
              </span>
              <span className="text-[13.5px] text-foreground/80 transition-colors group-hover:text-foreground">
                {label}
              </span>
              <ArrowRight className="ml-auto h-3.5 w-3.5 shrink-0 text-transparent transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-primary/60" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
