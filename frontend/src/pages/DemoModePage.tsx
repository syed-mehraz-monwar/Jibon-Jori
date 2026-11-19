import { useState } from "react";
import { Link } from "react-router-dom";
import { demoApi, type DemoProfile, type DemoResetResult } from "../api/demo.api";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useAsync } from "../hooks/useAsync";
import { BackButton } from "../components/layout/BackButton";
import { PageHeader } from "../components/layout/PageHeader";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { EmptyState } from "../components/ui/EmptyState";

type DemoChecklistItem = {
  feature: string;
  instruction: string;
  to: string;
};

const DEMO_CHECKLIST: DemoChecklistItem[] = [
  { feature: "Session and JWT authentication", instruction: "Watch the live session posture on this page.", to: "/app" },
  { feature: "Username availability", instruction: "Run the availability check on the Developer hub.", to: "/app/developer" },
  { feature: "Email verification", instruction: "Open the registration screen and start an email OTP challenge.", to: "/register" },
  { feature: "Phone verification", instruction: "Open the profile screen and start a phone change OTP.", to: "/app/profile" },
  { feature: "Cloud image upload", instruction: "Open the profile editor and use the photo upload control.", to: "/app/profile" },
  { feature: "Realtime comments", instruction: "Open discovery, then open a profile to comment.", to: "/app/recommendations" },
  { feature: "Likes and dislikes", instruction: "Open discovery and react to a profile.", to: "/app/recommendations" },
  { feature: "Datepicker and adult validation", instruction: "Open the profile editor and set a date of birth.", to: "/app/profile" },
  { feature: "Tailwind design system", instruction: "Browse the landing page, dashboard and feature screens.", to: "/" },
  { feature: "Star rating", instruction: "Open the rating screen and submit a rating.", to: "/app/feedback" },
  { feature: "Embedded video", instruction: "Open the About page and play a curated clip.", to: "/app/about" },
  { feature: "Maps and location", instruction: "Open the profile editor and try the location control.", to: "/app/profile" },
  { feature: "Animations", instruction: "Play the animation demo on the Developer hub.", to: "/app/developer" },
  { feature: "GraphQL teacher lab", instruction: "Open the teacher lab and run the live and failing queries.", to: "/app/developer/graphql" },
];

type DemoPersona = {
  id: string;
  name: string;
  username: string;
  age: number;
  profession: string;
  education: string;
  interests: string[];
  city: string;
  country: string;
};

/**
 * The six fictional adult Bangladeshi personas used by the Demo Mode walkthrough.
 *
 * These are presentation-only personas for the teacher demonstration: they are
 * fictional by design, hold no real accounts, and never carry verified contact
 * state. The Demo Mode reset targets the `demo_` username marker, so these are
 * exactly the records it may clean up.
 */
const DEMO_PERSONAS: DemoPersona[] = [
  { id: "demo-1", name: "Arif Rahman", username: "demo_arif", age: 31, profession: "Software engineer", education: "BSc computer science", interests: ["music", "travel"], city: "Dhaka", country: "Bangladesh" },
  { id: "demo-2", name: "Nusrat Rahman", username: "demo_nusrat", age: 29, profession: "Teacher", education: "MSc education", interests: ["reading", "cooking"], city: "Chittagong", country: "Bangladesh" },
  { id: "demo-3", name: "Rafiqul Islam", username: "demo_rafiq", age: 38, profession: "Doctor", education: "MBBS", interests: ["football", "history"], city: "Dhaka", country: "Bangladesh" },
  { id: "demo-4", name: "Farhana Ahmed", username: "demo_farhana", age: 26, profession: "Product designer", education: "BA design", interests: ["art", "photography"], city: "Sylhet", country: "Bangladesh" },
  { id: "demo-5", name: "Tanvir Hossain", username: "demo_tanvir", age: 34, profession: "Chartered accountant", education: "Chartered accountancy", interests: ["finance", "reading"], city: "Khulna", country: "Bangladesh" },
  { id: "demo-6", name: "Mithila Barua", username: "demo_mithila", age: 27, profession: "Registered nurse", education: "BSc nursing", interests: ["fitness", "music"], city: "Rajshahi", country: "Bangladesh" },
];

