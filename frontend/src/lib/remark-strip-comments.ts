import { visit } from 'unist-util-visit';

/** Remark plugin that removes HTML comment nodes from the AST. */
export function remarkStripComments() {
  return (tree: any) => {
    visit(tree, 'html', (node: any, index: number | undefined, parent: any) => {
      if (
        typeof node.value === 'string' &&
        /^<!--[\s\S]*?-->$/.test(node.value.trim())
      ) {
        parent.children.splice(index, 1);
        return index as any;
      }
    });
  };
}
