import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export type InputProps = InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean };

export const inputClasses = (invalid?: boolean) =>
  cn(
    "w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:outline-none focus:ring-2 disabled:bg-slate-50 disabled:text-slate-500",
    invalid
      ? "border-red-300 focus:border-red-400 focus:ring-red-200"
      : "border-slate-300 focus:border-brand-500 focus:ring-brand-200"
  );

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid, className, ...rest },
  ref
) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(inputClasses(invalid), className)}
      {...rest}
    />
  );
});
