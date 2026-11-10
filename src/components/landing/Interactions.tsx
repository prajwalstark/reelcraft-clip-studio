import { useEffect, useRef, useState, type ReactNode } from "react";
import { gsap, REDUCED_QUERY } from "./motion";

/**
 * Two-part cursor: a precise dot plus a lagging ring that grows and shows a label over
 * elements carrying `data-cursor="Label"`. Only mounts for fine pointers without reduced motion.
 */
export function Cursor() {
  const dot = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const [label, setLabel] = useState("");
  const [on, setOn] = useState(false);

  useEffect(() => {
    if (!window.matchMedia("(pointer: fine)").matches || window.matchMedia(REDUCED_QUERY).matches)
      return;
    setOn(true);
    const root = document.querySelector("[data-landing]");
    root?.setAttribute("data-cursor-ready", "");
    return () => root?.removeAttribute("data-cursor-ready");
  }, []);

  useEffect(() => {
    if (!on || !dot.current || !ring.current) return;
    const dx = gsap.quickTo(dot.current, "x", { duration: 0.08, ease: "power3" });
    const dy = gsap.quickTo(dot.current, "y", { duration: 0.08, ease: "power3" });
    const rx = gsap.quickTo(ring.current, "x", { duration: 0.45, ease: "power3" });
    const ry = gsap.quickTo(ring.current, "y", { duration: 0.45, ease: "power3" });
    let current = "";
    const move = (e: PointerEvent) => {
      dx(e.clientX);
      dy(e.clientY);
      rx(e.clientX);
      ry(e.clientY);
      const t = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-cursor], a, button");
      const next = t ? (t.dataset["cursor"] ?? "·") : "";
      if (next !== current) {
        current = next;
        setLabel(next);
        gsap.to(ring.current, {
          scale: next ? (next === "·" ? 1.6 : 2.6) : 1,
          duration: 0.5,
          ease: "expo.out",
        });
      }
    };
    const leave = () => gsap.to([dot.current, ring.current], { opacity: 0, duration: 0.3 });
    const enter = () => gsap.to([dot.current, ring.current], { opacity: 1, duration: 0.3 });
    const down = () => gsap.to(ring.current, { scale: "*=0.82", duration: 0.2 });
    const up = () =>
      gsap.to(ring.current, {
        scale: current ? (current === "·" ? 1.6 : 2.6) : 1,
        duration: 0.4,
        ease: "back.out(3)",
      });
    window.addEventListener("pointermove", move, { passive: true });
    document.addEventListener("pointerleave", leave);
    document.addEventListener("pointerenter", enter);
    window.addEventListener("pointerdown", down);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      document.removeEventListener("pointerleave", leave);
      document.removeEventListener("pointerenter", enter);
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("pointerup", up);
    };
  }, [on]);

  if (!on) return null;
  return (
    <>
      <div
        ref={ring}
        aria-hidden
        className="pointer-events-none fixed left-0 top-0 z-[100] -ml-5 -mt-5 flex h-10 w-10 items-center justify-center rounded-full border border-white/60 mix-blend-difference"
      >
        <span
          className="hud whitespace-nowrap text-[4px] text-white"
          style={{ letterSpacing: "0.12em" }}
        >
          {label !== "·" ? label : ""}
        </span>
      </div>
      <div
        ref={dot}
        aria-hidden
        className="pointer-events-none fixed left-0 top-0 z-[101] -ml-[3px] -mt-[3px] h-1.5 w-1.5 rounded-full bg-white mix-blend-difference"
      />
    </>
  );
}

/** Pulls its child toward the pointer while hovered; the inner label travels further for depth. */
export function Magnetic({
  children,
  strength = 0.35,
  className = "",
}: {
  children: ReactNode;
  strength?: number;
  className?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = el.current;
    if (
      !node ||
      !window.matchMedia("(pointer: fine)").matches ||
      window.matchMedia(REDUCED_QUERY).matches
    )
      return;
    const inner = node.querySelector<HTMLElement>("[data-magnetic-inner]");
    const x = gsap.quickTo(node, "x", { duration: 0.6, ease: "elastic.out(1, 0.4)" });
    const y = gsap.quickTo(node, "y", { duration: 0.6, ease: "elastic.out(1, 0.4)" });
    const ix = inner
      ? gsap.quickTo(inner, "x", { duration: 0.6, ease: "elastic.out(1, 0.4)" })
      : null;
    const iy = inner
      ? gsap.quickTo(inner, "y", { duration: 0.6, ease: "elastic.out(1, 0.4)" })
      : null;
    const move = (e: PointerEvent) => {
      const r = node.getBoundingClientRect();
      const mx = e.clientX - (r.left + r.width / 2);
      const my = e.clientY - (r.top + r.height / 2);
      x(mx * strength);
      y(my * strength);
      ix?.(mx * strength * 0.5);
      iy?.(my * strength * 0.5);
    };
    const reset = () => {
      x(0);
      y(0);
      ix?.(0);
      iy?.(0);
    };
    node.addEventListener("pointermove", move);
    node.addEventListener("pointerleave", reset);
    return () => {
      node.removeEventListener("pointermove", move);
      node.removeEventListener("pointerleave", reset);
    };
  }, [strength]);
  return (
    <div ref={el} className={`inline-block will-change-transform ${className}`}>
      {children}
    </div>
  );
}

/** Text that rolls up to a duplicate on hover (CSS only). */
export function RollText({ children }: { children: string }) {
  return (
    <span className="group/roll relative inline-flex overflow-hidden">
      <span className="block transition-transform duration-500 [transition-timing-function:var(--ease-cine)] group-hover/roll:-translate-y-full group-focus-visible/roll:-translate-y-full">
        {children}
      </span>
      <span
        aria-hidden
        className="absolute inset-0 block translate-y-full transition-transform duration-500 [transition-timing-function:var(--ease-cine)] group-hover/roll:translate-y-0 group-focus-visible/roll:translate-y-0"
      >
        {children}
      </span>
    </span>
  );
}

/** Pointer-driven 3D tilt with a moving specular highlight. */
export function Tilt({
  children,
  className = "",
  max = 10,
}: {
  children: ReactNode;
  className?: string;
  max?: number;
}) {
  const el = useRef<HTMLDivElement>(null);
  const glare = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = el.current;
    if (
      !node ||
      !window.matchMedia("(pointer: fine)").matches ||
      window.matchMedia(REDUCED_QUERY).matches
    )
      return;
    const rx = gsap.quickTo(node, "rotationX", { duration: 0.8, ease: "power3" });
    const ry = gsap.quickTo(node, "rotationY", { duration: 0.8, ease: "power3" });
    const move = (e: PointerEvent) => {
      const r = node.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      ry((px - 0.5) * max * 2);
      rx(-(py - 0.5) * max * 2);
      if (glare.current)
        glare.current.style.background = `radial-gradient(600px circle at ${px * 100}% ${py * 100}%, oklch(1 0 0 / 0.14), transparent 45%)`;
    };
    const reset = () => {
      rx(0);
      ry(0);
      if (glare.current) glare.current.style.background = "transparent";
    };
    node.addEventListener("pointermove", move);
    node.addEventListener("pointerleave", reset);
    return () => {
      node.removeEventListener("pointermove", move);
      node.removeEventListener("pointerleave", reset);
    };
  }, [max]);
  return (
    <div style={{ perspective: 1200 }} className={className}>
      <div
        ref={el}
        className="relative h-full w-full will-change-transform [transform-style:preserve-3d]"
      >
        {children}
        <div
          ref={glare}
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[inherit] mix-blend-screen"
        />
      </div>
    </div>
  );
}
