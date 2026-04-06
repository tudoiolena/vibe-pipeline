import { cn } from "@/lib/utils";

export type PageHeroProps = {
  eyebrow?: string;
  title: string;
  subtitle: string;
  className?: string;
};

export function PageHero({ eyebrow, title, subtitle, className }: PageHeroProps) {
  return (
    <section
      aria-labelledby="home-hero-title"
      className={cn(
        "border border-border bg-[var(--surface-muted)] px-[var(--pad-section-x)] py-[var(--pad-section-y)]",
        "rounded-[var(--radius-hero)]",
        className
      )}
    >
      {eyebrow ? (
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">{eyebrow}</p>
      ) : null}
      <h2 id="home-hero-title" className="text-balance text-2xl font-semibold tracking-tight md:text-3xl">
        {title}
      </h2>
      <p className="mt-2 max-w-2xl text-pretty text-base text-muted-foreground">{subtitle}</p>
    </section>
  );
}
