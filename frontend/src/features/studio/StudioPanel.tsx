import { PanelRightClose, PanelRightOpen, FileText, FileDown, Sparkles } from 'lucide-react';
import { useUIStore } from '../../stores/ui-store.ts';
import { useStudioStore } from '../../stores/studio-store.ts';
import { useSSEChat } from '../chat/hooks/useSSEChat.ts';
import { FeedTab } from './FeedTab.tsx';
import { ArtifactsTab } from './ArtifactsTab.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Tabs, TabsList, TabsTrigger } from '../../components/ui/tabs.tsx';
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

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
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
                <DropdownMenuItem onClick={() => sendMessage('Export the data for the selected sources as CSV.')}>
                  <FileDown className="mr-2 h-3.5 w-3.5" />
                  Data Export
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>

      {!collapsed && (
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Tabs */}
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'feed' | 'artifacts')} className="flex flex-1 flex-col overflow-hidden">
            <TabsList className="w-full rounded-none border-b border-border bg-transparent p-0">
              <TabsTrigger
                value="feed"
                className="flex-1 rounded-none border-b-2 border-transparent py-2 text-xs text-muted-foreground data-[state=active]:border-foreground data-[state=active]:text-foreground data-[state=active]:shadow-none"
              >
                Feed
              </TabsTrigger>
              <TabsTrigger
                value="artifacts"
                className="flex-1 rounded-none border-b-2 border-transparent py-2 text-xs text-muted-foreground data-[state=active]:border-foreground data-[state=active]:text-foreground data-[state=active]:shadow-none"
              >
                Artifacts
              </TabsTrigger>
            </TabsList>

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto">
              {activeTab === 'feed' && <FeedTab />}
              {activeTab === 'artifacts' && <ArtifactsTab />}
            </div>
          </Tabs>
        </div>
      )}
    </div>
  );
}
