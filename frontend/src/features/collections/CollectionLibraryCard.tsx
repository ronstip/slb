import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  BarChart2,
  Download,
  Eye,
  EyeOff,
  Globe,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  StopCircle,
  Table2,
  Trash2,
} from 'lucide-react';
import { useAuth } from '../../auth/useAuth.ts';
import { useSourcesStore, type Source } from '../../stores/sources-store.ts';
import { PLATFORM_LABELS, SCHEDULE_UTC_TIMES, parseScheduleString, formatSchedule } from '../../lib/constants.ts';
import { formatNumber, shortDate } from '../../lib/format.ts';
import {
  deleteCollection,
  downloadCollection,
  setCollectionVisibility,
  triggerCollection,
  updateCollectionMode,
} from '../../api/endpoints/collections.ts';
import { Button } from '../../components/ui/button.tsx';
import { Switch } from '../../components/ui/switch.tsx';
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
import { cn } from '../../lib/utils.ts';
import { StatsModal } from '../sources/StatsModal.tsx';
import { TableModal } from '../sources/TableModal.tsx';

interface CollectionLibraryCardProps {
  source: Source;
}

export function CollectionLibraryCard({ source }: CollectionLibraryCardProps) {
  const { profile } = useAuth();
  const addToSession = useSourcesStore((s) => s.addToSession);
  const removeFromSession = useSourcesStore((s) => s.removeFromSession);
  const updateSource = useSourcesStore((s) => s.updateSource);
  const removeSource = useSourcesStore((s) => s.removeSource);
  const queryClient = useQueryClient();

  const [statsOpen, setStatsOpen] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [togglingMode, setTogglingMode] = useState(false);
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);

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
  const isInSession = source.selected;

  const platforms = source.config.platforms
    .map((p) => PLATFORM_LABELS[p] || p)
    .join(', ');

  const keywords = source.config.keywords ?? [];

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
        ? 'Completed'
        : isFailed
          ? 'Failed'
          : source.status;

  const handleSessionToggle = (checked: boolean) => {
    if (checked) {
      addToSession(source.collectionId);
    } else {
      removeFromSession(source.collectionId);
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

  const handleToggleVisibility = async () => {
    const newVisibility = isShared ? 'private' : 'org';
    try {
      await setCollectionVisibility(source.collectionId, newVisibility);
      updateSource(source.collectionId, { visibility: newVisibility });
      queryClient.invalidateQueries({ queryKey: ['collections'] });
    } catch {
      // handle error
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

  return (
    <>
      <div className={cn(
        'overflow-hidden rounded-lg border bg-card p-3 transition-all duration-150',
        isInSession ? 'border-accent-vibrant/30 shadow-sm' : 'border-border hover:border-border/80 hover:shadow-sm',
      )}>
        {/* Top row: title + actions */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-sm font-medium text-foreground">
                {source.title}
              </span>
              {isShared && <Globe className="h-3 w-3 shrink-0 text-accent-blue" />}
            </div>

            {/* Keywords */}
            {keywords.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {keywords.slice(0, 4).map((kw) => (
                  <span
                    key={kw}
                    className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                  >
                    {kw}
                  </span>
                ))}
                {keywords.length > 4 && (
                  <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    +{keywords.length - 4}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Actions dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onSelect={() => setStatsOpen(true)}>
                <BarChart2 className="mr-2 h-3.5 w-3.5" /> View Stats
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setTableOpen(true)}>
                <Table2 className="mr-2 h-3.5 w-3.5" /> View Table
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
                    <RefreshCw className="mr-2 h-3.5 w-3.5" /> Edit Schedule
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={handleStopMonitoring} disabled={togglingMode}>
                    <StopCircle className="mr-2 h-3.5 w-3.5" /> Stop Monitoring
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}

              {isOwner && isReady && !source.config.ongoing && (
                <>
                  <DropdownMenuItem onSelect={() => setScheduleDialogOpen(true)} disabled={togglingMode}>
                    <RefreshCw className="mr-2 h-3.5 w-3.5" /> Set Schedule...
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}

              {isOwner && isInOrg && (
                <DropdownMenuItem onSelect={handleToggleVisibility}>
                  {isShared ? (
                    <><EyeOff className="mr-2 h-3.5 w-3.5" /> Make Private</>
                  ) : (
                    <><Eye className="mr-2 h-3.5 w-3.5" /> Share with Org</>
                  )}
                </DropdownMenuItem>
              )}

              {isOwner && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onSelect={() => setDeleteDialogOpen(true)}
                  >
                    <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Stats row */}
        <div className="mt-2 flex items-center gap-x-2 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', statusDot)} />
            {statusLabel}
          </span>
          <span className="opacity-30">·</span>
          <span>{formatNumber(source.postsCollected)} posts</span>
          <span className="opacity-30">·</span>
          <span>{shortDate(source.createdAt)}</span>
          {platforms && (
            <>
              <span className="opacity-30">·</span>
              <span className="truncate">{platforms}</span>
            </>
          )}
        </div>

        {/* Monitoring schedule */}
        {isMonitoring && source.config.schedule && (
          <div className="mt-1 text-[10px] text-emerald-600 dark:text-emerald-400">
            {formatSchedule(source.config.schedule)}
          </div>
        )}

        {/* Session toggle row — entire row is clickable */}
        <button
          type="button"
          className="mt-2.5 flex w-full items-center justify-between border-t border-border/50 pt-2.5 text-left cursor-pointer"
          onClick={() => handleSessionToggle(!isInSession)}
        >
          <span className={cn('text-xs', isInSession ? 'font-medium text-accent-vibrant' : 'text-muted-foreground')}>
            {isInSession ? 'In current session' : 'Add to session'}
          </span>
          <Switch
            checked={isInSession}
            onCheckedChange={handleSessionToggle}
            className="scale-90 pointer-events-none"
          />
        </button>
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
            <Button variant="outline" onClick={() => setScheduleDialogOpen(false)}>Cancel</Button>
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
              Are you sure you want to delete "{source.title}"? This will permanently remove all collected data.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? 'Deleting...' : 'Delete'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
