import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

export { gsap, ScrollTrigger };

/** Animation is a progressive enhancement: honour the OS-level motion setting. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** A short emphasis pulse, used to acknowledge an interaction (like, comment, rating). */
export function pulse(element: Element | null): void {
  if (!element || prefersReducedMotion()) return;
  gsap.fromTo(
    element,
    { scale: 1 },
    { scale: 1.15, duration: 0.15, yoyo: true, repeat: 1, ease: "power1.inOut" }
  );
}

/** Scroll-triggered entrance for a single element. */
export function revealFrom(
  element: Element,
  { y = 18, delay = 0, duration = 0.6 }: { y?: number; delay?: number; duration?: number } = {}
): gsap.core.Tween | null {
  if (prefersReducedMotion()) {
    gsap.set(element, { opacity: 1, y: 0 });
    return null;
  }
  return gsap.fromTo(
    element,
    { opacity: 0, y },
    {
      opacity: 1,
      y: 0,
      delay,
      duration,
      ease: "power2.out",
      scrollTrigger: { trigger: element, start: "top 90%" },
    }
  );
}

/** Staggered entrance for a list of cards. */
export function revealList(elements: Element[]): void {
  if (elements.length === 0) return;
  if (prefersReducedMotion()) {
    gsap.set(elements, { opacity: 1, y: 0 });
    return;
  }
  gsap.fromTo(
    elements,
    { opacity: 0, y: 20 },
    {
      opacity: 1,
      y: 0,
      duration: 0.5,
      ease: "power2.out",
      stagger: 0.05,
      scrollTrigger: { trigger: elements[0], start: "top 92%" },
    }
  );
}
