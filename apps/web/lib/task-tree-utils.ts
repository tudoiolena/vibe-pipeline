import type { TaskNode, TaskTree } from "@vibe/schema";

export function flattenTaskTree(tree: TaskTree): TaskNode[] {
  const out: TaskNode[] = [];
  function walk(node: TaskNode): void {
    out.push(node);
    for (const child of node.children) {
      walk(child);
    }
  }
  for (const epic of tree.epics) {
    walk(epic);
  }
  return out;
}
