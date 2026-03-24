import { ListChecks, Check, Circle, ArrowRight } from 'lucide-react';
import { Card } from '../../../components/ui/card.tsx';

interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

interface TodoCardProps {
  data: Record<string, unknown>;
}

export function TodoCard({ data }: TodoCardProps) {
  const todos = (data.todos as TodoItem[]) ?? [];
  const progress = (data.progress as string) ?? '';
  const current = data.current as string | undefined;

  const completed = todos.filter((t) => t.status === 'completed').length;
  const total = todos.length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <Card className="mt-3 overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border/30 bg-accent-vibrant/5 px-4 py-2">
        <ListChecks className="h-3.5 w-3.5 text-accent-vibrant" />
        <span className="text-[11px] font-medium text-accent-vibrant">
          Progress
        </span>
        <span className="ml-auto text-[10px] text-muted-foreground">
          {progress}
        </span>
      </div>

      <div className="p-4 space-y-2.5">
        {/* Progress bar */}
        <div className="h-1.5 w-full rounded-full bg-muted/50 overflow-hidden">
          <div
            className="h-full rounded-full bg-accent-vibrant transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>

        {/* Checklist */}
        <ol className="space-y-1">
          {todos.map((todo) => (
            <li key={todo.id} className="flex items-start gap-2">
              <span className="mt-0.5 shrink-0">
                {todo.status === 'completed' ? (
                  <Check className="h-3.5 w-3.5 text-accent-vibrant" />
                ) : todo.status === 'in_progress' ? (
                  <ArrowRight className="h-3.5 w-3.5 text-foreground" />
                ) : (
                  <Circle className="h-3.5 w-3.5 text-muted-foreground/40" />
                )}
              </span>
              <span
                className={`text-[11px] leading-snug ${
                  todo.status === 'completed'
                    ? 'text-muted-foreground line-through'
                    : todo.status === 'in_progress'
                      ? 'text-foreground font-medium'
                      : 'text-muted-foreground'
                }`}
              >
                {todo.content}
              </span>
            </li>
          ))}
        </ol>

        {/* Current step callout */}
        {current && completed < total && (
          <div className="text-[10px] text-muted-foreground pt-0.5">
            Working on: <span className="font-medium text-foreground/80">{current}</span>
          </div>
        )}
      </div>
    </Card>
  );
}
