import { useEffect, useRef } from "react";
import { gsap, ScrollTrigger, range, useIsoLayoutEffect } from "./motion";

const SRC = "/media/ridge-loop.mp4";

function Reel({
  offset,
  position,
  caption,
  side,
}: {
  offset: number;
  position: string;
  caption: string;
  side: "l" | "r";
}) {
  return (
    <div
      data-side-reel={side}
      className="absolute top-1/2 aspect-[9/16] h-[72svh] max-h-[760px] -translate-y-1/2 overflow-hidden rounded-[26px] border border-white/15 opacity-0 shadow-[0_40px_120px_-20px_rgba(0,0,0,0.9)]"
      style={{ left: "50%" }}
    >
      <video
        src={SRC}
        muted
        loop
        playsInline
        preload="none"
        data-offset={offset}
        className="h-full w-full object-cover"
        style={{ objectPosition: position }}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/20" />
      <p className="absolute inset-x-4 bottom-[18%] text-center text-[clamp(14px,1.5vw,20px)] font-extrabold uppercase leading-tight tracking-tight text-white [text-shadow:0_3px_14px_rgba(0,0,0,.9)]">
        {caption}
      </p>
      <span className="hud absolute left-3 top-3 rounded-full bg-black/50 px-2 py-1 text-[9px] text-white/80 backdrop-blur">
        Reel {side === "l" ? "01" : "03"}
      </span>
    </div>
  );
}

