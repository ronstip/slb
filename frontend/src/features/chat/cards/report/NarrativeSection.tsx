import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface NarrativeSectionProps {
  data: Record<string, unknown>;
}

export function NarrativeSection({ data }: NarrativeSectionProps) {
  const markdown = (data.markdown ?? '') as string;
  if (!markdown.trim()) return null;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="prose prose-sm max-w-none text-muted-foreground prose-headings:text-foreground prose-strong:text-foreground prose-p:leading-relaxed">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
      </div>
    </div>
  );
}
