import { Link } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { Magnetic, RollText } from "./Interactions";
import { gsap, ScrollTrigger, scrollToTarget } from "./motion";

const LINKS = [
  { id: "#story", label: "Story" },
  { id: "#workflow", label: "Workflow" },
  { id: "#showcase", label: "Showcase" },
  { id: "#features", label: "Features" },
];

export function Nav() {
  const bar = useRef<HTMLElement>(null);
  const progress = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const st = ScrollTrigger.create({
      start: 0,
      end: "max",
      onUpdate: (self) => {
        if (progress.current) progress.current.style.transform = `scaleX(${self.progress})`;
        if (!bar.current) return;
        const hide = self.direction === 1 && self.scroll() > window.innerHeight * 0.6;
        gsap.to(bar.current, {
          yPercent: hide ? -110 : 0,
          duration: 0.6,
          ease: "expo.out",
          overwrite: "auto",
        });
      },
    });
    return () => st.kill();
  }, []);

  return (
    <header ref={bar} className="fixed inset-x-0 top-0 z-50">
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-px origin-left bg-[var(--volt)]"
        style={{ transform: "scaleX(0)" }}
        ref={progress}
      />
      <nav
        aria-label="Primary"
        className="mx-auto flex items-center justify-between px-5 py-4 md:px-10 md:py-6"
      >
        <a
          href="#top"
          onClick={(e) => (e.preventDefault(), scrollToTarget(0))}
          className="group flex items-center gap-2.5 text-[15px] font-semibold tracking-tight text-white mix-blend-difference"
          data-cursor="Top"
        >
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inset-0 rounded-full bg-[var(--volt)] opacity-60 blur-[3px] transition-opacity group-hover:opacity-100" />
            <span className="relative h-2.5 w-2.5 rounded-full bg-[var(--volt)]" />
          </span>
          ReelForge
        </a>
        <ul className="hidden items-center gap-1 rounded-full px-2 py-1.5 glass-panel md:flex">
          {LINKS.map((l) => (
            <li key={l.id}>
              <a
                href={l.id}
                onClick={(e) => (e.preventDefault(), scrollToTarget(l.id))}
                className="block rounded-full px-4 py-1.5 text-[13px] text-white/70 transition-colors hover:text-white focus-visible:text-white focus-visible:outline-none"
              >
                <RollText>{l.label}</RollText>
              </a>
            </li>
          ))}
        </ul>
        <Magnetic>
          <Link
            to="/studio"
            data-cursor="Open"
            className="group relative inline-flex items-center gap-2 overflow-hidden rounded-full bg-white px-5 py-2.5 text-[13px] font-semibold text-black"
          >
            <span data-magnetic-inner className="relative z-10 flex items-center gap-2">
              <RollText>Open Studio</RollText>
              <span
                aria-hidden
                className="transition-transform duration-500 group-hover:translate-x-0.5"
              >
                →
              </span>
            </span>
            <span
              aria-hidden
              className="absolute inset-0 translate-y-full rounded-full bg-[var(--volt)] transition-transform duration-500 [transition-timing-function:var(--ease-cine)] group-hover:translate-y-0"
            />
          </Link>
        </Magnetic>
      </nav>
    </header>
  );
}
