import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { Clip } from "@/lib/reelforge/core";
import {
  NEUTRAL_GRADE,
  evalCurve,
  gradeActive,
  neutralCurve,
  periodic,
  type ColorGrade,
  type CurveKind,
  type CurvePoints,
  type Wheel,
  type WheelKind,
} from "@/lib/reelforge/grading/primaries";
import { commit, updateClip } from "@/lib/reelforge/store";

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const round3 = (v: number) => Math.round(v * 1000) / 1000;

// Hue ring that matches wheelChroma: puck angle 0 (right) = red, counter-clockwise → yellow, green…
// CSS conic gradients start at the top and go clockwise, so css angle θ shows hue (90 − θ).
const RING = `conic-gradient(${Array.from({ length: 13 }, (_, i) => {
  const css = i * 30;
  const hue = (((90 - css) % 360) + 360) % 360;
  return `hsl(${hue} 85% 55%) ${css}deg`;
}).join(", ")})`;

function ColorWheel({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Wheel;
  onChange: (w: Wheel, live?: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const fromPointer = (e: PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    let x = ((e.clientX - r.left) / r.width) * 2 - 1;
    let y = -(((e.clientY - r.top) / r.height) * 2 - 1);
    const d = Math.hypot(x, y);
    if (d > 1) {
      x /= d;
      y /= d;
    }
    onChange({ ...value, x: round3(x), y: round3(y) });
  };
  const onKey = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 0.1 : 0.02;
    const d: Record<string, [number, number]> = {
      ArrowRight: [step, 0],
      ArrowLeft: [-step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    const m = d[e.key];
    if (!m) return;
    e.preventDefault();
    let x = value.x + m[0];
    let y = value.y + m[1];
    const r = Math.hypot(x, y);
    if (r > 1) {
      x /= r;
      y /= r;
    }
    onChange({ ...value, x: round3(x), y: round3(y) });
  };
  const neutral = value.x === 0 && value.y === 0 && value.master === 0;
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="flex w-full items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {label}
        </span>
        <button
          type="button"
          aria-label={`Reset ${label}`}
          disabled={neutral}
          onClick={() => onChange({ x: 0, y: 0, master: 0 })}
          className="text-muted-foreground hover:text-foreground disabled:opacity-30"
        >
          <RotateCcw className="h-3 w-3" />
        </button>
      </div>
      <div
        ref={ref}
        role="slider"
        tabIndex={0}
        aria-label={`${label} colour`}
        aria-valuetext={`${label}: ${Math.round(Math.hypot(value.x, value.y) * 100)}% toward hue ${Math.round(((Math.atan2(value.y, value.x) * 180) / Math.PI + 360) % 360)}°`}
        onKeyDown={onKey}
        onDoubleClick={() => onChange({ ...value, x: 0, y: 0 })}
        onPointerDown={(e) => {
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          fromPointer(e);
        }}
        onPointerMove={(e) => dragging.current && fromPointer(e)}
        onPointerUp={() => (dragging.current = false)}
        className="relative aspect-square w-full max-w-[124px] cursor-crosshair touch-none rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
        style={{ background: RING }}
      >
        <div className="absolute inset-[5px] rounded-full bg-[radial-gradient(circle,#1b1d23_0%,rgba(27,29,35,0.92)_55%,rgba(27,29,35,0.35)_100%)]" />
        <div className="absolute left-1/2 top-[8px] bottom-[8px] w-px -translate-x-1/2 bg-white/10" />
        <div className="absolute top-1/2 left-[8px] right-[8px] h-px -translate-y-1/2 bg-white/10" />
        <div
          className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-black/40 shadow"
          style={{ left: `${50 + value.x * 46}%`, top: `${50 - value.y * 46}%` }}
        />
      </div>
      <input
        type="range"
        aria-label={`${label} master`}
        min={-1}
        max={1}
        step={0.01}
        value={value.master}
        onChange={(e) => onChange({ ...value, master: Number(e.target.value) })}
        onDoubleClick={() => onChange({ ...value, master: 0 })}
        className="w-full accent-[var(--color-primary)]"
      />
      <span className="tc text-[10px] text-muted-foreground">
        {value.master >= 0 ? "+" : ""}
        {value.master.toFixed(2)}
      </span>
    </div>
  );
}

const CURVE_TABS: { id: string; label: string; kinds: CurveKind[] }[] = [
  { id: "custom", label: "Custom", kinds: ["y", "r", "g", "b"] },
  { id: "hueHue", label: "Hue vs Hue", kinds: ["hueHue"] },
  { id: "hueSat", label: "Hue vs Sat", kinds: ["hueSat"] },
  { id: "lumSat", label: "Luma vs Sat", kinds: ["lumSat"] },
];
const STROKE: Record<CurveKind, string> = {
  y: "#e7e9ee",
  r: "#ff5a5a",
  g: "#4ade80",
  b: "#60a5fa",
  hueHue: "#e7e9ee",
  hueSat: "#e7e9ee",
  lumSat: "#e7e9ee",
};

function CurveEditor({
  kind,
  points,
  onChange,
}: {
  kind: CurveKind;
  points: CurvePoints;
  onChange: (p: CurvePoints) => void;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const W = 256;
  const H = 160;
  const wrap = periodic(kind);
  const path = useMemo(() => {
    let d = "";
    for (let i = 0; i <= 64; i++) {
      const x = i / 64;
      const y = clamp(evalCurve(points, x, wrap), 0, 1);
      d += `${i ? "L" : "M"}${x * W},${(1 - y) * H}`;
    }
    return d;
  }, [points, wrap]);
  const toUnit = (e: PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return [
      clamp((e.clientX - r.left) / r.width, 0, 1),
      clamp(1 - (e.clientY - r.top) / r.height, 0, 1),
    ] as [number, number];
  };
  const sorted = (p: CurvePoints) => [...p].sort((a, b) => a[0] - b[0]);
  const move = (i: number, [x, y]: [number, number]) => {
    const next = points.map((p) => [...p] as [number, number]);
    // tone curves keep their end points pinned to x = 0 / 1
    const pinned = !wrap && (i === 0 || i === points.length - 1);
    const lo = !wrap && i > 0 ? next[i - 1]![0] + 0.01 : 0;
    const hi = !wrap && i < next.length - 1 ? next[i + 1]![0] - 0.01 : 1;
    next[i] = [pinned ? next[i]![0] : round3(clamp(x, lo, hi)), round3(y)];
    onChange(wrap ? sorted(next) : next);
  };
  const background =
    kind === "hueHue" || kind === "hueSat"
      ? "linear-gradient(90deg, hsl(0 70% 35%), hsl(60 70% 35%), hsl(120 70% 35%), hsl(180 70% 35%), hsl(240 70% 35%), hsl(300 70% 35%), hsl(360 70% 35%))"
      : kind === "lumSat"
        ? "linear-gradient(90deg, #000, #888)"
        : "transparent";
  return (
    <div className="space-y-1">
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        role="group"
        aria-label={`${kind} curve. Click to add a point, drag to move, double-click a point to remove it.`}
        className="h-auto w-full touch-none rounded border bg-background/60"
        style={{ background }}
        onPointerDown={(e) => {
          if ((e.target as Element).tagName === "circle") return;
          if (points.length >= 16) {
            toast.message("Curves can have up to 16 points.");
            return;
          }
          const [x, y] = toUnit(e);
          const next = sorted([...points, [round3(x), round3(y)]]);
          onChange(next);
          const idx = next.findIndex((p) => p[0] === round3(x) && p[1] === round3(y));
          setDrag(idx);
          ref.current!.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => drag !== null && move(drag, toUnit(e))}
        onPointerUp={() => setDrag(null)}
      >
        {[0.25, 0.5, 0.75].map((g) => (
          <g key={g} stroke="rgba(255,255,255,0.08)">
            <line x1={g * W} x2={g * W} y1={0} y2={H} />
            <line y1={g * H} y2={g * H} x1={0} x2={W} />
          </g>
        ))}
        {wrap || kind === "lumSat" ? (
          <line
            x1={0}
            x2={W}
            y1={H / 2}
            y2={H / 2}
            stroke="rgba(255,255,255,0.25)"
            strokeDasharray="3 3"
          />
        ) : (
          <line x1={0} y1={H} x2={W} y2={0} stroke="rgba(255,255,255,0.15)" strokeDasharray="3 3" />
        )}
        <path d={path} fill="none" stroke={STROKE[kind]} strokeWidth={2} />
        {points.map(([x, y], i) => (
          <circle
            key={i}
            cx={x * W}
            cy={(1 - y) * H}
            r={focus === i || drag === i ? 6 : 4.5}
            fill={STROKE[kind]}
            stroke="#0b0b0d"
            strokeWidth={1.5}
            tabIndex={0}
            role="slider"
            aria-label={`Point ${i + 1} at ${Math.round(x * 100)}%, ${Math.round(y * 100)}%`}
            aria-valuenow={Math.round(y * 100)}
            className="cursor-grab outline-none"
            onFocus={() => setFocus(i)}
            onBlur={() => setFocus(null)}
            onPointerDown={(e) => {
              e.stopPropagation();
              setDrag(i);
              ref.current!.setPointerCapture(e.pointerId);
            }}
            onDoubleClick={() => {
              const canRemove = wrap ? points.length > 1 : i !== 0 && i !== points.length - 1;
              if (canRemove) onChange(points.filter((_, j) => j !== i));
            }}
            onKeyDown={(e) => {
              const s = e.shiftKey ? 0.05 : 0.01;
              const d: Record<string, [number, number]> = {
                ArrowUp: [0, s],
                ArrowDown: [0, -s],
                ArrowLeft: [-s, 0],
                ArrowRight: [s, 0],
              };
              const m = d[e.key];
              if (m) {
                e.preventDefault();
                move(i, [x + m[0], clamp(y + m[1], 0, 1)]);
              } else if (e.key === "Delete" || e.key === "Backspace") {
                const canRemove = wrap ? points.length > 1 : i !== 0 && i !== points.length - 1;
                if (canRemove) onChange(points.filter((_, j) => j !== i));
              }
            }}
          />
        ))}
      </svg>
      <p className="text-[10px] text-muted-foreground">
        {kind === "hueHue"
          ? "Raise or lower a hue to rotate it toward a neighbouring hue."
          : kind === "hueSat"
            ? "Raise a hue to saturate it, lower it to desaturate."
            : kind === "lumSat"
              ? "Saturation by brightness: lower the left end to clean up shadow colour."
              : "Click to add points; drag to shape. Double-click a point to remove it."}
      </p>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step = 0.01,
  neutral,
  format = (v: number) => v.toFixed(2),
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  neutral: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block text-xs">
      <span className="flex justify-between">
        <span>{label}</span>
        <span className="tc text-muted-foreground">{format(value)}</span>
      </span>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => onChange(neutral)}
        className="w-full accent-[var(--color-primary)]"
      />
    </label>
  );
}

/** Resolve-style primaries and curves for the selected clip. */
export function ColorGradePanel({ clip }: { clip: Clip }) {
  const g: ColorGrade = clip.colorGrade ?? NEUTRAL_GRADE;
  const [tab, setTab] = useState("custom");
  const [channel, setChannel] = useState<CurveKind>("y");
  const set = (patch: Partial<ColorGrade>) => {
    const next: ColorGrade = { ...g, ...patch };
    updateClip(clip.id, { colorGrade: gradeActive(next) ? next : undefined }, `cgrade-${clip.id}`);
  };
  const setWheel = (k: WheelKind) => (w: Wheel) => set({ [k]: w } as Partial<ColorGrade>);
  const activeTab = CURVE_TABS.find((t) => t.id === tab)!;
  const kind: CurveKind = activeTab.kinds.length > 1 ? channel : activeTab.kinds[0]!;
  const pts = g.curves[kind] ?? neutralCurve(kind);
  const setCurve = (p: CurvePoints) => set({ curves: { ...g.curves, [kind]: p } });

  return (
    <section aria-labelledby="grade-title" className="space-y-4 rounded-lg border p-3">
      <div className="flex items-center justify-between">
        <h3 id="grade-title" className="text-xs font-semibold">
          Colour wheels &amp; curves
        </h3>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[11px]"
            disabled={!clip.colorGrade}
            onClick={() => {
              commit((p) => ({
                ...p,
                clips: p.clips.map((c) => ({ ...c, colorGrade: clip.colorGrade })),
              }));
              toast.success("Applied this grade to every clip.");
            }}
          >
            Apply to all
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[11px]"
            disabled={!clip.colorGrade}
            onClick={() => updateClip(clip.id, { colorGrade: undefined })}
          >
            <RotateCcw className="h-3 w-3" />
            Reset
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-4">
        <ColorWheel label="Lift" value={g.lift} onChange={setWheel("lift")} />
        <ColorWheel label="Gamma" value={g.gamma} onChange={setWheel("gamma")} />
        <ColorWheel label="Gain" value={g.gain} onChange={setWheel("gain")} />
        <ColorWheel label="Offset" value={g.offset} onChange={setWheel("offset")} />
      </div>
      <p className="text-[10px] leading-relaxed text-muted-foreground">
        Lift = shadows, Gamma = midtones, Gain = highlights, Offset = everything. Drag the puck
        toward a colour; the slider under each wheel brightens or darkens that range. Double-click
        to reset.
      </p>

      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        <Slider
          label="Temperature"
          value={g.temperature}
          min={-1}
          max={1}
          neutral={0}
          onChange={(v) => set({ temperature: v })}
        />
        <Slider
          label="Tint"
          value={g.tint}
          min={-1}
          max={1}
          neutral={0}
          onChange={(v) => set({ tint: v })}
        />
        <Slider
          label="Contrast"
          value={g.contrast}
          min={0}
          max={2}
          neutral={1}
          onChange={(v) => set({ contrast: v })}
        />
        <Slider
          label="Pivot"
          value={g.pivot}
          min={0}
          max={1}
          neutral={0.435}
          onChange={(v) => set({ pivot: v })}
        />
        <Slider
          label="Saturation"
          value={g.saturation}
          min={0}
          max={2}
          neutral={1}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => set({ saturation: v })}
        />
      </div>

      <div className="space-y-2">
        <div role="tablist" aria-label="Curve type" className="flex flex-wrap gap-1">
          {CURVE_TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className="rounded px-2 py-1 text-[11px] text-muted-foreground aria-selected:bg-white/10 aria-selected:text-foreground"
            >
              {t.label}
            </button>
          ))}
        </div>
        {activeTab.kinds.length > 1 && (
          <div className="flex items-center gap-1" role="radiogroup" aria-label="Curve channel">
            {activeTab.kinds.map((k) => (
              <button
                key={k}
                role="radio"
                aria-checked={channel === k}
                onClick={() => setChannel(k)}
                className="h-6 w-7 rounded border text-[11px] font-semibold uppercase aria-checked:border-foreground"
                style={{ color: STROKE[k] }}
              >
                {k}
              </button>
            ))}
          </div>
        )}
        <CurveEditor key={kind} kind={kind} points={pts} onChange={setCurve} />
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-[11px]"
          disabled={!g.curves[kind]}
          onClick={() => {
            const { [kind]: _drop, ...rest } = g.curves;
            set({ curves: rest });
          }}
        >
          <RotateCcw className="h-3 w-3" />
          Reset this curve
        </Button>
      </div>
      <p className="text-[10px] leading-relaxed text-muted-foreground">
        Order: basic adjustments → wheels → curves → look. Preview and export use the same GPU pass.
      </p>
    </section>
  );
}
