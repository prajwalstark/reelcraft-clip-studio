import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import type Lenis from "lenis";
import { useEffect, useLayoutEffect, useState } from "react";

if (typeof window !== "undefined") gsap.registerPlugin(ScrollTrigger);

export { gsap, ScrollTrigger };

export const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

export const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

/** Live `prefers-reduced-motion` flag. Always false during SSR, resolved on mount. */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(REDUCED_QUERY);
    setReduced(mq.matches);
    const on = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

export function useMediaQuery(query: string) {
  const [match, setMatch] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    setMatch(mq.matches);
    const on = (e: MediaQueryListEvent) => setMatch(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return match;
}

let lenisInstance: Lenis | null = null;
export const setLenis = (l: Lenis | null) => (lenisInstance = l);
export const getLenis = () => lenisInstance;

/** Smooth-scroll to an anchor, falling back to native scrolling when Lenis is off (reduced motion). */
export function scrollToTarget(target: string | number) {
  const l = getLenis();
  if (l) {
    l.scrollTo(target, { duration: 1.6, easing: (t) => 1 - Math.pow(1 - t, 4) });
    return;
  }
  if (typeof target === "number") window.scrollTo({ top: target });
  else document.querySelector(target)?.scrollIntoView();
}

export function hasWebGL() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** Map progress `p` into a 0..1 sub-range [a, b]. */
export const range = (p: number, a: number, b: number) => clamp01((p - a) / (b - a));
