import { DataTable, topPostColumns } from '../../../../components/DataTable/index.ts';

interface PostRow {
  post_id: string;
  platform: string;
  channel_handle: string;
  title: string;
  post_url: string;
  likes: number;
  views: number;
  shares: number;
  comments_count: number;
  total_engagement: number;
  sentiment: string;
}

interface TopPostsTableProps {
  data: Record<string, unknown>;
}

const columns = topPostColumns<PostRow>();

export function TopPostsTable({ data }: TopPostsTableProps) {
  const posts = (data.posts ?? []) as PostRow[];
  if (posts.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <DataTable
        data={posts}
        columns={columns}
        getRowKey={(p) => p.post_id}
        pageSize={0}
        striped={false}
        className="[&_tr]:border-b [&_tr]:border-border/50 [&_tr:last-child]:border-b-0 [&_tr]:hover:bg-muted/30 [&_tr]:transition-colors [&_thead_tr]:bg-muted/40 [&_thead_tr]:border-border [&_th]:px-3 [&_td]:px-3"
      />
    </div>
  );
}
