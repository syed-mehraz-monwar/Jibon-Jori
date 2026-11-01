import { useState, type FormEvent } from "react";
import { partnerPreferencesApi } from "../../api/partner-preferences.api";
import { useReferenceData } from "../../context/ReferenceDataContext";
import { useToast } from "../../context/ToastContext";
import { ApiError } from "../../lib/http";
import { GENDER_OPTIONS } from "../../lib/profile-options";
import type { Gender, MaritalStatus, PartnerPreferences, PreferenceRule } from "../../lib/types";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Checkbox } from "../ui/Checkbox";
import { Field } from "../ui/Field";
import { Input } from "../ui/Input";
import { MultiCheckList, toggle } from "../ui/MultiCheckList";
import { Textarea } from "../ui/Textarea";

const MARITAL: { value: MaritalStatus; label: string }[] = [
  { value: "never_married", label: "Never married" },
  { value: "divorced", label: "Divorced" },
  { value: "widowed", label: "Widowed" },
  { value: "annulled", label: "Annulled" },
];

/** Comma-separated text field <-> string[] (the API takes arrays). */
function splitList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function RuleEditor({
  legend,
  value,
  onChange,
}: {
  legend: string;
  value: PreferenceRule;
  onChange: (next: PreferenceRule) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-3 rounded-xl border border-slate-200 p-4">
      <legend className="px-1 text-sm font-semibold text-slate-700">{legend}</legend>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Minimum height (cm)" htmlFor={`${legend}-minHeight`}>
          <Input
            id={`${legend}-minHeight`}
            type="number"
            min={100}
            max={250}
            value={value.minHeightCm ?? ""}
            onChange={(event) =>
              onChange({ ...value, minHeightCm: event.target.value === "" ? undefined : Number(event.target.value) })
            }
          />
        </Field>
        <Field label="Maximum height (cm)" htmlFor={`${legend}-maxHeight`}>
          <Input
            id={`${legend}-maxHeight`}
            type="number"
            min={100}
            max={250}
            value={value.maxHeightCm ?? ""}
            onChange={(event) =>
              onChange({ ...value, maxHeightCm: event.target.value === "" ? undefined : Number(event.target.value) })
            }
          />
        </Field>
      </div>

      <Field
        label="Religions"
        htmlFor={`${legend}-religions`}
        hint="Comma-separated, up to 30."
      >
        <Input
          id={`${legend}-religions`}
          value={(value.religions ?? []).join(", ")}
          onChange={(event) => onChange({ ...value, religions: splitList(event.target.value) })}
        />
      </Field>

      <fieldset className="flex flex-wrap gap-3">
        <legend className="w-full text-sm font-medium text-slate-700">Marital statuses</legend>
        {MARITAL.map((option) => (
          <label key={option.value} className="flex items-center gap-1.5 text-sm text-slate-700">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-200"
              checked={(value.maritalStatuses ?? []).includes(option.value)}
              onChange={() =>
                onChange({
                  ...value,
                  maritalStatuses: toggle(value.maritalStatuses ?? [], option.value) as MaritalStatus[],
                })
              }
            />
            {option.label}
          </label>
        ))}
      </fieldset>

      <Checkbox
        label="Require a verified contact"
        checked={value.requiresVerifiedContact ?? false}
        onChange={(event) => onChange({ ...value, requiresVerifiedContact: event.target.checked })}
      />

      <Field label="Notes" htmlFor={`${legend}-notes`} hint="Up to 500 characters.">
        <Textarea
          id={`${legend}-notes`}
          rows={2}
          maxLength={500}
          value={value.notes ?? ""}
          onChange={(event) => onChange({ ...value, notes: event.target.value })}
        />
      </Field>
    </fieldset>
  );
}