export function DemoModePage() {
  const { status, isAdmin } = useAuth();
  const toast = useToast();
  const { data: demoProfiles, status: planStatus } = useAsync<DemoProfile[]>(() => demoApi.plan(), [], { enabled: isAdmin });
  const [armed, setArmed] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [lastReset, setLastReset] = useState<DemoResetResult | null>(null);

  async function runReset() {
    setResetting(true);
    try {
      const result = await demoApi.reset();
      setLastReset(result);
      setArmed(false);
      toast.success("Demo content was reset.", `Deleted ${result.deleted.comments} comments, ${result.deleted.interactions} interactions, ${result.deleted.ratings} ratings, ${result.deleted.feedback} feedback rows and ${result.deleted.notifications} notifications.`);
    } catch {
      toast.error("The demo reset could not be completed.");
    } finally {
      setResetting(false);
    }
  }

  function requestReset() {
    if (!armed) {
      setArmed(true);
      toast.info("Demo reset armed. Press the button again to confirm - nothing has been deleted yet.");
      return;
    }
    void runReset();
  }

  return (
    <>
      <PageHeader
        title="Demo mode"
        description="A guided walkthrough of the implemented features. Demonstrations use the real backend; nothing here is simulated, and the reset only ever touches demo-marked content."
        actions={<BackButton to="/app" label="Back to home" />}
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Walkthrough checklist" className="lg:col-span-2">
          <ol className="flex flex-col gap-2">
            {DEMO_CHECKLIST.map((item) => (
              <li key={item.feature} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{item.feature}</p>
                  <p className="text-xs text-slate-500">{item.instruction}</p>
                </div>
                <Link to={item.to}>
                  <Button size="sm" variant="secondary">
                    Open
                  </Button>
                </Link>
              </li>
            ))}
          </ol>
        </Card>

        <Card title="Your session">
          <div className="flex flex-col gap-2">
            <Badge tone={status === "authenticated" ? "success" : "neutral"}>
              {status === "authenticated" ? "Signed in" : status === "loading" ? "Restoring session" : "Signed out"}
            </Badge>
            <p className="text-sm text-slate-600">
              Demo Mode sits inside the normal authenticated app, so every demonstration inherits the real session,
              authentication guard and row level security.
            </p>
            {status !== "authenticated" ? (
              <Link to="/login">
                <Button size="sm">Sign in to run demos</Button>
              </Link>
            ) : null}
          </div>
        </Card>
      </div>

      <div className="mt-5">
        <Card title="Fictional demo personas" actions={<Badge tone="neutral">Fictional · not real members</Badge>}>
          <p className="mb-4 text-sm text-slate-600">
            The teacher demonstration uses six fictional adult Bangladeshi personas. They are not real accounts and
            hold no verified contact state; they exist only so the discovery, ratings and comments flows can be shown
            without touching real members.
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {DEMO_PERSONAS.map((persona) => (
              <div key={persona.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-base font-semibold text-slate-900">{persona.name}</p>
                <p className="text-xs text-slate-500">{persona.username}</p>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
                  <div>
                    <dt className="text-slate-400">Age</dt>
                    <dd>{persona.age}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-400">Profession</dt>
                    <dd>{persona.profession}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-400">Education</dt>
                    <dd>{persona.education}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-400">Location</dt>
                    <dd>
                      {[persona.city, persona.country].filter(Boolean).join(", ") || "—"}
                    </dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="mt-5">
        <Card title="Demo reset" actions={isAdmin ? <Badge tone="brand">Administrator</Badge> : <Badge tone="warning">Administrator only</Badge>}>
          <p className="mb-3 text-sm text-slate-600">
            The reset removes content that references a <code className="rounded bg-slate-100 px-1">demo_</code>-marked
            profile. It never touches real members, real profiles or any content they created.
          </p>

          {isAdmin ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="danger" loading={resetting} onClick={requestReset}>
                  {armed ? "Press again to confirm the demo reset" : "Reset demo content"}
                </Button>
                {armed ? (
                  <Button variant="secondary" onClick={() => setArmed(false)}>
                    Cancel
                  </Button>
                ) : null}
              </div>

              {planStatus === "loading" ? (
                <p className="text-sm text-slate-500">Loading the demo content that would be reset…</p>
              ) : planStatus === "error" ? (
                <EmptyState title="Demo reset unavailable" description="The demo reset service could not be reached." />
              ) : (
                <ul className="flex flex-col gap-1 text-sm text-slate-600">
                  {(demoProfiles ?? []).map((persona) => (
                    <li key={persona.id} className="flex justify-between gap-2">
                      <span>{persona.displayName ?? persona.username}</span>
                      <span className="font-mono text-xs text-slate-500">{persona.id}</span>
                    </li>
                  ))}
                  {demoProfiles && demoProfiles.length === 0 ? (
                    <li className="text-sm text-slate-500">No demo-marked profiles are present in this project.</li>
                  ) : null}
                </ul>
              )}

              {lastReset ? (
                <p className="text-sm text-slate-600">
                  Last reset removed {lastReset.deleted.comments} comments, {lastReset.deleted.interactions} interactions,{" "}
                  {lastReset.deleted.ratings} ratings, {lastReset.deleted.feedback} feedback rows and{" "}
                  {lastReset.deleted.notifications} notifications.
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-slate-600">
              Only an administrator can run the demo reset. Sign in with an administrator account to enable it.
            </p>
          )}
        </Card>
      </div>
    </>
  );
}
