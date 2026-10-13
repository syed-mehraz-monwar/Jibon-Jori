export type MultiOption = { value: string; label: string };

export function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

/**
 * Checkbox list for the API's array-valued option sets (interests, preferred
 * education/professions). Extracted from `PreferenceForm` so the profile form and the
 * preferences form render the same control rather than two drifting copies.
 */
export function MultiCheckList({
  legend,
  options,
  selected,
  onToggle,
  emptyLabel,
}: {
  legend: string;
  options: MultiOption[];
  selected: string[];
  onToggle: (value: string) => void;
  emptyLabel: string;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium text-slate-700">{legend}</legend>
      {options.length === 0 ? (
        <p className="text-xs text-slate-500">{emptyLabel}</p>
      ) : (
        <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 p-2">
          {options.map((option) => (
            <label key={option.value} className="flex items-center gap-2 py-1 text-sm text-slate-700">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-200"
                checked={selected.includes(option.value)}
                onChange={() => onToggle(option.value)}
              />
              {option.label}
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}
