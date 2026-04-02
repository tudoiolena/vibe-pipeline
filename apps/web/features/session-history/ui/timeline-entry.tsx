"use client";

import { ExternalLink, LayoutTemplate, Sparkles, User } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type TimelineEntryRole = "user" | "assistant" | "system";

type TimelineEntryProps = {
  role: TimelineEntryRole;
  /** Short label shown on the left of the header row (e.g. You, Assistant). */
  senderLabel: string;
  /** ISO timestamp; formatted as local time on the right. */
  timeIso: string;
  align: "left" | "right" | "center";
  children: ReactNode;
  className?: string;
  bubbleClassName?: string;
};

function roleIcon(role: TimelineEntryRole) {
  if (role === "user") {
    return <User className="size-4" strokeWidth={2} aria-hidden />;
  }
  if (role === "assistant") {
    return <Sparkles className="size-4" strokeWidth={2} aria-hidden />;
  }
  return null;
}

export function formatTimelineTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return "—";
  }
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function TimelineEntry({
  role,
  senderLabel,
  timeIso,
  align,
  children,
  className,
  bubbleClassName
}: TimelineEntryProps) {
  const icon = roleIcon(role);
  const time = formatTimelineTime(timeIso);

  const header = (
    <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px] font-medium tabular-nums">
      <span
        className={cn(
          "text-[10px] font-semibold uppercase tracking-wide",
          role === "user" && "text-primary/80",
          role === "assistant" && "text-muted-foreground",
          role === "system" && "text-muted-foreground"
        )}
      >
        {senderLabel}
      </span>
      <time dateTime={timeIso} className="shrink-0 text-muted-foreground">
        {time}
      </time>
    </div>
  );

  if (align === "center") {
    return (
      <div className={cn("w-full", className)}>
        <div className="mx-auto max-w-lg px-1">
          {header}
          <div className={bubbleClassName}>{children}</div>
        </div>
      </div>
    );
  }

  const row = (
    <div
      className={cn(
        "flex gap-2",
        align === "right" ? "flex-row-reverse justify-start" : "flex-row justify-start"
      )}
    >
      {icon ? (
        <div
          className={cn(
            "mt-1 flex size-8 shrink-0 items-center justify-center rounded-full ring-1",
            role === "user" && "bg-primary/15 text-primary ring-primary/20",
            role === "assistant" && "bg-muted text-muted-foreground ring-border"
          )}
          aria-hidden
        >
          {icon}
        </div>
      ) : null}
      <div className={cn("min-w-0 max-w-[min(100%,28rem)] flex-1", align === "right" && "flex flex-col items-end")}>
        {header}
        <div
          className={cn(
            align === "right" ? "rounded-2xl rounded-tr-md bg-primary/5 px-4 py-3 shadow-sm ring-1 ring-primary/10" : "",
            align === "left"
              ? "rounded-2xl rounded-tl-md bg-muted/50 px-4 py-3 shadow-sm ring-1 ring-border/60 dark:bg-muted/25"
              : "",
            bubbleClassName
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );

  return <div className={cn(className)}>{row}</div>;
}

const FIGMA_URL_RE = /https:\/\/(?:www\.)?figma\.com\/[^\s)\]>"']+/gi;

export function extractFigmaUrls(text: string): string[] {
  const m = text.match(FIGMA_URL_RE);
  if (!m) {
    return [];
  }
  return [...new Set(m.map((u) => u.replace(/[.,;]+$/, "")))];
}

