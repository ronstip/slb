import type { ComponentProps, ReactNode } from 'react';
import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { remarkStripComments } from '../lib/remark-strip-comments.ts';
import { ReportChart, tryParseChartSpec } from '../features/studio/ReportChart.tsx';

/** HTML tags we allow rehype-raw to pass through unchanged. Anything else
 *  written like `<TagName>` (dashboard template placeholders such as
 *  `<AttackLine>`, `<Subject>`, `<Rival1>`, agent-prose tokens like
 *  `<avg eng/post>`) is escaped to `&lt;…>` so the browser stops emitting
 *  it as an unknown custom element. Unknown elements wrap inline content
 *  with default zero-styling, but their presence interacts badly with
 *  layout measurements - that's the "jumping" near the bottom of the
 *  dashboard. Lowercased on comparison because HTML parsing normalizes
 *  tag case. */
const ALLOWED_HTML_TAGS = new Set([
  'a', 'abbr', 'address', 'area', 'article', 'aside', 'audio',
  'b', 'bdi', 'bdo', 'blockquote', 'br', 'button',
  'canvas', 'caption', 'cite', 'code', 'col', 'colgroup',
  'data', 'datalist', 'dd', 'del', 'details', 'dfn', 'dialog', 'div', 'dl', 'dt',
  'em', 'embed',
  'fieldset', 'figcaption', 'figure', 'footer', 'form',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr',
  'i', 'iframe', 'img', 'input', 'ins',
  'kbd',
  'label', 'legend', 'li', 'link',
  'main', 'map', 'mark', 'meter',
  'nav', 'noscript',
  'object', 'ol', 'optgroup', 'option', 'output',
  'p', 'picture', 'pre', 'progress',
  'q',
  'rp', 'rt', 'ruby',
  's', 'samp', 'section', 'select', 'small', 'source', 'span', 'strong', 'sub', 'summary', 'sup', 'svg',
  'table', 'tbody', 'td', 'template', 'textarea', 'tfoot', 'th', 'thead', 'time', 'title', 'tr', 'track',
  'u', 'ul',
  'var', 'video',
  'wbr',
]);

const ANGLE_TAG_RE = /<\/?([a-zA-Z][a-zA-Z0-9-]*)\b/g;

function escapeUnknownAngleTags(markdown: string): string {
  return markdown.replace(ANGLE_TAG_RE, (match, name: string) => {
    if (ALLOWED_HTML_TAGS.has(name.toLowerCase())) return match;
    return match.replace('<', '&lt;');
  });
}

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

type AnchorProps = ComponentProps<'a'> & { node?: unknown };

/** Open links in a new tab. Skip in-document anchors (TOC, headings) so
 *  same-page navigation stays in the current view. */
function linkRenderer({ node: _node, href, children, ...rest }: AnchorProps) {
  const isInPageAnchor = typeof href === 'string' && href.startsWith('#');
  if (isInPageAnchor) {
    return <a href={href} {...rest}>{children}</a>;
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
      {children}
    </a>
  );
}

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
    a: linkRenderer,
    ...(renderCharts ? { code: chartCodeRenderer } : {}),
    ...(headingIds ? HEADING_COMPONENTS : {}),
  };
  const safeChildren = useMemo(() => escapeUnknownAngleTags(children), [children]);
  const content = (
    <ReactMarkdown
      remarkPlugins={plugins}
      rehypePlugins={[rehypeRaw]}
      components={components}
    >
      {safeChildren}
    </ReactMarkdown>
  );

  if (!className && !autoDir) return content;
  return (
    <div className={className} {...(autoDir ? { dir: 'auto' } : {})}>
      {content}
    </div>
  );
}
