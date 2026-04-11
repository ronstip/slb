import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Link2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../../components/ui/dialog.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Input } from '../../components/ui/input.tsx';
import { createFeedLink, listFeedLinks, revokeFeedLink } from '../../api/endpoints/feed-links.ts';
import { timeAgo } from '../../lib/format.ts';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

function buildPublicUrl(token: string, format: 'json' | 'csv'): string {
  // Build a full, absolute URL that external tools (Excel, Power BI) can reach
  const base = API_BASE.startsWith('http')
    ? API_BASE
    : `${window.location.origin}${API_BASE}`;
  const url = `${base}/feed-links/public/${token}`;
  return format === 'csv' ? `${url}?format=csv` : url;
}

interface FeedLinkDialogProps {
  open: boolean;
  onClose: () => void;
  selectedCollectionIds: string[];
  collectionNames: Map<string, string>;
  filters: Record<string, string>;
}

export function FeedLinkDialog({
  open,
  onClose,
  selectedCollectionIds,
  collectionNames,
  filters,
}: FeedLinkDialogProps) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const [format, setFormat] = useState<'json' | 'csv'>('json');

  const { data: existingLinks = [] } = useQuery({
    queryKey: ['feed-links'],
    queryFn: listFeedLinks,
    enabled: open,
    staleTime: 10_000,
  });

  const createMutation = useMutation({
    mutationFn: createFeedLink,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feed-links'] });
      toast.success('Feed link created');
      setTitle('');
    },
    onError: () => {
      toast.error('Failed to create feed link');
    },
  });

  const revokeMutation = useMutation({
    mutationFn: revokeFeedLink,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feed-links'] });
      toast.success('Feed link revoked');
    },
  });

  const handleCreate = () => {
    if (!title.trim()) {
      toast.error('Please enter a title');
      return;
    }
    createMutation.mutate({
      collection_ids: selectedCollectionIds,
      filters,
      title: title.trim(),
    });
  };

  const handleCopy = (token: string) => {
    const url = buildPublicUrl(token, format);
    navigator.clipboard.writeText(url);
    setCopied(token);
    toast.success('URL copied');
    setTimeout(() => setCopied(null), 2000);
  };

  const selectedNames = selectedCollectionIds.map((id) => collectionNames.get(id) ?? id);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Link2 className="h-4 w-4 text-primary" />
            Create Feed Link
          </DialogTitle>
          <DialogDescription className="text-xs">
            Generate a URL to use as a data source in Excel, Power BI, or any web-data tool.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {/* Selected collections summary */}
          <div className="text-[11px] text-muted-foreground">
            {selectedNames.length} collection{selectedNames.length !== 1 ? 's' : ''} selected
            <span className="ml-1 text-foreground/70">
              ({selectedNames.slice(0, 3).join(', ')}{selectedNames.length > 3 ? ` +${selectedNames.length - 3}` : ''})
            </span>
          </div>

          {/* Title + create */}
          <div className="flex gap-2">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Give this feed link a name..."
              className="h-8 text-sm flex-1"
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
            />
            <Button
              size="sm"
              className="h-8 px-4"
              onClick={handleCreate}
              disabled={createMutation.isPending || selectedCollectionIds.length === 0}
            >
              {createMutation.isPending ? '...' : 'Create'}
            </Button>
          </div>

          {/* Format toggle */}
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-muted-foreground">Format:</span>
            {(['json', 'csv'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFormat(f)}
                className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  format === f
                    ? 'bg-foreground text-background'
                    : 'bg-muted text-muted-foreground hover:text-foreground'
                }`}
              >
                {f.toUpperCase()}
              </button>
            ))}
          </div>

          {/* Tip */}
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            In <strong>Excel</strong>: Data &rarr; Get Data &rarr; From Web. In <strong>Power BI</strong>: Get Data &rarr; Web.
            No authentication needed — anyone with the link can access the data.
          </p>
        </div>

        {/* Existing links */}
        {existingLinks.length > 0 && (
          <div className="border-t pt-3 mt-2">
            <h4 className="text-[11px] font-medium text-muted-foreground mb-2">Your feed links</h4>
            <div className="space-y-1.5 max-h-44 overflow-y-auto">
              {existingLinks.map((link) => (
                <div
                  key={link.token}
                  className="flex items-center gap-2 rounded-md border border-border/60 px-3 py-2"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate">{link.title}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {link.collection_ids.length} collection{link.collection_ids.length !== 1 ? 's' : ''}
                      {' · '}{link.access_count} view{link.access_count !== 1 ? 's' : ''}
                      {' · '}{timeAgo(link.created_at)}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={() => handleCopy(link.token)}
                    title="Copy URL"
                  >
                    {copied === link.token
                      ? <Check className="h-3.5 w-3.5 text-green-500" />
                      : <Copy className="h-3.5 w-3.5" />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => revokeMutation.mutate(link.token)}
                    disabled={revokeMutation.isPending}
                    title="Revoke"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
