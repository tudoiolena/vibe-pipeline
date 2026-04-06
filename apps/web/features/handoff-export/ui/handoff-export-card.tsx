"use client";

import { useCallback, useState } from "react";
import { Download, FileJson, FolderArchive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type HandoffExportCardProps = {
  projectId: string;
  /** Server hint: valid PRD artifact loaded for current page context. */
  specPackLikelyReady: boolean;
  /** Server hint: valid cursor_rules artifact loaded for this project. */
  cursorRulesLikelyReady: boolean;
  prdHint?: string | null;
  taskHint?: string | null;
  cursorRulesHint?: string | null;
  briefHint?: string | null;
};

export function HandoffExportCard({
  projectId,
  specPackLikelyReady,
  cursorRulesLikelyReady,
  prdHint,
  taskHint,
  cursorRulesHint,
  briefHint
}: HandoffExportCardProps) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);

  const runDownload = useCallback(
    async (format: string, defaultFilename: string) => {
      setError(null);
      setLoading(format);
      try {
        const res = await fetch(`/api/projects/${projectId}/export/handoff?format=${encodeURIComponent(format)}`, {
          method: "GET",
          credentials: "same-origin"
        });
        const contentType = res.headers.get("content-type") ?? "";
        if (!res.ok) {
          const payload: unknown = await res.json().catch(() => ({}));
          const msg =
            typeof payload === "object" && payload !== null && "error" in payload
              ? String((payload as { error?: unknown }).error ?? res.statusText)
              : res.statusText;
          setError(msg);
          return;
        }
        if (contentType.includes("application/json")) {
          const text = await res.text();
          const blob = new Blob([text], { type: "application/json;charset=utf-8" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `project-${projectId.slice(0, 8)}-artifacts.json`;
          a.click();
          URL.revokeObjectURL(url);
          return;
        }
        const blob = await res.blob();
        const dispo = res.headers.get("Content-Disposition");
        const match = /filename="([^"]+)"/.exec(dispo ?? "");
        const name = match?.[1] ?? defaultFilename;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        a.click();
        URL.revokeObjectURL(url);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(null);
      }
    },
    [projectId]
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <FolderArchive className="h-5 w-5 text-muted-foreground" />
          Export handoff
        </CardTitle>
        <CardDescription>
          Exports use latest <span className="font-mono">prd</span>, <span className="font-mono">tasks</span>,{" "}
          <span className="font-mono">brief</span>, and <span className="font-mono">cursor_rules</span> artifacts. If a
          download fails, the message from the server is shown below.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {(prdHint || taskHint || cursorRulesHint || briefHint) && (
          <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
            {prdHint ? <p>PRD: {prdHint}</p> : null}
            {taskHint ? <p className="mt-1">Tasks: {taskHint}</p> : null}
            {briefHint ? <p className="mt-1">Brief: {briefHint}</p> : null}
            {cursorRulesHint ? <p className="mt-1">Cursor rules: {cursorRulesHint}</p> : null}
          </div>
        )}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button
            type="button"
            variant="default"
            disabled={loading !== null}
            className="justify-start gap-2"
            title={
              specPackLikelyReady
                ? "ZIP: project-spec/* (ТЗ §9 layout) + docs/CURSOR_HANDOFF.md"
                : "Requires a valid PRD artifact."
            }
            onClick={() => void runDownload("spec-pack-zip", "project-spec.zip")}
          >
            <Download className="h-4 w-4 shrink-0" />
            {loading === "spec-pack-zip" ? "Preparing…" : "Spec pack (ZIP)"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={loading !== null}
            className="justify-start gap-2"
            title={
              cursorRulesLikelyReady ? "ZIP: .cursor/rules/*.mdc" : "Requires a valid cursor_rules artifact."
            }
            onClick={() => void runDownload("cursor-rules-zip", "cursor-rules.zip")}
          >
            <Download className="h-4 w-4 shrink-0" />
            {loading === "cursor-rules-zip" ? "Preparing…" : "Cursor rules (ZIP)"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={loading !== null}
            className="justify-start gap-2"
            title="ZIP: project-spec + .cursor/rules + artifacts/prd.json & tasks + notes if something is missing"
            onClick={() => void runDownload("full-handoff-zip", "full-handoff.zip")}
          >
            <Download className="h-4 w-4 shrink-0" />
            {loading === "full-handoff-zip" ? "Preparing…" : "Full handoff (ZIP)"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={loading !== null}
            className="justify-start gap-2"
            title="Raw content_json from latest prd + tasks artifacts, plus an issues[] list"
            onClick={() => void runDownload("artifacts-json", "artifacts.json")}
          >
            <FileJson className="h-4 w-4 shrink-0" />
            {loading === "artifacts-json" ? "Loading…" : "Artifacts (JSON)"}
          </Button>
        </div>
        {error ? (
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-red-300 bg-red-50 p-3 text-xs text-red-800 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200">
            {error}
          </pre>
        ) : null}
      </CardContent>
    </Card>
  );
}
