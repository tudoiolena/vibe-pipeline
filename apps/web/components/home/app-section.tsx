import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type AppSectionProps = {
  overline?: string;
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
};

export function AppSection({ overline, title, description, children, className }: AppSectionProps) {
  return (
    <section className={cn("flex flex-col gap-4", className)}>
      {overline ? (
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{overline}</p>
      ) : null}
      {title ? <h2 className="text-lg font-semibold tracking-tight">{title}</h2> : null}
      {description ? <p className="max-w-2xl text-sm text-muted-foreground">{description}</p> : null}
      {children}
    </section>
  );
}
