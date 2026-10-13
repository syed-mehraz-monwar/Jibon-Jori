import { useState, type FormEvent } from "react";
import { profileApi } from "../../api/profile.api";
import { useReferenceData } from "../../context/ReferenceDataContext";
import { useToast } from "../../context/ToastContext";
import { ApiError } from "../../lib/http";
import { toDateInputValue } from "../../lib/format";
import { dobError, heightError, requiredTextError } from "../../lib/validation";
import type { Gender, MaritalStatus, PhotoVisibility, Profile, ProfileInput } from "../../lib/types";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Checkbox } from "../ui/Checkbox";
import { DatePicker } from "../ui/DatePicker";
import { Field } from "../ui/Field";
import { Input } from "../ui/Input";
import { MultiCheckList, toggle } from "../ui/MultiCheckList";
import { Select } from "../ui/Select";
import { Textarea } from "../ui/Textarea";
import { LocationPicker, type LocationValue } from "../map/LocationPicker";

const GENDERS: { value: Gender; label: string }[] = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "other", label: "Other" },
];

const MARITAL: { value: MaritalStatus; label: string }[] = [
  { value: "never_married", label: "Never married" },
  { value: "divorced", label: "Divorced" },
  { value: "widowed", label: "Widowed" },
  { value: "annulled", label: "Annulled" },
];

const VISIBILITY: { value: PhotoVisibility; label: string }[] = [
  { value: "public", label: "Anyone" },
  { value: "members", label: "Signed-in members" },
  { value: "private", label: "Only me" },
];

const LIFESTYLE_OPTIONS = {
  smoking: ["never", "occasionally", "regularly"],
  drinking: ["never", "occasionally", "regularly"],
  diet: ["vegetarian", "non_vegetarian", "eggetarian", "vegan"],
};

function lifestyleString(profile: Profile | null, key: string): string {
  const value = profile?.lifestyle?.[key];
  return typeof value === "string" ? value : "";
}

