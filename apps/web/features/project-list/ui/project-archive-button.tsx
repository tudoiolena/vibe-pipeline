"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

type ProjectArchiveButtonProps = {
  projectId: string;
  projectName: string;
};

export function ProjectArchiveButton({ projectId, projectName }: ProjectArchiveButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function onArchive() {
    const ok = window.confirm(
      `Archive “${projectName}”? It will disappear from the dashboard list; data stays in the database.`
    );
    if (!ok) {
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/archive`, { method: "POST" });
      const body: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message =
          typeof body === "object" && body !== null && "error" in body
            ? String((body as { error?: unknown }).error ?? res.statusText)
            : res.statusText;
        throw new Error(message);
      }
      router.refresh();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button type="button" variant="ghost" size="sm" className="shrink-0 text-muted-foreground" disabled={loading} onClick={() => void onArchive()}>
      {loading ? "Archiving…" : "Archive"}
    </Button>
  );
}