export function stripFigmaUrls(text: string): string {
  return text
    .replace(new RegExp(FIGMA_URL_RE.source, "gi"), "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type TextPart = { kind: "text"; value: string } | { kind: "figma"; url: string };

export function splitTextWithFigmaUrls(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  FIGMA_URL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  const re = new RegExp(FIGMA_URL_RE.source, "gi");
  while ((match = re.exec(text)) !== null) {
    const start = match.index;
    if (start > last) {
      const chunk = text.slice(last, start);
      if (chunk.length > 0) {
        parts.push({ kind: "text", value: chunk });
      }
    }
    const url = match[0].replace(/[.,;]+$/, "");
    parts.push({ kind: "figma", url });
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    parts.push({ kind: "text", value: text.slice(last) });
  }
  if (parts.length === 0) {
    return [{ kind: "text", value: text }];
  }
  return parts;
}

function figmaCardTitle(url: string): string {
  try {
    const u = new URL(url);
    const seg = u.pathname.split("/").filter(Boolean);
    if (seg.length >= 2 && seg[0] === "design") {
      return decodeURIComponent(seg[2] ?? "Figma file").replace(/-/g, " ");
    }
    if (seg.length >= 2 && seg[0] === "make") {
      return decodeURIComponent(seg[1] ?? "Figma Make").replace(/-/g, " ");
    }
  } catch {
    /* ignore */
  }
  return "Figma design";
}

export function FigmaDesignPreviewCard({ url }: { url: string }) {
  const title = figmaCardTitle(url);
  return (
    <Link
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "mt-2 flex items-center gap-3 rounded-xl border border-border/80 bg-card/80 px-3 py-2.5 text-left shadow-sm",
        "ring-1 ring-border/40 transition-colors hover:bg-accent/40 hover:ring-primary/25"
      )}
    >
      <span
        className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-violet-500/15 text-violet-700 ring-1 ring-violet-500/25 dark:bg-violet-500/20 dark:text-violet-200"
        aria-hidden
      >
        <LayoutTemplate className="size-5" strokeWidth={2} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold text-foreground">Design preview</span>
        <span className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">{title}</span>
      </span>
      <ExternalLink className="size-4 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}

/** First up to `maxLabels` short labels from bullets / numbered lines for summary chips. */
export function inferUserContentSummary(text: string, maxLabels = 4): string {
  const lines = text
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const labels: string[] = [];
  for (const line of lines) {
    const bullet = line.match(/^[-*•]\s*(.+)$/);
    const numbered = line.match(/^\d+[.)]\s*(.+)$/);
    const raw = (bullet?.[1] ?? numbered?.[1] ?? "").trim();
    if (raw.length > 0 && raw.length < 80) {
      labels.push(raw);
    }
    if (labels.length >= maxLabels) {
      break;
    }
  }
  if (labels.length > 0) {
    const shown = labels.slice(0, 3);
    const extra = labels.length > 3 ? ` +${labels.length - 3}` : "";
    return `Project parameters updated (${shown.join(", ")}${extra})`;
  }
  const first = lines[0] ?? text.trim();
  const short = first.length > 72 ? `${first.slice(0, 69)}…` : first;
  return short.length > 0 ? `Update: ${short}` : "Clarification";
}

export function gapsListSummary(titles: string[]): string {
  if (titles.length === 0) {
    return "Gap analysis updated.";
  }
  const head = titles.slice(0, 4).join(", ");
  const tail = titles.length > 4 ? ` +${titles.length - 4} more` : "";
  return `Missing project gaps: ${head}${tail}`;
}

type CollapsibleBlockProps = {
  summary: string;
  /** Full rich content (caller may include figma cards outside). */
  children: ReactNode;
  collapsedContent: ReactNode;
  className?: string;
};

export function CollapsibleTimelineBlock({
  summary,
  children,
  collapsedContent,
  className
}: CollapsibleBlockProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={className}>
      {!expanded ? (
        <div className="space-y-2">
          <p className="text-[11px] font-medium leading-snug text-muted-foreground">{summary}</p>
          <div className="text-sm leading-relaxed text-foreground">{collapsedContent}</div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-auto px-0 py-1 text-xs font-normal text-primary hover:bg-transparent"
            onClick={() => setExpanded(true)}
          >
            Show more
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {children}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-auto px-0 py-1 text-xs font-normal text-primary hover:bg-transparent"
            onClick={() => setExpanded(false)}
          >
            Show less
          </Button>
        </div>
      )}
    </div>
  );
}

type CollapsibleTextWithFigmaProps = {
  text: string;
  summary: string;
  /** When false, skip collapsible (short content). */
  collapsible: boolean;
};

export function CollapsibleTextWithFigma({ text, summary, collapsible }: CollapsibleTextWithFigmaProps) {
  const parts = useMemo(() => splitTextWithFigmaUrls(text), [text]);
  const figmaUrls = useMemo(() => extractFigmaUrls(text), [text]);
  const textOnly = useMemo(() => stripFigmaUrls(text), [text]);

  const body = (
    <div className="space-y-2">
      {parts.map((p, i) =>
        p.kind === "figma" ? (
          <FigmaDesignPreviewCard key={`${p.url}-${i}`} url={p.url} />
        ) : (
          <div key={i} className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
            {p.value.trim() ? p.value : null}
          </div>
        )
      )}
    </div>
  );

  const collapsedInner = (
    <div className="space-y-2">
      {textOnly.trim().length > 0 ? (
        <p className="line-clamp-3 whitespace-pre-wrap text-sm leading-relaxed text-foreground">{textOnly}</p>
      ) : null}
      {figmaUrls.map((url) => (
        <FigmaDesignPreviewCard key={`collapsed-${url}`} url={url} />
      ))}
    </div>
  );

  if (!collapsible) {
    return <div className="space-y-2">{body}</div>;
  }

  return (
    <CollapsibleTimelineBlock summary={summary} collapsedContent={collapsedInner}>
      {body}
    </CollapsibleTimelineBlock>
  );
}
