import { useState } from "react";
import { Link } from "react-router-dom";
import { profileApi } from "../api/profile.api";
import { useAuth } from "../context/AuthContext";
import { useAsync } from "../hooks/useAsync";
import { useRealtime } from "../hooks/useRealtime";
import { ApiError } from "../lib/http";
import { relativeTime } from "../lib/format";
import { PageHeader } from "../components/layout/PageHeader";
import { CompletenessMeter } from "../components/profile/CompletenessMeter";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { Spinner } from "../components/ui/Spinner";

type Activity = { id: string; label: string; at: string };

/**
 * Dashboard.
 *
 * Also the one place in the app where the target-owner realtime events land: the
 * backend emits `like:new`, `comment:new`, `rating:new` and `notification:new` to
 * the affected member's room, which is this user. The activity feed below is fed
 * straight from those events, so it is genuinely realtime rather than polled.
 */
export function DashboardPage() {
  const { user } = useAuth();
  const profile = useAsync((signal) => profileApi.getMine(signal), []);
  const [activity, setActivity] = useState<Activity[]>([]);

  useRealtime({
    "like:new": (payload) => {
      const { value, removed } = payload as { value?: number; removed?: boolean };
      if (removed) {
        push("Someone withdrew their reaction to your profile");
        return;
      }
      push(`Someone ${value === 2 ? "favourited" : value === -1 ? "disliked" : "liked"} your profile`);
    },
    "comment:new": (payload) => {
      const body = (payload as { body?: string }).body ?? "";
      push(`New comment: "${body.slice(0, 60)}"`);
    },
    "rating:new": (payload) => {
      const score = (payload as { score?: number }).score;
      push(`New rating of ${score ?? "?"}/5`);
    },
    "notification:new": () => push("New notification"),
  });

  function push(label: string) {
    setActivity((current) =>
      [{ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, label, at: new Date().toISOString() }, ...current].slice(0, 12)
    );
  }

  const missingProfile = profile.status === "error" && profile.error instanceof ApiError && profile.error.status === 404;

  return (
    <>
      <PageHeader
        title={`Welcome, ${user?.username ?? "member"}`}
        description="Your profile, discovery and activity at a glance."
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Your profile" className="lg:col-span-2">
          {profile.status === "loading" ? (
            <div className="flex justify-center py-6">
              <Spinner className="h-6 w-6 text-brand-600" />
            </div>
          ) : missingProfile ? (
            <EmptyState
              title="Your profile is not created yet"
              description="Create your profile to appear in search and to receive recommendations."
              action={
                <Link to="/app/profile">
                  <Button>Create profile</Button>
                </Link>
              }
            />
          ) : profile.status === "error" ? (
            <p className="text-sm text-red-700">Could not load your profile.</p>
          ) : profile.data ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-lg font-semibold text-slate-900">{profile.data.profile.displayName}</p>
                <Badge tone={profile.data.profile.isPublic ? "success" : "warning"}>
                  {profile.data.profile.isPublic ? "Listed in discovery" : "Hidden"}
                </Badge>
                <Badge tone="neutral">Photos: {profile.data.profile.photoVisibility}</Badge>
              </div>
              <CompletenessMeter value={profile.data.profile.completeness} />
              <div className="flex flex-wrap gap-2">
                <Link to="/app/profile">
                  <Button variant="secondary" size="sm">
                    Edit profile
                  </Button>
                </Link>
                <Link to="/app/preferences">
                  <Button variant="secondary" size="sm">
                    Partner preferences
                  </Button>
                </Link>
                <Link to="/app/recommendations">
                  <Button size="sm">See my matches</Button>
                </Link>
              </div>
            </div>
          ) : null}
        </Card>

        <Card title="Live activity">
          {activity.length === 0 ? (
            <p className="text-sm text-slate-500">
              Nothing yet. Likes, comments and ratings on your profile appear here the moment they happen.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {activity.map((item) => (
                <li key={item.id} className="rounded-lg bg-slate-50 px-3 py-2">
                  <p className="text-sm text-slate-700">{item.label}</p>
                  <p className="text-xs text-slate-400">{relativeTime(item.at)}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
