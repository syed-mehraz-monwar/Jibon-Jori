import { partnerPreferencesApi } from "../api/partner-preferences.api";
import { useAsync } from "../hooks/useAsync";
import { ApiError } from "../lib/http";
import { BackButton } from "../components/layout/BackButton";
import { PageHeader } from "../components/layout/PageHeader";
import { PreferenceForm } from "../components/profile/PreferenceForm";
import { ErrorState } from "../components/ui/ErrorState";
import { Spinner } from "../components/ui/Spinner";

export function PreferencesPage() {
  const preferences = useAsync((signal) => partnerPreferencesApi.getMine(signal), []);
  const notFound =
    preferences.status === "error" &&
    preferences.error instanceof ApiError &&
    preferences.error.status === 404;

  return (
    <>
      <PageHeader
        title="Partner preferences"
        description="These preferences feed directly into the partner-preference compatibility factor."
        actions={<BackButton />}
      />

      {preferences.status === "loading" ? (
        <div className="flex justify-center py-16">
          <Spinner className="h-8 w-8 text-brand-600" />
        </div>
      ) : preferences.status === "error" && !notFound ? (
        <ErrorState error={preferences.error} onRetry={preferences.reload} />
      ) : (
        <PreferenceForm
          preferences={notFound ? null : (preferences.data?.preferences ?? null)}
          onSaved={preferences.reload}
        />
      )}
    </>
  );
}
