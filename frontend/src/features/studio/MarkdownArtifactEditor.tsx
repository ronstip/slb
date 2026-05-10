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
  Separator,
  UndoRedo,
} from '@mdxeditor/editor';
import '@mdxeditor/editor/style.css';
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

function Toolbar() {
  return (
    <>
      <UndoRedo />
      <Separator />
      <BoldItalicUnderlineToggles />
      <StrikeThroughSupSubToggles />
      <Separator />
      <BlockTypeSelect />
      <Separator />
      <ListsToggle />
      <Separator />
      <CreateLink />
      <InsertTable />
      <InsertThematicBreak />
      <InsertCodeBlock />
    </>
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
        toolbarPlugin({ toolbarContents: () => <Toolbar /> }),
      ]}
    />
  );
}
