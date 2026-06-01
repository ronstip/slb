import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '../../../components/ui/sheet.tsx';
import { Button } from '../../../components/ui/button.tsx';
import { Textarea } from '../../../components/ui/textarea.tsx';
import { Input } from '../../../components/ui/input.tsx';
import { Label } from '../../../components/ui/label.tsx';
import { Checkbox } from '../../../components/ui/checkbox.tsx';
import { fetchPostsByUrl } from '../../../api/endpoints/agents.ts';
import { describeError } from '../../../lib/errors.ts';

interface AddPostByUrlDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentId: string;
}

function parseUrls(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function AddPostByUrlDrawer({ open, onOpenChange, agentId }: AddPostByUrlDrawerProps) {
  const qc = useQueryClient();
  const [urlsText, setUrlsText] = useState('');
  const [note, setNote] = useState('');
  const [includeComments, setIncludeComments] = useState(false);

  useEffect(() => {
    if (open) {
      setUrlsText('');
      setNote('');
      setIncludeComments(false);
    }
  }, [open]);

  const urls = useMemo(() => parseUrls(urlsText), [urlsText]);

  const mutation = useMutation({
    mutationFn: () => fetchPostsByUrl(agentId, urls, note || undefined, includeComments),
    onSuccess: (data) => {
      toast.success(
        `Fetching ${urls.length} post${urls.length === 1 ? '' : 's'}`,
        { description: `${data.collection_ids.length} collection(s) dispatched` },
      );
      qc.invalidateQueries({ queryKey: ['agent-detail', agentId] });
      qc.invalidateQueries({ queryKey: ['agent', agentId] });
      onOpenChange(false);
    },
    onError: (err) => {
      toast.error('Could not fetch posts', { description: describeError(err) });
    },
    meta: { silent: true }, // handled above — don't double-toast via global net
  });

  const submitDisabled = urls.length === 0 || mutation.isPending;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full max-w-[480px] sm:max-w-[480px] gap-0">
        <SheetHeader className="px-6 pt-6">
          <SheetTitle className="flex items-center gap-2">
            <Link2 className="h-4 w-4 text-primary" />
            Add posts by URL
          </SheetTitle>
          <SheetDescription>
            Paste one X/Twitter or Instagram post URL per line. Each post runs
            through the same enrichment as keyword-collected ones.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-6 py-4">
          <div className="space-y-1.5">
            <Label htmlFor="post-urls">Post URLs</Label>
            <Textarea
              id="post-urls"
              value={urlsText}
              onChange={(e) => setUrlsText(e.target.value)}
              placeholder={'https://x.com/user/status/1234567890\nhttps://www.instagram.com/p/Cabc123/'}
              rows={6}
              className="font-mono text-xs"
            />
            <p className="text-[11px] text-muted-foreground">
              {urls.length === 0
                ? 'One URL per line.'
                : `${urls.length} URL${urls.length === 1 ? '' : 's'} ready.`}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="post-note">Label (optional)</Label>
            <Input
              id="post-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Investor day reactions"
            />
          </div>

          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={includeComments}
              onCheckedChange={(v) => setIncludeComments(v === true)}
              className="mt-0.5"
            />
            <span>
              Also fetch replies
              <span className="block text-[11px] text-muted-foreground">
                Off by default — fetching replies can be expensive on X.
              </span>
            </span>
          </label>
        </div>

        <div className="flex justify-end gap-2 border-t border-border/40 px-6 py-4">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={submitDisabled}>
            {mutation.isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
            {mutation.isPending
              ? 'Starting…'
              : urls.length > 0
                ? `Fetch ${urls.length} post${urls.length === 1 ? '' : 's'}`
                : 'Fetch posts'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
