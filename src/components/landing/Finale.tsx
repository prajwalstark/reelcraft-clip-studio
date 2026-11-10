import { Link } from "@tanstack/react-router";
import { useRef } from "react";
import { Magnetic, RollText } from "./Interactions";
import { SplitChars } from "./Split";
import { gsap, scrollToTarget, useIsoLayoutEffect } from "./motion";

function Cta() {
  return (
    <div className="flex flex-col items-center px-5 text-center text-black">
      <p className="hud text-black/60">Final cut · Roll credits</p>
      <h2 className="display mt-6 max-w-[14ch] text-[clamp(2.6rem,7.4vw,8.5rem)]">
        Your next reel is <span className="editorial font-normal">already in your footage.</span>
      </h2>
      <div className="mt-12 flex flex-col items-center gap-5 sm:flex-row">
        <Magnetic strength={0.45}>
          <Link
            to="/studio"
            data-cursor="Open"
            className="group relative inline-flex items-center gap-3 overflow-hidden rounded-full bg-black px-9 py-5 text-base font-semibold text-white md:px-12 md:py-6 md:text-lg"
          >
            <span data-magnetic-inner className="relative z-10 flex items-center gap-3">
              <RollText>Open the Studio</RollText>
              <span
                aria-hidden
                className="inline-block transition-transform duration-500 group-hover:translate-x-1"
              >
                →
              </span>
            </span>
            <span
              aria-hidden
              className="absolute inset-0 scale-x-0 origin-left bg-[#1d1f26] transition-transform duration-700 [transition-timing-function:var(--ease-cine)] group-hover:scale-x-100"
            />
          </Link>
        </Magnetic>
        <p className="max-w-[26ch] text-left text-sm text-black/65">
          Free, local-first, no sign-up. Includes a small optional demo clip if you have no footage
          handy.
        </p>
      </div>
    </div>
  );
}

