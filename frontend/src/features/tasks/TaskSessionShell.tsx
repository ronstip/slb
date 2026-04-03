import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useTaskStore } from '../../stores/task-store.ts';
import { AppShell } from '../../layout/AppShell.tsx';

export function TaskSessionShell() {
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!taskId) {
      navigate('/tasks', { replace: true });
      return;
    }

    const load = async () => {
      const store = useTaskStore.getState();
      await store.loadTask(taskId);

      const task = useTaskStore.getState().activeTask;
      if (!task) {
        navigate('/tasks', { replace: true });
        return;
      }

      // Navigate to the task's session so AppShell can handle restoration
      const sessionId = task.primary_session_id || task.session_id;
      if (sessionId) {
        navigate(`/session/${sessionId}`, { replace: true });
      } else {
        // No session yet — go to tasks list
        navigate('/tasks', { replace: true });
      }
    };

    load();
  }, [taskId, navigate]);

  if (!ready) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-primary" />
      </div>
    );
  }

  return <AppShell />;
}