export function ProfileForm({
  profile,
  onSaved,
}: {
  profile: Profile | null;
  onSaved: () => void;
}) {
  const toast = useToast();
  const reference = useReferenceData();

  const [displayName, setDisplayName] = useState(profile?.displayName ?? "");
  const [dob, setDob] = useState(toDateInputValue(profile?.dob));
  const [gender, setGender] = useState<Gender | "">(profile?.gender ?? "");
  const [heightCm, setHeightCm] = useState<string>(profile?.heightCm?.toString() ?? "");
  const [maritalStatus, setMaritalStatus] = useState<MaritalStatus | "">(profile?.maritalStatus ?? "");
  const [religion, setReligion] = useState(profile?.religion ?? "");
  const [casteCommunity, setCasteCommunity] = useState(profile?.casteCommunity ?? "");
  const [educationId, setEducationId] = useState(profile?.education?.id ?? "");
  const [educationDetail, setEducationDetail] = useState(profile?.educationDetail ?? "");
  const [professionId, setProfessionId] = useState(profile?.profession?.id ?? "");
  const [professionDetail, setProfessionDetail] = useState(profile?.professionDetail ?? "");
  const [incomeBand, setIncomeBand] = useState(profile?.incomeBand ?? "");
  const [city, setCity] = useState(profile?.city ?? "");
  const [district, setDistrict] = useState(profile?.district ?? "");
  const [country, setCountry] = useState(profile?.country ?? "Bangladesh");
  const [about, setAbout] = useState(profile?.about ?? "");
  const [interestIds, setInterestIds] = useState<string[]>(
    profile?.interests?.map((interest) => interest.id) ?? []
  );
  const [smoking, setSmoking] = useState(lifestyleString(profile, "smoking"));
  const [drinking, setDrinking] = useState(lifestyleString(profile, "drinking"));
  const [diet, setDiet] = useState(lifestyleString(profile, "diet"));
  const [isPublic, setIsPublic] = useState(profile?.isPublic ?? true);
  const [photoVisibility, setPhotoVisibility] = useState<PhotoVisibility>(
    profile?.photoVisibility ?? "members"
  );
  const [location, setLocation] = useState<LocationValue>({
    lat: profile?.lat ?? null,
    lng: profile?.lng ?? null,
  });
  const [consent, setConsent] = useState(profile?.locationConsent ?? false);
  const [showExact, setShowExact] = useState(profile?.showExactLocation ?? false);

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const isNew = profile === null;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);

    const problems = [
      displayName.trim() ? requiredTextError(displayName, "Display name", 80) : null,
      dob ? dobError(dob) : null,
      heightCm ? heightError(Number(heightCm)) : null,
      about ? requiredTextError(about, "About", 2000) : null,
    ].filter((message): message is string => message !== null);

    if (isNew) {
      if (!displayName.trim()) problems.push("Display name is required to create your profile.");
      if (!dob) problems.push("Date of birth is required to create your profile.");
      if (!gender) problems.push("Gender is required to create your profile.");
      if (!city.trim()) problems.push("City is required to create your profile.");
    }
    if (problems.length > 0) {
      setFormError(problems[0]);
      return;
    }

    // Send only meaningful values: empty strings would fail the API's range rules
    // (for example an empty `heightCm`), so they are omitted rather than nulled.
    const payload: ProfileInput = {};
    if (displayName.trim()) payload.displayName = displayName.trim();
    if (dob) payload.dob = dob;
    if (gender) payload.gender = gender;
    if (heightCm) payload.heightCm = Number(heightCm);
    if (maritalStatus) payload.maritalStatus = maritalStatus;
    if (religion.trim()) payload.religion = religion.trim();
    if (casteCommunity.trim()) payload.casteCommunity = casteCommunity.trim();
    if (educationId) payload.educationId = educationId;
    if (educationDetail.trim()) payload.educationDetail = educationDetail.trim();
    if (professionId) payload.professionId = professionId;
    if (professionDetail.trim()) payload.professionDetail = professionDetail.trim();
    if (incomeBand.trim()) payload.incomeBand = incomeBand.trim();
    if (city.trim()) payload.city = city.trim();
    if (district.trim()) payload.district = district.trim();
    if (country.trim()) payload.country = country.trim();
    if (about.trim()) payload.about = about.trim();
    // Always sent, including as an empty array: it is a replacement set, so clearing
    // every interest has to reach the API rather than being omitted as "no change".
    payload.interestIds = interestIds;
    payload.isPublic = isPublic;
    payload.photoVisibility = photoVisibility;
    payload.lifestyle = { smoking, drinking, diet };
    // lat/lng must be supplied together (DB constraint profiles_lat_lng_conull).
    if (consent && location.lat !== null && location.lng !== null) {
      payload.lat = location.lat;
      payload.lng = location.lng;
      payload.locationConsent = true;
      payload.showExactLocation = showExact;
    } else {
      payload.locationConsent = false;
      payload.showExactLocation = false;
    }

    if (Object.keys(payload).length === 0) {
      setFormError("Change at least one field before saving.");
      return;
    }

    setSaving(true);
    try {
      await profileApi.upsertMine(payload);
      setSavedAt(new Date().toISOString());
      toast.success("Profile saved.");
      onSaved();
    } catch (caught) {
      if (caught instanceof ApiError && caught.isValidation && caught.issues.length > 0) {
        setFormError(caught.issues.map((issue) => `${issue.path}: ${issue.message}`).join(" "));
      } else {
        setFormError(caught instanceof ApiError ? caught.message : "Could not save your profile.");
      }
    } finally {
      setSaving(false);
    }
  }

  const educationOptions = (reference.data?.educationLevels ?? []).map((item) => ({
    value: item.id,
    label: item.label,
  }));
  const professionOptions = (reference.data?.professions ?? []).map((item) => ({
    value: item.id,
    label: item.label,
  }));

  return (
    <form className="flex flex-col gap-5" onSubmit={onSubmit} noValidate>
      <Card title="Basic details">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Display name" htmlFor="displayName" required>
            <Input
              id="displayName"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Arif Hossain"
            />
          </Field>

          <Field label="Date of birth" htmlFor="dob" required hint="You must be at least 18 years old.">
            <DatePicker
              id="dob"
              value={dob}
              onChange={(event) => setDob(event.target.value)}
              minAgeYears={18}
            />
          </Field>

          <Field label="Gender" htmlFor="gender" required>
            <Select
              id="gender"
              value={gender}
              placeholder="Select gender"
              onChange={(event) => setGender(event.target.value as Gender)}
              options={GENDERS}
            />
          </Field>

          <Field label="Height (cm)" htmlFor="heightCm" hint="100 to 250 cm.">
            <Input
              id="heightCm"
              type="number"
              min={100}
              max={250}
              value={heightCm}
              onChange={(event) => setHeightCm(event.target.value)}
            />
          </Field>

          <Field label="Marital status" htmlFor="maritalStatus">
            <Select
              id="maritalStatus"
              value={maritalStatus}
              placeholder="Select status"
              onChange={(event) => setMaritalStatus(event.target.value as MaritalStatus)}
              options={MARITAL}
            />
          </Field>

          <Field label="Religion" htmlFor="religion">
            <Input id="religion" value={religion} onChange={(event) => setReligion(event.target.value)} />
          </Field>

          <Field label="Caste / community" htmlFor="casteCommunity">
            <Input
              id="casteCommunity"
              value={casteCommunity}
              onChange={(event) => setCasteCommunity(event.target.value)}
            />
          </Field>
        </div>
      </Card>

      <Card title="Education, profession and income">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Highest education" htmlFor="educationId" hint="Loaded from the reference data.">
            <Select
              id="educationId"
              value={educationId}
              placeholder="Select education level"
              onChange={(event) => setEducationId(event.target.value)}
              options={educationOptions}
              disabled={reference.status === "loading"}
            />
          </Field>

          <Field label="Education detail" htmlFor="educationDetail">
            <Input
              id="educationDetail"
              value={educationDetail}
              onChange={(event) => setEducationDetail(event.target.value)}
              placeholder="BSc in CSE"
            />
          </Field>

          <Field label="Profession" htmlFor="professionId">
            <Select
              id="professionId"
              value={professionId}
              placeholder="Select profession"
              onChange={(event) => setProfessionId(event.target.value)}
              options={professionOptions}
              disabled={reference.status === "loading"}
            />
          </Field>

          <Field label="Profession detail" htmlFor="professionDetail">
            <Input
              id="professionDetail"
              value={professionDetail}
              onChange={(event) => setProfessionDetail(event.target.value)}
              placeholder="Backend engineer"
            />
          </Field>

          <Field label="Income band" htmlFor="incomeBand">
            <Input
              id="incomeBand"
              value={incomeBand}
              onChange={(event) => setIncomeBand(event.target.value)}
              placeholder="50k-100k"
            />
          </Field>
        </div>
      </Card>

      <Card title="Location">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="City" htmlFor="city" required>
            <Input id="city" value={city} onChange={(event) => setCity(event.target.value)} />
          </Field>
          <Field label="District" htmlFor="district">
            <Input id="district" value={district} onChange={(event) => setDistrict(event.target.value)} />
          </Field>
          <Field label="Country" htmlFor="country">
            <Input id="country" value={country} onChange={(event) => setCountry(event.target.value)} />
          </Field>
        </div>

        <div className="mt-5">
          <LocationPicker
            value={location}
            onChange={setLocation}
            consent={consent}
            onConsentChange={(next) => {
              setConsent(next);
              if (!next) setShowExact(false);
            }}
            showExact={showExact}
            onShowExactChange={setShowExact}
          />
        </div>
      </Card>

      <Card title="Lifestyle, about and visibility">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Smoking" htmlFor="smoking">
            <Select
              id="smoking"
              value={smoking}
              placeholder="Not specified"
              onChange={(event) => setSmoking(event.target.value)}
              options={LIFESTYLE_OPTIONS.smoking.map((value) => ({ value, label: value.replace("_", " ") }))}
            />
          </Field>
          <Field label="Drinking" htmlFor="drinking">
            <Select
              id="drinking"
              value={drinking}
              placeholder="Not specified"
              onChange={(event) => setDrinking(event.target.value)}
              options={LIFESTYLE_OPTIONS.drinking.map((value) => ({ value, label: value.replace("_", " ") }))}
            />
          </Field>
          <Field label="Diet" htmlFor="diet">
            <Select
              id="diet"
              value={diet}
              placeholder="Not specified"
              onChange={(event) => setDiet(event.target.value)}
              options={LIFESTYLE_OPTIONS.diet.map((value) => ({ value, label: value.replace("_", " ") }))}
            />
          </Field>
        </div>

        <div className="mt-4">
          <Field label="About you" htmlFor="about" hint="Up to 2000 characters.">
            <Textarea
              id="about"
              rows={5}
              maxLength={2000}
              value={about}
              onChange={(event) => setAbout(event.target.value)}
            />
          </Field>
        </div>

        <div className="mt-4">
          <MultiCheckList
            legend="Interests"
            options={(reference.data?.interests ?? []).map((item) => ({
              value: item.id,
              label: item.label,
            }))}
            selected={interestIds}
            onToggle={(value) => setInterestIds((current) => toggle(current, value))}
            emptyLabel="Reference data is still loading."
          />
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Profile visibility" htmlFor="isPublic">
            <Select
              id="isPublic"
              value={isPublic ? "public" : "hidden"}
              onChange={(event) => setIsPublic(event.target.value === "public")}
              options={[
                { value: "public", label: "Visible in search and recommendations" },
                { value: "hidden", label: "Hidden from discovery" },
              ]}
            />
          </Field>

          <Field
            label="Who can see my photos"
            htmlFor="photoVisibility"
            hint="A private photo is withheld from other members entirely."
          >
            <Select
              id="photoVisibility"
              value={photoVisibility}
              onChange={(event) => setPhotoVisibility(event.target.value as PhotoVisibility)}
              options={VISIBILITY}
            />
          </Field>
        </div>

        <div className="mt-4">
          <Checkbox
            label="List my profile in discovery"
            description="When off, your profile is excluded from search results and recommendations."
            checked={isPublic}
            onChange={(event) => setIsPublic(event.target.checked)}
          />
        </div>
      </Card>

      {formError ? (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {formError}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <Button type="submit" loading={saving} size="lg">
          {isNew ? "Create profile" : "Save changes"}
        </Button>
        {savedAt ? <span className="text-sm text-emerald-700">Saved.</span> : null}
      </div>
    </form>
  );
}
