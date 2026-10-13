import type { InputHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export type CheckboxProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  description?: string;
};

export function Checkbox({ label, description, className, id, ...rest }: CheckboxProps) {
  const inputId = id ?? `checkbox-${label.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <div className={cn("flex items-start gap-2.5", className)}>
      <input
        id={inputId}
        type="checkbox"
        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-200"
        {...rest}
      />
      <div className="leading-tight">
        <label htmlFor={inputId} className="text-sm font-medium text-slate-700">
          {label}
        </label>
        {description ? <p className="text-xs text-slate-500">{description}</p> : null}
      </div>
    </div>
  );
}
