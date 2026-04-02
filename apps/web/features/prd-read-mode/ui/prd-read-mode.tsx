"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DesignMap, PRD, TaskTree, UIKit } from "@vibe/schema";
import { getInternalSpecIdFromTask, serializePrdToMarkdown } from "@vibe/schema";
import { Check, ChevronDown, ExternalLink, Loader2, PenTool } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buildProjectSpecFilesFromPrd, type ProjectSpecFile } from "@/lib/project-spec-files";
import { getDynamicBadgeStyle } from "@/lib/tech-stack-badge";
import { flattenTaskTree } from "@/lib/task-tree-utils";
import { ExportLinearDialog } from "./export-linear-dialog";

type CursorRuleFile = {
  filename: string;
  content: string;
};

type ReadModeTab = "prd" | "spec" | "tasks" | "rules";
type TaskCheckboxRow = ReturnType<typeof buildTaskRow>;

function buildTaskRow(task: ReturnType<typeof flattenTaskTree>[number]) {
  const internalSpecId = getInternalSpecIdFromTask(task);
  const titleShowsVpPrefix = /^\[VP-\d+]/.test(task.title.trim());
  return {
    ...task,
    internalSpecId,
    titleForDisplay: task.title,
    vpChip: internalSpecId && !titleShowsVpPrefix ? internalSpecId : null,
    indentClass: task.hierarchyLevel === 0 ? "" : task.hierarchyLevel === 1 ? "ml-4" : "ml-8",
    typeLabel: task.taskType === "epic" ? "Epic" : task.taskType === "task" ? "Task" : "Subtask"
  };
}

