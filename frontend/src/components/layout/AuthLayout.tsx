import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { BrandMark } from "./BrandMark";

/**
 * Layout shared by the authentication screens.
 *
 * These screens are full-screen flows, so they deliberately do not use the
 * application shell: no drawer, no bottom bar. The card is width-capped and
 * vertically centred, with `env(safe-area-inset-*)` padding so the layout does
 * not collide with the Android status/navigation bars.
 */
export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50 px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))]">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center">
        <Link to="/" className="mb-6 flex items-center justify-center gap-3" aria-label="JibonJori home">
          <BrandMark size="lg" />
          <span className="text-2xl font-bold tracking-tight text-slate-900">JibonJori</span>
        </Link>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <header className="mb-5">
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
            {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
          </header>
          {children}
        </section>

        {footer ? <div className="mt-4 text-center text-sm text-slate-500">{footer}</div> : null}
      </div>
    </div>
  );
}
