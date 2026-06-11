import {
  MDXEditor,
  type CodeBlockEditorDescriptor,
  headingsPlugin,
  listsPlugin,
  quotePlugin,
  thematicBreakPlugin,
  linkPlugin,
  linkDialogPlugin,
  tablePlugin,
  codeBlockPlugin,
  codeMirrorPlugin,
  diffSourcePlugin,
  markdownShortcutPlugin,
  toolbarPlugin,
  BoldItalicUnderlineToggles,
  StrikeThroughSupSubToggles,
  BlockTypeSelect,
  ListsToggle,
  CreateLink,
  InsertTable,
  InsertCodeBlock,
  InsertThematicBreak,
  DiffSourceToggleWrapper,
  ButtonWithTooltip,
  Separator,
  UndoRedo,
  insertMarkdown$,
  usePublisher,
} from '@mdxeditor/editor';
import '@mdxeditor/editor/style.css';
import {
  AlignLeft,
  AlignCenter,
  AlignRight,
  ArrowRightToLine,
  ArrowLeftToLine,
  Space,
  Image as ImageIcon,
  Baseline,
  Highlighter,
} from 'lucide-react';
import { useRef } from 'react';
import { ReportChart, tryParseChartSpec } from './ReportChart.tsx';

interface MarkdownArtifactEditorProps {
  initialMarkdown: string;
  /** Fires on every keystroke. `isInitialNormalize` is true for the synthetic
   *  change MDXEditor emits on mount when it reformats the seed markdown
   *  (e.g. bullet glyph swap). Skip those to avoid marking the doc dirty. */
  onChange: (markdown: string, isInitialNormalize: boolean) => void;
  /** Where MDXEditor portals its popups (BlockTypeSelect dropdown, link
   *  dialog). When the editor sits inside a Radix Dialog with modal pointer
   *  events, the default `document.body` target falls outside the dialog's
   *  interactive scope and the popups become unclickable - pass a node
   *  inside the dialog content instead. */
  overlayContainer?: HTMLElement | null;
}

/** Renders ```chart blocks as live ReportChart while keeping the JSON source
 *  intact for round-tripping. The chart itself is non-editable; users can
 *  delete or move the block as a unit. */
const ChartCodeEditor: CodeBlockEditorDescriptor['Editor'] = ({ code }) => {
  const spec = tryParseChartSpec(code);
  return (
    <div
      contentEditable={false}
      onKeyDown={(e) => e.nativeEvent.stopImmediatePropagation()}
      className="my-4"
    >
      {spec ? (
        <ReportChart spec={spec} />
      ) : (
        <pre className="overflow-x-auto rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          {code}
        </pre>
      )}
    </div>
  );
};

const chartDescriptor: CodeBlockEditorDescriptor = {
  priority: 10,
  match: (language) => language === 'chart',
  Editor: ChartCodeEditor,
};

/** Language list shown in the code-block language dropdown and used to load
 *  CodeMirror's syntax-highlighting bundles. The empty key handles unlabeled
 *  fenced blocks (```…``` with no language). */
const CODE_BLOCK_LANGUAGES = {
  '': 'Plain text',
  js: 'JavaScript',
  ts: 'TypeScript',
  jsx: 'JSX',
  tsx: 'TSX',
  py: 'Python',
  sql: 'SQL',
  json: 'JSON',
  bash: 'Bash',
  sh: 'Shell',
  html: 'HTML',
  css: 'CSS',
  md: 'Markdown',
};

/** Toolbar button that injects a raw markdown/HTML snippet at the cursor.
 *  Used for features markdown can't express natively (alignment, RTL/LTR,
 *  vertical spacing) - the snippet is rendered correctly by Markdown.tsx
 *  via rehype-raw, but appears as HTML source inside the editor itself. */
function InsertSnippetButton({
  title,
  icon,
  snippet,
}: {
  title: string;
  icon: React.ReactNode;
  snippet: string;
}) {
  const insertMarkdown = usePublisher(insertMarkdown$);
  return (
    <ButtonWithTooltip title={title} onClick={() => insertMarkdown(snippet)}>
      {icon}
    </ButtonWithTooltip>
  );
}

const ALIGN_SNIPPET = (align: 'left' | 'center' | 'right') =>
  `\n\n<div style="text-align: ${align}">\n\nYour text here\n\n</div>\n\n`;
const DIR_SNIPPET = (dir: 'ltr' | 'rtl') =>
  `\n\n<div dir="${dir}">\n\nYour text here\n\n</div>\n\n`;
const SPACER_SNIPPET = '\n\n<br />\n\n';

/** Replacement for MDXEditor's `InsertImage` button - the built-in dialog
 *  portals into the editor root and uses `position: fixed`, which breaks
 *  when the editor is nested inside a Radix Dialog (the dialog's
 *  `transform` creates a new containing block, pushing the image dialog
 *  off-screen). Window prompt is dependable across both surfaces. */
function InsertImageButton() {
  const insertMarkdown = usePublisher(insertMarkdown$);
  return (
    <ButtonWithTooltip
      title="Insert image"
      onClick={() => {
        const url = window.prompt('Image URL');
        if (!url) return;
        const alt = window.prompt('Alt text (optional)', '') ?? '';
        insertMarkdown(`![${alt}](${url})`);
      }}
    >
      <ImageIcon size={15} strokeWidth={1.75} />
    </ButtonWithTooltip>
  );
}

