import { useRef, type ReactNode } from "react";
import { Tilt } from "./Interactions";
import { gsap, ScrollTrigger, useIsoLayoutEffect } from "./motion";

type Step = {
  n: string;
  title: string;
  line: string;
  body: string;
  tags: string[];
  rig: ReactNode;
};

const loop = "[animation-iteration-count:infinite]";

const STEPS: Step[] = [
  {
    n: "01",
    title: "Import",
    line: "Drop it in. It stays here.",
    body: "Drag a file or pick one. ReelForge reads duration and dimensions locally — no upload, no account, no queue.",
    tags: ["MP4", "MOV", "WebM", "MKV"],
    rig: (
      <div className="relative h-full w-full">
        <div className="absolute inset-x-[14%] bottom-[16%] h-[42%] rounded-2xl border border-dashed border-white/25 bg-white/[0.03]">
          <div className="absolute inset-x-0 -bottom-px mx-auto h-px w-1/2 bg-[var(--volt)] shadow-[0_0_24px_4px_var(--volt)]" />
        </div>
        <div
          data-loop
          className={`absolute left-[32%] top-[14%] h-[52%] w-[36%] rounded-xl border border-white/15 bg-cover shadow-2xl [animation:drop-file_3.2s_var(--ease-cine)] ${loop}`}
          style={{ backgroundImage: "url(/media/ridge-poster.jpg)", backgroundPosition: "50% 50%" }}
        >
          <span className="hud absolute bottom-2 left-2 rounded bg-black/60 px-1.5 py-0.5 text-[9px] text-white/80">
            master.mp4
          </span>
        </div>
      </div>
    ),
  },
  {
    n: "02",
    title: "Split",
    line: "Equal beats. Nothing lost.",
    body: "Choose 15, 30 or 60 seconds — or your own length. Cuts cover the entire source; the final remainder is kept, never dropped.",
    tags: ["15 s", "30 s", "60 s", "Custom"],
    rig: (
      <div className="relative flex h-full w-full items-center px-[8%]">
        <div
          className="relative h-[34%] w-full overflow-hidden rounded-lg bg-cover"
          style={{ backgroundImage: "url(/media/ridge-poster.jpg)" }}
        >
          {[1, 2, 3, 4].map((i) => (
            <span
              key={i}
              data-loop
              className={`absolute inset-y-0 w-[3px] -translate-x-1/2 origin-top bg-[var(--volt)] shadow-[0_0_14px_var(--volt)] [animation:slice-in_2.4s_var(--ease-cine)_both] ${loop}`}
              style={{ left: `${i * 22}%`, animationDelay: `${i * 0.18}s` }}
            />
          ))}
          <span className="hud absolute bottom-1.5 right-2 text-[9px] text-black/80">+12 s</span>
        </div>
      </div>
    ),
  },
  {
    n: "03",
    title: "Trim",
    line: "Handles, or exact frames.",
    body: "Drag trim handles on the timeline or type exact in/out points. Ranges are validated — no zero-length or out-of-bounds clips.",
    tags: ["In / Out", "Split at playhead", "Duplicate"],
    rig: (
      <div className="relative flex h-full w-full items-center px-[8%]">
        <div
          className="relative h-[30%] w-full rounded-lg bg-cover opacity-90"
          style={{ backgroundImage: "url(/media/ridge-poster.jpg)" }}
        >
          <div
            data-loop
            className={`absolute inset-y-[-8px] rounded-md border-2 border-[var(--volt)] bg-[var(--volt)]/10 [animation:trim-l_4s_ease-in-out,trim-r_4s_ease-in-out] ${loop}`}
            style={{ left: "8%", right: "10%" }}
          >
            <span className="absolute -left-1.5 top-1/2 h-8 w-2.5 -translate-y-1/2 rounded-sm bg-[var(--volt)]" />
            <span className="absolute -right-1.5 top-1/2 h-8 w-2.5 -translate-y-1/2 rounded-sm bg-[var(--volt)]" />
          </div>
        </div>
        <div className="hud absolute bottom-[18%] left-[8%] right-[8%] flex justify-between text-[9px] text-white/50">
          <span>00:00:12.08</span>
          <span>00:00:41.20</span>
        </div>
      </div>
    ),
  },
  {
    n: "04",
    title: "Crop",
    line: "Reframe without guessing.",
    body: "9:16, 1:1 or 16:9 with a draggable focal point, fit or fill, and zoom. The preview uses the same crop math as the export.",
    tags: ["1080 × 1920", "Focal point", "Fit / Fill"],
    rig: (
      <div className="relative flex h-full w-full items-center justify-center">
        <div
          className="relative aspect-video w-[84%] overflow-hidden rounded-lg bg-cover"
          style={{ backgroundImage: "url(/media/ridge-poster.jpg)" }}
        >
          <div className="absolute inset-0 bg-black/55" />
          <div
            data-loop
            className={`absolute inset-y-0 aspect-[9/16] overflow-hidden border border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.0)] [animation:pan-crop_5s_ease-in-out] ${loop}`}
            style={{ left: "14%" }}
          >
            <span className="absolute left-1/3 inset-y-0 w-px bg-white/30" />
            <span className="absolute left-2/3 inset-y-0 w-px bg-white/30" />
            <span className="absolute top-1/3 inset-x-0 h-px bg-white/30" />
            <span className="absolute top-2/3 inset-x-0 h-px bg-white/30" />
            <span className="hud absolute -top-0 left-1 text-[8px] text-white">9:16</span>
          </div>
        </div>
      </div>
    ),
  },
  {
    n: "05",
    title: "Caption",
    line: "Words, timed to the frame.",
    body: "Write captions or import SRT/VTT. Style size, colour and position inside the safe zone, burn them in, and download a matching SRT.",
    tags: ["SRT", "VTT", "Burn-in", "Safe zone"],
    rig: (
      <div className="relative flex h-full w-full items-center justify-center">
        <div
          className="relative aspect-[9/16] h-[86%] overflow-hidden rounded-2xl border border-white/15 bg-cover"
          style={{ backgroundImage: "url(/media/ridge-poster.jpg)", backgroundPosition: "40% 50%" }}
        >
          <div className="absolute inset-x-[8%] bottom-[22%] top-[12%] border border-dashed border-cyan-300/40" />
          <p className="absolute inset-x-0 bottom-[28%] px-4 text-center text-[13px] font-bold leading-tight text-white [text-shadow:0_2px_10px_rgba(0,0,0,.9)]">
            every frame <span className="rounded bg-[var(--volt)] px-1 text-black">counts</span>
            <span className="anim-caret ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 bg-white" />
          </p>
        </div>
      </div>
    ),
  },
  {
    n: "06",
    title: "Export",
    line: "Real files. Honest progress.",
    body: "Render the selected clip or a whole batch with cancel and progress. MP4 (H.264) where the browser supports it — a clearly labelled WebM otherwise. Batch to ZIP.",
    tags: ["MP4 · H.264", "WebM fallback", "ZIP batch"],
    rig: (
      <div className="relative flex h-full w-full items-center justify-center">
        <svg viewBox="0 0 120 120" className="h-[62%] -rotate-90">
          <circle
            cx="60"
            cy="60"
            r="48"
            fill="none"
            stroke="rgba(255,255,255,0.08)"
            strokeWidth="6"
          />
          <circle
            data-loop
            cx="60"
            cy="60"
            r="48"
            fill="none"
            stroke="var(--volt)"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray="302"
            className={`[animation:ring-fill_3.6s_cubic-bezier(.6,0,.2,1)] ${loop}`}
            style={{ filter: "drop-shadow(0 0 6px var(--volt))" }}
          />
        </svg>
        <span className="hud absolute text-[11px] text-white">Rendering</span>
      </div>
    ),
  },
];

