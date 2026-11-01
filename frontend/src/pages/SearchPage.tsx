import { useState } from "react";
import { referenceApi } from "../api/reference.api";
import type { SearchFilters } from "../api/search.api";
import { useReferenceData } from "../context/ReferenceDataContext";
import { useAsync } from "../hooks/useAsync";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { GENDER_OPTIONS } from "../lib/profile-options";
import { MARITAL_STATUS_LABELS } from "../lib/format";
import type { Gender, MaritalStatus } from "../lib/types";
import { PageHeader } from "../components/layout/PageHeader";
import { ProfileCard } from "../components/discovery/ProfileCard";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorState } from "../components/ui/ErrorState";
import { Field } from "../components/ui/Field";
import { Input } from "../components/ui/Input";
import { Pagination } from "../components/ui/Pagination";
import { Select } from "../components/ui/Select";
import { Spinner } from "../components/ui/Spinner";

const PAGE_SIZE = 5;

const MARITAL_OPTIONS = Object.entries(MARITAL_STATUS_LABELS).map(([value, label]) => ({ value, label }));

/** B-40: the same ceiling the API enforces. */
const RADIUS_OPTIONS = [5, 10, 25, 50, 100, 250, 500].map((km) => ({
  value: String(km),
  label: `${km} km`,
}));

/**
 * Advanced search (Spec §9) with pagination (Spec §10).
 *
 * This query runs over GraphQL, which is the flexible-read case `AGENTS.md` calls
 * out: the filter set is optional and combinatorial, and the same Zod schemas as
 * REST validate it server-side. The `city` field is debounced so typing does not
 * fire a request per keystroke.
 */
