import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { remarkStripComments } from '../lib/remark-strip-comments.ts';

interface MarkdownProps {
  children: string;
  /** Strip HTML comments before rendering. Default true. */
  stripComments?: boolean;
  /** Wrapper div className. If provided, content is wrapped; otherwise passed through. */
  className?: string;
  /** If true, render with `dir="auto"` on the wrapper (for RTL-friendly content). */
  autoDir?: boolean;
}

export function Markdown({ children, stripComments = true, className, autoDir }: MarkdownProps) {
  const plugins = stripComments ? [remarkGfm, remarkStripComments] : [remarkGfm];
  const content = <ReactMarkdown remarkPlugins={plugins}>{children}</ReactMarkdown>;

  if (!className && !autoDir) return content;
  return (
    <div className={className} {...(autoDir ? { dir: 'auto' } : {})}>
      {content}
    </div>
  );
}
