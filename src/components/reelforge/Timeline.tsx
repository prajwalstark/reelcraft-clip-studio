import { useEffect, useRef } from "react";
import { clampRange, fmtTC, type Clip } from "@/lib/reelforge/core";
import { snapTime, timelineTime } from "@/lib/reelforge/editing";
import { getState, seek, setRt, updateClip, useStore } from "@/lib/reelforge/store";

export function Timeline() {
  const clips = useStore((s) => s.project.clips),
    captions = useStore((s) => s.project.captions);
  const markers = useStore((s) => s.project.markers),
    activeId = useStore((s) => s.rt.activeId);
  const time = useStore((s) => s.rt.time),
    d = useStore((s) => s.project.source?.duration ?? 1);
  const zoom = useStore((s) => s.rt.timelineZoom),
    snapping = useStore((s) => s.rt.snapping),
    fps = useStore((s) => s.rt.stepFps);
  const bar = useRef<HTMLDivElement>(null),
    cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);
  const pct = (t: number) => `${(t / d) * 100}%`;
  const tAt = (x: number, exclude?: string) => {
    const r = bar.current?.getBoundingClientRect();
    if (!r) return 0;
    const t = timelineTime(x, r.left, r.width, d),
      s = getState();
    return s.rt.snapping
      ? snapTime(
          t,
          [
            0,
            d,
            ...(s.project.markers ?? []).map((m) => m.time),
            ...s.project.clips.filter((c) => c.id !== exclude).flatMap((c) => [c.start, c.end]),
          ],
          (8 / r.width) * d,
        )
      : t;
  };
  const drag = (c: Clip, edge: "start" | "end") => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    cleanup.current?.();
    e.currentTarget.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const cur = getState().project.clips.find((x) => x.id === c.id);
      if (!cur || ev.pointerId !== e.pointerId) return;
      const t = tAt(ev.clientX, c.id);
      const [start, end] =
        edge === "start"
          ? clampRange(Math.min(t, cur.end - 0.5), cur.end, d)
          : clampRange(cur.start, Math.max(t, cur.start + 0.5), d);
      updateClip(c.id, { start, end }, `trim-${c.id}`);
      seek(edge === "start" ? start : end);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      cleanup.current = null;
    };
    cleanup.current = up;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };
  return (
    <div className="glass shrink-0 border-x-0 border-b-0 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
        <label className="flex items-center gap-1">
          Timeline zoom
          <input
            aria-label="Timeline zoom"
            type="range"
            min={1}
            max={8}
            step={0.5}
            value={zoom}
            onChange={(e) => setRt({ timelineZoom: Number(e.target.value) })}
            className="w-20 accent-[var(--primary)]"
          />
          {zoom}×
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={snapping}
            onChange={(e) => setRt({ snapping: e.target.checked })}
          />
          Snap
        </label>
        <label>
          Arrow step{" "}
          <select
            aria-label="Timeline step rate"
            className="rounded border bg-background"
            value={fps}
            onChange={(e) => setRt({ stepFps: Number(e.target.value) })}
          >
            <option value={24}>1/24s</option>
            <option value={30}>1/30s</option>
          </select>
        </label>
        <details className="relative">
          <summary className="cursor-pointer">Shortcuts</summary>
          <p className="absolute bottom-6 right-0 z-30 w-64 rounded border bg-background p-3 shadow-lg">
            Space: play/pause · I/O: trim in/out · M: marker · Ctrl/⌘ K: split · ←/→: source time
            step · Shift + arrow: 1 second · Ctrl/⌘ Z: undo. Step size is a time increment, not
            decoded-frame stepping.
          </p>
        </details>
      </div>
      <div className="overflow-x-auto pb-1" aria-label="Scrollable source timeline">
        <div style={{ width: `${zoom * 100}%` }}>
          <div className="mb-1 flex justify-between text-[10px] tc text-muted-foreground">
            <span>00:00.00</span>
            <span>Source timeline · drag edges to trim</span>
            <span>{fmtTC(d)}</span>
          </div>
          <div
            ref={bar}
            data-testid="timeline"
            className="relative h-20 cursor-crosshair rounded bg-track"
            onPointerDown={(e) => seek(tAt(e.clientX))}
          >
            {clips.map((c, i) => (
              <div
                key={c.id}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  setRt({ activeId: c.id });
                  seek(tAt(e.clientX));
                }}
                className={`absolute top-5 h-8 overflow-hidden rounded border px-3 text-[10px] ${c.id === activeId ? "z-10 border-primary bg-primary/25" : i % 2 ? "border-cyan/30 bg-cyan/10" : "border-border bg-accent/70"}`}
                style={{ left: pct(c.start), width: pct(c.end - c.start) }}
              >
                <span className="truncate">{c.title}</span>
                {c.id === activeId && (
                  <>
                    <div
                      aria-label="Trim start handle"
                      onPointerDown={drag(c, "start")}
                      className="absolute inset-y-0 left-0 w-2 touch-none cursor-ew-resize bg-primary"
                    />
                    <div
                      aria-label="Trim end handle"
                      onPointerDown={drag(c, "end")}
                      className="absolute inset-y-0 right-0 w-2 touch-none cursor-ew-resize bg-primary"
                    />
                  </>
                )}
              </div>
            ))}
            {markers?.map((m) => (
              <button
                key={m.id}
                aria-label={`Timeline marker ${m.name}`}
                title={`${m.name} · ${fmtTC(m.time)}`}
                className="absolute top-0 z-20 -translate-x-1/2 text-xs text-amber-400"
                style={{ left: pct(m.time) }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  seek(m.time);
                }}
              >
                ◆
              </button>
            ))}
            {captions.map((c) => (
              <div
                key={c.id}
                className="absolute bottom-1 h-2 rounded-sm bg-cyan/60"
                style={{ left: pct(c.start), width: pct(c.end - c.start) }}
                title={c.text}
              />
            ))}
            <div
              className="pointer-events-none absolute inset-y-0 z-20 w-px bg-foreground"
              style={{ left: pct(time) }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
