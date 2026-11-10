import { useEffect, useRef } from "react";
import { Line, SplitChars } from "./Split";
import { gsap, ScrollTrigger, useIsoLayoutEffect } from "./motion";

const SRC = "/media/hero-scrub.mp4";
const FRAMES = 240;
const FPS = 30;

function timecode(frame: number) {
  const s = Math.floor(frame / FPS);
  const f = frame % FPS;
  const p = (n: number) => String(n).padStart(2, "0");
  return `00:${p(Math.floor(s / 60))}:${p(s % 60)}:${p(f)}`;
}

/**
 * Downloads the scrub master fully into memory (so every seek is local and instant),
 * reporting progress. Falls back to direct streaming if fetch/streams are unavailable.
 */
async function loadMaster(onProgress: (p: number) => void, signal: AbortSignal): Promise<string> {
  try {
    const res = await fetch(SRC, { signal });
    if (!res.ok || !res.body) throw new Error(String(res.status));
    const total = Number(res.headers.get("content-length")) || 0;
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      if (total) onProgress(got / total);
    }
    onProgress(1);
    return URL.createObjectURL(new Blob(chunks as BlobPart[], { type: "video/mp4" }));
  } catch (e) {
    if (signal.aborted) throw e;
    onProgress(1);
    return SRC;
  }
}

