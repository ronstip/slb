import { visit } from 'unist-util-visit';

/** Remark plugin that removes HTML comment nodes and converts `<br>` to
 *  hard breaks. The agent occasionally emits raw HTML - react-markdown
 *  won't render it, so without this it leaks through as literal text
 *  (e.g. `br>` next to a date). */
export function remarkStripComments() {
  return (tree: any) => {
    visit(tree, 'html', (node: any, index: number | undefined, parent: any) => {
      if (typeof node.value !== 'string' || !parent || index == null) return;
      const value = node.value.trim();
      if (/^<!--[\s\S]*?-->$/.test(value)) {
        parent.children.splice(index, 1);
        return index as any;
      }
      if (/^<br\s*\/?\s*>$/i.test(value)) {
        parent.children.splice(index, 1, { type: 'break' });
        return index as any;
      }
    });
  };
}
