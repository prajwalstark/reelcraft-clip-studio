import Lenis from "lenis";
import { useCallback, useEffect, useRef, useState } from "react";
import { Features } from "./Features";
import { Finale, Footer } from "./Finale";
import { Hero } from "./Hero";
import { Cursor } from "./Interactions";
import { gsap, ScrollTrigger, setLenis, useIsoLayoutEffect, useReducedMotion } from "./motion";
import { Nav } from "./Nav";
import { Showcase } from "./Showcase";
import { Story } from "./Story";
import { Workflow } from "./Workflow";

function Preloader({
  progress,
  loaded,
  onDone,
}: {
  progress: number;
  loaded: boolean;
  onDone: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const num = useRef<HTMLSpanElement>(null);
  const shown = useRef({ v: 0 });
  const started = useRef(performance.now());
  const [gone, setGone] = useState(false);

  // Count smoothly toward real download progress.
  useEffect(() => {
    gsap.to(shown.current, {
      v: progress * 100,
      duration: 0.6,
      ease: "power2.out",
      overwrite: true,
      onUpdate: () => {
        if (num.current)
          num.current.textContent = String(Math.round(shown.current.v)).padStart(3, "0");
      },
    });
  }, [progress]);

  useEffect(() => {
    if (!loaded || !root.current) return;
    const wait = Math.max(0, 1.1 - (performance.now() - started.current) / 1000);
    const tl = gsap.timeline({ delay: wait, onComplete: () => setGone(true) });
    tl.to(shown.current, {
      v: 100,
      duration: 0.4,
      onUpdate: () => {
        if (num.current)
          num.current.textContent = String(Math.round(shown.current.v)).padStart(3, "0");
      },
    })
      .to("[data-pre-fade]", {
        opacity: 0,
        y: -20,
        duration: 0.5,
        ease: "power2.in",
        stagger: 0.05,
      })
      .call(onDone)
      .to("[data-pre-top]", { yPercent: -100, duration: 1.3, ease: "expo.inOut" }, "<")
      .to("[data-pre-bottom]", { yPercent: 100, duration: 1.3, ease: "expo.inOut" }, "<");
    return () => {
      tl.kill();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  if (gone) return null;
  return (
    <div
      ref={root}
      className="fixed inset-0 z-[90]"
      role="status"
      aria-live="polite"
      aria-label="Loading"
    >
      <div data-pre-top className="absolute inset-x-0 top-0 h-1/2 bg-[var(--ink)]" />
      <div data-pre-bottom className="absolute inset-x-0 bottom-0 h-1/2 bg-[var(--ink)]" />
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <p data-pre-fade className="hud mb-6 text-white/45">
          Loading master reel
        </p>
        <span
          data-pre-fade
          ref={num}
          className="display text-chrome text-[clamp(5rem,16vw,14rem)] tabular-nums"
        >
          000
        </span>
        <div data-pre-fade className="mt-8 h-px w-48 overflow-hidden bg-white/10">
          <div
            className="h-full origin-left bg-[var(--volt)] transition-transform duration-500"
            style={{ transform: `scaleX(${progress})` }}
          />
        </div>
      </div>
      <div data-pre-fade className="hud absolute bottom-6 left-5 text-white/35 md:left-10">
        ReelForge — projector warm-up
      </div>
      <div data-pre-fade className="hud absolute bottom-6 right-5 text-white/35 md:right-10">
        24 fps · 16:9 → 9:16
      </div>
    </div>
  );
}

export function Landing() {
  const reduced = useReducedMotion();
  const [progress, setProgress] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const lenisRef = useRef<Lenis | null>(null);

  useEffect(() => {
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
    window.scrollTo(0, 0);
  }, []);

  // Lenis drives the scroll; GSAP's ticker drives Lenis so ScrollTrigger and smooth scroll share one clock.
  useIsoLayoutEffect(() => {
    if (reduced) return;
    const lenis = new Lenis({ lerp: 0.085, wheelMultiplier: 0.9, touchMultiplier: 1.4 });
    lenisRef.current = lenis;
    setLenis(lenis);
    lenis.on("scroll", ScrollTrigger.update);
    const raf = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(raf);
    gsap.ticker.lagSmoothing(0);
    lenis.stop();
    return () => {
      gsap.ticker.remove(raf);
      lenis.destroy();
      setLenis(null);
      lenisRef.current = null;
    };
  }, [reduced]);

  useEffect(() => {
    if (!revealed) return;
    lenisRef.current?.start();
    document.fonts?.ready.then(() => ScrollTrigger.refresh());
  }, [revealed]);

  const onProgress = useCallback((p: number) => setProgress(p), []);
  const onLoaded = useCallback(() => setLoaded(true), []);
  const onDone = useCallback(() => setRevealed(true), []);

  return (
    <div data-landing className="relative min-h-svh">
      <a
        href="#story"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[110] focus:rounded focus:bg-white focus:px-3 focus:py-2 focus:text-black"
      >
        Skip intro
      </a>
      {!reduced && <Preloader progress={progress} loaded={loaded} onDone={onDone} />}
      <Cursor />
      <Nav />
      <main>
        <Hero
          reduced={reduced}
          revealed={revealed || reduced}
          onProgress={onProgress}
          onLoaded={onLoaded}
        />
        <Story reduced={reduced} />
        <Workflow reduced={reduced} />
        <Showcase reduced={reduced} />
        <Features reduced={reduced} />
        <Finale reduced={reduced} />
      </main>
      <Footer />
      {/* film grain over everything */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-[80] opacity-[0.07] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
        }}
      />
    </div>
  );
}
