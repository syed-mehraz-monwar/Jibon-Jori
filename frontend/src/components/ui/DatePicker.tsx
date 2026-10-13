import { forwardRef, type InputHTMLAttributes } from "react";
import { Input } from "./Input";

export type DatePickerProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  invalid?: boolean;
  /** Require the chosen date to be at least this many years in the past (18 for DOB). */
  minAgeYears?: number;
  /** Optional upper bound as an ISO date string. */
  maxDate?: string;
};

/** `yyyy-mm-dd` for `max`, N years before today. */
export function dateYearsAgo(years: number): string {
  const date = new Date();
  date.setFullYear(date.getFullYear() - years);
  return date.toISOString().slice(0, 10);
}

export const todayIsoDate = (): string => new Date().toISOString().slice(0, 10);

/**
 * Date picker built on the native `<input type="date">`.
 *
 * A native control is used deliberately instead of a date-picker dependency: it is
 * accessible, locale-aware and keyboard-operable on every target platform, and
 * the backend re-validates the concrete date (including the 18-year rule) anyway.
 * Server-side rules are surfaced here as `min`/`max` so the browser rejects an
 * invalid DOB before it is ever submitted.
 */
export const DatePicker = forwardRef<HTMLInputElement, DatePickerProps>(function DatePicker(
  { invalid, minAgeYears, maxDate, min, max, ...rest },
  ref
) {
  return (
    <Input
      ref={ref}
      type="date"
      invalid={invalid}
      min={min ?? (minAgeYears !== undefined ? dateYearsAgo(minAgeYears) : undefined)}
      max={max ?? maxDate ?? todayIsoDate()}
      {...rest}
    />
  );
});
