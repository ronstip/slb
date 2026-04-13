import { useState, useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Agent, SearchDef, TodoItem } from '../../../api/endpoints/agents.ts';
import { updateAgent } from '../../../api/endpoints/agents.ts';
import type { CustomFieldDef } from '../../../api/types.ts';

export interface AgentEditDraft {
  title: string;
  enrichment_context: string;
  searches: SearchDef[];
  custom_fields: CustomFieldDef[];
  todos: TodoItem[];
}

function draftFromAgent(agent: Agent): AgentEditDraft {
  return {
    title: agent.title,
    enrichment_context: agent.data_scope?.enrichment_context ?? '',
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
        todos: draft.todos,
      });
      await queryClient.invalidateQueries({ queryKey: ['agent-detail', agent.agent_id] });
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
