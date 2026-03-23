import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ClipboardList } from 'lucide-react';
import { useStudioStore } from '../../stores/studio-store.ts';

export function ProtocolView() {
  const protocolContent = useStudioStore((s) => s.protocolContent);

  if (!protocolContent) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-sm gap-2">
        <ClipboardList className="h-8 w-8 opacity-40" />
        <p>No protocol loaded</p>
        <p className="text-xs">Create a task to see its protocol here</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-5 max-w-2xl">
        <div className="prose prose-sm dark:prose-invert prose-headings:text-foreground prose-p:text-muted-foreground prose-li:text-muted-foreground prose-strong:text-foreground max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {protocolContent}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
