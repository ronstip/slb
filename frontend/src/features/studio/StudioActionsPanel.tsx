import { useState } from 'react';
import { useChatStore } from '../../stores/chat-store.ts';
import { useSSEChat } from '../chat/hooks/useSSEChat.ts';
import { ChartDialog } from './ChartDialog.tsx';
import { STUDIO_ACTIONS } from './studio-actions.ts';
import { cn } from '../../lib/utils.ts';

export function StudioActionsPanel() {
  const { sendMessage } = useSSEChat();
  const isAgentResponding = useChatStore((s) => s.isAgentResponding);
  const [chartOpen, setChartOpen] = useState(false);

  return (
    <div className="grid grid-cols-2 gap-2">
      {STUDIO_ACTIONS.map((action) => {
        const Icon = action.icon;
        const onClick =
          action.id === 'chart'
            ? () => setChartOpen(true)
            : () => action.prompt && sendMessage(action.prompt);
        return (
          <button
            key={action.id}
            type="button"
            disabled={isAgentResponding}
            onClick={onClick}
            className={cn(
              'flex flex-col items-center justify-center gap-1.5 rounded-xl border border-border bg-background px-2 py-3 text-center transition-colors',
              'disabled:cursor-not-allowed disabled:opacity-50',
              !isAgentResponding && action.hoverClass,
            )}
          >
            <span className={cn('flex h-8 w-8 items-center justify-center rounded-lg', action.iconClass)}>
              <Icon className="h-4 w-4" />
            </span>
            <span className="text-[11px] font-medium leading-tight text-foreground">
              {action.label}
            </span>
          </button>
        );
      })}
      <ChartDialog open={chartOpen} onOpenChange={setChartOpen} onSubmit={sendMessage} />
    </div>
  );
}
