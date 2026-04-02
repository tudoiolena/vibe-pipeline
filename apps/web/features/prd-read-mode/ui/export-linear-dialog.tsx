"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { buildLinearIssueMarkdown, type DesignMap, type TaskNode } from "@vibe/schema";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { exportTasksToLinear } from "@/lib/export-tasks-to-linear";

type ExportLinearDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId?: string;
  projectId?: string;
  selectedTaskIds: string[];
  selectedTasks: TaskNode[];
  designMap?: DesignMap;
  linearTeamDisplay: string;
  defaultLinearTeamId?: string;
};

function figmaNodeUrl(fileKey: string, nodeId: string): string {
  return `https://www.figma.com/design/${fileKey}?node-id=${encodeURIComponent(nodeId)}`;
}

function resolveTaskFigmaUrl(task: TaskNode, designMap?: DesignMap): string | null {
  const meta = task.metadata;
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    const explicit = (meta as { figmaUrl?: unknown }).figmaUrl;
    if (typeof explicit === "string" && /^https?:\/\//.test(explicit)) {
      return explicit;
    }
    const nodeId = (meta as { figmaNodeId?: unknown }).figmaNodeId;
    const fileKey = (meta as { figmaFileKey?: unknown }).figmaFileKey;
    if (typeof nodeId === "string" && nodeId.trim() && typeof fileKey === "string" && fileKey.trim()) {
      return figmaNodeUrl(fileKey.trim(), nodeId.trim());
    }
  }
  if (!designMap?.links?.length) {
    return null;
  }
  const link = designMap.links.find((candidate) => candidate.taskExternalKey === task.externalKey);
  if (!link) {
    return null;
  }
  const node = designMap.nodes.find((candidate) => candidate.nodeId === link.nodeId);
  return node?.figmaUrl ?? null;
}

export function ExportLinearDialog({
  open,
  onOpenChange,
  sessionId,
  projectId,
  selectedTaskIds,
  selectedTasks,
  designMap,
  linearTeamDisplay,
  defaultLinearTeamId
}: ExportLinearDialogProps) {
  const router = useRouter();
  const [teamIdOverride, setTeamIdOverride] = useState(defaultLinearTeamId?.trim() ?? "");
  const [exportLoading, setExportLoading] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  const selectedCount = selectedTaskIds.length;
  const selectedPreview = useMemo(() => selectedTaskIds.slice(0, 8), [selectedTaskIds]);
  const markdownPreview = useMemo(
    () =>
      selectedTasks
        .map((task) => {
          const body =
            buildLinearIssueMarkdown(task, {
              figmaUrl: resolveTaskFigmaUrl(task, designMap)
            }) ?? "_No description body_";
          return [`### ${task.externalKey} — ${task.title}`, "", body].join("\n");
        })
        .join("\n\n---\n\n"),
    [designMap, selectedTasks]
  );

  const onDialogChange = useCallback(
    (nextOpen: boolean) => {
      onOpenChange(nextOpen);
      setExportError(null);
      if (nextOpen) {
        setTeamIdOverride(defaultLinearTeamId?.trim() ?? "");
        setShowPreview(false);
      }
    },
    [defaultLinearTeamId, onOpenChange]
  );

  const onSendToLinear = useCallback(async () => {
    if (!sessionId || selectedTaskIds.length === 0) {
      return;
    }
    setExportError(null);
    setExportLoading(true);
    try {
      const trimmedTeam = teamIdOverride.trim();
      const body: {
        sessionId: string;
        selectedTaskIds: string[];
        teamId?: string;
      } = {
        sessionId,
        selectedTaskIds
      };
      if (trimmedTeam.length > 0) {
        body.teamId = trimmedTeam;
      }

      const data = await exportTasksToLinear(body);
      onOpenChange(false);
      router.refresh();

      const workspaceUrl = typeof data.workspaceUrl === "string" ? data.workspaceUrl : null;
      toast.success("Exported to Linear", {
        description: workspaceUrl ? (
          <a href={workspaceUrl} className="underline underline-offset-2" target="_blank" rel="noreferrer">
            Open Linear workspace
          </a>
        ) : (
          "Issues were created in your team."
        ),
        duration: 8000
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setExportError(message);
    } finally {
      setExportLoading(false);
    }
  }, [onOpenChange, router, selectedTaskIds, sessionId, teamIdOverride]);

  return (
    <Dialog open={open} onOpenChange={onDialogChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Export to Linear</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-1 text-left text-muted-foreground">
              <p>
                Exporting to team <span className="font-medium text-foreground">{linearTeamDisplay}</span>
                {projectId ? <span className="block font-mono text-xs text-muted-foreground">Project {projectId}</span> : null}
              </p>
              <p className="text-xs">
                Selected tasks: <span className="font-medium text-foreground">{selectedCount}</span>
              </p>
            </div>
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block text-sm font-medium text-foreground" htmlFor="linear-team-override">
            Team ID (optional override)
          </label>
          <input
            id="linear-team-override"
            type="text"
            placeholder="UUID — leave empty to use server default"
            value={teamIdOverride}
            onChange={(e) => setTeamIdOverride(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            autoComplete="off"
          />
          <p className="text-xs text-muted-foreground">
            Task selection comes from the checkboxes in the Task Backlog tab.
          </p>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" checked={showPreview} onChange={(e) => setShowPreview(e.target.checked)} />
            Preview final Markdown body
          </label>
          <div className="max-h-[min(30vh,220px)] space-y-1 overflow-y-auto rounded-md border border-border p-3 text-sm">
            {selectedPreview.map((taskId) => (
              <p key={taskId} className="font-mono text-xs text-foreground/90">
                {taskId}
              </p>
            ))}
            {selectedTaskIds.length > selectedPreview.length ? (
              <p className="pt-1 text-xs text-muted-foreground">
                + {selectedTaskIds.length - selectedPreview.length} more selected
              </p>
            ) : null}
          </div>
          {showPreview ? (
            <div className="max-h-[min(40vh,320px)] overflow-auto rounded-md border border-border bg-muted/20 p-3">
              <pre className="whitespace-pre-wrap text-xs leading-relaxed text-foreground">{markdownPreview}</pre>
            </div>
          ) : null}
        </div>
        {exportError ? (
          <p className="rounded-md border border-red-300 bg-red-50 p-2 text-sm text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300">
            {exportError}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="default"
            disabled={exportLoading || selectedTaskIds.length === 0 || !sessionId}
            onClick={() => void onSendToLinear()}
          >
            {exportLoading ? "Sending…" : "Send to Linear"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
