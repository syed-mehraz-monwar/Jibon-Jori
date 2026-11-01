import { cn } from "../../lib/cn";

/**
 * The JibonJori mark.
 *
 * A monogram "J" inside a rounded brand tile, drawn with CSS rather than
 * loaded from a bitmap, so it stays crisp at every density and needs no extra
 * asset in the APK. The official launcher icon remains the Android mipmap; this
 * mark is the in-app header/splash identity.
 */
export function BrandMark({ className, size = "md" }: { className?: string; size?: "sm" | "md" | "lg" }) {
  const dimensions = {
    sm: "h-8 w-8 text-base rounded-lg",
    md: "h-10 w-10 text-lg rounded-xl",
    lg: "h-16 w-16 text-3xl rounded-2xl",
  }[size];

  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center bg-gradient-to-br from-brand-500 to-brand-700 font-serif font-bold text-white shadow-sm ring-1 ring-brand-800/20",
        dimensions,
        className
      )}
    >
      J
    </span>
  );
}

export function BrandLockup({ className, subtitle }: { className?: string; subtitle?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <BrandMark />
      <span className="flex flex-col leading-tight">
        <span className="text-lg font-bold tracking-tight text-slate-900">JibonJori</span>
        {subtitle ? <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{subtitle}</span> : null}
      </span>
    </span>
  );
}
