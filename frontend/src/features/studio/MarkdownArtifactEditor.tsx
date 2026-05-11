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
} from 'lucide-react';
import { ReportChart, tryParseChartSpec } from './ReportChart.tsx';

interface MarkdownArtifactEditorProps {
  initialMarkdown: string;
  /** Fires on every keystroke. `isInitialNormalize` is true for the synthetic
   *  change MDXEditor emits on mount when it reformats the seed markdown
   *  (e.g. bullet glyph swap). Skip those to avoid marking the doc dirty. */
  onChange: (markdown: string, isInitialNormalize: boolean) => void;
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

/** Catch-all so any unknown fenced language renders as plain code instead of
 *  crashing the editor when MDXEditor encounters an undescribed block. */
const PlainCodeEditor: CodeBlockEditorDescriptor['Editor'] = ({ code, language }) => (
  <pre
    contentEditable={false}
    onKeyDown={(e) => e.nativeEvent.stopImmediatePropagation()}
    className="my-4 overflow-x-auto rounded-md border border-border bg-muted/40 p-3 text-xs"
    data-language={language}
  >
    {code}
  </pre>
);

const plainCodeDescriptor: CodeBlockEditorDescriptor = {
  priority: 0,
  match: () => true,
  Editor: PlainCodeEditor,
};

/** Toolbar button that injects a raw markdown/HTML snippet at the cursor.
 *  Used for features markdown can't express natively (alignment, RTL/LTR,
 *  vertical spacing) — the snippet is rendered correctly by Markdown.tsx
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

/** Replacement for MDXEditor's `InsertImage` button — the built-in dialog
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

function Toolbar() {
  return (
    <DiffSourceToggleWrapper>
      <UndoRedo />
      <Separator />
      <BoldItalicUnderlineToggles />
      <StrikeThroughSupSubToggles />
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

export function MarkdownArtifactEditor({
  initialMarkdown,
  onChange,
}: MarkdownArtifactEditorProps) {
  return (
    <MDXEditor
      markdown={initialMarkdown}
      onChange={onChange}
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
          codeBlockEditorDescriptors: [chartDescriptor, plainCodeDescriptor],
          defaultCodeBlockLanguage: '',
        }),
        markdownShortcutPlugin(),
        diffSourcePlugin({ viewMode: 'rich-text' }),
        toolbarPlugin({ toolbarContents: () => <Toolbar /> }),
      ]}
    />
  );
}