function resolveTaskFigmaUrl(task: TaskCheckboxRow, designMap?: DesignMap): string | null {
  const meta = task.metadata;
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    const explicitUrl = (meta as { figmaUrl?: unknown }).figmaUrl;
    if (typeof explicitUrl === "string" && /^https?:\/\//.test(explicitUrl)) {
      return explicitUrl;
    }
    const nodeId = (meta as { figmaNodeId?: unknown }).figmaNodeId;
    const fileKey = (meta as { figmaFileKey?: unknown }).figmaFileKey;
    if (typeof nodeId === "string" && nodeId.trim().length > 0 && typeof fileKey === "string" && fileKey.trim().length > 0) {
      return `https://www.figma.com/design/${fileKey}?node-id=${encodeURIComponent(nodeId)}`;
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

function Markdown({ content }: { content: string }) {
  return (
    <div className="prose prose-sm max-w-none whitespace-pre-wrap text-foreground/90 dark:prose-invert">
      {content}
    </div>
  );
}

const STAGE_LABELS: Record<string, string> = {
  intake: "Intake",
  clarify: "Clarify",
  prd: "PRD",
  tasks: "Tasks",
  design_sync: "Design sync",
  handoff: "Handoff",
  export: "Export"
};

type PrdReadModeProps = {
  prd: PRD;
  sessionId?: string;
  projectId?: string;
  taskTree?: TaskTree | null;
  designMap?: DesignMap;
  cursorRules?: CursorRuleFile[];
  specFiles?: ProjectSpecFile[];
  uiKit?: UIKit;
  linearTeamDisplay?: string;
  defaultLinearTeamId?: string;
};

export function PrdReadMode({
  prd,
  sessionId,
  projectId,
  taskTree,
  designMap,
  cursorRules = [],
  specFiles = [],
  uiKit,
  linearTeamDisplay = "configured team",
  defaultLinearTeamId
}: PrdReadModeProps) {
  const router = useRouter();
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [copiedRule, setCopiedRule] = useState<string | null>(null);
  const [redraftLoading, setRedraftLoading] = useState(false);
  const [redraftError, setRedraftError] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<ReadModeTab>("prd");
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [expandedTaskKeys, setExpandedTaskKeys] = useState<Set<string>>(() => new Set());

  const flatTasks = useMemo(() => (taskTree ? flattenTaskTree(taskTree) : []), [taskTree]);
  const figmaMappedTaskKeys = useMemo(
    () => new Set((designMap?.links ?? []).map((link) => link.taskExternalKey)),
    [designMap]
  );

  useEffect(() => {
    if (flatTasks.length === 0) {
      setSelectedKeys(new Set());
      return;
    }
    setSelectedKeys((prev) => {
      if (prev.size > 0) {
        return prev;
      }
      return new Set(flatTasks.map((task) => task.externalKey));
    });
  }, [flatTasks]);

  const canExport = Boolean(sessionId && flatTasks.length > 0);
  const selectedTaskIds = useMemo(
    () => flatTasks.map((task) => task.externalKey).filter((key) => selectedKeys.has(key)),
    [flatTasks, selectedKeys]
  );
  const selectedTasksForExport = useMemo(
    () => flatTasks.filter((task) => selectedKeys.has(task.externalKey)),
    [flatTasks, selectedKeys]
  );

  const markdown = serializePrdToMarkdown(prd);
  const resolvedSpecFiles = useMemo(
    () => (specFiles.length > 0 ? specFiles : buildProjectSpecFilesFromPrd(prd, uiKit)),
    [specFiles, prd, uiKit]
  );

  const taskCheckboxRows = useMemo(
    () => flatTasks.map((task) => buildTaskRow(task)),
    [flatTasks]
  );
  const [selectedSpecFilename, setSelectedSpecFilename] = useState("");
  useEffect(() => {
    if (resolvedSpecFiles.length === 0) {
      setSelectedSpecFilename("");
      return;
    }
    setSelectedSpecFilename((prev) =>
      resolvedSpecFiles.some((file) => file.filename === prev) ? prev : resolvedSpecFiles[0]!.filename
    );
  }, [resolvedSpecFiles]);
  const selectedSpecFile = useMemo(
    () => resolvedSpecFiles.find((f) => f.filename === selectedSpecFilename) ?? resolvedSpecFiles[0] ?? null,
    [selectedSpecFilename, resolvedSpecFiles]
  );

  const syncSelectionAll = useCallback(() => {
    setSelectedKeys(new Set(flatTasks.map((t) => t.externalKey)));
  }, [flatTasks]);

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 2000);
    } catch {
      setCopyState("error");
      window.setTimeout(() => setCopyState("idle"), 2500);
    }
  }, [markdown]);

  const onRedraftToClarification = useCallback(async () => {
    if (!sessionId) {
      return;
    }
    setRedraftError(null);
    setRedraftLoading(true);
    try {
      const res = await fetch("/api/pipeline/redraft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, target: "gapDetector" })
      });
      const payload: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message =
          typeof payload === "object" && payload !== null && "error" in payload
            ? String((payload as { error?: unknown }).error ?? res.statusText)
            : res.statusText;
        throw new Error(message);
      }
      router.refresh();
    } catch (error) {
      setRedraftError(error instanceof Error ? error.message : String(error));
    } finally {
      setRedraftLoading(false);
    }
  }, [router, sessionId]);

  const toggleTask = useCallback((externalKey: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(externalKey)) {
        next.delete(externalKey);
      } else {
        next.add(externalKey);
      }
      return next;
    });
  }, []);
  const toggleExpandedTask = useCallback((externalKey: string) => {
    setExpandedTaskKeys((prev) => {
      const next = new Set(prev);
      if (next.has(externalKey)) {
        next.delete(externalKey);
      } else {
        next.add(externalKey);
      }
      return next;
    });
  }, []);

  const onCopyRule = useCallback(async (filename: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedRule(filename);
      window.setTimeout(() => setCopiedRule(null), 2000);
    } catch {
      setCopiedRule(null);
    }
  }, []);

  return (
    <Card className="overflow-hidden border-primary/20 shadow-md shadow-primary/5">
      <CardHeader className="border-b border-border bg-linear-to-br from-primary/6 to-transparent">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="text-xl tracking-tight">Product requirements</CardTitle>
            <CardDescription className="mt-1.5 max-w-xl leading-relaxed">
              Read-only view of the generated PRD. Copy as Markdown for docs, tickets, or handoff.
            </CardDescription>
          </div>
          <div className="flex shrink-0 flex-col gap-2 sm:items-end">
            {sessionId ? (
              <Button
                type="button"
                variant="outline"
                disabled={redraftLoading}
                onClick={() => void onRedraftToClarification()}
              >
                {redraftLoading ? "Returning…" : "Go back to clarification"}
              </Button>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="default" onClick={() => void onCopy()}>
                {copyState === "copied" ? "Copied" : copyState === "error" ? "Copy failed" : "Copy to clipboard"}
              </Button>
            </div>
          </div>
        </div>
          {redraftError ? (
            <p className="mt-3 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300">
              {redraftError}
            </p>
          ) : null}
          <div className="mt-4 inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground">
            {(
              [
                { value: "prd", label: "PRD" },
                { value: "spec", label: "Project Spec" },
                { value: "tasks", label: "Task Backlog" },
                { value: "rules", label: "Cursor Rules" }
              ] as const
            ).map((tab) => (
              <button
                key={tab.value}
                type="button"
                onClick={() => setActiveTab(tab.value)}
                data-state={activeTab === tab.value ? "active" : "inactive"}
                className="inline-flex h-8 cursor-pointer items-center justify-center rounded-sm px-3 text-sm font-medium whitespace-nowrap ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"
              >
                {tab.label}
              </button>
            ))}
          </div>
      </CardHeader>
      <CardContent className="max-h-[min(70vh,720px)] overflow-y-auto px-6 py-8 sm:px-10">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {activeTab === "prd" ? (
            <div className="rounded-md border border-border bg-card p-4">
            <article className="mx-auto max-w-2xl space-y-10 text-[15px] leading-relaxed text-foreground">
              <header className="space-y-3 border-b border-border pb-8">
                <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">Overview</p>
                <p className="text-lg font-semibold leading-snug tracking-tight text-foreground">{prd.productOverview}</p>
              </header>

              <section className="space-y-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Problem</h2>
                <p className="text-foreground/90">{prd.problemStatement}</p>
              </section>

              <section className="space-y-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Goals</h2>
                <ul className="list-inside list-disc space-y-1.5 text-foreground/90 marker:text-primary">
                  {prd.goals.map((g) => (
                    <li key={g}>{g}</li>
                  ))}
                </ul>
              </section>

              <section className="space-y-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Scope</h2>
                <ul className="list-inside list-disc space-y-1.5 text-foreground/90 marker:text-primary">
                  {prd.scopeSummary.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </section>

              <section className="space-y-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Users & personas</h2>
                <ul className="list-inside list-disc space-y-1.5 text-foreground/90 marker:text-primary">
                  {prd.usersAndPersonas.map((u) => (
                    <li key={u}>{u}</li>
                  ))}
                </ul>
              </section>

              <section className="space-y-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Architecture flow</h2>
                <ol className="flex flex-wrap gap-2">
                  {prd.architectureFlow.map((stage) => (
                    <li
                      key={stage}
                      className="rounded-full border border-border bg-secondary/60 px-3 py-1 text-xs font-medium text-secondary-foreground"
                    >
                      {STAGE_LABELS[stage] ?? stage}
                    </li>
                  ))}
                </ol>
              </section>

              <section className="space-y-4">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">User stories</h2>
                <div className="overflow-x-auto rounded-md border border-border">
                  <table className="min-w-full text-sm">
                    <thead className="bg-muted/50 text-left">
                      <tr>
                        <th className="px-3 py-2 font-medium">ID</th>
                        <th className="px-3 py-2 font-medium">As a</th>
                        <th className="px-3 py-2 font-medium">I want</th>
                        <th className="px-3 py-2 font-medium">So that</th>
                      </tr>
                    </thead>
                    <tbody>
                      {prd.userStories.map((us) => (
                        <tr key={us.id} className="border-t border-border">
                          <td className="px-3 py-2 font-mono text-xs">{us.id}</td>
                          <td className="px-3 py-2">{us.asA}</td>
                          <td className="px-3 py-2">{us.iWant}</td>
                          <td className="px-3 py-2">{us.soThat}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="space-y-4">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Functional requirements
                </h2>
                <ul className="space-y-4">
                  {prd.functionalRequirements.map((fr) => (
                    <li key={fr.id} className="rounded-xl border border-border bg-card/80 p-4 shadow-sm">
                      <p className="font-semibold text-foreground">
                        {fr.id}: {fr.title}
                      </p>
                      {fr.details.length > 0 ? (
                        <ul className="mt-2 list-inside list-disc text-sm text-foreground/90">
                          {fr.details.map((d) => (
                            <li key={d}>{d}</li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>

              <section className="space-y-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Non-functional requirements
                </h2>
                <ul className="list-inside list-disc space-y-1.5 text-foreground/90 marker:text-primary">
                  {prd.nonFunctionalRequirements.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </section>

              <section className="space-y-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Tech stack</h2>
                <ul className="flex flex-wrap gap-2">
                  {prd.techStack.map((tech) => (
                    <li key={`${tech.category}:${tech.name}`}>
                      <Badge variant="outline" style={getDynamicBadgeStyle(tech)} className="border-transparent shadow-sm">
                        {tech.name}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="space-y-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Assumptions</h2>
                <ul className="list-inside list-disc space-y-1.5 text-foreground/90 marker:text-primary">
                  {prd.assumptions.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              </section>

              <section className="space-y-3 pb-4">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Risks</h2>
                <ul className="list-inside list-disc space-y-1.5 text-foreground/90 marker:text-primary">
                  {prd.risks.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </section>
            </article>
            </div>
          ) : null}

          {activeTab === "spec" ? (
            <div className="rounded-md border border-border bg-card">
            <div className="grid min-h-[420px] grid-cols-1 md:grid-cols-[220px_minmax(0,1fr)]">
              <aside className="border-b border-border p-3 md:border-r md:border-b-0">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Spec Files</p>
                <div className="space-y-1">
                  {resolvedSpecFiles.map((file) => (
                    <button
                      key={file.filename}
                      type="button"
                      onClick={() => setSelectedSpecFilename(file.filename)}
                      className={[
                        "w-full cursor-pointer rounded-sm px-2 py-1 text-left text-sm",
                        selectedSpecFile?.filename === file.filename
                          ? "bg-primary/10 text-foreground"
                          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                      ].join(" ")}
                    >
                      {file.filename}
                    </button>
                  ))}
                </div>
              </aside>
              <section className="p-4">
                {selectedSpecFile ? (
                  <>
                    <p className="mb-2 font-mono text-xs text-muted-foreground">{selectedSpecFile.filename}</p>
                    <pre className="max-h-[560px] overflow-auto whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                      {selectedSpecFile.content}
                    </pre>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">No spec files generated yet.</p>
                )}
              </section>
            </div>
            </div>
          ) : null}

          {activeTab === "tasks" ? (
            <div className="space-y-4">
            <div className="sticky top-0 z-20 -mx-2 rounded-md border border-border bg-background/95 px-2 py-2 shadow-sm backdrop-blur supports-backdrop-filter:bg-background/80">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">
                {selectedTaskIds.length} of {flatTasks.length} tasks selected
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={syncSelectionAll} disabled={flatTasks.length === 0}>
                  Select all
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedKeys(new Set())}
                  disabled={selectedKeys.size === 0}
                >
                  Clear
                </Button>
                <Button
                  type="button"
                  size="lg"
                  disabled={!canExport || selectedTaskIds.length === 0}
                  onClick={() => setExportOpen(true)}
                >
                  Export to Linear
                </Button>
              </div>
            </div>
            </div>

            <div className="space-y-2 rounded-md border border-border p-3">
              {flatTasks.length === 0 ? (
                <p className="text-sm text-muted-foreground">No tasks available yet.</p>
              ) : (
                taskCheckboxRows.map((task) => (
                  <div
                    key={task.externalKey}
                    className={[
                      "overflow-hidden rounded-md border border-border bg-card text-sm",
                      task.indentClass
                    ].join(" ")}
                  >
                    <div className="flex items-start gap-2 p-3">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={selectedKeys.has(task.externalKey)}
                        onChange={() => toggleTask(task.externalKey)}
                      />
                      <button
                        type="button"
                        onClick={() => toggleExpandedTask(task.externalKey)}
                        className="flex min-w-0 flex-1 cursor-pointer items-start justify-between gap-3 text-left"
                        aria-expanded={expandedTaskKeys.has(task.externalKey)}
                      >
                        <span className="min-w-0">
                          <span className="font-mono text-xs text-muted-foreground">
                            {task.externalKey} · {task.typeLabel}
                          </span>
                          <span className="mt-1 flex flex-wrap items-center gap-2 text-foreground">
                            {task.vpChip ? (
                              <Badge variant="outline" className="font-mono text-[10px] tracking-wide">
                                {task.vpChip}
                              </Badge>
                            ) : null}
                            <span>{task.titleForDisplay}</span>
                          </span>
                        </span>
                        <ChevronDown
                          className={[
                            "mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                            expandedTaskKeys.has(task.externalKey) ? "rotate-180" : ""
                          ].join(" ")}
                        />
                      </button>
                      {(resolveTaskFigmaUrl(task, designMap) || figmaMappedTaskKeys.has(task.externalKey)) &&
                      (() => {
                        const figmaUrl = resolveTaskFigmaUrl(task, designMap);
                        if (!figmaUrl) {
                          return (
                            <Badge variant="secondary" className="inline-flex items-center gap-1">
                              <PenTool className="h-3 w-3" />
                              Figma
                            </Badge>
                          );
                        }
                        return (
                          <a
                            href={figmaUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                            title="Open Figma design"
                          >
                            <PenTool className="h-3 w-3" />
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        );
                      })()}
                    </div>
                    {expandedTaskKeys.has(task.externalKey) ? (
                      <div className="space-y-3 border-t border-border bg-muted/20 px-3 py-3">
                        <div className="space-y-1">
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Handoff Preview
                          </p>
                          {task.description?.trim() ? (
                            <Markdown content={task.description.trim()} />
                          ) : (
                            <div className="rounded-md border border-border bg-background p-3">
                              <div className="space-y-2">
                                <div className="h-3 w-44 animate-pulse rounded bg-muted" />
                                <div className="h-3 w-full animate-pulse rounded bg-muted" />
                                <div className="h-3 w-5/6 animate-pulse rounded bg-muted" />
                              </div>
                              <p className="mt-3 text-xs text-muted-foreground">Generating implementation details...</p>
                            </div>
                          )}
                        </div>
                        {task.acceptanceCriteria.length > 0 ? (
                          <div className="space-y-1">
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              Acceptance Criteria
                            </p>
                            <ul className="space-y-1">
                              {task.acceptanceCriteria.map((criterion) => (
                                <li key={criterion} className="flex items-start gap-2 text-sm text-foreground/90">
                                  <Check className="mt-0.5 h-3.5 w-3.5 text-primary" />
                                  <span>{criterion}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                        {task.specReferences.length > 0 ? (
                          <div className="space-y-1 pt-1">
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              Spec Context
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                              {task.specReferences.map((reference) => (
                                <Badge key={reference} variant="secondary" className="text-[10px]">
                                  {reference}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ))
              )}
            </div>
            </div>
          ) : null}

          {activeTab === "rules" ? (
            <div className="space-y-3">
            {cursorRules.length === 0 ? (
              <div className="rounded-md border border-border p-5 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Generating Rules...</span>
                </div>
                <p className="mt-2 text-xs">
                  Implementation planner output will appear here once `state.cursorRules` is populated.
                </p>
              </div>
            ) : (
              cursorRules.map((ruleFile) => (
                <div key={ruleFile.filename} className="rounded-md border border-border bg-card">
                  <div className="flex items-center justify-between border-b border-border px-3 py-2">
                    <p className="font-mono text-xs text-muted-foreground">{ruleFile.filename}</p>
                    <Button type="button" variant="outline" size="sm" onClick={() => void onCopyRule(ruleFile.filename, ruleFile.content)}>
                      {copiedRule === ruleFile.filename ? "Copied" : "Copy to Clipboard"}
                    </Button>
                  </div>
                  <pre className="max-h-80 overflow-auto whitespace-pre-wrap p-3 text-xs leading-relaxed text-foreground">
                    {ruleFile.content}
                  </pre>
                </div>
              ))
            )}
            </div>
          ) : null}
        </div>

        <ExportLinearDialog
          open={exportOpen}
          onOpenChange={setExportOpen}
          sessionId={sessionId}
          projectId={projectId}
          selectedTaskIds={selectedTaskIds}
          selectedTasks={selectedTasksForExport}
          designMap={designMap}
          linearTeamDisplay={linearTeamDisplay}
          defaultLinearTeamId={defaultLinearTeamId}
        />
      </CardContent>
    </Card>
  );
}
