"use client";

import { createContext, useContext, useMemo, useState, type HTMLAttributes, type ReactNode } from "react";

type TabsContextValue = {
  value: string;
  setValue: (next: string) => void;
};

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext(): TabsContextValue {
  const ctx = useContext(TabsContext);
  if (!ctx) {
    throw new Error("Tabs components must be used within <Tabs>.");
  }
  return ctx;
}

type TabsProps = {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  className?: string;
  children: ReactNode;
};

export function Tabs({ value, defaultValue, onValueChange, className, children }: TabsProps) {
  const [internalValue, setInternalValue] = useState(defaultValue ?? "");
  const currentValue = value ?? internalValue;

  const context = useMemo<TabsContextValue>(
    () => ({
      value: currentValue,
      setValue: (next) => {
        if (value === undefined) {
          setInternalValue(next);
        }
        onValueChange?.(next);
      }
    }),
    [currentValue, onValueChange, value]
  );

  return (
    <TabsContext.Provider value={context}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

export function TabsList({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={[
        "inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground",
        className ?? ""
      ].join(" ")}
      {...props}
    />
  );
}

type TabsTriggerProps = HTMLAttributes<HTMLButtonElement> & {
  value: string;
};

export function TabsTrigger({ value, className, children, ...props }: TabsTriggerProps) {
  const { value: currentValue, setValue } = useTabsContext();
  const active = currentValue === value;

  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      data-state={active ? "active" : "inactive"}
      className={[
        "inline-flex h-8 cursor-pointer items-center justify-center rounded-sm px-3 text-sm font-medium whitespace-nowrap ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
        "data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm",
        className ?? ""
      ].join(" ")}
      onClick={() => setValue(value)}
      {...props}
    >
      {children}
    </button>
  );
}

type TabsContentProps = HTMLAttributes<HTMLDivElement> & {
  value: string;
};

export function TabsContent({ value, children, ...props }: TabsContentProps) {
  const { value: currentValue } = useTabsContext();
  if (currentValue !== value) {
    return null;
  }
  return (
    <div role="tabpanel" {...props}>
      {children}
    </div>
  );
}
