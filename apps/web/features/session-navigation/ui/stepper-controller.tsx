"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { SessionProgressStepper } from "@/shared/ui/session-progress-stepper";

export const STAGE_MAP = ["intake", "analysis", "clarify", "prd"] as const;

export type StepperStage = (typeof STAGE_MAP)[number];

type StepperControllerProps = {
  sessionId: string;
  projectId: string;
  activeIndex: number;
  className?: string;
};

export function StepperController({ sessionId, projectId, activeIndex, className }: StepperControllerProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pendingIndex, setPendingIndex] = useState<number | null>(null);

  const handleStepClick = useCallback(
    async (index: number) => {
      const stage = STAGE_MAP[index];
      if (!stage) {
        return;
      }
      setError(null);
      setPendingIndex(index);
      try {
        const res = await fetch(`/api/pipeline/session/${sessionId}/jump`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stage, projectId })
        });
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          setError(payload.error ?? `Request failed (${res.status})`);
          return;
        }
        router.refresh();
      } catch {
        setError("Network error while updating stage.");
      } finally {
        setPendingIndex(null);
      }
    },
    [projectId, router, sessionId]
  );

  return (
    <div className={className}>
      <SessionProgressStepper
        activeIndex={activeIndex}
        onStepClick={handleStepClick}
        allowForwardJump
      />
      {pendingIndex !== null ? (
        <p className="mt-2 text-center text-xs text-muted-foreground" aria-live="polite">
          Updating stage…
        </p>
      ) : null}
      {error ? (
        <p className="mt-2 text-center text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
