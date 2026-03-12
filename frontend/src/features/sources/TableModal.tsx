import { useQuery } from '@tanstack/react-query';
import { getPosts } from '../../api/endpoints/feed.ts';
import { DataTable, postColumns, ExpandedPostRow } from '../../components/DataTable/index.ts';
import { PostCard } from '../studio/PostCard.tsx';
import { formatNumber } from '../../lib/format.ts';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.tsx';
import type { FeedPost } from '../../api/types.ts';
import type { Source } from '../../stores/sources-store.ts';

interface TableModalProps {
  source: Source;
  open: boolean;
  onClose: () => void;
}

const columns = postColumns<FeedPost>({
  hoverContent: (row) => <PostCard post={row} />,
});

export function TableModal({ source, open, onClose }: TableModalProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['collection-table', source.collectionId],
    queryFn: () => getPosts(source.collectionId, { sort: 'views', limit: 200 }),
    enabled: open,
    staleTime: 2 * 60 * 1000,
  });

  const allPosts = data?.posts ?? [];

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="flex h-[90vh] w-[96vw] max-w-screen-2xl sm:max-w-screen-2xl flex-col gap-0 p-0">
        <DialogHeader className="shrink-0 border-b px-5 py-3">
          <DialogTitle className="text-sm font-semibold">
            {source.title}
            {allPosts.length > 0 && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {formatNumber(allPosts.length)} posts
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-8 animate-pulse rounded bg-secondary" />
            ))}
          </div>
        ) : (
          <DataTable
            data={allPosts}
            columns={columns}
            getRowKey={(p) => p.post_id}
            defaultSortKey="views"
            renderExpandedRow={(row) => <ExpandedPostRow row={row} />}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
