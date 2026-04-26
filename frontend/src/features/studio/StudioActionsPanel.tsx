import { useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { useChatStore } from '../../stores/chat-store.ts';
import { useSSEChat } from '../chat/hooks/useSSEChat.ts';
import { ChartDialog } from './ChartDialog.tsx';
import { STUDIO_ACTIONS, type StudioAction } from './studio-actions.ts';
import { cn } from '../../lib/utils.ts';
import type { CustomFieldDef } from '../../api/types.ts';

interface StudioActionsPanelProps {
  /** Agent-defined custom enrichment fields, forwarded to dialogs that build prompts. */
  customFields?: CustomFieldDef[] | null;
  /**
   * 'compact' (default) renders the dense tile-and-label buttons used in the
   * Topics page. 'overview' renders DeliverablesPanel-style cards (gradient
   * tile on top, label below) so the actions blend with the rest of the
   * Overview page.
   */
  variant?: 'compact' | 'overview';
}

export function StudioActionsPanel({ customFields, variant = 'compact' }: StudioActionsPanelProps = {}) {
  const { sendMessage } = useSSEChat();
  const isAgentResponding = useChatStore((s) => s.isAgentResponding);
  const [chartOpen, setChartOpen] = useState(false);

  const handlerFor = (action: StudioAction) => {
    if (action.id === 'chart') return () => setChartOpen(true);
    if (action.id === 'create_skill') return () => {};
    return () => action.prompt && sendMessage(action.prompt);
  };

  if (variant === 'overview') {
    return (
      <>
        <div className="grid grid-cols-2 gap-2.5">
          {STUDIO_ACTIONS.map((action) => {
            const Icon = action.icon;
            const isDashed = action.variant === 'dashed';
            return (
              <button
                key={action.id}
                type="button"
                disabled={isAgentResponding}
                onClick={handlerFor(action)}
                className={cn(
                  'group relative flex h-[88px] flex-col items-start justify-between overflow-hidden rounded-xl border p-3 text-left transition-all duration-200 active:scale-[0.97]',
                  action.tileTheme,
                  !isDashed && 'hover:shadow-md',
                  'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:shadow-none disabled:active:scale-100',
                )}
              >
                <span
                  className={cn(
                    'flex h-9 w-9 items-center justify-center rounded-lg shadow-sm ring-1 ring-inset ring-white/10 transition-transform duration-200 group-hover:scale-110',
                    action.iconBubble,
                  )}
                >
                  <Icon className="h-[18px] w-[18px]" />
                </span>
                <span className="line-clamp-1 text-[13px] font-semibold">
                  {action.label}
                </span>
                {!isDashed && (
                  <ArrowUpRight className="absolute right-2.5 top-2.5 h-3.5 w-3.5 opacity-60 transition-all duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:opacity-100" />
                )}
              </button>
            );
          })}
        </div>
        <ChartDialog
          open={chartOpen}
          onOpenChange={setChartOpen}
          onSubmit={sendMessage}
          customFields={customFields}
        />
      </>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      {STUDIO_ACTIONS.map((action) => {
        const Icon = action.icon;
        const isDashed = action.variant === 'dashed';
        return (
          <button
            key={action.id}
            type="button"
            disabled={isAgentResponding}
            onClick={handlerFor(action)}
            className={cn(
              'flex flex-col items-center justify-center gap-1.5 rounded-xl border bg-background px-2 py-3 text-center transition-colors',
              isDashed ? 'border-dashed border-muted-foreground/40' : 'border-border',
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
      <ChartDialog
        open={chartOpen}
        onOpenChange={setChartOpen}
        onSubmit={sendMessage}
        customFields={customFields}
      />
    </div>
  );
}
