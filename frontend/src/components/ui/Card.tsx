import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export function Card({
  title,
  actions,
  children,
  className,
  as: Tag = "section",
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  as?: "section" | "article" | "div";
}) {
  return (
    <Tag
      className={cn(
        "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6",
        className
      )}
    >
      {title || actions ? (
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
          {title ? <h2 className="text-lg font-semibold text-slate-900">{title}</h2> : null}
          {actions}
        </header>
      ) : null}
      {children}
    </Tag>
  );
}
