import type { Task } from '../../api/endpoints/tasks.ts';
import { TaskCard } from './TaskCard.tsx';

interface TaskCardGridProps {
  tasks: Task[];
  onTaskClick?: (task: Task) => void;
}

export function TaskCardGrid({ tasks, onTaskClick }: TaskCardGridProps) {
  if (tasks.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        No tasks found
      </div>
    );
  }

  return (
    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {tasks.map((task) => (
        <TaskCard
          key={task.task_id}
          task={task}
          onClick={onTaskClick ? () => onTaskClick(task) : undefined}
        />
      ))}
    </div>
  );
}
