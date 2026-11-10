import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { gsap, hasWebGL, ScrollTrigger, useIsoLayoutEffect } from "./motion";

const StoryScene = lazy(() => import("./StoryScene"));

const COPY =
  "Every long video hides a dozen shorts. ReelForge slices the master into equal cuts, reframes each one for the vertical screen and burns in the words — without a single byte leaving your machine.";

export function Story({ reduced }: { reduced: boolean }) {
  const section = useRef<HTMLElement>(null);
  const progress = useRef(0);
  const [near, setNear] = useState(false);
  const [visible, setVisible] = useState(false);
  const [gl, setGl] = useState<boolean | null>(null);
  const [high, setHigh] = useState(false);

  useEffect(() => {
    setGl(hasWebGL());
    setHigh(
      window.matchMedia("(min-width: 900px) and (pointer: fine)").matches &&
        (navigator.hardwareConcurrency ?? 4) >= 6,
    );
    const el = section.current;
    if (!el) return;
    // Mount the WebGL scene a screen early; only render frames while on screen.
    const pre = new IntersectionObserver(([e]) => e?.isIntersecting && setNear(true), {
      rootMargin: "100% 0px",
    });
    const vis = new IntersectionObserver(([e]) => setVisible(!!e?.isIntersecting));
    pre.observe(el);
    vis.observe(el);
    return () => (pre.disconnect(), vis.disconnect());
  }, []);

  useIsoLayoutEffect(() => {
    if (!section.current) return;
    const ctx = gsap.context(() => {
      if (reduced) {
        progress.current = 0.9;
        return;
      }
      ScrollTrigger.create({
        trigger: section.current,
        start: "top bottom",
        end: "bottom bottom",
        onUpdate: (s) => (progress.current = s.progress),
      });
      gsap.fromTo(
        ".story-word",
        { opacity: 0.12 },
        {
          opacity: 1,
          stagger: 0.05,
          ease: "none",
          scrollTrigger: {
            trigger: section.current,
            start: "top top",
            end: "60% bottom",
            scrub: true,
          },
        },
      );
      gsap.fromTo(
        "[data-story-steps] li",
        { yPercent: 100, opacity: 0 },
        {
          yPercent: 0,
          opacity: 1,
          stagger: 0.25,
          ease: "power2.out",
          scrollTrigger: {
            trigger: section.current,
            start: "35% bottom",
            end: "80% bottom",
            scrub: true,
          },
        },
      );
    }, section);
    return () => ctx.revert();
  }, [reduced]);

  return (
    <section
      ref={section}
      id="story"
      className={reduced ? "relative" : "relative h-[340vh]"}
      aria-labelledby="story-title"
    >
      <div
        className={
          reduced ? "relative min-h-svh overflow-hidden" : "sticky top-0 h-svh overflow-hidden"
        }
      >
        <div aria-hidden className="absolute inset-0">
          {gl && near && !reduced ? (
            <Suspense fallback={null}>
              <StoryScene progress={progress} active={visible} high={high} />
            </Suspense>
          ) : (
            gl !== null && (
              <div className="flex h-full items-center justify-center gap-3 px-6 [perspective:1400px]">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className="aspect-[9/16] w-[16vw] max-w-48 overflow-hidden rounded-xl border border-white/10 bg-cover shadow-2xl"
                    style={{
                      backgroundImage: "url(/media/ridge-poster.jpg)",
                      backgroundPosition: `${i * 25}% 50%`,
                      transform: `rotateY(${(2 - i) * 12}deg) translateZ(${-Math.abs(2 - i) * 40}px)`,
                    }}
                  />
                ))}
              </div>
            )
          )}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[var(--ink)] via-transparent to-[var(--ink)]/70" />
          <div className="pointer-events-none absolute inset-y-0 left-0 w-2/3 bg-gradient-to-r from-[var(--ink)]/85 to-transparent md:w-1/2" />
        </div>

        <div className="relative z-10 flex h-full flex-col justify-between px-5 pb-10 pt-28 md:px-10 md:pb-14 md:pt-32">
          <p className="hud text-white/45">
            <span className="text-[var(--volt)]">(01)</span>&nbsp;&nbsp;The idea
          </p>
          <div className="grid gap-10 md:grid-cols-12">
            <h2
              id="story-title"
              className="max-w-[18ch] text-[clamp(1.7rem,3.4vw,3.4rem)] font-medium leading-[1.08] tracking-[-0.03em] md:col-span-7"
            >
              {COPY.split(" ").map((w, i) => (
                <span key={i} className={`story-word ${i < 7 ? "editorial text-[1.08em]" : ""}`}>
                  {w}{" "}
                </span>
              ))}
            </h2>
            <ol
              data-story-steps
              className="hud flex flex-col justify-end gap-3 text-white/60 md:col-span-4 md:col-start-9"
            >
              {[
                ["Master", "16:9 · any length"],
                ["Split", "15 · 30 · 60 s or custom"],
                ["Reframe", "9:16 · 1:1 · 16:9"],
                ["Export", "MP4 / WebM · SRT"],
              ].map(([k, v], i) => (
                <li
                  key={k}
                  className="flex items-baseline justify-between gap-6 overflow-hidden border-t border-white/10 pt-3"
                >
                  <span>
                    <span className="text-white/30">0{i + 1}</span>&nbsp;&nbsp;{k}
                  </span>
                  <span className="text-white/90">{v}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
}
