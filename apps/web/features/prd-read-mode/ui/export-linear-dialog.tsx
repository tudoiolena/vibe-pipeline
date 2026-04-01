"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
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
  linearTeamDisplay: string;
  defaultLinearTeamId?: string;
};

export function ExportLinearDialog({
  open,
  onOpenChange,
  sessionId,
  projectId,
  selectedTaskIds,
  linearTeamDisplay,
  defaultLinearTeamId
}: ExportLinearDialogProps) {
  const router = useRouter();
  const [teamIdOverride, setTeamIdOverride] = useState(defaultLinearTeamId?.trim() ?? "");
  const [exportLoading, setExportLoading] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const selectedCount = selectedTaskIds.length;
  const selectedPreview = useMemo(() => selectedTaskIds.slice(0, 8), [selectedTaskIds]);

  const onDialogChange = useCallback(
    (nextOpen: boolean) => {
      onOpenChange(nextOpen);
      setExportError(null);
      if (nextOpen) {
        setTeamIdOverride(defaultLinearTeamId?.trim() ?? "");
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
