"use client";

import { memo } from "react";
import { useDroppable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface KanbanColumnProps {
  id: string;
  title: string;
  colorClass: string;
  count: number;
  children: ReactNode;
  headerAction?: ReactNode;
  opacity?: number;
  showBorder?: boolean;
  hideScrollbar?: boolean;
}

export const KanbanColumn = memo(function KanbanColumn({
  id,
  title,
  colorClass,
  count,
  children,
  headerAction,
  opacity = 100,
  showBorder = true,
  hideScrollbar = false,
}: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "relative flex flex-col h-full rounded-xl transition-all duration-200 w-72",
        showBorder && "border border-border/60",
        isOver && "ring-2 ring-primary/30 ring-offset-1 ring-offset-background"
      )}
      data-testid={`kanban-column-${id}`}
    >
      {/* Background layer with opacity */}
      <div
        className={cn(
          "absolute inset-0 rounded-xl backdrop-blur-sm transition-colors duration-200",
          isOver ? "bg-accent/80" : "bg-card/80"
        )}
        style={{ opacity: opacity / 100 }}
      />

      {/* Column Header */}
      <div
        className={cn(
          "relative z-10 flex items-center gap-3 px-3 py-2.5",
          showBorder && "border-b border-border/40"
        )}
      >
        <div className={cn("w-2.5 h-2.5 rounded-full shrink-0", colorClass)} />
        <h3 className="font-semibold text-sm text-foreground/90 flex-1 tracking-tight">{title}</h3>
        {headerAction}
        <span className="text-xs font-medium text-muted-foreground/80 bg-muted/50 px-2 py-0.5 rounded-md tabular-nums">
          {count}
        </span>
      </div>

      {/* Column Content */}
      <div
        className={cn(
          "relative z-10 flex-1 overflow-y-auto p-2 space-y-2.5",
          hideScrollbar &&
            "[&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]",
          // Smooth scrolling
          "scroll-smooth"
        )}
      >
        {children}
      </div>

      {/* Drop zone indicator when dragging over */}
      {isOver && (
        <div className="absolute inset-0 rounded-xl bg-primary/5 pointer-events-none z-5 border-2 border-dashed border-primary/20" />
      )}
    </div>
  );
});
