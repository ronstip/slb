import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useSourcesStore, type Source } from '../../stores/sources-store.ts';
import { useStudioStore } from '../../stores/studio-store.ts';
import { useUIStore } from '../../stores/ui-store.ts';
import { useAuth } from '../../auth/useAuth.ts';
import { PLATFORM_LABELS, SCHEDULE_UTC_TIMES, parseScheduleString, formatSchedule } from '../../lib/constants.ts';
import { formatNumber, shortDate } from '../../lib/format.ts';
import {
  BarChart2,
  Check,
  Download,
  Eye,
  EyeOff,
  Globe,
  Loader2,
  LogOut,
  MoreHorizontal,
  RefreshCw,
  Sparkles,
  StopCircle,
  Table2,
  Trash2,
  Users,
} from 'lucide-react';
import { Button } from '../../components/ui/button.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.tsx';
import {
  setCollectionVisibility,
  deleteCollection,
  downloadCollection,
  triggerCollection,
  updateCollectionMode,
} from '../../api/endpoints/collections.ts';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '../../lib/utils.ts';
import { StatsModal } from './StatsModal.tsx';
import { TableModal } from './TableModal.tsx';

interface SourceCardProps {
  source: Source;
}

export function SourceCard({ source }: SourceCardProps) {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const toggleActive = useSourcesStore((s) => s.toggleActive);
  const removeFromSession = useSourcesStore((s) => s.removeFromSession);
  const updateSource = useSourcesStore((s) => s.updateSource);
  const removeSource = useSourcesStore((s) => s.removeSource);
  const setFeedSource = useStudioStore((s) => s.setFeedSource);
  const setActiveTab = useStudioStore((s) => s.setActiveTab);
  const studioPanelCollapsed = useUIStore((s) => s.studioPanelCollapsed);
  const toggleStudioPanel = useUIStore((s) => s.toggleStudioPanel);
  const queryClient = useQueryClient();

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [togglingMode, setTogglingMode] = useState(false);
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);

  // Schedule dialog state — init from existing config if available
  const existingSchedule = parseScheduleString(source.config.schedule);
  const [scheduleDays, setScheduleDays] = useState(existingSchedule.days);
  const [scheduleTime, setScheduleTime] = useState(existingSchedule.time);

  const isProcessing = source.status === 'collecting' || source.status === 'enriching' || source.status === 'pending';
  const isMonitoring = source.status === 'monitoring';
  const isReady = source.status === 'completed';
  const isFailed = source.status === 'failed';
  const isOwner = !source.userId || source.userId === profile?.uid;
  const isInOrg = !!profile?.org_id;
  const isShared = source.visibility === 'org';
  const isAgentSelected = useSourcesStore((s) => s.agentSelectedIds.includes(source.collectionId));

  const platforms = source.config.platforms
    .map((p) => PLATFORM_LABELS[p] || p)
    .join(', ');

  const handleCardClick = () => {
    setFeedSource(source.collectionId);
    setActiveTab('feed');
    if (studioPanelCollapsed) {
      toggleStudioPanel();
    }
    navigate(`/collection/${source.collectionId}`);
  };

  const handleToggleVisibility = async (e: Event) => {
    e.stopPropagation();
    const newVisibility = isShared ? 'private' : 'org';
    try {
      await setCollectionVisibility(source.collectionId, newVisibility);
      updateSource(source.collectionId, { visibility: newVisibility });
      queryClient.invalidateQueries({ queryKey: ['collections'] });
    } catch {
      // handle error
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteCollection(source.collectionId);
      removeSource(source.collectionId);
      queryClient.invalidateQueries({ queryKey: ['collections'] });
      setDeleteDialogOpen(false);
    } catch {
      // handle error
    } finally {
      setDeleting(false);
    }
  };

  const handleDownload = async () => {
    setDownloading(true);
    try {
      await downloadCollection(source.collectionId, source.title);
    } catch {
      // handle error
    } finally {
      setDownloading(false);
    }
  };

  const handleTriggerNow = async () => {
    setTriggering(true);
    try {
      await triggerCollection(source.collectionId);
      updateSource(source.collectionId, { status: 'collecting' });
      queryClient.invalidateQueries({ queryKey: ['collection-status', source.collectionId] });
    } catch {
      // handle error
    } finally {
      setTriggering(false);
    }
  };

  const handleStopMonitoring = async () => {
    setTogglingMode(true);
    try {
      await updateCollectionMode(source.collectionId, false);
      updateSource(source.collectionId, {
        status: 'completed',
        config: { ...source.config, ongoing: false, schedule: undefined },
      });
      queryClient.invalidateQueries({ queryKey: ['collections'] });
    } catch {
      // handle error
    } finally {
      setTogglingMode(false);
    }
  };

  const handleStartMonitoring = async (schedule: string) => {
    setTogglingMode(true);
    try {
      await updateCollectionMode(source.collectionId, true, schedule);
      updateSource(source.collectionId, {
        status: 'monitoring',
        config: { ...source.config, ongoing: true, schedule },
      });
      queryClient.invalidateQueries({ queryKey: ['collections'] });
    } catch {
      // handle error
    } finally {
      setTogglingMode(false);
    }
  };

  const statusDot = isProcessing
    ? 'bg-amber-500 animate-pulse'
    : isMonitoring
      ? 'bg-emerald-500 animate-pulse'
      : isReady
        ? 'bg-emerald-500'
        : isFailed
          ? 'bg-red-500'
          : 'bg-muted-foreground';

  const statusLabel = isProcessing
    ? 'Processing'
    : isMonitoring
      ? 'Monitoring'
      : isReady
        ? 'Ready'
        : isFailed
          ? 'Failed'
          : source.status;

  // Relative time helpers for monitoring meta line
  const relativeTime = (iso: string | undefined): string => {
    if (!iso) return '';
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.round(diff / 60_000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.round(hrs / 24)}d ago`;
  };

  const timeUntil = (iso: string | undefined): string => {
    if (!iso) return '';
    const diff = new Date(iso).getTime() - Date.now();
    if (diff <= 0) return 'soon';
    const mins = Math.round(diff / 60_000);
    if (mins < 60) return `in ${mins}m`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `in ${hrs}h`;
    return `in ${Math.round(hrs / 24)}d`;
  };

  return (
    <>
      <div
        className={cn(
          'group relative flex cursor-pointer items-start rounded-lg border py-1.5 pl-3.5 pr-2 transition-all',
          isMonitoring
            ? source.active
              ? 'border-emerald-500/30 bg-emerald-500/5'
              : 'border-emerald-500/10 hover:border-emerald-500/30 hover:bg-emerald-500/5'
            : source.active
              ? 'border-primary/30 bg-primary/5'
              : 'border-transparent hover:border-border/60 hover:bg-muted/50',
        )}
        onClick={handleCardClick}
      >
        {/* Left accent bar */}
        <div
          className={cn(
            'absolute left-1 top-[12%] bottom-[12%] w-[3px] rounded-full transition-all duration-200',
            source.active
              ? isMonitoring ? 'bg-emerald-500' : 'bg-primary'
              : 'bg-transparent',
          )}
        />

        {/* Context toggle */}
        <div
          className="mt-0.5 mr-1.5 shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            toggleActive(source.collectionId);
          }}
          title={source.active ? 'Remove from agent context' : 'Include in agent context'}
        >
          <div
            className={cn(
              'flex h-4 w-4 cursor-pointer items-center justify-center rounded-full border-2 transition-all duration-150',
              source.active
                ? isMonitoring
                  ? 'border-emerald-500 bg-emerald-500'
                  : 'border-primary bg-primary'
                : isMonitoring
                  ? 'border-muted-foreground/30 bg-transparent hover:border-emerald-500/60'
                  : 'border-muted-foreground/30 bg-transparent hover:border-primary/60',
            )}
          >
            {source.active && <Check className="h-2.5 w-2.5 text-primary-foreground stroke-[3]" />}
          </div>
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1 overflow-hidden">
          {/* Title row */}
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                'truncate text-[13px] leading-tight',
                source.active ? 'font-semibold text-foreground' : 'font-medium text-foreground',
              )}
            >
              {source.title}
            </span>
            {isAgentSelected && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-violet-500/10 px-1 py-px" title="Selected by agent">
                <Sparkles className="h-2.5 w-2.5 text-violet-500" />
                <span className="text-[8px] font-semibold uppercase tracking-wider text-violet-500">AI</span>
              </span>
            )}
            {isShared && <Globe className="h-3 w-3 shrink-0 text-primary" />}
          </div>

          {/* Meta row */}
          <div className="mt-0.5 flex items-center gap-x-1.5 overflow-hidden text-[10px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', statusDot)} />
              {statusLabel}
            </span>
            <span className="text-border">·</span>
            <span className="whitespace-nowrap">{formatNumber(source.postsCollected)} posts</span>
            <span className="text-border">·</span>
            <span className="whitespace-nowrap">{shortDate(source.createdAt)}</span>
            {platforms && (
              <>
                <span className="text-border">·</span>
                <span className="truncate">{platforms}</span>
              </>
            )}
          </div>

          {/* Monitoring schedule meta */}
          {isMonitoring && (
            <div className="mt-0.5 text-[10px] text-emerald-600 dark:text-emerald-400">
              {source.config.schedule && (
                <span>{formatSchedule(source.config.schedule)}</span>
              )}
              {(source.lastRunAt || source.nextRunAt) && (
                <span className="text-muted-foreground">
                  {source.config.schedule && <span className="mx-1 text-border">·</span>}
                  {source.lastRunAt && <span>Updated {relativeTime(source.lastRunAt)}</span>}
                  {source.lastRunAt && source.nextRunAt && <span className="mx-1 text-border">·</span>}
                  {source.nextRunAt && <span>Next {timeUntil(source.nextRunAt)}</span>}
                </span>
              )}
            </div>
          )}

          {/* Shared badge */}
          {!isOwner && (
            <div className="mt-0.5">
              <span className="inline-flex items-center gap-0.5 text-[9px] text-muted-foreground">
                <Users className="h-2.5 w-2.5" />
                Shared with you
              </span>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="ml-1 shrink-0" onClick={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6">
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {/* Data inspection */}
              <DropdownMenuItem onSelect={() => setStatsOpen(true)}>
                <BarChart2 className="mr-2 h-3.5 w-3.5" />
                View Stats
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setTableOpen(true)}>
                <Table2 className="mr-2 h-3.5 w-3.5" />
                View Table
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={handleDownload} disabled={downloading}>
                {downloading ? (
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="mr-2 h-3.5 w-3.5" />
                )}
                {downloading ? 'Downloading...' : 'Download CSV'}
              </DropdownMenuItem>

              <DropdownMenuSeparator />

              {/* Ongoing monitoring actions */}
              {isOwner && isMonitoring && (
                <>
                  <DropdownMenuItem onSelect={handleTriggerNow} disabled={triggering}>
                    {triggering ? (
                      <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-2 h-3.5 w-3.5" />
                    )}
                    Run Now
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setScheduleDialogOpen(true)} disabled={togglingMode}>
                    <RefreshCw className="mr-2 h-3.5 w-3.5" />
                    Edit Schedule
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={handleStopMonitoring} disabled={togglingMode}>
                    <StopCircle className="mr-2 h-3.5 w-3.5" />
                    Stop Monitoring
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              {isOwner && isReady && !source.config.ongoing && (
                <>
                  <DropdownMenuItem onSelect={() => setScheduleDialogOpen(true)} disabled={togglingMode}>
                    <RefreshCw className="mr-2 h-3.5 w-3.5" />
                    Set Schedule...
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}

              {/* Session */}
              <DropdownMenuItem onSelect={() => removeFromSession(source.collectionId)}>
                <LogOut className="mr-2 h-3.5 w-3.5" />
                Remove from session
              </DropdownMenuItem>

              {/* Visibility */}
              {isOwner && isInOrg && (
                <DropdownMenuItem onSelect={handleToggleVisibility}>
                  {isShared ? (
                    <>
                      <EyeOff className="mr-2 h-3.5 w-3.5" />
                      Make Private
                    </>
                  ) : (
                    <>
                      <Eye className="mr-2 h-3.5 w-3.5" />
                      Share with Org
                    </>
                  )}
                </DropdownMenuItem>
              )}

              {/* Delete */}
              {isOwner && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onSelect={() => setDeleteDialogOpen(true)}
                  >
                    <Trash2 className="mr-2 h-3.5 w-3.5" />
                    Delete
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Modals */}
      <StatsModal source={source} open={statsOpen} onClose={() => setStatsOpen(false)} />
      <TableModal source={source} open={tableOpen} onClose={() => setTableOpen(false)} />

      {/* Schedule Dialog */}
      <Dialog open={scheduleDialogOpen} onOpenChange={setScheduleDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Monitoring Schedule</DialogTitle>
            <DialogDescription>
              Configure when this collection automatically refreshes.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Every</span>
              <input
                type="number"
                min={1}
                max={90}
                value={scheduleDays}
                onChange={(e) => setScheduleDays(Math.max(1, Math.min(90, Number(e.target.value) || 1)))}
                className="w-14 rounded border border-input bg-background px-2 py-1 text-center text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <span className="text-muted-foreground">
                {scheduleDays === 1 ? 'day' : 'days'} at
              </span>
              <Select value={scheduleTime} onValueChange={setScheduleTime}>
                <SelectTrigger className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCHEDULE_UTC_TIMES.map(({ label, value }) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground">UTC</span>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setScheduleDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                handleStartMonitoring(`${scheduleDays}d@${scheduleTime}`);
                setScheduleDialogOpen(false);
              }}
              disabled={togglingMode}
            >
              {isMonitoring ? 'Update Schedule' : 'Start Monitoring'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Collection</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{source.title}"? This will permanently remove all collected data. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? 'Deleting...' : 'Delete'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
