import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export type FieldProps = {
  label: string;
  htmlFor?: string;
  error?: string | null;
  hint?: ReactNode;
  required?: boolean;
  className?: string;
  children: ReactNode;
};

/**
 * Label + control + error/hint wrapper.
 *
 * The error text is rendered next to the control and announced with `role="alert"`,
 * and `aria-invalid` is set by the controls themselves, so validation is
 * perceivable and not colour-only.
 */
export function Field({ label, htmlFor, error, hint, required, className, children }: FieldProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-sm font-medium text-slate-700">
        {label}
        {required ? <span className="ml-0.5 text-brand-600">*</span> : null}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
}
