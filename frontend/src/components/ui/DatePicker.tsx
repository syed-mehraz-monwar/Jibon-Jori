import { forwardRef, type InputHTMLAttributes } from "react";
import { Input } from "./Input";

export type DatePickerProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  invalid?: boolean;
  /** Optional upper bound as an ISO date string; defaults to today. */
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
 *
 * Bounds are always supplied explicitly by the caller. An earlier version
 * derived `min` from "today minus 18 years", which marked that date as the
 * *earliest* selectable value and made every older birth date unselectable —
 * the reason members could not enter their date of birth. For a date of birth the
 * floor is a fixed past date and the 18-year rule is the `max`.
 */
export const DatePicker = forwardRef<HTMLInputElement, DatePickerProps>(function DatePicker(
  { invalid, maxDate, max, ...rest },
  ref
) {
  return <Input ref={ref} type="date" invalid={invalid} max={max ?? maxDate ?? todayIsoDate()} {...rest} />;
});
