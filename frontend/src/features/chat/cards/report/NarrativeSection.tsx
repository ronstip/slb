import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface NarrativeSectionProps {
  data: Record<string, unknown>;
}

export function NarrativeSection({ data }: NarrativeSectionProps) {
  const markdown = (data.markdown ?? '') as string;
  if (!markdown.trim()) return null;

  return (
    <div className="rounded-lg border border-border bg-card px-5 py-4">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h2: ({ children }) => (
            <h2 className="mb-2 mt-3 first:mt-0 text-[13px] font-semibold text-foreground">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="mb-1.5 mt-2.5 text-[12px] font-semibold text-foreground">
              {children}
            </h3>
          ),
          p: ({ children }) => (
            <p className="mb-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
              {children}
            </p>
          ),
          ul: ({ children }) => (
            <ul className="mb-2 ml-4 list-disc space-y-1">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="mb-2 ml-4 list-decimal space-y-1">
              {children}
            </ol>
          ),
          li: ({ children }) => (
            <li className="text-[12.5px] leading-relaxed text-muted-foreground">
              {children}
            </li>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-foreground">{children}</strong>
          ),
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
