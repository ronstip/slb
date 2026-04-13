import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';

const STATUS_MESSAGES = [
  'Reading your request…',
  'Checking your existing collections…',
  'Drafting the collection plan…',
  'Picking enrichment fields…',
  'Finalizing the schedule…',
];

const LONG_WAIT_MESSAGE = 'Almost there…';
const STEP_MS = 1200;
const LONG_WAIT_MS = 8000;

interface AIThinkingCardProps {
  label?: string;
}

export function AIThinkingCard({ label }: AIThinkingCardProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [longWait, setLongWait] = useState(false);

  useEffect(() => {
    const stepTimer = setInterval(() => {
      setStepIndex((i) => (i + 1) % STATUS_MESSAGES.length);
    }, STEP_MS);
    const longTimer = setTimeout(() => setLongWait(true), LONG_WAIT_MS);
    return () => {
      clearInterval(stepTimer);
      clearTimeout(longTimer);
    };
  }, []);

  const message = longWait ? LONG_WAIT_MESSAGE : STATUS_MESSAGES[stepIndex];

  return (
    <div className="relative overflow-hidden rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
      <div className="absolute inset-x-0 top-0 h-0.5 overflow-hidden">
        <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.8s_infinite] bg-gradient-to-r from-transparent via-primary/70 to-transparent" />
      </div>
      <div className="flex items-center gap-2.5">
        <div className="relative flex h-6 w-6 items-center justify-center">
          <span className="absolute inset-0 animate-ping rounded-full bg-primary/30" />
          <Sparkles className="relative h-3.5 w-3.5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          {label && (
            <p className="text-[10px] font-medium uppercase tracking-wide text-primary/70">
              {label}
            </p>
          )}
          <p className="text-xs font-medium text-foreground transition-opacity duration-300">
            {message}
          </p>
        </div>
      </div>
    </div>
  );
}
