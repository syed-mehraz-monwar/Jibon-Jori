import { useState, type FormEvent } from "react";
import { profileApi } from "../../api/profile.api";
import { useReferenceData } from "../../context/ReferenceDataContext";
import { useToast } from "../../context/ToastContext";
import { ApiError } from "../../lib/http";
import { toDateInputValue } from "../../lib/format";
import {
  BIODATA_MAX,
  DOB_EARLIEST,
  SOCIAL_URL_MAX,
  cmToFeetInches,
  dobError,
  feetInchesError,
  feetInchesToCm,
  latestAdultDob,
  requiredTextError,
  socialUrlError,
} from "../../lib/validation";
import {
  BLOOD_GROUP_OPTIONS,
  GENDER_OPTIONS,
  RELIGION_OPTIONS,
  RELIGIOUS_PRACTICE_OPTIONS,
  SOCIAL_PLATFORMS,
  VISIBILITY_OPTIONS,
} from "../../lib/profile-options";
import type {
  BloodGroup,
  Gender,
  MaritalStatus,
  PhotoVisibility,
  Profile,
  ProfileDetailsInput,
  ProfileInput,
  ReligiousPractice,
  SocialLinks,
  SocialPlatform,
} from "../../lib/types";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Checkbox } from "../ui/Checkbox";
import { DatePicker } from "../ui/DatePicker";
import { Field } from "../ui/Field";
import { Input } from "../ui/Input";
import { MarkdownField } from "../ui/MarkdownField";
import { MultiCheckList, toggle } from "../ui/MultiCheckList";
import { SearchableSelect } from "../ui/SearchableSelect";
import { Select } from "../ui/Select";
import { Textarea } from "../ui/Textarea";
import { LocationPicker, type LocationValue } from "../map/LocationPicker";

const MARITAL: { value: MaritalStatus; label: string }[] = [
  { value: "never_married", label: "Never married" },
  { value: "divorced", label: "Divorced" },
  { value: "widowed", label: "Widowed" },
  { value: "annulled", label: "Annulled" },
];

const LIFESTYLE_OPTIONS = {
  smoking: ["never", "occasionally", "regularly"],
  drinking: ["never", "occasionally", "regularly"],
  diet: ["vegetarian", "non_vegetarian", "eggetarian", "vegan"],
};

const FEET_OPTIONS = Array.from({ length: 5 }, (_, index) => String(index + 3)); // 3-7 ft
const INCH_OPTIONS = Array.from({ length: 12 }, (_, index) => String(index)); // 0-11 in

function lifestyleString(profile: Profile | null, key: string): string {
  const value = profile?.lifestyle?.[key];
  return typeof value === "string" ? value : "";
}

function initialHeight(profile: Profile | null): { feet: string; inches: string } {
  if (!profile?.heightCm) return { feet: "", inches: "" };
  const { feet, inches } = cmToFeetInches(profile.heightCm);
  return { feet: String(feet), inches: String(inches) };
}

function emptyLinks(): Record<SocialPlatform, string> {
  return { facebook: "", instagram: "", linkedin: "", x: "", youtube: "", website: "" };
}

function initialLinks(profile: Profile | null): Record<SocialPlatform, string> {
  const links = emptyLinks();
  const stored = profile?.details?.socialLinks ?? {};
  for (const platform of Object.keys(links) as SocialPlatform[]) {
    const value = stored[platform];
    if (typeof value === "string") links[platform] = value;
  }
  return links;
}

/**
 * The profile editor.
 *
 * Fields map 1:1 to either `profiles` (core columns) or the optional
 * `profile_details` row, and the optional groups each carry their own
 * visibility. The form is intentionally long but grouped into cards, with every
 * grid collapsing to one column on a 360px screen.
 *
 * Date of birth and height were the two reported input defects:
 *   * DOB uses a fixed earliest date and the 18-year rule as the *upper* bound,
 *     so a member born before 2008 can select their real date.
 *   * Height is chosen in feet and inches (the unit members use) and converted
 *     to centimetres for storage, with the centimetre value shown live.
 */
