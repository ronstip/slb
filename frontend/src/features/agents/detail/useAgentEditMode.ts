import { useState, useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Agent, Constitution, SearchDef, TodoItem } from '../../../api/endpoints/agents.ts';
import { updateAgent } from '../../../api/endpoints/agents.ts';
import type { CustomFieldDef } from '../../../api/types.ts';
import { EMPTY_CONSTITUTION } from '../wizard/AgentContextEditor.tsx';
import { useAgentStore } from '../../../stores/agent-store.ts';

export interface AgentEditDraft {
  title: string;
  enrichment_context: string;
  constitution: Constitution;
  searches: SearchDef[];
  custom_fields: CustomFieldDef[];
  todos: TodoItem[];
}

function draftFromAgent(agent: Agent): AgentEditDraft {
  return {
    title: agent.title,
    enrichment_context: agent.data_scope?.enrichment_context ?? '',
    constitution: agent.constitution ? structuredClone(agent.constitution) : { ...EMPTY_CONSTITUTION },
    searches: structuredClone(agent.data_scope?.searches ?? []),
    custom_fields: structuredClone((agent.data_scope?.custom_fields ?? []) as CustomFieldDef[]),
    todos: structuredClone(agent.todos ?? []),
  };
}

function draftsEqual(a: AgentEditDraft, b: AgentEditDraft): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

const EMPTY_DRAFT: AgentEditDraft = {
  title: '',
  enrichment_context: '',
  constitution: { ...EMPTY_CONSTITUTION },
  searches: [],
  custom_fields: [],
  todos: [],
};

export function useAgentEditMode(agent: Agent | null) {
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<AgentEditDraft | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const original = useMemo(
    () => (agent ? draftFromAgent(agent) : EMPTY_DRAFT),
    [agent],
  );

  const isDirty = useMemo(
    () => draft !== null && !draftsEqual(draft, original),
    [draft, original],
  );

  const enterEdit = useCallback(() => {
    if (!agent) return;
    setDraft(draftFromAgent(agent));
    setIsEditing(true);
  }, [agent]);

  const cancel = useCallback(() => {
    setDraft(null);
    setIsEditing(false);
  }, []);

  const save = useCallback(async () => {
    if (!draft || !agent) return;
    setIsSaving(true);
    try {
      await updateAgent(agent.agent_id, {
        title: draft.title,
        data_scope: {
          searches: draft.searches,
          custom_fields: draft.custom_fields.length > 0 ? draft.custom_fields : null,
          enrichment_context: draft.enrichment_context || undefined,
        },
        constitution: draft.constitution,
        todos: draft.todos,
      });
      await queryClient.invalidateQueries({ queryKey: ['agent-detail', agent.agent_id] });
      // Refresh the Zustand-backed agents list so AgentsPage / home rows reflect
      // the edit without a full page reload.
      void useAgentStore.getState().fetchAgents();
      setIsEditing(false);
      setDraft(null);
    } finally {
      setIsSaving(false);
    }
  }, [draft, agent, queryClient]);

  const updateDraft = useCallback((patch: Partial<AgentEditDraft>) => {
    setDraft((prev) => (prev ? { ...prev, ...patch } : null));
  }, []);

  return {
    isEditing,
    draft,
    isDirty,
    isSaving,
    enterEdit,
    cancel,
    save,
    updateDraft,
  };
}