export function Hero({
  reduced,
  revealed,
  onProgress,
  onLoaded,
}: {
  reduced: boolean;
  revealed: boolean;
  onProgress: (p: number) => void;
  onLoaded: () => void;
}) {
  const section = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const tc = useRef<HTMLSpanElement>(null);
  const fc = useRef<HTMLSpanElement>(null);
  const playhead = useRef<HTMLDivElement>(null);
  const target = useRef(0);

  // Load the master reel (or skip straight to ready for reduced motion, which shows a still).
  useEffect(() => {
    if (reduced) {
      onProgress(1);
      onLoaded();
      return;
    }
    const ac = new AbortController();
    let url = "";
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      onLoaded();
    };
    const safety = window.setTimeout(finish, 12000);
    loadMaster(onProgress, ac.signal)
      .then((u) => {
        url = u;
        const v = video.current;
        if (!v) return finish();
        v.src = u;
        v.addEventListener("loadeddata", finish, { once: true });
        v.addEventListener("error", finish, { once: true });
        v.load();
      })
      .catch(() => {});
    return () => {
      ac.abort();
      window.clearTimeout(safety);
      if (url.startsWith("blob:")) URL.revokeObjectURL(url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  // Frame-accurate scrub with inertia: scroll sets a target, the ticker eases toward it and
  // only issues a seek when the decoder is free, so seeks never queue up.
  useEffect(() => {
    if (reduced) return;
    let smoothed = 0;
    let lastFrame = -1;
    const tick = () => {
      smoothed += (target.current - smoothed) * 0.16;
      if (Math.abs(target.current - smoothed) < 0.0002) smoothed = target.current;
      const frame = Math.round(smoothed * (FRAMES - 1));
      const v = video.current;
      if (v && v.readyState >= 1 && frame !== lastFrame && !v.seeking) {
        v.currentTime = Math.min((frame + 0.25) / FPS, (v.duration || FRAMES / FPS) - 0.01);
        lastFrame = frame;
        if (tc.current) tc.current.textContent = timecode(frame);
        if (fc.current) fc.current.textContent = String(frame + 1).padStart(3, "0");
      }
      if (playhead.current) playhead.current.style.transform = `translateX(${smoothed * 100}%)`;
    };
    gsap.ticker.add(tick);
    return () => gsap.ticker.remove(tick);
  }, [reduced]);

  useIsoLayoutEffect(() => {
    if (reduced || !section.current) return;
    const ctx = gsap.context(() => {
      ScrollTrigger.create({
        trigger: section.current,
        start: "top top",
        end: "bottom bottom",
        onUpdate: (s) => (target.current = s.progress),
      });

      const tl = gsap.timeline({
        defaults: { ease: "none" },
        scrollTrigger: {
          trigger: section.current,
          start: "top top",
          end: "bottom bottom",
          scrub: 0.6,
        },
      });
      tl.to("[data-letterbox]", { scaleY: 0, duration: 0.08 }, 0)
        .to("[data-hero-sub]", { autoAlpha: 0, y: -30, duration: 0.08 }, 0)
        .to(
          ".hero-title .split-char",
          {
            x: () => gsap.utils.random(-260, 260),
            y: () => gsap.utils.random(-420, -60),
            z: () => gsap.utils.random(150, 700),
            rotationZ: () => gsap.utils.random(-70, 70),
            rotationY: () => gsap.utils.random(-120, 120),
            opacity: 0,
            stagger: { each: 0.004, from: "random" },
            duration: 0.22,
          },
          0.03,
        )
        .fromTo(
          "[data-chapter='1']",
          { autoAlpha: 0, y: 40 },
          { autoAlpha: 1, y: 0, duration: 0.06 },
          0.28,
        )
        .to("[data-chapter='1']", { autoAlpha: 0, y: -40, duration: 0.06 }, 0.44)
        .fromTo(
          "[data-chapter='2']",
          { autoAlpha: 0, y: 40 },
          { autoAlpha: 1, y: 0, duration: 0.06 },
          0.5,
        )
        .to("[data-chapter='2']", { autoAlpha: 0, y: -40, duration: 0.06 }, 0.66)
        .set("[data-chapter='3']", { autoAlpha: 1 }, 0.79)
        .fromTo(
          "[data-chapter='3'] .split-word",
          { yPercent: 110 },
          { yPercent: 0, stagger: 0.012, duration: 0.08, ease: "power2.out" },
          0.8,
        )
        .fromTo(
          stage.current,
          { scale: 1, borderRadius: 0, filter: "brightness(1)" },
          { scale: 0.9, borderRadius: 36, filter: "brightness(0.55)", duration: 0.1 },
          0.9,
        );
    }, section);
    return () => ctx.revert();
  }, [reduced]);

  // Entrance once the preloader opens.
  useIsoLayoutEffect(() => {
    if (!title.current) return;
    const ctx = gsap.context(() => {
      if (!revealed) {
        gsap.set(".hero-title .split-char", { yPercent: 120, rotationX: -90, opacity: 0 });
        gsap.set("[data-hero-sub] > *", { y: 24, opacity: 0 });
        return;
      }
      gsap.fromTo(
        ".hero-title .split-char",
        { yPercent: 120, rotationX: -90, opacity: 0 },
        {
          yPercent: 0,
          rotationX: 0,
          opacity: 1,
          duration: 1.4,
          ease: "expo.out",
          stagger: 0.035,
          delay: 0.15,
        },
      );
      gsap.fromTo(
        "[data-hero-sub] > *",
        { y: 24, opacity: 0 },
        { y: 0, opacity: 1, duration: 1.2, ease: "expo.out", stagger: 0.08, delay: 0.7 },
      );
    }, section);
    return () => ctx.revert();
  }, [revealed]);

  return (
    <section
      ref={section}
      id="top"
      className={reduced ? "relative h-svh" : "relative h-[520vh]"}
      aria-label="ReelForge introduction"
    >
      <div className="sticky top-0 h-svh overflow-hidden bg-[var(--ink)]">
        <div ref={stage} className="absolute inset-0 overflow-hidden will-change-transform">
          {reduced ? (
            <img
              src="/media/hero-end.jpg"
              alt=""
              className="absolute inset-0 h-full w-full object-cover opacity-80"
            />
          ) : (
            <video
              ref={video}
              muted
              playsInline
              preload="auto"
              poster="/media/hero-poster.jpg"
              aria-hidden
              className="absolute inset-0 h-full w-full object-cover"
            />
          )}
          {/* grade */}
          <div
            aria-hidden
            className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_35%,rgba(0,0,0,0.75))]"
          />
          <div
            aria-hidden
            className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black via-black/40 to-transparent"
          />
          {/* letterbox */}
          <div
            data-letterbox
            aria-hidden
            className="absolute inset-x-0 top-0 h-[11vh] origin-top bg-black"
          />
          <div
            data-letterbox
            aria-hidden
            className="absolute inset-x-0 bottom-0 h-[11vh] origin-bottom bg-black"
          />
        </div>

        {/* HUD */}
        <div
          aria-hidden
          className="hud pointer-events-none absolute inset-x-5 top-20 flex justify-between text-white/55 md:inset-x-10 md:top-28"
        >
          <div className="flex items-center gap-3">
            <span className="anim-rec inline-block h-2 w-2 rounded-full bg-red-500 shadow-[0_0_10px_2px_rgba(239,68,68,0.6)]" />
            <span>Rec</span>
            <span className="text-white/30">/</span>
            <span ref={tc} className="text-white/80">
              00:00:00:00
            </span>
          </div>
          <div className="hidden gap-6 sm:flex">
            <span>Src 16:9</span>
            <span className="text-[var(--volt)]">Out 9:16</span>
            <span>
              F <span ref={fc}>001</span>/{FRAMES}
            </span>
          </div>
        </div>
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 hidden h-16 w-16 -translate-x-1/2 -translate-y-1/2 md:block"
        >
          <span className="absolute left-0 top-0 h-3 w-3 border-l border-t border-white/40" />
          <span className="absolute right-0 top-0 h-3 w-3 border-r border-t border-white/40" />
          <span className="absolute bottom-0 left-0 h-3 w-3 border-b border-l border-white/40" />
          <span className="absolute bottom-0 right-0 h-3 w-3 border-b border-r border-white/40" />
        </div>

        {/* Title */}
        <div className="absolute inset-x-5 bottom-[13vh] md:inset-x-10">
          <h1
            ref={title}
            className="hero-title display text-[clamp(3.4rem,12.5vw,15rem)] [perspective:900px]"
          >
            <SplitChars text="One film." className="block" charClassName="text-chrome" />
            <span className="block">
              <SplitChars text="Endless" charClassName="text-chrome" />{" "}
              <SplitChars
                text="reels."
                className="editorial text-[1.08em] tracking-[-0.04em] text-white"
              />
            </span>
          </h1>
          <div
            data-hero-sub
            className="mt-8 flex flex-col gap-6 md:mt-10 md:flex-row md:items-end md:justify-between"
          >
            <p className="max-w-md text-[15px] leading-relaxed text-white/65 md:text-base">
              ReelForge turns long-form video into vertical shorts — split, trim, crop, caption and
              export, entirely in your browser.
            </p>
            <div className="hud flex items-center gap-3 text-white/50">
              <span className="relative block h-10 w-px overflow-hidden bg-white/15">
                <span className="anim-scroll-cue absolute inset-0 bg-white" />
              </span>
              {reduced ? "Scroll" : "Scroll to scrub the reel"}
            </div>
          </div>
        </div>

        {/* Chapters synced to the footage */}
        {!reduced && (
          <>
            <div
              data-chapter="1"
              className="invisible absolute right-5 top-1/2 max-w-xs -translate-y-1/2 md:right-16"
            >
              <p className="hud text-[var(--volt)]">01 — The master</p>
              <p className="mt-3 text-2xl leading-tight text-white md:text-3xl">
                Your long-form footage,{" "}
                <span className="editorial text-white/70">one continuous strip.</span>
              </p>
            </div>
            <div
              data-chapter="2"
              className="invisible absolute left-5 top-[30%] max-w-xs md:left-16"
            >
              <p className="hud text-[var(--volt)]">02 — The cut</p>
              <p className="mt-3 text-2xl leading-tight text-white md:text-3xl">
                Frames lift off the reel{" "}
                <span className="editorial text-white/70">and reframe to 9:16.</span>
              </p>
            </div>
            <div
              data-chapter="3"
              className="invisible absolute inset-0 flex items-center justify-center px-5 text-center"
            >
              <h2 className="display text-[clamp(2.6rem,8vw,9rem)] drop-shadow-[0_10px_40px_rgba(0,0,0,0.8)]">
                {["One", "master."].map((w) => (
                  <span key={w} className="inline-block overflow-hidden pb-[0.1em] align-bottom">
                    <span className="split-word inline-block text-chrome">{w}&nbsp;</span>
                  </span>
                ))}
                <br />
                {["Every", "reel."].map((w) => (
                  <span key={w} className="inline-block overflow-hidden pb-[0.1em] align-bottom">
                    <span className="split-word editorial inline-block text-white">{w}&nbsp;</span>
                  </span>
                ))}
              </h2>
            </div>
          </>
        )}

        {/* Scroll-timeline scrubber */}
        {!reduced && (
          <div aria-hidden className="absolute inset-x-5 bottom-6 md:inset-x-10 md:bottom-8">
            <div className="relative h-4">
              <div
                className="absolute inset-0 opacity-40"
                style={{
                  backgroundImage:
                    "repeating-linear-gradient(90deg, rgba(255,255,255,0.5) 0 1px, transparent 1px 8px), repeating-linear-gradient(90deg, rgba(255,255,255,0.9) 0 1px, transparent 1px 80px)",
                  backgroundSize: "auto 40%, auto 100%",
                  backgroundRepeat: "repeat-x",
                  backgroundPosition: "bottom",
                }}
              />
              <div
                ref={playhead}
                className="absolute inset-y-[-6px] left-0 w-full will-change-transform"
              >
                <span className="absolute inset-y-0 left-0 w-px bg-[var(--volt)] shadow-[0_0_12px_2px_var(--volt)]" />
                <span className="absolute -top-1.5 left-0 h-2 w-2 -translate-x-1/2 rotate-45 bg-[var(--volt)]" />
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
