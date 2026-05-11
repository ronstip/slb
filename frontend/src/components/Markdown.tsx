import type { ComponentProps, ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { remarkStripComments } from '../lib/remark-strip-comments.ts';
import { ReportChart, tryParseChartSpec } from '../features/studio/ReportChart.tsx';

interface MarkdownProps {
  children: string;
  /** Strip HTML comments before rendering. Default true. */
  stripComments?: boolean;
  /** Wrapper div className. If provided, content is wrapped; otherwise passed through. */
  className?: string;
  /** If true, render with `dir="auto"` on the wrapper (for RTL-friendly content). */
  autoDir?: boolean;
  /** If true, fenced code blocks tagged ```chart are rendered as live charts. */
  renderCharts?: boolean;
  /** If true, headings get slug-based ids so in-document TOC links resolve. */
  headingIds?: boolean;
}

type CodeProps = ComponentProps<'code'> & { node?: unknown };

function chartCodeRenderer({ className, children, ...rest }: CodeProps) {
  const lang = /language-chart\b/.test(className ?? '');
  if (lang) {
    const raw = String(children ?? '').replace(/\n$/, '');
    const spec = tryParseChartSpec(raw);
    if (spec) return <ReportChart spec={spec} />;
  }
  return <code className={className} {...rest}>{children}</code>;
}

function reactNodeText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(reactNodeText).join('');
  if (typeof node === 'object' && 'props' in node) {
    return reactNodeText((node as { props: { children?: ReactNode } }).props.children);
  }
  return '';
}

/** Slugify rule (must match the strategic-planning prompt's TOC contract):
 *  trim → lowercase → replace any run of chars that aren't unicode letters,
 *  numbers, marks, or `-` with a single `-` → strip leading/trailing dashes. */
export function slugifyHeading(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}-]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

type HeadingProps = ComponentProps<'h1'>;

function makeHeadingRenderer(Tag: 'h1' | 'h2' | 'h3' | 'h4') {
  return function HeadingWithId({ children, ...rest }: HeadingProps) {
    const id = slugifyHeading(reactNodeText(children));
    return <Tag id={id || undefined} {...rest}>{children}</Tag>;
  };
}

const HEADING_COMPONENTS = {
  h1: makeHeadingRenderer('h1'),
  h2: makeHeadingRenderer('h2'),
  h3: makeHeadingRenderer('h3'),
  h4: makeHeadingRenderer('h4'),
};

export function Markdown({
  children,
  stripComments = true,
  className,
  autoDir,
  renderCharts,
  headingIds,
}: MarkdownProps) {
  const plugins = stripComments ? [remarkGfm, remarkStripComments] : [remarkGfm];
  const components = {
    ...(renderCharts ? { code: chartCodeRenderer } : {}),
    ...(headingIds ? HEADING_COMPONENTS : {}),
  };
  const content = (
    <ReactMarkdown
      remarkPlugins={plugins}
      rehypePlugins={[rehypeRaw]}
      components={Object.keys(components).length > 0 ? components : undefined}
    >
      {children}
    </ReactMarkdown>
  );

  if (!className && !autoDir) return content;
  return (
    <div className={className} {...(autoDir ? { dir: 'auto' } : {})}>
      {content}
    </div>
  );
}
