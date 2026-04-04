import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useAgentStore } from '../../stores/agent-store.ts';
import { AppShell } from '../../layout/AppShell.tsx';

export function AgentSessionShell() {
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  const [ready] = useState(false);

  useEffect(() => {
    if (!taskId) {
      navigate('/agents', { replace: true });
      return;
    }

    const load = async () => {
      const store = useAgentStore.getState();
      await store.loadAgent(taskId);

      const task = useAgentStore.getState().activeAgent;
      if (!task) {
        navigate('/agents', { replace: true });
        return;
      }

      // Navigate to the agent's session so AppShell can handle restoration
      const sessionId = task.primary_session_id || task.session_id;
      if (sessionId) {
        navigate(`/session/${sessionId}`, { replace: true });
      } else {
        // No session yet — go to tasks list
        navigate('/agents', { replace: true });
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
