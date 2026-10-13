import { profileApi } from "../api/profile.api";
import { useAsync } from "../hooks/useAsync";
import { ApiError } from "../lib/http";
import { PageHeader } from "../components/layout/PageHeader";
import { MediaManager } from "../components/profile/MediaManager";
import { ProfileForm } from "../components/profile/ProfileForm";
import { LocationMap } from "../components/map/LocationMap";
import { Card } from "../components/ui/Card";
import { ErrorState } from "../components/ui/ErrorState";
import { Spinner } from "../components/ui/Spinner";

export function ProfilePage() {
  const profile = useAsync((signal) => profileApi.getMine(signal), []);

  const notFound = profile.status === "error" && profile.error instanceof ApiError && profile.error.status === 404;

  if (profile.status === "loading") {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="h-8 w-8 text-brand-600" />
      </div>
    );
  }

  if (profile.status === "error" && !notFound) {
    return <ErrorState error={profile.error} onRetry={profile.reload} />;
  }

  const current = notFound ? null : (profile.data?.profile ?? null);

  return (
    <>
      <PageHeader
        title="My profile"
        description="A complete profile improves your compatibility factors and appears in more searches."
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ProfileForm profile={current} onSaved={profile.reload} />
        </div>

        <div className="flex flex-col gap-5">
          <Card title="Shared location">
            <LocationMap
              lat={current?.lat ?? null}
              lng={current?.lng ?? null}
              label={current?.displayName}
              height={220}
            />
            <p className="mt-3 text-xs text-slate-500">
              {current?.showExactLocation
                ? "Other members see your exact coordinates."
                : "Other members see a coarsened coordinate (two decimal places)."}
              {current?.locationConsent ? "" : " Location sharing is currently off."}
            </p>
          </Card>

          <MediaManager />
        </div>
      </div>
    </>
  );
}