export function Finale({ reduced }: { reduced: boolean }) {
  const section = useRef<HTMLElement>(null);
  const pin = useRef<HTMLDivElement>(null);
  const dot = useRef<HTMLSpanElement>(null);
  const flood = useRef<HTMLDivElement>(null);

  useIsoLayoutEffect(() => {
    if (reduced || !section.current) return;
    const ctx = gsap.context(() => {
      // A vector clip-path circle grows out of the period, so the flood stays razor-sharp
      // (scaling the tiny dot itself would smear it).
      const geo = { cx: 0, cy: 0, r0: 0, far: 0 };
      const measure = () => {
        // rect centre is scale-invariant (origin is centre); size comes from the untransformed box
        const d = dot.current!.getBoundingClientRect();
        const c = pin.current!.getBoundingClientRect();
        geo.r0 = (dot.current!.offsetWidth || 1) / 2;
        geo.cx = d.left - c.left + d.width / 2;
        geo.cy = d.top - c.top + d.height / 2;
        geo.far =
          Math.max(
            Math.hypot(geo.cx, geo.cy),
            Math.hypot(c.width - geo.cx, geo.cy),
            Math.hypot(geo.cx, c.height - geo.cy),
            Math.hypot(c.width - geo.cx, c.height - geo.cy),
          ) * 1.02;
      };
      measure();
      const grow = { t: 0 };
      const paint = () => {
        const r = geo.r0 + (geo.far - geo.r0) * grow.t;
        if (flood.current) {
          flood.current.style.clipPath = `circle(${r}px at ${geo.cx}px ${geo.cy}px)`;
          flood.current.style.visibility = grow.t > 0 ? "visible" : "hidden";
        }
      };
      const tl = gsap.timeline({
        defaults: { ease: "none" },
        scrollTrigger: {
          trigger: section.current,
          start: "top top",
          end: "bottom bottom",
          scrub: 0.7,
          invalidateOnRefresh: true,
          onRefresh: () => (measure(), paint()),
        },
      });
      tl.fromTo(
        ".wrap-title .split-char",
        { yPercent: 115, rotateX: -80 },
        { yPercent: 0, rotateX: 0, stagger: 0.012, duration: 0.18, ease: "power3.out" },
        0,
      )
        .fromTo(dot.current, { scale: 0 }, { scale: 1, duration: 0.06, ease: "back.out(3)" }, 0.16)
        .to(
          ".wrap-title .split-char",
          {
            opacity: 0,
            filter: "blur(8px)",
            stagger: { each: 0.006, from: "end" },
            duration: 0.14,
          },
          0.36,
        )
        .fromTo(grow, { t: 0 }, { t: 1, duration: 0.3, ease: "power2.in", onUpdate: paint }, 0.36)
        .set("[data-wrap-cta]", { autoAlpha: 1 }, 0.66)
        .fromTo(
          "[data-wrap-cta] > *",
          { y: 80, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.2, ease: "power3.out" },
          0.68,
        )
        .to({}, { duration: 0.12 });
    }, section);
    return () => ctx.revert();
  }, [reduced]);

  if (reduced)
    return (
      <section id="finale" aria-label="Get started" className="bg-[var(--volt)] py-32">
        <Cta />
      </section>
    );

  return (
    <section ref={section} id="finale" aria-label="Get started" className="relative h-[320vh]">
      <div
        ref={pin}
        className="sticky top-0 flex h-svh items-center justify-center overflow-hidden bg-[var(--ink)]"
      >
        <p className="hud absolute left-5 top-24 text-white/45 md:left-10 md:top-28">
          <span className="text-[var(--volt)]">(05)</span>&nbsp;&nbsp;Final cut
        </p>
        <h2 className="wrap-title display relative whitespace-nowrap text-[clamp(2.4rem,12vw,16rem)] [perspective:900px]">
          <SplitChars text="That's a wrap" charClassName="text-chrome" />
          <span
            ref={dot}
            aria-hidden
            className="relative ml-[0.04em] inline-block h-[0.2em] w-[0.2em] rounded-full bg-[var(--volt)] align-baseline will-change-transform"
          />
        </h2>
        <div
          ref={flood}
          aria-hidden
          className="invisible absolute inset-0 bg-[var(--volt)]"
          style={{ clipPath: "circle(0px at 50% 50%)" }}
        />
        <div data-wrap-cta className="invisible absolute inset-0 flex items-center justify-center">
          <Cta />
        </div>
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="relative overflow-hidden bg-[var(--volt)] px-5 pb-6 pt-16 text-black md:px-10">
      <div className="grid gap-10 border-t border-black/15 pt-10 md:grid-cols-12">
        <div className="md:col-span-5">
          <p className="hud text-black/55">ReelForge</p>
          <p className="mt-3 max-w-sm text-sm text-black/70">
            A local-first editor for turning long videos into vertical shorts. Your files are
            processed in this browser and never uploaded.
          </p>
        </div>
        <nav
          aria-label="Footer"
          className="hud grid grid-cols-2 gap-3 text-black/75 md:col-span-4 md:col-start-9"
        >
          <Link to="/studio" className="hover:text-black">
            Studio
          </Link>
          <a
            href="#workflow"
            onClick={(e) => (e.preventDefault(), scrollToTarget("#workflow"))}
            className="hover:text-black"
          >
            Workflow
          </a>
          <a
            href="#features"
            onClick={(e) => (e.preventDefault(), scrollToTarget("#features"))}
            className="hover:text-black"
          >
            Features
          </a>
          <a
            href="#top"
            onClick={(e) => (e.preventDefault(), scrollToTarget(0))}
            className="hover:text-black"
          >
            Back to top ↑
          </a>
        </nav>
      </div>
      <p
        aria-hidden
        className="display mt-14 select-none whitespace-nowrap text-center text-[19.5vw] leading-[0.78] tracking-[-0.07em] text-black"
      >
        ReelForge
      </p>
      <div className="hud mt-4 flex justify-between text-[9.5px] text-black/55">
        <span>Footage on this page is rendered in-house with Three.js</span>
        <span>© {new Date().getFullYear()}</span>
      </div>
    </footer>
  );
}
