import { PanelRightClose, PanelRightOpen, FileText, BarChart3, Presentation, FileDown, Sparkles } from 'lucide-react';
import { useUIStore } from '../../stores/ui-store.ts';
import { useStudioStore } from '../../stores/studio-store.ts';
import { useSSEChat } from '../chat/hooks/useSSEChat.ts';
import { FeedTab } from './FeedTab.tsx';
import { ArtifactsTab } from './ArtifactsTab.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Tabs, TabsList, TabsTrigger } from '../../components/ui/tabs.tsx';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip.tsx';

export function StudioPanel() {
  const collapsed = useUIStore((s) => s.studioPanelCollapsed);
  const toggle = useUIStore((s) => s.toggleStudioPanel);
  const activeTab = useStudioStore((s) => s.activeTab);
  const setActiveTab = useStudioStore((s) => s.setActiveTab);
  const { sendMessage } = useSSEChat();

  const actionButtons = [
    { label: 'Insight Report', icon: FileText, enabled: true, onClick: () => sendMessage('Generate an insight report for the selected sources.') },
    { label: 'Slide Deck', icon: Presentation, enabled: false },
    { label: 'Comparison Chart', icon: BarChart3, enabled: false },
    { label: 'Data Export', icon: FileDown, enabled: true, onClick: () => sendMessage('Export the data for the selected sources as CSV.') },
    { label: 'Custom...', icon: Sparkles, enabled: false },
  ];

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={toggle}>
          {collapsed ? (
            <PanelRightOpen className="h-4 w-4" />
          ) : (
            <PanelRightClose className="h-4 w-4" />
          )}
        </Button>
        {!collapsed && (
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Studio
          </span>
        )}
      </div>

      {!collapsed && (
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Action Buttons */}
          <div className="flex flex-wrap gap-2 border-b border-border p-3">
            {actionButtons.map(({ label, icon: Icon, enabled, onClick }) => (
              <Tooltip key={label}>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onClick}
                    disabled={!enabled}
                    className="h-auto gap-1.5 rounded-xl px-2.5 py-1.5 text-xs"
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </Button>
                </TooltipTrigger>
                {!enabled && (
                  <TooltipContent>Coming soon</TooltipContent>
                )}
              </Tooltip>
            ))}
          </div>

          {/* Tabs */}
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'feed' | 'artifacts')} className="flex flex-1 flex-col overflow-hidden">
            <TabsList className="w-full rounded-none border-b border-border bg-transparent p-0">
              <TabsTrigger
                value="feed"
                className="flex-1 rounded-none border-b-2 border-transparent py-2 text-xs data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:shadow-none"
              >
                Feed
              </TabsTrigger>
              <TabsTrigger
                value="artifacts"
                className="flex-1 rounded-none border-b-2 border-transparent py-2 text-xs data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:shadow-none"
              >
                Artifacts
              </TabsTrigger>
            </TabsList>

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto">
              {activeTab === 'feed' ? <FeedTab /> : <ArtifactsTab />}
            </div>
          </Tabs>
        </div>
      )}
    </div>
  );
}