/** Recolor the selected text by wrapping it in a styled `<span>`. Mirrors the
 *  raw-HTML snippet approach of the align/dir buttons - the span shows as HTML
 *  source inside the editor but renders colored in the preview and on the saved
 *  dashboard (Markdown.tsx allows `span` + inline `style`).
 *
 *  Selection is captured on `mousedown` (with `preventDefault` so the editor
 *  keeps both DOM focus and its Lexical RangeSelection). `insertMarkdown$` runs
 *  `$insertNodes`, which replaces the active selection - so we feed it the
 *  captured text as the span body to recolor exactly the selected run (or a
 *  `text` placeholder when nothing is selected). */
function ColorButton({
  title,
  icon,
  cssProp,
  defaultColor,
}: {
  title: string;
  icon: React.ReactNode;
  cssProp: 'color' | 'background-color';
  defaultColor: string;
}) {
  const insertMarkdown = usePublisher(insertMarkdown$);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const selectedRef = useRef('');
  return (
    <>
      <button
        type="button"
        title={title}
        className="inline-flex h-7 min-w-7 items-center justify-center rounded px-1 hover:bg-black/5 dark:hover:bg-white/10"
        onMouseDown={(e) => {
          e.preventDefault(); // keep the editor's text selection + focus alive
          selectedRef.current = window.getSelection()?.toString() ?? '';
          inputRef.current?.click();
        }}
      >
        {icon}
      </button>
      <input
        ref={inputRef}
        type="color"
        defaultValue={defaultColor}
        aria-hidden
        tabIndex={-1}
        style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
        onChange={(e) => {
          const text = selectedRef.current || 'text';
          insertMarkdown(`<span style="${cssProp}: ${e.target.value}">${text}</span>`);
        }}
      />
    </>
  );
}

function Toolbar() {
  return (
    <DiffSourceToggleWrapper>
      <UndoRedo />
      <Separator />
      <BoldItalicUnderlineToggles />
      <StrikeThroughSupSubToggles />
      <Separator />
      <ColorButton
        title="Text color"
        icon={<Baseline size={15} strokeWidth={1.75} />}
        cssProp="color"
        defaultColor="#e11d48"
      />
      <ColorButton
        title="Highlight color"
        icon={<Highlighter size={15} strokeWidth={1.75} />}
        cssProp="background-color"
        defaultColor="#fde047"
      />
      <Separator />
      <BlockTypeSelect />
      <Separator />
      <ListsToggle />
      <Separator />
      <InsertSnippetButton
        title="Align left"
        icon={<AlignLeft size={15} strokeWidth={1.75} />}
        snippet={ALIGN_SNIPPET('left')}
      />
      <InsertSnippetButton
        title="Align center"
        icon={<AlignCenter size={15} strokeWidth={1.75} />}
        snippet={ALIGN_SNIPPET('center')}
      />
      <InsertSnippetButton
        title="Align right"
        icon={<AlignRight size={15} strokeWidth={1.75} />}
        snippet={ALIGN_SNIPPET('right')}
      />
      <Separator />
      <InsertSnippetButton
        title="Left-to-right block"
        icon={<ArrowRightToLine size={15} strokeWidth={1.75} />}
        snippet={DIR_SNIPPET('ltr')}
      />
      <InsertSnippetButton
        title="Right-to-left block"
        icon={<ArrowLeftToLine size={15} strokeWidth={1.75} />}
        snippet={DIR_SNIPPET('rtl')}
      />
      <Separator />
      <InsertSnippetButton
        title="Insert blank line"
        icon={<Space size={15} strokeWidth={1.75} />}
        snippet={SPACER_SNIPPET}
      />
      <Separator />
      <CreateLink />
      <InsertImageButton />
      <InsertTable />
      <InsertThematicBreak />
      <InsertCodeBlock />
    </DiffSourceToggleWrapper>
  );
}

/** Escape pseudo-tags that come from dashboard templates and agent prose
 *  (`<AttackLine>`, `<Subject>`, `<Rival1>`, `<avg eng/post>`). MDX
 *  treats any `<Name…>` token as a JSX component; an unclosed one throws
 *  the editor into source-only error mode and the error banner re-renders
 *  on every keystroke, which manifests as the bottom of the editor
 *  "jumping". Escape `<` → `&lt;` for any tag whose name isn't in the
 *  allowlist; recognized HTML tags pass through. Allowlist is the
 *  subset relevant to markdown - same set the read-only Markdown
 *  component uses. */
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

function escapePseudoJsxTags(markdown: string): string {
  return markdown.replace(/<\/?([a-zA-Z][a-zA-Z0-9-]*)\b/g, (match, name: string) => {
    if (ALLOWED_HTML_TAGS.has(name.toLowerCase())) return match;
    return match.replace('<', '&lt;');
  });
}

export function MarkdownArtifactEditor({
  initialMarkdown,
  onChange,
  overlayContainer,
}: MarkdownArtifactEditorProps) {
  return (
    <MDXEditor
      markdown={escapePseudoJsxTags(initialMarkdown)}
      onChange={onChange}
      onError={({ error, source }) => {
        console.warn('[MarkdownArtifactEditor] parse error', error, source);
      }}
      overlayContainer={overlayContainer ?? undefined}
      contentEditableClassName="agent-prose max-w-none break-words text-sm leading-relaxed"
      plugins={[
        headingsPlugin(),
        listsPlugin(),
        quotePlugin(),
        thematicBreakPlugin(),
        linkPlugin(),
        linkDialogPlugin(),
        tablePlugin(),
        codeBlockPlugin({
          codeBlockEditorDescriptors: [chartDescriptor],
          defaultCodeBlockLanguage: '',
        }),
        codeMirrorPlugin({ codeBlockLanguages: CODE_BLOCK_LANGUAGES }),
        markdownShortcutPlugin(),
        diffSourcePlugin({ viewMode: 'rich-text' }),
        toolbarPlugin({ toolbarContents: () => <Toolbar /> }),
      ]}
    />
  );
}
