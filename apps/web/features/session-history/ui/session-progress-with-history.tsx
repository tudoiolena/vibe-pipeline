"use client";

import { History } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger
} from "@/components/ui/sheet";
import { StepperController } from "@/features/session-navigation";
import { SessionHistoryRefreshProvider } from "../context/session-history-refresh-context";
import { SessionAuditLog } from "./session-audit-log";

type SessionProgressWithHistoryProps = {
  sessionId: string;
  projectId: string;
  activeStepperIndex: number;
  children: ReactNode;
};

export function SessionProgressWithHistory({
  sessionId,
  projectId,
  activeStepperIndex,
  children
}: SessionProgressWithHistoryProps) {
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <SessionHistoryRefreshProvider>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <CardTitle className="text-base">Session progress</CardTitle>
              <CardDescription>Where you are in the pipeline for this project.</CardDescription>
            </div>
            <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
              <SheetTrigger asChild>
                <Button type="button" variant="outline" size="sm" className="shrink-0 gap-2">
                  <History className="size-4" aria-hidden />
                  History
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="flex flex-col overflow-hidden p-0">
                <SheetHeader className="border-b border-border p-6 pb-4">
                  <SheetTitle>Session history</SheetTitle>
                  <SheetDescription>Checkpoint timeline and gap changes for this session.</SheetDescription>
                </SheetHeader>
                <div className="min-h-0 flex-1 overflow-y-auto p-6 pt-4">
                  <SessionAuditLog sessionId={sessionId} embedded />
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </CardHeader>
        <CardContent>
          <StepperController sessionId={sessionId} projectId={projectId} activeIndex={activeStepperIndex} />
        </CardContent>
      </Card>
      {children}
    </SessionHistoryRefreshProvider>
  );
}