export function SearchPage() {
  const reference = useReferenceData();

  const [ageMin, setAgeMin] = useState("");
  const [ageMax, setAgeMax] = useState("");
  const [gender, setGender] = useState<Gender | "">("");
  const [maritalStatus, setMaritalStatus] = useState<MaritalStatus | "">("");
  const [city, setCity] = useState("");
  const [educationId, setEducationId] = useState("");
  const [professionId, setProfessionId] = useState("");
  const [interestIds, setInterestIds] = useState<string[]>([]);
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [radiusKm, setRadiusKm] = useState("");
  const [geoError, setGeoError] = useState<string | null>(null);
  const [geoBusy, setGeoBusy] = useState(false);
  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(true);

  const debouncedCity = useDebouncedValue(city, 350);

  // B-40: the API accepts a centre and a radius, or neither. Partial input is kept in the
  // form but not sent, so a half-typed coordinate never becomes a 400.
  const nearLat = lat.trim() === "" ? undefined : Number(lat);
  const nearLng = lng.trim() === "" ? undefined : Number(lng);
  const radius = radiusKm === "" ? undefined : Number(radiusKm);
  const proximityComplete =
    nearLat !== undefined &&
    nearLng !== undefined &&
    radius !== undefined &&
    Number.isFinite(nearLat) &&
    Number.isFinite(nearLng) &&
    Number.isFinite(radius) &&
    radius > 0;

  const filters: SearchFilters = {
    page,
    limit: PAGE_SIZE,
    ageMin: ageMin ? Number(ageMin) : undefined,
    ageMax: ageMax ? Number(ageMax) : undefined,
    gender,
    maritalStatus,
    city: debouncedCity,
    educationId,
    professionId,
    interestIds,
    ...(proximityComplete ? { nearLat, nearLng, radiusKm: radius } : {}),
  };

  const results = useAsync(
    (signal) => referenceApi.searchProfiles(filters, signal),
    [JSON.stringify(filters)]
  );

  function update<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      setPage(1);
    };
  }

  function reset() {
    setAgeMin("");
    setAgeMax("");
    setGender("");
    setMaritalStatus("");
    setCity("");
    setEducationId("");
    setProfessionId("");
    setInterestIds([]);
    setLat("");
    setLng("");
    setRadiusKm("");
    setGeoError(null);
    setPage(1);
  }

  /**
   * B-40: fills the centre from the browser's own location. The coordinates are used only
   * as a search centre - they are sent as filter values and never stored by the app.
   */
  function useMyLocation() {
    setGeoError(null);

    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeoError("This browser does not expose a location.");
      return;
    }

    setGeoBusy(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setGeoBusy(false);
        setLat(position.coords.latitude.toFixed(4));
        setLng(position.coords.longitude.toFixed(4));
        setRadiusKm((current) => (current === "" ? "25" : current));
        setPage(1);
      },
      () => {
        setGeoBusy(false);
        setGeoError("Location permission was refused. Enter coordinates manually instead.");
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300_000 }
    );
  }

  const profiles = results.data?.searchProfiles.profiles ?? [];
  const pagination = results.data?.searchProfiles.pagination;

  return (
    <>
      <PageHeader
        title="Search profiles"
        description="Combine any filters. Results are paginated and respect each member's privacy settings."
        actions={
          <Button variant="secondary" size="sm" onClick={() => setShowFilters((value) => !value)}>
            {showFilters ? "Hide filters" : "Show filters"}
          </Button>
        }
      />

      {showFilters ? (
        <Card className="mb-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Minimum age" htmlFor="search-ageMin">
              <Input
                id="search-ageMin"
                type="number"
                min={18}
                max={100}
                value={ageMin}
                onChange={(event) => update(setAgeMin)(event.target.value)}
              />
            </Field>
            <Field label="Maximum age" htmlFor="search-ageMax">
              <Input
                id="search-ageMax"
                type="number"
                min={18}
                max={100}
                value={ageMax}
                onChange={(event) => update(setAgeMax)(event.target.value)}
              />
            </Field>
            <Field label="Gender" htmlFor="search-gender">
              <Select
                id="search-gender"
                value={gender}
                placeholder="Any"
                options={GENDER_OPTIONS}
                onChange={(event) => update(setGender)(event.target.value as Gender)}
              />
            </Field>
            <Field label="Marital status" htmlFor="search-marital">
              <Select
                id="search-marital"
                value={maritalStatus}
                placeholder="Any"
                options={MARITAL_OPTIONS}
                onChange={(event) => update(setMaritalStatus)(event.target.value as MaritalStatus)}
              />
            </Field>
            <Field label="City" htmlFor="search-city">
              <Input
                id="search-city"
                value={city}
                onChange={(event) => update(setCity)(event.target.value)}
                placeholder="Dhaka"
              />
            </Field>
            <Field label="Education" htmlFor="search-education">
              <Select
                id="search-education"
                value={educationId}
                placeholder="Any"
                options={(reference.data?.educationLevels ?? []).map((item) => ({
                  value: item.id,
                  label: item.label,
                }))}
                onChange={(event) => update(setEducationId)(event.target.value)}
              />
            </Field>
            <Field label="Profession" htmlFor="search-profession">
              <Select
                id="search-profession"
                value={professionId}
                placeholder="Any"
                options={(reference.data?.professions ?? []).map((item) => ({
                  value: item.id,
                  label: item.label,
                }))}
                onChange={(event) => update(setProfessionId)(event.target.value)}
              />
            </Field>
            <div className="flex items-end">
              <Button variant="ghost" size="sm" onClick={reset}>
                Reset filters
              </Button>
            </div>
          </div>

          {(reference.data?.interests.length ?? 0) > 0 ? (
            <fieldset className="mt-4">
              <legend className="mb-1.5 text-sm font-medium text-slate-700">Interests</legend>
              <div className="flex max-h-32 flex-wrap gap-3 overflow-y-auto rounded-lg border border-slate-200 p-3">
                {reference.data?.interests.map((interest) => (
                  <label key={interest.id} className="flex items-center gap-1.5 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-200"
                      checked={interestIds.includes(interest.id)}
                      onChange={() => {
                        setPage(1);
                        setInterestIds((current) =>
                          current.includes(interest.id)
                            ? current.filter((id) => id !== interest.id)
                            : [...current, interest.id]
                        );
                      }}
                    />
                    {interest.label}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

          <fieldset className="mt-4 rounded-lg border border-slate-200 p-3">
            <legend className="px-1 text-sm font-medium text-slate-700">Near a location</legend>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Latitude" htmlFor="search-lat">
                <Input
                  id="search-lat"
                  type="number"
                  step="0.0001"
                  min={-90}
                  max={90}
                  value={lat}
                  onChange={(event) => update(setLat)(event.target.value)}
                  placeholder="23.8103"
                />
              </Field>
              <Field label="Longitude" htmlFor="search-lng">
                <Input
                  id="search-lng"
                  type="number"
                  step="0.0001"
                  min={-180}
                  max={180}
                  value={lng}
                  onChange={(event) => update(setLng)(event.target.value)}
                  placeholder="90.4125"
                />
              </Field>
              <Field label="Radius (km)" htmlFor="search-radius">
                <Select
                  id="search-radius"
                  value={radiusKm}
                  placeholder="Any"
                  options={RADIUS_OPTIONS}
                  onChange={(event) => update(setRadiusKm)(event.target.value)}
                />
              </Field>
              <div className="flex items-end">
                <Button variant="secondary" size="sm" loading={geoBusy} onClick={useMyLocation}>
                  Use my location
                </Button>
              </div>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Straight-line distance. Only members who have turned on location sharing in their
              privacy settings can be found this way.
            </p>
            {geoError ? <p className="mt-1 text-xs text-rose-600">{geoError}</p> : null}
          </fieldset>
        </Card>
      ) : null}

      {results.status === "loading" ? (
        <div className="flex justify-center py-16">
          <Spinner className="h-8 w-8 text-brand-600" />
        </div>
      ) : results.status === "error" ? (
        <ErrorState error={results.error} onRetry={results.reload} />
      ) : profiles.length === 0 ? (
        <EmptyState
          title="No profiles matched"
          description="Try widening the age range or removing a filter."
          action={
            <Button variant="secondary" onClick={reset}>
              Reset filters
            </Button>
          }
        />
      ) : (
        <>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {profiles.map((profile) => (
              <li key={profile.id}>
                <ProfileCard profile={profile} />
              </li>
            ))}
          </ul>
          {pagination ? (
            <div className="mt-6">
              <Pagination
                page={pagination.page}
                totalPages={pagination.totalPages}
                total={pagination.total}
                onChange={setPage}
              />
            </div>
          ) : null}
        </>
      )}
    </>
  );
}
