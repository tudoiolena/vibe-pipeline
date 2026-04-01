"use client";

import { Fragment } from "react";
import { Check } from "lucide-react";
import { SESSION_STEPPER_STEPS } from "@/lib/session-progress";
import { cn } from "@/lib/utils";

const STEP_COUNT = SESSION_STEPPER_STEPS.length;

type SessionProgressStepperProps = {
  activeIndex: number;
  className?: string;
  /** Called when the user activates a clickable step (past steps, and future steps if `allowForwardJump`). */
  onStepClick?: (index: number) => void;
  /**
   * When true, steps after the current one are also clickable.
   * Default false so users can only go back unless you opt in.
   */
  allowForwardJump?: boolean;
};

export function SessionProgressStepper({
  activeIndex,
  className,
  onStepClick,
  allowForwardJump = false
}: SessionProgressStepperProps) {
  const safeIndex = Math.min(Math.max(activeIndex, 0), STEP_COUNT - 1);

  return (
    <nav aria-label="Session progress" className={cn("w-full", className)}>
      <ol className="m-0 flex w-full list-none flex-wrap items-center justify-center gap-y-4 p-0 sm:flex-nowrap sm:justify-between">
        {SESSION_STEPPER_STEPS.map((label, index) => {
          const isComplete = index < safeIndex;
          const isCurrent = index === safeIndex;
          const isClickable =
            Boolean(onStepClick) &&
            !isCurrent &&
            (index < safeIndex || allowForwardJump);

          const circleClassName = cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold tabular-nums transition-colors",
            isComplete && "border-primary bg-primary text-primary-foreground",
            isCurrent && !isComplete && "border-primary bg-primary/15 text-primary",
            !isComplete && !isCurrent && "border-muted-foreground/25 bg-muted/50 text-muted-foreground"
          );

          const labelId = `session-progress-step-${index}-label`;
          const stepPosition = `Step ${index + 1} of ${STEP_COUNT}`;

          return (
            <Fragment key={label}>
              {index > 0 ? (
                <li
                  aria-hidden
                  className={cn(
                    "mx-2 hidden h-0.5 min-w-[1.5rem] flex-1 sm:list-item sm:block",
                    index <= safeIndex ? "bg-primary" : "bg-border"
                  )}
                />
              ) : null}
              <li
                className="flex min-w-0 flex-col items-center gap-1.5 text-center"
                aria-posinset={index + 1}
                aria-setsize={STEP_COUNT}
              >
                {isClickable ? (
                  <button
                    type="button"
                    className={cn(
                      circleClassName,
                      "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                      isComplete && "hover:bg-primary/90",
                      !isComplete && "hover:border-primary/40 hover:bg-primary/20"
                    )}
                    aria-label={`${label}, ${stepPosition}${isComplete ? ", completed" : ""}. Go to this stage.`}
                    onClick={() => onStepClick?.(index)}
                  >
                    {isComplete ? (
                      <Check className="h-4 w-4 shrink-0" strokeWidth={2.5} aria-hidden />
                    ) : (
                      index + 1
                    )}
                  </button>
                ) : (
                  <span
                    className={circleClassName}
                    aria-current={isCurrent ? "step" : undefined}
                    aria-label={
                      isCurrent
                        ? `${label}, ${stepPosition}, current stage`
                        : `${label}, ${stepPosition}${isComplete ? ", completed" : ", not yet reached"}`
                    }
                  >
                    {isComplete ? (
                      <Check className="h-4 w-4 shrink-0" strokeWidth={2.5} aria-hidden />
                    ) : (
                      index + 1
                    )}
                  </span>
                )}
                <span
                  id={labelId}
                  className={cn(
                    "max-w-[5.25rem] text-[11px] font-medium leading-tight sm:max-w-none sm:text-xs",
                    isCurrent ? "text-foreground" : "text-muted-foreground"
                  )}
                >
                  {label}
                </span>
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
