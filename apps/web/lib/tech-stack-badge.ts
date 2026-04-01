/**
 * Maps common stack strings to badge colors for a developer-first PRD view.
 */
export function techStackBadgeClassName(tech: string): string {
  const trimmed = tech.trim();
  const t = trimmed.toLowerCase();

  if (t === "go" || /\bgolang\b/i.test(trimmed)) {
    return "border-transparent bg-orange-600 text-white shadow-sm dark:bg-orange-500";
  }

  const rules: { keys: string[]; className: string }[] = [
    {
      keys: ["react", "next.js", "nextjs", "remix", "gatsby", "vue", "svelte", "angular"],
      className: "border-transparent bg-blue-600 text-white shadow-sm dark:bg-blue-500"
    },
    {
      keys: ["node", "nodejs", "express", "nestjs", "fastify", "bun", "deno"],
      className: "border-transparent bg-green-600 text-white shadow-sm dark:bg-green-600"
    },
    {
      keys: ["typescript", "javascript"],
      className: "border-transparent bg-sky-700 text-white shadow-sm dark:bg-sky-600"
    },
    {
      keys: [
        "postgres",
        "postgresql",
        "mysql",
        "redis",
        "mongo",
        "dynamodb",
        "sqlite",
        "supabase",
        "prisma",
        "drizzle"
      ],
      className:
        "border-transparent bg-amber-500 text-amber-950 shadow-sm dark:bg-amber-600 dark:text-amber-50"
    },
    {
      keys: ["python", "django", "fastapi", "flask"],
      className: "border-transparent bg-yellow-500 text-yellow-950 shadow-sm dark:bg-yellow-600 dark:text-yellow-50"
    },
    {
      keys: ["kotlin", "java", "rust", "swift"],
      className: "border-transparent bg-orange-600 text-white shadow-sm dark:bg-orange-500"
    },
    {
      keys: ["aws", "gcp", "azure", "terraform", "kubernetes", "k8s", "docker"],
      className: "border-transparent bg-violet-600 text-white shadow-sm dark:bg-violet-500"
    },
    {
      keys: ["tailwind", "css", "sass", "scss"],
      className: "border-transparent bg-cyan-600 text-white shadow-sm dark:bg-cyan-500"
    }
  ];

  for (const { keys, className } of rules) {
    if (keys.some((k) => t.includes(k))) {
      return className;
    }
  }

  return "border-border bg-secondary/90 text-secondary-foreground";
}
