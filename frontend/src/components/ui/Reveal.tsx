import { useEffect, useRef, type ReactNode } from "react";
import { gsap, prefersReducedMotion } from "../../lib/animations";

/**
 * Fades and lifts its children in when they scroll into view.
 *
 * Content is never hidden with inline styles up front, so if JavaScript fails the
 * page still shows everything; the animation only ever moves an element from a
 * visible-plus-offset state. When `prefers-reduced-motion` is set the effect is
 * skipped entirely and GSAP is told to place the element at its final position.
 */
export function Reveal({
  children,
  delay = 0,
  y = 18,
  className,
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    if (prefersReducedMotion()) {
      gsap.set(element, { opacity: 1, y: 0 });
      return;
    }

    const context = gsap.context(() => {
      gsap.fromTo(
        element,
        { opacity: 0, y },
        {
          opacity: 1,
          y: 0,
          delay,
          duration: 0.6,
          ease: "power2.out",
          scrollTrigger: { trigger: element, start: "top 90%" },
        }
      );
    }, element);

    return () => context.revert();
  }, [delay, y]);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