export function PreferenceForm({
  preferences,
  onSaved,
}: {
  preferences: PartnerPreferences | null;
  onSaved: () => void;
}) {
  const toast = useToast();
  const reference = useReferenceData();

  const [ageMin, setAgeMin] = useState(preferences?.ageMin?.toString() ?? "");
  const [ageMax, setAgeMax] = useState(preferences?.ageMax?.toString() ?? "");
  const [genders, setGenders] = useState<string[]>(preferences?.genders ?? []);
  const [educationIds, setEducationIds] = useState<string[]>(preferences?.educationIds ?? []);
  const [professionIds, setProfessionIds] = useState<string[]>(preferences?.professionIds ?? []);
  const [locations, setLocations] = useState((preferences?.locations ?? []).join(", "));
  const [mustHave, setMustHave] = useState<PreferenceRule>(preferences?.mustHave ?? {});
  const [dealbreakers, setDealbreakers] = useState<PreferenceRule>(preferences?.dealbreakers ?? {});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);

    if (ageMin && ageMax && Number(ageMin) > Number(ageMax)) {
      setFormError("Minimum age cannot be greater than maximum age.");
      return;
    }
    if (
      mustHave.minHeightCm !== undefined &&
      mustHave.maxHeightCm !== undefined &&
      mustHave.minHeightCm > mustHave.maxHeightCm
    ) {
      setFormError("'Must have' minimum height cannot exceed its maximum.");
      return;
    }

    const payload = {
      ...(ageMin ? { ageMin: Number(ageMin) } : {}),
      ...(ageMax ? { ageMax: Number(ageMax) } : {}),
      genders: genders as Gender[],
      educationIds,
      professionIds,
      locations: splitList(locations),
      mustHave,
      dealbreakers,
    };

    setSaving(true);
    try {
      await partnerPreferencesApi.upsertMine(payload);
      toast.success("Partner preferences saved.");
      onSaved();
    } catch (caught) {
      if (caught instanceof ApiError && caught.isValidation && caught.issues.length > 0) {
        setFormError(caught.issues.map((issue) => `${issue.path}: ${issue.message}`).join(" "));
      } else {
        setFormError(caught instanceof ApiError ? caught.message : "Could not save your preferences.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="flex flex-col gap-5" onSubmit={onSubmit} noValidate>
      <Card title="Basic preferences">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Minimum age" htmlFor="ageMin" hint="18 to 100.">
            <Input
              id="ageMin"
              type="number"
              min={18}
              max={100}
              value={ageMin}
              onChange={(event) => setAgeMin(event.target.value)}
            />
          </Field>
          <Field label="Maximum age" htmlFor="ageMax" hint="18 to 100.">
            <Input
              id="ageMax"
              type="number"
              min={18}
              max={100}
              value={ageMax}
              onChange={(event) => setAgeMax(event.target.value)}
            />
          </Field>
        </div>

        <fieldset className="mt-4 flex flex-wrap gap-4">
          <legend className="w-full text-sm font-medium text-slate-700">Preferred genders</legend>
          {GENDER_OPTIONS.map((option) => (
            <label key={option.value} className="flex items-center gap-1.5 text-sm text-slate-700">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-200"
                checked={genders.includes(option.value)}
                onChange={() => setGenders((current) => toggle(current, option.value))}
              />
              {option.label}
            </label>
          ))}
        </fieldset>
      </Card>

      <Card title="Education, profession and locations">
        <div className="grid gap-5 sm:grid-cols-2">
          <MultiCheckList
            legend="Preferred education levels"
            options={(reference.data?.educationLevels ?? []).map((item) => ({
              value: item.id,
              label: item.label,
            }))}
            selected={educationIds}
            onToggle={(value) => setEducationIds((current) => toggle(current, value))}
            emptyLabel="Reference data is still loading."
          />
          <MultiCheckList
            legend="Preferred professions"
            options={(reference.data?.professions ?? []).map((item) => ({
              value: item.id,
              label: item.label,
            }))}
            selected={professionIds}
            onToggle={(value) => setProfessionIds((current) => toggle(current, value))}
            emptyLabel="Reference data is still loading."
          />
        </div>

        <div className="mt-4">
          <Field
            label="Preferred locations"
            htmlFor="locations"
            hint="Comma-separated, up to 100 entries."
          >
            <Input
              id="locations"
              value={locations}
              onChange={(event) => setLocations(event.target.value)}
              placeholder="Dhaka, Sylhet"
            />
          </Field>
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <RuleEditor legend="Must have" value={mustHave} onChange={setMustHave} />
        <RuleEditor legend="Dealbreakers" value={dealbreakers} onChange={setDealbreakers} />
      </div>

      {formError ? (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {formError}
        </p>
      ) : null}

      <div>
        <Button type="submit" loading={saving} size="lg">
          Save preferences
        </Button>
      </div>
    </form>
  );
}
