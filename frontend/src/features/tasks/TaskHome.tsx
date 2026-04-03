import { useEffect } from 'react';
import { Sparkles } from 'lucide-react';
import { useTaskStore } from '../../stores/task-store.ts';
import { useCollectionsSync } from '../collections/useCollectionsSync.ts';
import { Logo } from '../../components/Logo.tsx';
import { TaskHomeHeader } from './TaskHomeHeader.tsx';
import { LatestTasksRow } from './LatestTasksRow.tsx';
import { TaskCreationWizard } from './wizard/TaskCreationWizard.tsx';

export function TaskHome() {
  const tasks = useTaskStore((s) => s.tasks);
  const isLoading = useTaskStore((s) => s.isLoading);
  const fetchTasks = useTaskStore((s) => s.fetchTasks);

  useCollectionsSync();

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const hasTasks = tasks.length > 0;

  return (
    <div className="flex h-screen flex-col bg-background">
      <TaskHomeHeader />

      <main className="flex flex-1 flex-col items-center overflow-y-auto px-6 py-8">
        {/* Loading state */}
        {isLoading && tasks.length === 0 && (
          <div className="flex flex-1 items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-primary" />
          </div>
        )}

        {/* Content */}
        {(!isLoading || tasks.length > 0) && (
          <>
            {hasTasks && (
              <div className="w-full max-w-[1200px] mb-10">
                <LatestTasksRow tasks={tasks} />
              </div>
            )}

            <div className="w-full max-w-[1200px]">
              {!hasTasks && (
                <div className="mb-8 flex flex-col items-center text-center">
                  <Logo size="lg" showText={false} />
                  <h2 className="mt-3 text-2xl font-bold tracking-tight text-foreground">
                    Welcome to Veille
                  </h2>
                  <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                    <Sparkles className="h-4 w-4 text-primary/60" />
                    Set up your first monitoring task in three simple steps
                  </p>
                </div>
              )}

              {hasTasks && (
                <div className="mb-4">
                  <h2 className="text-sm font-semibold text-foreground">Create a New Task</h2>
                  <p className="text-xs text-muted-foreground">
                    Define what to monitor, configure collection settings, and set the schedule
                  </p>
                </div>
              )}

              <TaskCreationWizard />
            </div>
          </>
        )}
      </main>
    </div>
  );
}
