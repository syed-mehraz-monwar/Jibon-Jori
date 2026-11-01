import { Link, useLocation, useParams } from "react-router-dom";
import { profileApi } from "../api/profile.api";
import { useAsync } from "../hooks/useAsync";
import { GENDER_LABELS, MARITAL_STATUS_LABELS } from "../lib/format";
import { BLOOD_GROUP_OPTIONS, RELIGIOUS_PRACTICE_OPTIONS, SOCIAL_PLATFORMS, labelFor } from "../lib/profile-options";
import type { SearchProfile } from "../lib/types";
import { PageHeader } from "../components/layout/PageHeader";
import { BackButton } from "../components/layout/BackButton";
import { CompatibilityPanel } from "../components/discovery/CompatibilityPanel";
import { CommentThread } from "../components/social/CommentThread";
import { InteractionBar } from "../components/social/InteractionBar";
import { RatingPanel } from "../components/social/RatingPanel";
import { Avatar } from "../components/ui/Avatar";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { Markdown } from "../components/ui/Markdown";

/**
 * A member's profile as seen by another member.
 *
 * The backend exposes no "profile by id" read (only `GET /api/profile/me`), so the
 * display fields arrive through the router state set by the search / recommendation
 * card that linked here. A direct visit without that state cannot resolve the
 * profile; instead of guessing or showing a broken shell, the page explains how to
 * reach it. Everything that *is* addressable by id — compatibility, ratings,
 * comments, interactions — is loaded from its own endpoint regardless.
 */
export function ProfileViewPage() {
  const { profileId } = useParams<{ profileId: string }>();
  const location = useLocation();
  const profile = (location.state as { profile?: SearchProfile } | null)?.profile;
  const details = useAsync(
    (signal) => (profileId ? profileApi.publicDetails(profileId, signal) : Promise.resolve(null)),
    [profileId]
  );
  const publicDetails = details.data;

  if (!profileId) {
    return <EmptyState title="Profile not specified" />;
  }

  if (!profile) {
    return (
      <>
        <PageHeader title="Profile" />
        <EmptyState
          title="Open this profile from a list"
          description="Profile details are provided by the search or recommendations list you came from. Open the profile from there to see its compatibility, ratings and comments."
          action={
            <Link to="/app/search">
              <Button>Go to search</Button>
            </Link>
          }
        />
        <div className="mt-5 grid gap-5">
          <CompatibilityPanel profileId={profileId} />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={profile.displayName}
        description={`${profile.age} \u00b7 ${GENDER_LABELS[profile.gender] ?? profile.gender}${
          profile.city ? ` \u00b7 ${profile.city}` : ""
        }`}
        actions={<BackButton to="/app/search" label="Back to results" />}
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="flex flex-col gap-5 lg:col-span-2">
          <Card>
            <div className="flex flex-wrap items-start gap-4">
              <Avatar name={profile.displayName} src={profile.primaryPhoto} size="xl" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap gap-2">
                  <Badge tone="neutral">{MARITAL_STATUS_LABELS[profile.maritalStatus] ?? profile.maritalStatus}</Badge>
                  {profile.education ? <Badge tone="info">{profile.education.label}</Badge> : null}
                  {profile.profession ? <Badge tone="info">{profile.profession.label}</Badge> : null}
                </div>
                {profile.about ? (
                  <p className="mt-3 whitespace-pre-line text-sm text-slate-700">{profile.about}</p>
                ) : (
                  <p className="mt-3 text-sm text-slate-500">This member has not written an introduction yet.</p>
                )}
                {profile.interests.length > 0 ? (
                  <ul className="mt-3 flex flex-wrap gap-1.5">
                    {profile.interests.map((interest) => (
                      <li key={interest.slug} className="jj-chip">
                        {interest.label}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>

            <div className="mt-5 border-t border-slate-200 pt-4">
              <p className="mb-2 text-sm font-medium text-slate-700">Interact</p>
              <InteractionBar targetProfileId={profileId} />
            </div>
          </Card>

          <CompatibilityPanel profileId={profileId} />
          <CommentThread profileId={profileId} canComment />
        </div>

        <div className="flex flex-col gap-5">
          <RatingPanel profileId={profileId} />

          {publicDetails ? (
            <Card title="More about">
              <dl className="flex flex-col gap-3 text-sm">
                {publicDetails.religiousPractice ? (
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Religious practice
                    </dt>
                    <dd className="text-slate-800">
                      {labelFor(RELIGIOUS_PRACTICE_OPTIONS, publicDetails.religiousPractice) ?? "—"}
                    </dd>
                  </div>
                ) : null}
                {publicDetails.bloodGroup ? (
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Blood group</dt>
                    <dd className="text-slate-800">
                      {labelFor(BLOOD_GROUP_OPTIONS, publicDetails.bloodGroup) ?? "—"}
                    </dd>
                  </div>
                ) : null}
              </dl>

              {publicDetails.biodata ? (
                <div className="mt-4 border-t border-slate-200 pt-4">
                  <p className="mb-2 text-sm font-medium text-slate-700">Biodata</p>
                  <Markdown source={publicDetails.biodata} />
                </div>
              ) : null}

              {Object.keys(publicDetails.socialLinks).length > 0 ? (
                <div className="mt-4 border-t border-slate-200 pt-4">
                  <p className="mb-2 text-sm font-medium text-slate-700">Links</p>
                  <ul className="flex flex-col gap-1.5">
                    {SOCIAL_PLATFORMS.filter((platform) => publicDetails.socialLinks[platform.value]).map(
                      (platform) => (
                        <li key={platform.value}>
                          <a
                            href={publicDetails.socialLinks[platform.value]}
                            target="_blank"
                            rel="noopener noreferrer nofollow"
                            className="text-sm font-medium text-brand-700 underline underline-offset-2"
                          >
                            {platform.label}
                          </a>
                        </li>
                      )
                    )}
                  </ul>
                </div>
              ) : null}
            </Card>
          ) : null}

          <Card title="Interests">
            {profile.interests.length === 0 ? (
              <p className="text-sm text-slate-500">No interests listed.</p>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {profile.interests.map((interest) => (
                  <li key={interest.slug} className="jj-chip">
                    {interest.label}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