export function Showcase({ reduced }: { reduced: boolean }) {
  const section = useRef<HTMLElement>(null);
  const main = useRef<HTMLVideoElement>(null);
  const window_ = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLSpanElement>(null);

  // Play the videos only while the section is on screen.
  useEffect(() => {
    const el = section.current;
    if (!el) return;
    const vids = Array.from(el.querySelectorAll("video"));
    const io = new IntersectionObserver(
      ([e]) => {
        vids.forEach((v) => {
          if (e?.isIntersecting && !reduced) {
            if (v.preload === "none") {
              v.preload = "auto";
              const off = Number(v.dataset["offset"] || 0);
              if (off)
                v.addEventListener("loadedmetadata", () => (v.currentTime = off), { once: true });
            }
            v.play().catch(() => {});
          } else v.pause();
        });
      },
      { rootMargin: "20% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [reduced]);

  useIsoLayoutEffect(() => {
    if (reduced || !section.current) return;
    const ctx = gsap.context(() => {
      const crop = { w: 0, h: 0 };
      const measure = () => {
        const vh = window.innerHeight;
        crop.h = Math.min(vh * 0.72, 760);
        crop.w = (crop.h * 9) / 16;
      };
      measure();
      ScrollTrigger.addEventListener("refreshInit", measure);
      const apply = (p: number) => {
        const W = window.innerWidth;
        const H = window.innerHeight;
        const a = gsap.parseEase("expo.inOut")(range(p, 0.05, 0.36));
        const pan = range(p, 0.38, 0.62);
        const spread = gsap.parseEase("expo.out")(range(p, 0.62, 0.86));
        // focal point sweeps left -> right and settles centre
        const focal = Math.sin(pan * Math.PI * 1.5) * 0.28 * (1 - spread);
        const cx = W / 2 + focal * W;
        const left = gsap.utils.interpolate(0, cx - crop.w / 2, a);
        const right = gsap.utils.interpolate(0, W - (cx + crop.w / 2), a);
        const top = gsap.utils.interpolate(0, (H - crop.h) / 2, a);
        const radius = gsap.utils.interpolate(0, 26, a);
        if (window_.current) {
          window_.current.style.clipPath = `inset(${top}px ${right}px ${top}px ${left}px round ${radius}px)`;
          window_.current.style.setProperty("--crop-l", `${left}px`);
          window_.current.style.setProperty("--crop-r", `${right}px`);
          window_.current.style.setProperty("--crop-t", `${top}px`);
        }
        if (label.current) label.current.textContent = `Focal ${Math.round(50 + focal * 100)}%`;
        gsap.set("[data-crop-guides]", { opacity: a * (1 - spread * 0.6) });
        gsap.set("[data-backdrop]", { opacity: 0.45 * a * (1 - spread) });
        const gap = crop.w + Math.min(W * 0.04, 48);
        gsap.set("[data-side-reel='l']", {
          xPercent: -50,
          x: -gap * spread - 200 * (1 - spread),
          rotateY: 28 - 10 * spread,
          z: -80,
          opacity: spread,
        });
        gsap.set("[data-side-reel='r']", {
          xPercent: -50,
          x: gap * spread + 200 * (1 - spread),
          rotateY: -28 + 10 * spread,
          z: -80,
          opacity: spread,
        });
        gsap.set("[data-main-caption]", { opacity: spread, y: 20 * (1 - spread) });
      };
      ScrollTrigger.create({
        trigger: section.current,
        start: "top top",
        end: "bottom bottom",
        scrub: true,
        onUpdate: (s) => apply(s.progress),
        onRefresh: (s) => apply(s.progress),
      });
      gsap.fromTo(
        "[data-show-title] .split-word",
        { yPercent: 110 },
        {
          yPercent: 0,
          stagger: 0.06,
          ease: "expo.out",
          duration: 1.2,
          scrollTrigger: { trigger: section.current, start: "top 40%" },
        },
      );
      return () => ScrollTrigger.removeEventListener("refreshInit", measure);
    }, section);
    return () => ctx.revert();
  }, [reduced]);

  return (
    <section
      ref={section}
      id="showcase"
      aria-labelledby="showcase-title"
      className={reduced ? "relative" : "relative h-[420vh]"}
    >
      <div
        className={
          reduced ? "relative py-24" : "sticky top-0 h-svh overflow-hidden [perspective:1600px]"
        }
      >
        {reduced ? (
          <div className="px-5 md:px-10">
            <h2 id="showcase-title" className="display text-[clamp(2.6rem,7vw,8rem)]">
              <span className="text-chrome">What you see</span>
              <br />
              <span className="editorial text-white">is what you export.</span>
            </h2>
            <div className="mt-12 flex justify-center gap-4">
              {["20%", "50%", "80%"].map((pos) => (
                <img
                  key={pos}
                  src="/media/ridge-poster.jpg"
                  alt=""
                  className="aspect-[9/16] w-1/4 max-w-56 rounded-2xl object-cover"
                  style={{ objectPosition: pos }}
                />
              ))}
            </div>
          </div>
        ) : (
          <>
            {/* dim full frame: what lies outside the crop */}
            <img
              data-backdrop
              src="/media/ridge-poster.jpg"
              alt=""
              aria-hidden
              className="absolute inset-0 h-full w-full scale-105 object-cover opacity-0 blur-md"
            />
            <Reel side="l" offset={1.6} position="18% 50%" caption="Every frame counts" />
            <Reel side="r" offset={3.8} position="82% 50%" caption="Ship it tonight" />
            <div ref={window_} className="absolute inset-0 will-change-[clip-path]">
              <video
                ref={main}
                src={SRC}
                muted
                loop
                playsInline
                preload="none"
                poster="/media/ridge-poster.jpg"
                aria-label="Sample footage cropped live from 16:9 to 9:16"
                className="absolute inset-0 h-full w-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-transparent to-black/60" />
              <p
                data-main-caption
                className="absolute inset-x-0 bottom-[calc(var(--crop-t,0px)+18%)] text-center text-[clamp(14px,1.5vw,20px)] font-extrabold uppercase tracking-tight text-white opacity-0 [text-shadow:0_3px_14px_rgba(0,0,0,.9)]"
              >
                One master{" "}
                <span className="rounded bg-[var(--volt)] px-1.5 text-black">three reels</span>
              </p>
            </div>
            {/* crop guides that ride the window */}
            <div
              data-crop-guides
              aria-hidden
              className="pointer-events-none absolute opacity-0"
              style={{ inset: "var(--crop-t) var(--crop-r) var(--crop-t) var(--crop-l)" }}
            >
              {[
                "left-0 top-0 border-l-2 border-t-2",
                "right-0 top-0 border-r-2 border-t-2",
                "bottom-0 left-0 border-b-2 border-l-2",
                "bottom-0 right-0 border-b-2 border-r-2",
              ].map((c) => (
                <span key={c} className={`absolute -m-2 h-6 w-6 border-[var(--volt)] ${c}`} />
              ))}
              <span className="hud absolute -top-8 left-0 whitespace-nowrap text-[var(--volt)]">
                9:16 · 1080 × 1920
              </span>
              <span
                ref={label}
                className="hud absolute -bottom-8 right-0 whitespace-nowrap text-white/60"
              >
                Focal 50%
              </span>
            </div>
            <div className="pointer-events-none absolute inset-x-5 top-24 flex items-start justify-between md:inset-x-10 md:top-28">
              <p className="hud text-white/60">
                <span className="text-[var(--volt)]">(03)</span>&nbsp;&nbsp;Showcase
              </p>
              <p className="hud hidden text-right text-white/45 md:block">
                Live crop · same math
                <br />
                preview → export
              </p>
            </div>
            <h2
              id="showcase-title"
              data-show-title
              className="display pointer-events-none absolute bottom-8 left-5 text-[clamp(2.4rem,6.4vw,7.5rem)] mix-blend-difference md:bottom-12 md:left-10"
            >
              {["What", "you", "see"].map((w) => (
                <span key={w} className="inline-block overflow-hidden pb-[0.08em] align-bottom">
                  <span className="split-word inline-block text-white">{w}&nbsp;</span>
                </span>
              ))}
              <br />
              {["is", "what", "you", "export."].map((w) => (
                <span key={w} className="inline-block overflow-hidden pb-[0.08em] align-bottom">
                  <span className="split-word editorial inline-block font-normal text-white">
                    {w}&nbsp;
                  </span>
                </span>
              ))}
            </h2>
          </>
        )}
      </div>
    </section>
  );
}
