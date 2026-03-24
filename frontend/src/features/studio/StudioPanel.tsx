import { useState } from 'react';
import { PanelRightClose, PanelRightOpen, FileText, FileDown, LayoutDashboard, Sparkles, Presentation, BarChart3, Mail } from 'lucide-react';
import { useUIStore } from '../../stores/ui-store.ts';
import { useStudioStore } from '../../stores/studio-store.ts';
import { useSSEChat } from '../chat/hooks/useSSEChat.ts';
import { FeedTab } from './FeedTab.tsx';
import { ArtifactsTab } from './ArtifactsTab.tsx';
import { ChartDialog } from './ChartDialog.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui/tabs.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu.tsx';

export function StudioPanel() {
  const collapsed = useUIStore((s) => s.studioPanelCollapsed);
  const toggle = useUIStore((s) => s.toggleStudioPanel);
  const activeTab = useStudioStore((s) => s.activeTab);
  const setActiveTab = useStudioStore((s) => s.setActiveTab);
  const { sendMessage } = useSSEChat();
  const [chartOpen, setChartOpen] = useState(false);

  return (
    <div data-testid="studio-panel" className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2">
        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={toggle}>
          {collapsed ? (
            <PanelRightOpen className="h-4 w-4" />
          ) : (
            <PanelRightClose className="h-4 w-4" />
          )}
        </Button>
        {!collapsed && (
          <>
            <span className="text-xs font-medium text-muted-foreground">
              Workspace
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground">
                  <Sparkles className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem onClick={() => sendMessage('Generate an insight report for the selected sources.')}>
                  <FileText className="mr-2 h-3.5 w-3.5" />
                  Insight Report
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => sendMessage('Create an interactive dashboard for the selected sources.')}>
                  <LayoutDashboard className="mr-2 h-3.5 w-3.5" />
                  Dashboard
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => sendMessage('Export the data for the selected sources as CSV.')}>
                  <FileDown className="mr-2 h-3.5 w-3.5" />
                  Data Export
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setChartOpen(true)}>
                  <BarChart3 className="mr-2 h-3.5 w-3.5" />
                  Chart
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => sendMessage('Send me an email summary of the key findings for the selected sources. Ask me for my email address first.')}>
                  <Mail className="mr-2 h-3.5 w-3.5" />
                  Send Email
                </DropdownMenuItem>
                <DropdownMenuItem disabled>
                  <Presentation className="mr-2 h-3.5 w-3.5" />
                  Deck Slides
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>

      {!collapsed && (
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* Tabs */}
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'feed' | 'artifacts')} className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <TabsList className="w-full min-w-0">
              <TabsTrigger value="feed" className="min-w-0 truncate data-[state=active]:bg-white">Feed</TabsTrigger>
              <TabsTrigger value="artifacts" className="min-w-0 truncate data-[state=active]:bg-white">Artifacts</TabsTrigger>
            </TabsList>

            <TabsContent value="feed" className="overflow-y-auto">
              <FeedTab />
            </TabsContent>
            <TabsContent value="artifacts" className="overflow-y-auto">
              <ArtifactsTab />
            </TabsContent>
          </Tabs>
        </div>
      )}

      <ChartDialog open={chartOpen} onOpenChange={setChartOpen} onSubmit={sendMessage} />
    </div>
  );
}