export function ProfileForm({ profile, onSaved }: { profile: Profile | null; onSaved: () => void }) {
  const toast = useToast();
  const reference = useReferenceData();

  const [displayName, setDisplayName] = useState(profile?.displayName ?? "");
  const [dob, setDob] = useState(toDateInputValue(profile?.dob));
  const [gender, setGender] = useState<Gender | "">(profile?.gender ?? "");
  const [maritalStatus, setMaritalStatus] = useState<MaritalStatus | "">(
    profile?.maritalStatus ?? ""
  );
  const [height, setHeight] = useState(initialHeight(profile));
  const [heightTouched, setHeightTouched] = useState(false);
  const [religion, setReligion] = useState(profile?.religion ?? "");
  const [casteCommunity, setCasteCommunity] = useState(profile?.casteCommunity ?? "");
  const [religiousPractice, setReligiousPractice] = useState<ReligiousPractice | "">(
    profile?.details?.religiousPractice ?? ""
  );
  const [bloodGroup, setBloodGroup] = useState<BloodGroup | "">(profile?.details?.bloodGroup ?? "");
  const [biodata, setBiodata] = useState(profile?.details?.biodata ?? "");

  const [educationId, setEducationId] = useState(profile?.education?.id ?? "");
  const [educationDetail, setEducationDetail] = useState(profile?.educationDetail ?? "");
  const [professionId, setProfessionId] = useState(profile?.profession?.id ?? "");
  const [professionDetail, setProfessionDetail] = useState(profile?.professionDetail ?? "");
  const [incomeBand, setIncomeBand] = useState(profile?.incomeBand ?? "");

  const [city, setCity] = useState(profile?.city ?? "");
  const [district, setDistrict] = useState(profile?.district ?? "");
  const [country, setCountry] = useState(profile?.country ?? "Bangladesh");
  const [location, setLocation] = useState<LocationValue>({
    lat: profile?.lat ?? null,
    lng: profile?.lng ?? null,
  });
  const [consent, setConsent] = useState(profile?.locationConsent ?? false);
  const [showExact, setShowExact] = useState(profile?.showExactLocation ?? false);

  const [about, setAbout] = useState(profile?.about ?? "");
  const [smoking, setSmoking] = useState(lifestyleString(profile, "smoking"));
  const [drinking, setDrinking] = useState(lifestyleString(profile, "drinking"));
  const [diet, setDiet] = useState(lifestyleString(profile, "diet"));
  const [interestIds, setInterestIds] = useState<string[]>(
    profile?.interests?.map((interest) => interest.id) ?? []
  );

  const [links, setLinks] = useState<Record<SocialPlatform, string>>(initialLinks(profile));

  const [isPublic, setIsPublic] = useState(profile?.isPublic ?? true);
  const [photoVisibility, setPhotoVisibility] = useState<PhotoVisibility>(
    profile?.photoVisibility ?? "members"
  );
  const [practiceVisibility, setPracticeVisibility] = useState<PhotoVisibility>(
    profile?.details?.religiousPracticeVisibility ?? "members"
  );
  const [bloodVisibility, setBloodVisibility] = useState<PhotoVisibility>(
    profile?.details?.bloodGroupVisibility ?? "private"
  );
  const [biodataVisibility, setBiodataVisibility] = useState<PhotoVisibility>(
    profile?.details?.biodataVisibility ?? "members"
  );
  const [linksVisibility, setLinksVisibility] = useState<PhotoVisibility>(
    profile?.details?.socialLinksVisibility ?? "members"
  );

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const isNew = profile === null;

  const heightCm =
    heightTouched && (height.feet !== "" || height.inches !== "")
      ? feetInchesToCm(Number(height.feet || 0), Number(height.inches || 0))
      : (profile?.heightCm ?? null);

  const linkProblems = SOCIAL_PLATFORMS.map((platform) => ({
    platform: platform.value,
    message: links[platform.value] ? socialUrlError(links[platform.value]) : null,
  })).filter((entry): entry is { platform: SocialPlatform; message: string } => entry.message !== null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);

    const problems = [
      requiredTextError(displayName, "Display name", 80),
      dobError(dob),
      isNew && !gender ? "Gender is required to create your profile." : null,
      requiredTextError(city, "City", 80),
      about ? requiredTextError(about, "About", 2000) : null,
      biodata.trim().length > BIODATA_MAX ? `Biodata must be at most ${BIODATA_MAX} characters.` : null,
      feetInchesError(
        height.feet === "" ? null : Number(height.feet),
        height.inches === "" ? null : Number(height.inches)
      ),
    ].filter((message): message is string => message !== null);

    if (linkProblems.length > 0) {
      problems.push(`${SOCIAL_PLATFORMS.find((p) => p.value === linkProblems[0].platform)?.label}: ${linkProblems[0].message}`);
    }

    if (problems.length > 0) {
      setFormError(problems[0]);
      return;
    }

    const socialLinks: SocialLinks = {};
    for (const platform of SOCIAL_PLATFORMS) {
      const value = links[platform.value].trim();
      if (value) socialLinks[platform.value] = value;
    }

    const details: ProfileDetailsInput = {
      religiousPractice: religiousPractice === "" ? null : religiousPractice,
      bloodGroup: bloodGroup === "" ? null : bloodGroup,
      biodata: biodata.trim() ? biodata.trim() : null,
      socialLinks,
      religiousPracticeVisibility: practiceVisibility,
      bloodGroupVisibility: bloodVisibility,
      biodataVisibility: biodataVisibility,
      socialLinksVisibility: linksVisibility,
    };

    // Send only meaningful values. An empty string would fail a range rule (for
    // example `heightCm`), so absent fields are omitted rather than nulled;
    // optional text that the member cleared is explicitly null so it is erased.
    const payload: ProfileInput = {
      displayName: displayName.trim(),
      dob,
      interestIds,
      isPublic,
      photoVisibility,
      lifestyle: { smoking, drinking, diet },
      details,
    };
    if (gender) payload.gender = gender;
    if (heightCm !== null) payload.heightCm = heightCm;
    if (maritalStatus) payload.maritalStatus = maritalStatus;
    payload.religion = religion.trim() ? religion.trim() : null;
    payload.casteCommunity = casteCommunity.trim() ? casteCommunity.trim() : null;
    payload.educationId = educationId || null;
    payload.educationDetail = educationDetail.trim() ? educationDetail.trim() : null;
    payload.professionId = professionId || null;
    payload.professionDetail = professionDetail.trim() ? professionDetail.trim() : null;
    payload.incomeBand = incomeBand.trim() ? incomeBand.trim() : null;
    payload.city = city.trim();
    payload.district = district.trim() ? district.trim() : null;
    payload.country = country.trim() ? country.trim() : null;
    payload.about = about.trim() ? about.trim() : null;

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
  const religionOptions = RELIGION_OPTIONS.map((value) => ({ value, label: value }));

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
              maxLength={80}
            />
          </Field>

          <Field
            label="Date of birth"
            htmlFor="dob"
            required
            error={dob ? dobError(dob) : null}
            hint={`Between ${DOB_EARLIEST} and ${latestAdultDob()} (18+).`}
          >
            <DatePicker
              id="dob"
              value={dob}
              onChange={(event) => setDob(event.target.value)}
              min={DOB_EARLIEST}
              max={latestAdultDob()}
            />
          </Field>

          <Field label="Gender" htmlFor="gender" required>
            <Select
              id="gender"
              value={gender}
              placeholder="Select gender"
              onChange={(event) => setGender(event.target.value as Gender)}
              options={GENDER_OPTIONS}
            />
          </Field>

          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-sm font-medium text-slate-700">Height</legend>
            <div className="flex items-center gap-2">
              <label className="sr-only" htmlFor="heightFeet">
                Height in feet
              </label>
              <Select
                id="heightFeet"
                value={height.feet}
                placeholder="Feet"
                onChange={(event) => {
                  setHeight((current) => ({ ...current, feet: event.target.value }));
                  setHeightTouched(true);
                }}
                options={FEET_OPTIONS.map((value) => ({ value, label: `${value} ft` }))}
              />
              <label className="sr-only" htmlFor="heightInches">
                Height in inches
              </label>
              <Select
                id="heightInches"
                value={height.inches}
                placeholder="Inches"
                onChange={(event) => {
                  setHeight((current) => ({ ...current, inches: event.target.value }));
                  setHeightTouched(true);
                }}
                options={INCH_OPTIONS.map((value) => ({ value, label: `${value} in` }))}
              />
            </div>
            <p className="text-xs text-slate-500">
              {heightCm !== null ? `Stored as ${heightCm} cm.` : "Optional. Choose feet and inches."}
            </p>
          </fieldset>

          <Field label="Marital status" htmlFor="maritalStatus">
            <Select
              id="maritalStatus"
              value={maritalStatus}
              placeholder="Select status"
              onChange={(event) => setMaritalStatus(event.target.value as MaritalStatus)}
              options={MARITAL}
            />
          </Field>

          <Field label="Religion" htmlFor="religion" hint="Pick from the list or type your own.">
            <SearchableSelect
              id="religion"
              value={religion}
              onChange={setReligion}
              options={religionOptions}
              placeholder="Search or type a religion"
              allowCustom
            />
          </Field>

          <Field
            label="Religious practice"
            htmlFor="religiousPractice"
            hint="Optional. Choose what fits you; nothing is ranked."
          >
            <Select
              id="religiousPractice"
              value={religiousPractice}
              placeholder="Not specified"
              onChange={(event) => setReligiousPractice(event.target.value as ReligiousPractice | "")}
              options={RELIGIOUS_PRACTICE_OPTIONS}
            />
          </Field>

          <Field
            label="Caste / community"
            htmlFor="casteCommunity"
            hint="Optional. Skip this if you prefer not to say."
          >
            <Input
              id="casteCommunity"
              value={casteCommunity}
              onChange={(event) => setCasteCommunity(event.target.value)}
              maxLength={80}
            />
          </Field>

          <Field
            label="Blood group"
            htmlFor="bloodGroup"
            hint="Optional and private by default. Never used for matching."
          >
            <Select
              id="bloodGroup"
              value={bloodGroup}
              placeholder="Not specified"
              onChange={(event) => setBloodGroup(event.target.value as BloodGroup | "")}
              options={BLOOD_GROUP_OPTIONS}
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
              maxLength={120}
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
              maxLength={120}
            />
          </Field>

          <Field label="Income band" htmlFor="incomeBand">
            <Input
              id="incomeBand"
              value={incomeBand}
              onChange={(event) => setIncomeBand(event.target.value)}
              placeholder="50k-100k"
              maxLength={40}
            />
          </Field>
        </div>
      </Card>

      <Card title="Location">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="City" htmlFor="city" required>
            <Input id="city" value={city} onChange={(event) => setCity(event.target.value)} maxLength={80} />
          </Field>
          <Field label="District" htmlFor="district">
            <Input
              id="district"
              value={district}
              onChange={(event) => setDistrict(event.target.value)}
              maxLength={80}
            />
          </Field>
          <Field label="Country" htmlFor="country">
            <Input
              id="country"
              value={country}
              onChange={(event) => setCountry(event.target.value)}
              maxLength={80}
            />
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
            onResolvedAddress={(address) => {
              if (address.city) setCity(address.city);
              if (address.district) setDistrict(address.district);
              if (address.country) setCountry(address.country);
            }}
          />
        </div>
      </Card>

      <Card title="Lifestyle and about">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Smoking" htmlFor="smoking">
            <Select
              id="smoking"
              value={smoking}
              placeholder="Not specified"
              onChange={(event) => setSmoking(event.target.value)}
              options={LIFESTYLE_OPTIONS.smoking.map((value) => ({
                value,
                label: value.replace("_", " "),
              }))}
            />
          </Field>
          <Field label="Drinking" htmlFor="drinking">
            <Select
              id="drinking"
              value={drinking}
              placeholder="Not specified"
              onChange={(event) => setDrinking(event.target.value)}
              options={LIFESTYLE_OPTIONS.drinking.map((value) => ({
                value,
                label: value.replace("_", " "),
              }))}
            />
          </Field>
          <Field label="Diet" htmlFor="diet">
            <Select
              id="diet"
              value={diet}
              placeholder="Not specified"
              onChange={(event) => setDiet(event.target.value)}
              options={LIFESTYLE_OPTIONS.diet.map((value) => ({
                value,
                label: value.replace("_", " "),
              }))}
            />
          </Field>
        </div>

        <div className="mt-4">
          <Field label="About you" htmlFor="about" hint="Up to 2000 characters. Plain text.">
            <Textarea
              id="about"
              rows={4}
              maxLength={2000}
              value={about}
              onChange={(event) => setAbout(event.target.value)}
            />
          </Field>
        </div>

        <div className="mt-4">
          <MultiCheckList
            legend="Hobbies and interests"
            options={(reference.data?.interests ?? []).map((item) => ({
              value: item.id,
              label: item.label,
            }))}
            selected={interestIds}
            onToggle={(value) => setInterestIds((current) => toggle(current, value))}
            emptyLabel={
              reference.status === "error" ? "Hobbies could not be loaded yet." : "Loading hobbies…"
            }
          />
        </div>
      </Card>

      <Card title="Biodata">
        <MarkdownField
          id="biodata"
          label="Biodata"
          value={biodata}
          onChange={setBiodata}
          rows={8}
          maxLength={BIODATA_MAX}
          placeholder={
            "## About me\n\nWrite a few paragraphs about yourself, your family and what you are looking for.\n\n- What matters to you\n- Your day-to-day life"
          }
        />
        <p className="mt-2 text-xs text-slate-500">
          {biodata.length}/{BIODATA_MAX} characters. Formatting is rendered for other members; links are
          limited to https and images are not allowed.
        </p>
      </Card>

      <Card title="Social links">
        <p className="mb-3 text-sm text-slate-600">
          Optional. Only full <code className="rounded bg-slate-100 px-1">https://</code> addresses are
          accepted, and each link opens in a new tab with no referrer.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {SOCIAL_PLATFORMS.map((platform) => (
            <Field
              key={platform.value}
              label={platform.label}
              htmlFor={`link-${platform.value}`}
              error={links[platform.value] ? socialUrlError(links[platform.value]) : null}
            >
              <Input
                id={`link-${platform.value}`}
                type="url"
                inputMode="url"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={SOCIAL_URL_MAX}
                placeholder={platform.placeholder}
                value={links[platform.value]}
                onChange={(event) =>
                  setLinks((current) => ({ ...current, [platform.value]: event.target.value }))
                }
              />
            </Field>
          ))}
        </div>
      </Card>

      <Card title="Privacy and visibility">
        <div className="grid gap-4 sm:grid-cols-2">
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
              options={VISIBILITY_OPTIONS}
            />
          </Field>

          <Field label="Who can see my religious practice" htmlFor="practiceVisibility">
            <Select
              id="practiceVisibility"
              value={practiceVisibility}
              onChange={(event) => setPracticeVisibility(event.target.value as PhotoVisibility)}
              options={VISIBILITY_OPTIONS}
            />
          </Field>

          <Field label="Who can see my blood group" htmlFor="bloodVisibility">
            <Select
              id="bloodVisibility"
              value={bloodVisibility}
              onChange={(event) => setBloodVisibility(event.target.value as PhotoVisibility)}
              options={VISIBILITY_OPTIONS}
            />
          </Field>

          <Field label="Who can see my biodata" htmlFor="biodataVisibility">
            <Select
              id="biodataVisibility"
              value={biodataVisibility}
              onChange={(event) => setBiodataVisibility(event.target.value as PhotoVisibility)}
              options={VISIBILITY_OPTIONS}
            />
          </Field>

          <Field label="Who can see my social links" htmlFor="linksVisibility">
            <Select
              id="linksVisibility"
              value={linksVisibility}
              onChange={(event) => setLinksVisibility(event.target.value as PhotoVisibility)}
              options={VISIBILITY_OPTIONS}
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
