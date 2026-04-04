import { useState } from 'react';
import { toast } from 'sonner';
import { useChatStore } from '../../../stores/chat-store.ts';
import { useSessionStore } from '../../../stores/session-store.ts';
import { useSSEChat } from '../../chat/hooks/useSSEChat.ts';
import { DescribePanel } from './DescribePanel.tsx';
import { CollectionSettingsPanel } from './CollectionSettingsPanel.tsx';
import { AgentSettingsPanel } from './AgentSettingsPanel.tsx';
import { formatWizardAsPrompt } from './wizard-utils.ts';

export interface WizardCollectionSettings {
  platforms: string[];
  keywords: string[];
  channelUrls: string[];
  timeRangeDays: number;
  geoScope: string;
  nPosts: number;
}

export interface WizardAgentSettings {
  taskType: 'one_shot' | 'recurring';
  schedulePreset: 'hourly' | 'daily' | 'weekly';
  scheduleTime: string;
  autoReport: boolean;
}

export function AgentCreationWizard() {
  const { sendMessage } = useSSEChat();
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Panel 1 state
  const [description, setDescription] = useState('');

  // Panel 2 state
  const [collectionSettings, setCollectionSettings] = useState<WizardCollectionSettings>({
    platforms: ['instagram', 'tiktok'],
    keywords: [],
    channelUrls: [],
    timeRangeDays: 90,
    geoScope: 'global',
    nPosts: 500,
  });

  // Panel 3 state
  const [taskSettings, setTaskSettings] = useState<WizardAgentSettings>({
    taskType: 'one_shot',
    schedulePreset: 'daily',
    scheduleTime: '09:00',
    autoReport: true,
  });

  const canSubmit = description.trim().length > 0 && collectionSettings.platforms.length > 0;

  const handleSubmit = async () => {
    if (!canSubmit || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const message = formatWizardAsPrompt(description, collectionSettings, taskSettings);

      // Start a fresh session and send the wizard message
      useSessionStore.getState().startNewSession();
      useChatStore.getState().clearMessages();

      sendMessage(message);

      // Navigation to /session/{id} happens automatically via useSSEChat done handler
    } catch (err) {
      toast.error('Failed to create agent. Please try again.');
      setIsSubmitting(false);
    }
  };

  const handleQuickPrompt = (prompt: string) => {
    setDescription(prompt);
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        {/* Panel 1: Describe */}
        <DescribePanel
          description={description}
          onDescriptionChange={setDescription}
          onQuickPrompt={handleQuickPrompt}
        />

        {/* Panel 2: Collection Settings */}
        <CollectionSettingsPanel
          settings={collectionSettings}
          onChange={setCollectionSettings}
        />

        {/* Panel 3: Agent Settings */}
        <AgentSettingsPanel
          settings={taskSettings}
          onChange={setTaskSettings}
          onSubmit={handleSubmit}
          canSubmit={canSubmit}
          isSubmitting={isSubmitting}
        />
      </div>
    </div>
  );
}