export function Workflow({ reduced }: { reduced: boolean }) {
  const section = useRef<HTMLElement>(null);
  const track = useRef<HTMLDivElement>(null);

  useIsoLayoutEffect(() => {
    if (reduced || !section.current || !track.current) return;
    const mm = gsap.matchMedia();
    mm.add("(min-width: 768px)", () => {
      const t = track.current!;
      const distance = () => t.scrollWidth - window.innerWidth;
      const tween = gsap.to(t, {
        x: () => -distance(),
        ease: "none",
        scrollTrigger: {
          trigger: section.current,
          start: "top top",
          end: "bottom bottom",
          scrub: 0.8,
          invalidateOnRefresh: true,
        },
      });
      // Velocity skew: the reel bends with the speed of the scroll.
      const skew = gsap.quickTo(t, "skewX", { duration: 0.6, ease: "power3" });
      const st = ScrollTrigger.create({
        trigger: section.current,
        start: "top top",
        end: "bottom bottom",
        onUpdate: (s) => skew(gsap.utils.clamp(-6, 6, s.getVelocity() / -400)),
        onLeave: () => skew(0),
        onLeaveBack: () => skew(0),
      });
      // Parallax inside each panel against the horizontal motion.
      gsap.utils.toArray<HTMLElement>("[data-wf-num]").forEach((el) => {
        gsap.fromTo(
          el,
          { xPercent: 30 },
          {
            xPercent: -30,
            ease: "none",
            scrollTrigger: {
              trigger: el.closest("[data-wf-panel]"),
              containerAnimation: tween,
              start: "left right",
              end: "right left",
              scrub: true,
            },
          },
        );
      });
      gsap.utils.toArray<HTMLElement>("[data-wf-rig]").forEach((el) => {
        gsap.fromTo(
          el,
          { rotateY: -24, z: -120, opacity: 0.2 },
          {
            rotateY: 0,
            z: 0,
            opacity: 1,
            ease: "power2.out",
            scrollTrigger: {
              trigger: el.closest("[data-wf-panel]"),
              containerAnimation: tween,
              start: "left 95%",
              end: "center 60%",
              scrub: true,
            },
          },
        );
      });
      return () => st.kill();
    });
    mm.add("(max-width: 767px)", () => {
      gsap.utils.toArray<HTMLElement>("[data-wf-panel]").forEach((el) => {
        gsap.from(el.querySelectorAll("[data-wf-reveal]"), {
          y: 60,
          opacity: 0,
          stagger: 0.08,
          duration: 1.1,
          ease: "expo.out",
          scrollTrigger: { trigger: el, start: "top 80%" },
        });
      });
    });
    return () => mm.revert();
  }, [reduced]);

  return (
    <section
      ref={section}
      id="workflow"
      aria-labelledby="workflow-title"
      className={reduced ? "relative" : "relative md:h-[600vh]"}
    >
      <div className={reduced ? "" : "md:sticky md:top-0 md:h-svh md:overflow-hidden"}>
        <div
          ref={track}
          className="flex flex-col will-change-transform md:h-full md:w-max md:flex-row md:items-stretch"
        >
          {/* Title panel */}
          <div className="flex shrink-0 flex-col justify-between px-5 pb-12 pt-28 md:h-full md:w-[62vw] md:px-10 md:pb-14">
            <p className="hud text-white/45">
              <span className="text-[var(--volt)]">(02)</span>&nbsp;&nbsp;The workflow
            </p>
            <h2 id="workflow-title" className="display text-[clamp(3.2rem,9vw,11rem)]">
              <span className="text-chrome block">The cut,</span>
              <span className="editorial block font-normal text-white">in six moves.</span>
            </h2>
            <p className="max-w-sm text-white/55">
              The whole edit happens in one browser tab. Here's the path from a single master file
              to a folder of finished reels.
            </p>
          </div>
          {STEPS.map((s) => (
            <article
              key={s.n}
              data-wf-panel
              aria-label={`${s.n} ${s.title}`}
              className="relative grid shrink-0 grid-rows-[auto_1fr] gap-8 border-t border-white/10 px-5 py-14 md:h-full md:w-[78vw] md:grid-cols-2 md:grid-rows-1 md:gap-12 md:border-l md:border-t-0 md:px-14 md:py-24 lg:w-[66vw]"
            >
              <div className="relative flex flex-col justify-between gap-8 overflow-hidden md:overflow-visible">
                <span
                  data-wf-num
                  aria-hidden
                  className="display text-outline pointer-events-none absolute -top-6 right-0 select-none text-[clamp(7rem,20vw,20rem)] md:-top-10 md:right-auto md:left-0"
                >
                  {s.n}
                </span>
                <div data-wf-reveal className="relative pt-24 md:pt-[38%]">
                  <p className="hud text-[var(--volt)]">Step {s.n}</p>
                  <h3 className="display mt-4 text-[clamp(2.6rem,4.6vw,5.4rem)] text-white">
                    {s.title}
                  </h3>
                  <p className="editorial mt-3 text-2xl text-white/75 md:text-3xl">{s.line}</p>
                </div>
                <div data-wf-reveal className="relative">
                  <p className="max-w-md text-[15px] leading-relaxed text-white/55">{s.body}</p>
                  <ul className="mt-6 flex flex-wrap gap-2">
                    {s.tags.map((t) => (
                      <li
                        key={t}
                        className="hud rounded-full border border-white/12 px-3 py-1.5 text-white/70"
                      >
                        {t}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              <div
                data-wf-reveal
                className="relative min-h-[320px] [perspective:1400px] md:min-h-0"
              >
                <div data-wf-rig className="h-full w-full [transform-style:preserve-3d]">
                  <Tilt className="h-full w-full" max={8}>
                    <div className="glass-panel relative h-full w-full overflow-hidden rounded-[28px]">
                      <div
                        aria-hidden
                        className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_0%,oklch(1_0_0/0.08),transparent_60%)]"
                      />
                      <div className="hud absolute left-5 top-4 flex gap-3 text-white/35">
                        <span>{s.n}</span>
                        <span>{s.title}</span>
                      </div>
                      <div className="absolute inset-0 pt-8" aria-hidden>
                        {s.rig}
                      </div>
                    </div>
                  </Tilt>
                </div>
              </div>
            </article>
          ))}
          <div aria-hidden className="hidden shrink-0 md:block md:w-[12vw]" />
        </div>
      </div>
    </section>
  );
}
