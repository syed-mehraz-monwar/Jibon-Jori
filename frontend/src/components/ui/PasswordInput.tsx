import { forwardRef, useState, type InputHTMLAttributes } from "react";
import { cn } from "../../lib/cn";
import { inputClasses } from "./Input";

export type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  invalid?: boolean;
};

/**
 * Password field with an accessible show/hide toggle.
 *
 * The toggle is a real `<button type="button">` inside the field, so it never
 * submits the form, is reachable by keyboard, and carries an `aria-label` that
 * flips between "Show password" and "Hide password" while `aria-pressed`
 * reports the current state. Switching the `type` keeps focus on the toggle and
 * the input's value untouched, so a member can check what they typed and
 * continue typing without losing their place.
 */
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(function PasswordInput(
  { invalid, className, ...rest },
  ref
) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        ref={ref}
        type={visible ? "text" : "password"}
        aria-invalid={invalid || undefined}
        className={cn(inputClasses(invalid), "pr-12", className)}
        {...rest}
      />
      <button
        type="button"
        onClick={() => setVisible((current) => !current)}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        title={visible ? "Hide password" : "Show password"}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-slate-500 transition hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-5 w-5"
        >
          <path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z" />
          <circle cx="12" cy="12" r="2.75" />
          {visible ? <path d="M4 20 20 4" /> : null}
        </svg>
      </button>
    </div>
  );
});
