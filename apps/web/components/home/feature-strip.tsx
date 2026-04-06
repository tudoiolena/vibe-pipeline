import { cn } from "@/lib/utils";

export type FeatureStripItem = {
  title: string;
  description: string;
};

export type FeatureStripProps = {
  items: FeatureStripItem[];
  className?: string;
};

export function FeatureStrip({ items, className }: FeatureStripProps) {
  return (
    <section aria-label="How it works" className={cn(className)}>
      <ul className="grid gap-4 md:grid-cols-3">
        {items.map((item) => (
          <li
            key={item.title}
            className="rounded-[var(--radius-card)] border border-border bg-card p-[var(--pad-panel)] shadow-[var(--shadow-panel)]"
          >
            <h3 className="text-sm font-semibold leading-none">{item.title}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{item.description}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
