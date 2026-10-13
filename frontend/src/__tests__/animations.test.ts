import { afterEach, describe, expect, it, vi } from "vitest";
import { gsap, prefersReducedMotion, pulse, revealFrom, revealList } from "../lib/animations";

function stubReducedMotion(reduce: boolean): void {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: reduce && query.includes("prefers-reduced-motion"),
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }) as unknown as typeof window.matchMedia
  );
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("prefersReducedMotion", () => {
  it("reports the OS setting", () => {
    stubReducedMotion(true);
    expect(prefersReducedMotion()).toBe(true);

    stubReducedMotion(false);
    expect(prefersReducedMotion()).toBe(false);
  });
});

describe("GSAP wiring", () => {
  it("animates a real element on an interaction when motion is allowed", () => {
    stubReducedMotion(false);
    const element = document.createElement("span");
    document.body.appendChild(element);

    const fromTo = vi.spyOn(gsap, "fromTo");
    pulse(element);

    expect(fromTo).toHaveBeenCalledTimes(1);
    expect(fromTo.mock.calls[0][0]).toBe(element);
  });

  it("does not animate at all when the user asked for reduced motion", () => {
    stubReducedMotion(true);
    const element = document.createElement("span");
    document.body.appendChild(element);

    const fromTo = vi.spyOn(gsap, "fromTo");
    pulse(element);

    expect(fromTo).not.toHaveBeenCalled();
  });

  it("reveals with a scroll trigger when motion is allowed", () => {
    stubReducedMotion(false);
    const element = document.createElement("div");

    const fromTo = vi.spyOn(gsap, "fromTo");
    revealFrom(element, { y: 10 });

    expect(fromTo).toHaveBeenCalledTimes(1);
    const options = fromTo.mock.calls[0][2] as { scrollTrigger?: { trigger: Element } };
    expect(options.scrollTrigger?.trigger).toBe(element);
  });

  it("places an element at its final position instead of animating when motion is reduced", () => {
    stubReducedMotion(true);
    const element = document.createElement("div");

    const fromTo = vi.spyOn(gsap, "fromTo");
    const tween = revealFrom(element);

    expect(tween).toBeNull();
    expect(fromTo).not.toHaveBeenCalled();
    expect(element.style.opacity).toBe("1");
  });

  it("stagger-animates a list and does nothing for an empty list", () => {
    stubReducedMotion(false);
    const fromTo = vi.spyOn(gsap, "fromTo");

    revealList([]);
    expect(fromTo).not.toHaveBeenCalled();

    const elements = [document.createElement("div"), document.createElement("div")];
    revealList(elements);
    expect(fromTo).toHaveBeenCalledTimes(1);
    expect(fromTo.mock.calls[0][0]).toBe(elements);
  });
});
