import { useEffect, useId, useMemo, useRef, useState } from "react";
import { cn } from "../../lib/cn";
import { inputClasses } from "./Input";

export type SearchableOption = { value: string; label: string };

/**
 * Searchable single-select.
 *
 * Used where an option set is long enough that scrolling a plain `<select>` is
 * unpleasant on a phone (education, profession, religion). It keeps the native
 * text input for typing — and therefore the platform keyboard, autocorrect and
 * accessibility behaviour — and renders the filtered options in a listbox.
 *
 * `allowCustom` accepts a value that is not in the list (religion stays free
 * text). Without it, only listed values can be committed, so a slip of the
 * keyboard cannot store an invalid reference id.
 */
export function SearchableSelect({
  id,
  value,
  onChange,
  options,
  placeholder = "Select an option",
  allowCustom = false,
  disabled,
  invalid,
  describedBy,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  options: SearchableOption[];
  placeholder?: string;
  allowCustom?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
}) {
  const listId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const selectedLabel = useMemo(
    () => options.find((option) => option.value === value)?.label ?? (allowCustom ? value : ""),
    [options, value, allowCustom]
  );

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((option) => option.label.toLowerCase().includes(needle));
  }, [options, query]);

  function commit(next: string) {
    onChange(next);
    setOpen(false);
    setQuery("");
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((current) => Math.min(current + 1, Math.max(filtered.length - 1, 0)));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => Math.max(current - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      if (!open) return;
      event.preventDefault();
      const option = filtered[active];
      if (option) commit(option.value);
      else if (allowCustom && query.trim()) commit(query.trim());
      return;
    }
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        autoComplete="off"
        disabled={disabled}
        className={cn(inputClasses(invalid), "pr-9")}
        value={open ? query : selectedLabel}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          // Let a click on an option land first; then commit typed free text.
          window.setTimeout(() => {
            if (!wrapRef.current) return;
            setOpen(false);
            if (allowCustom && query.trim()) {
              onChange(query.trim());
              setQuery("");
            }
          }, 120);
        }}
      />
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
      >
        <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>

      {open && !disabled ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-slate-500">
              {allowCustom && query.trim() ? "Press Enter to use this value." : "No matches."}
            </li>
          ) : (
            filtered.map((option, index) => (
              <li key={option.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={option.value === value}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => commit(option.value)}
                  className={cn(
                    "flex w-full items-center px-3 py-2 text-left text-sm",
                    index === active ? "bg-brand-50 text-brand-900" : "text-slate-700 hover:bg-slate-50",
                    option.value === value && "font-semibold"
                  )}
                >
                  {option.label}
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
