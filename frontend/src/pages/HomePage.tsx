import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { gsap, prefersReducedMotion } from "../lib/animations";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Reveal } from "../components/ui/Reveal";

const FEATURES = [
  {
    title: "Explainable compatibility",
    body: "Deterministic scoring across interests, education and profession, location, lifestyle and partner preference - with a per-factor breakdown, not a black box.",
  },
  {
    title: "Assisted discovery",
    body: "Search by age, gender, location, education, profession and interests, or let the recommendation engine rank candidates for you.",
  },
  {
    title: "Real-time interaction",
    body: "Comments, likes, favourites and notification badges update live over Supabase Realtime; username availability is checked while you type.",
  },
  {
    title: "Privacy by design",
    body: "Coordinates are coarsened and photo visibility is honoured per viewer. Only the minimum data ever leaves the server.",
  },
];

export function HomePage() {
  const { status } = useAuth();
  const heroRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = heroRef.current;
    if (!element || prefersReducedMotion()) return;

    const context = gsap.context(() => {
      gsap
        .timeline()
        .from("[data-hero-title]", { y: 24, opacity: 0, duration: 0.7, ease: "power3.out" })
        .from("[data-hero-body]", { y: 16, opacity: 0, duration: 0.6, ease: "power2.out" }, "-=0.35")
        .from("[data-hero-actions] > *", { y: 12, opacity: 0, duration: 0.5, stagger: 0.08 }, "-=0.3");
    }, element);

    return () => context.revert();
  }, []);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10">
      <div ref={heroRef} className="jj-hero shadow-sm">
        <p className="jj-chip mb-4">AI-assisted matchmaking</p>
        <h1 data-hero-title className="max-w-2xl font-bold text-slate-900">
          Find a partner with <span className="jj-gradient-text">reasons</span>, not just scores.
        </h1>
        <p data-hero-body className="mt-4 max-w-2xl text-base text-slate-600">
          JibonJori builds a detailed matrimonial profile, computes compatibility from real profile
          data, and explains every factor behind the result.
        </p>
        <div data-hero-actions className="mt-7 flex flex-wrap gap-3">
          {status === "authenticated" ? (
            <Link to="/app">
              <Button size="lg">Go to dashboard</Button>
            </Link>
          ) : (
            <>
              <Link to="/register">
                <Button size="lg">Create an account</Button>
              </Link>
              <Link to="/login">
                <Button size="lg" variant="secondary">
                  Sign in
                </Button>
              </Link>
            </>
          )}
        </div>
      </div>

      <div className="mt-10 grid gap-5 sm:grid-cols-2">
        {FEATURES.map((feature, index) => (
          <Reveal key={feature.title} delay={index * 0.05}>
            <Card className="jj-card-interactive h-full">
              <h2 className="text-base font-semibold text-slate-900">{feature.title}</h2>
              <p className="mt-2 text-sm text-slate-600">{feature.body}</p>
            </Card>
          </Reveal>
        ))}
      </div>
    </div>
  );
}
