import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { ChatModelKey, ThinkingLevel } from '../api/types.ts';

/**
 * Per-user chat model settings. Persisted to **localStorage** so the
 * choices stick across reloads and across sessions for the same browser.
 *
 * Settings here override the backend defaults on every chat request.
 * Leaving `searchGrounding` at its default (`true`) and `thinkingLevel`
 * at `medium` matches the server-side defaults in `config/settings.py`.
 */
interface ModelSettingsState {
  model: ChatModelKey;
  thinkingLevel: ThinkingLevel;
  searchGrounding: boolean;
  setModel: (m: ChatModelKey) => void;
  setThinkingLevel: (t: ThinkingLevel) => void;
  setSearchGrounding: (b: boolean) => void;
}

export const useModelSettingsStore = create<ModelSettingsState>()(
  persist(
    (set) => ({
      model: 'flash',
      thinkingLevel: 'medium',
      searchGrounding: true,
      setModel: (model) => set({ model }),
      setThinkingLevel: (thinkingLevel) => set({ thinkingLevel }),
      setSearchGrounding: (searchGrounding) => set({ searchGrounding }),
    }),
    {
      name: 'slb-model-settings',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

export const MODEL_OPTIONS: {
  key: ChatModelKey;
  label: string;
  description: string;
}[] = [
  {
    key: 'flash',
    label: 'Gemini 3 Flash',
    description: 'Fast and capable — best for most queries.',
  },
  {
    key: 'pro',
    label: 'Gemini 3.1 Pro',
    description: 'Slower, deeper reasoning. Use for complex analysis.',
  },
];

export const THINKING_OPTIONS: {
  key: ThinkingLevel;
  label: string;
  description: string;
}[] = [
  { key: 'off', label: 'Off', description: 'No thinking; fastest replies.' },
  { key: 'minimal', label: 'Minimal', description: 'Quick consideration.' },
  { key: 'low', label: 'Low', description: 'Brief reasoning.' },
  { key: 'medium', label: 'Medium', description: 'Balanced (default).' },
  { key: 'high', label: 'High', description: 'Deep, thorough reasoning.' },
];
