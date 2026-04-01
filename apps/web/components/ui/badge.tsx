import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "border-border text-foreground",
        priorityHigh: "border-transparent bg-red-600 text-white dark:bg-red-700",
        priorityMed: "border-transparent bg-amber-500 text-amber-950 dark:bg-amber-600 dark:text-amber-50",
        priorityLow: "border-transparent bg-slate-500 text-white dark:bg-slate-600"
      }
    },
    defaultVariants: {
      variant: "default"
    }
  }
);

type BadgeProps = React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof badgeVariants>;

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
