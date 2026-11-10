import { useEffect, useRef, useState } from "react";
import { gsap, ScrollTrigger, useIsoLayoutEffect } from "./motion";

const FEATURES = [
  {
    k: "Local-first",
    d: "Footage never leaves the browser. No uploads, no accounts, no API keys.",
    pos: "10% 50%",
  },
  {
    k: "Split by duration",
    d: "15, 30 or 60 seconds — or custom. Every second of the source is covered.",
    pos: "30% 50%",
  },
  {
    k: "Frame-true crop",
    d: "9:16, 1:1, 16:9 with focal point, fit/fill and zoom. Preview equals export.",
    pos: "50% 50%",
  },
  {
    k: "Timed captions",
    d: "Write or import SRT/VTT, style it, burn it in, download a matching SRT.",
    pos: "70% 50%",
  },
  {
    k: "Batch export",
    d: "Queue many clips with real progress and cancel. Download them as a ZIP.",
    pos: "85% 50%",
  },
  {
    k: "Sequence Studio",
    d: "A multitrack timeline with GPU enhancement and 4K UHD export. In beta.",
    pos: "60% 40%",
  },
  {
    k: "Undo everything",
    d: "Full undo/redo history plus project JSON import and export.",
    pos: "40% 60%",
  },
];

function Marquee({ reduced }: { reduced: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  useIsoLayoutEffect(() => {
    if (reduced || !root.current) return;
    const ctx = gsap.context(() => {
      const rows = gsap.utils.toArray<HTMLElement>("[data-marquee-row]");
      const tweens = rows.map((row, i) =>
        gsap.fromTo(
          row,
          { xPercent: i % 2 ? -50 : 0 },
          { xPercent: i % 2 ? 0 : -50, duration: 38, ease: "none", repeat: -1 },
        ),
      );
      // Scroll velocity speeds the reels up and flips direction when scrolling back.
      ScrollTrigger.create({
        trigger: root.current,
        start: "top bottom",
        end: "bottom top",
        onUpdate: (s) => {
          const v = s.getVelocity() / 220;
          tweens.forEach((t) => {
            gsap.to(t, {
              timeScale: gsap.utils.clamp(-8, 8, (s.direction || 1) * Math.max(1, Math.abs(v))),
              duration: 0.3,
              overwrite: true,
            });
            gsap.to(t, {
              timeScale: s.direction || 1,
              duration: 1.2,
              delay: 0.3,
              overwrite: false,
            });
          });
        },
      });
    }, root);
    return () => ctx.revert();
  }, [reduced]);
  const words = ["Split", "Trim", "Crop", "Caption", "Export"];
  return (
    <div
      ref={root}
      aria-hidden
      className="relative -rotate-2 select-none overflow-hidden border-y border-white/10 bg-[var(--charcoal)] py-6 md:py-8"
    >
      {[0, 1].map((r) => (
        <div key={r} data-marquee-row className="flex w-max whitespace-nowrap">
          {[0, 1].map((dup) => (
            <div key={dup} className="flex items-center">
              {words.concat(words).map((w, i) => (
                <span
                  key={i}
                  className={`display flex items-center px-6 text-[clamp(3rem,8vw,8.5rem)] ${(i + r) % 2 ? "text-outline" : "text-chrome"}`}
                >
                  {w}
                  <span className="ml-12 inline-block h-[0.18em] w-[0.18em] rounded-full bg-[var(--volt)] shadow-[0_0_20px_var(--volt)]" />
                </span>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function Features({ reduced }: { reduced: boolean }) {
  const section = useRef<HTMLElement>(null);
  const preview = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<number | null>(null);

  useIsoLayoutEffect(() => {
    if (reduced || !section.current) return;
    const ctx = gsap.context(() => {
      gsap.utils.toArray<HTMLElement>("[data-feature]").forEach((row) => {
        const tl = gsap.timeline({
          scrollTrigger: { trigger: row, start: "top 88%", end: "top 55%", scrub: 0.6 },
        });
        tl.fromTo(row.querySelector("[data-rule]"), { scaleX: 0 }, { scaleX: 1, ease: "none" }, 0)
          .fromTo(
            row.querySelector("[data-title]"),
            { yPercent: 105, rotateX: -50 },
            { yPercent: 0, rotateX: 0, ease: "power3.out" },
            0,
          )
          .fromTo(
            row.querySelectorAll("[data-meta]"),
            { opacity: 0, y: 16 },
            { opacity: 1, y: 0, ease: "power2.out" },
            0.15,
          );
      });
      gsap.fromTo(
        "[data-feat-title] .split-word",
        { yPercent: 110 },
        {
          yPercent: 0,
          stagger: 0.08,
          duration: 1.3,
          ease: "expo.out",
          scrollTrigger: { trigger: "[data-feat-title]", start: "top 80%" },
        },
      );
    }, section);
    return () => ctx.revert();
  }, [reduced]);

  // Cursor-following preview of the reel crop for the hovered feature.
  useEffect(() => {
    const el = preview.current;
    const sec = section.current;
    if (!el || !sec || reduced || !window.matchMedia("(pointer: fine)").matches) return;
    const x = gsap.quickTo(el, "x", { duration: 0.7, ease: "power3" });
    const y = gsap.quickTo(el, "y", { duration: 0.7, ease: "power3" });
    const r = gsap.quickTo(el, "rotation", { duration: 0.9, ease: "power3" });
    let lastX = 0;
    const move = (e: PointerEvent) => {
      x(e.clientX);
      y(e.clientY);
      r(gsap.utils.clamp(-12, 12, (e.clientX - lastX) * 0.6));
      lastX = e.clientX;
    };
    sec.addEventListener("pointermove", move);
    return () => sec.removeEventListener("pointermove", move);
  }, [reduced]);

  useEffect(() => {
    if (!preview.current) return;
    gsap.to(preview.current, {
      scale: active === null ? 0 : 1,
      opacity: active === null ? 0 : 1,
      duration: 0.6,
      ease: "expo.out",
    });
  }, [active]);

  return (
    <section
      ref={section}
      id="features"
      aria-labelledby="features-title"
      className="relative bg-[var(--ink)] pb-28 md:pb-40"
    >
      <Marquee reduced={reduced} />
      <div className="px-5 pt-28 md:px-10 md:pt-40">
        <div className="grid gap-8 md:grid-cols-12">
          <p className="hud text-white/45 md:col-span-3">
            <span className="text-[var(--volt)]">(04)</span>&nbsp;&nbsp;Features
          </p>
          <h2
            id="features-title"
            data-feat-title
            className="display text-[clamp(2.6rem,7vw,8rem)] md:col-span-9"
          >
            {["Built", "for", "the"].map((w) => (
              <span key={w} className="inline-block overflow-hidden pb-[0.08em] align-bottom">
                <span className="split-word text-chrome inline-block">{w}&nbsp;</span>
              </span>
            ))}
            <br />
            {["edit,", "not", "the", "upload."].map((w) => (
              <span key={w} className="inline-block overflow-hidden pb-[0.08em] align-bottom">
                <span className="split-word editorial inline-block font-normal text-white">
                  {w}&nbsp;
                </span>
              </span>
            ))}
          </h2>
        </div>

        <ul className="mt-20 md:mt-28" onPointerLeave={() => setActive(null)}>
          {FEATURES.map((f, i) => (
            <li
              key={f.k}
              data-feature
              data-cursor="View"
              onPointerEnter={() => setActive(i)}
              className="group relative grid grid-cols-12 items-baseline gap-4 py-6 md:py-8"
            >
              <span
                data-rule
                aria-hidden
                className="absolute inset-x-0 top-0 h-px origin-left bg-white/15"
              />
              <span data-meta className="hud col-span-2 text-white/35 md:col-span-1">
                ({String(i + 1).padStart(2, "0")})
              </span>
              <span className="col-span-10 overflow-hidden [perspective:800px] md:col-span-7">
                <span
                  data-title
                  className="display block origin-bottom text-[clamp(2rem,5.4vw,5.6rem)] text-white/85 transition-[color,transform,letter-spacing] duration-700 [transition-timing-function:var(--ease-cine)] group-hover:translate-x-4 group-hover:text-white md:group-hover:translate-x-8"
                >
                  {f.k}
                  <span className="editorial ml-3 inline-block text-[0.5em] text-[var(--volt)] opacity-0 transition-opacity duration-500 group-hover:opacity-100">
                    ↗
                  </span>
                </span>
              </span>
              <p
                data-meta
                className="col-span-10 col-start-3 max-w-sm text-[15px] leading-relaxed text-white/50 transition-colors duration-500 group-hover:text-white/80 md:col-span-4 md:col-start-9"
              >
                {f.d}
              </p>
            </li>
          ))}
          <li aria-hidden className="h-px bg-white/15" />
        </ul>
      </div>
      <div
        ref={preview}
        aria-hidden
        className="pointer-events-none fixed left-0 top-0 z-40 -ml-28 -mt-48 hidden aspect-[9/16] w-56 overflow-hidden rounded-2xl border border-white/20 opacity-0 shadow-[0_30px_80px_-10px_rgba(0,0,0,0.9)] md:block"
      >
        <div
          className="h-full w-full bg-cover transition-[background-position] duration-700 [transition-timing-function:var(--ease-cine)]"
          style={{
            backgroundImage: "url(/media/ridge-poster.jpg)",
            backgroundPosition: (active !== null && FEATURES[active]?.pos) || "50% 50%",
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
        <span className="hud absolute bottom-3 left-3 text-[9px] text-[var(--volt)]">
          {active !== null ? FEATURES[active]?.k : ""}
        </span>
      </div>
    </section>
  );
}
