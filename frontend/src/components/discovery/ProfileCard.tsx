import { Link } from "react-router-dom";
import type { SearchProfile } from "../../lib/types";
import { GENDER_LABELS } from "../../lib/format";
import { Avatar } from "../ui/Avatar";
import { Badge } from "../ui/Badge";

/**
 * Result card for search and recommendation listings.
 *
 * Both links carry the profile as router state. The backend has no
 * "profile by id" read, so `ProfileViewPage` resolves the display fields from
 * this state; without it the view could only show its fallback. Passing the
 * already-fetched row avoids a second request and keeps the two views consistent.
 */
export function ProfileCard({
  profile,
  score,
  footer,
}: {
  profile: SearchProfile;
  score?: number | null;
  footer?: React.ReactNode;
}) {
  const linkState = { profile };
  return (
    <article className="jj-card-interactive flex h-full flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-start gap-3">
        <Avatar name={profile.displayName} src={profile.primaryPhoto} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold text-slate-900">
            <Link to={`/app/profiles/${profile.id}`} state={linkState} className="hover:text-brand-700">
              {profile.displayName}
            </Link>
          </h3>
          <p className="text-sm text-slate-500">
            {profile.age} &middot; {GENDER_LABELS[profile.gender] ?? profile.gender}
            {profile.city ? ` \u00b7 ${profile.city}` : ""}
          </p>
          {profile.education || profile.profession ? (
            <p className="mt-0.5 truncate text-xs text-slate-500">
              {[profile.education?.label, profile.profession?.label].filter(Boolean).join(" \u00b7 ")}
            </p>
          ) : null}
        </div>
        {score !== undefined && score !== null ? (
          <Badge tone="brand">{Math.round(score * 100)}% match</Badge>
        ) : null}
      </div>

      {profile.interests.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {profile.interests.slice(0, 4).map((interest) => (
            <li key={interest.slug} className="jj-chip">
              {interest.label}
            </li>
          ))}
        </ul>
      ) : null}

      {profile.about ? (
        <p className="line-clamp-2 text-sm text-slate-600">{profile.about}</p>
      ) : null}

      <div className="mt-auto flex items-center justify-between pt-1">
        <span className="text-xs text-slate-400">{profile.completeness.toFixed(0)}% complete</span>
        {footer ?? (
          <Link
            to={`/app/profiles/${profile.id}`}
            state={linkState}
            className="text-sm font-medium text-brand-700 hover:underline"
          >
            View profile
          </Link>
        )}
      </div>
    </article>
  );
}
