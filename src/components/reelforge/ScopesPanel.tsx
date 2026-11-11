import { useEffect, useRef, useState } from "react";
import { Activity, ChevronDown } from "lucide-react";
import {
  SKIN_LINE_DEG,
  TARGETS,
  cbcr,
  subscribeScopes,
  type ScopeData,
} from "@/lib/reelforge/grading/scopes";

type Mode = "waveform" | "parade" | "vector" | "histogram";
const MODES: { id: Mode; label: string; hint: string }[] = [
  {
    id: "waveform",
    label: "Waveform",
    hint: "Brightness of each column of the picture, black at the bottom, white at the top.",
  },
  {
    id: "parade",
    label: "Parade",
    hint: "Red, green and blue side by side — level them to neutralise a colour cast.",
  },
  {
    id: "vector",
    label: "Vectorscope",
    hint: "Hue around the circle, saturation outward. Skin tones sit near the dashed line.",
  },
  { id: "histogram", label: "Histogram", hint: "How many pixels sit at each level, per channel." },
];

const W = 300;
const H = 170;
const PREF = "reelforge.scopes";

/** Log-scaled 0..1 density so faint detail stays visible next to bright areas. */
function normaliser(arr: Uint32Array) {
  let max = 0;
  for (let i = 0; i < arr.length; i++) if (arr[i]! > max) max = arr[i]!;
  const k = 1 / Math.log1p(max || 1);
  return (v: number) => Math.log1p(v) * k;
}

function graticule(ctx: CanvasRenderingContext2D, x0: number, w: number) {
  ctx.save();
  ctx.font = "9px ui-monospace, monospace";
  ctx.textBaseline = "middle";
  for (const p of [0, 25, 50, 75, 100]) {
    const y = H - 6 - (p / 100) * (H - 12);
    ctx.strokeStyle = p === 0 || p === 100 ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.12)";
    ctx.beginPath();
    ctx.moveTo(x0, y + 0.5);
    ctx.lineTo(x0 + w, y + 0.5);
    ctx.stroke();
    if (x0 === 0) {
      ctx.fillStyle = "rgba(255,255,255,0.45)";
      // keep labels inside the canvas: the top one goes just under its line
      ctx.fillText(String(p), 2, p === 100 ? y + 6 : y - 5);
    }
  }
  ctx.restore();
}

/** Draw a width×levels density into the band [x0, x0+w) of the scope, tinted `rgb`. */
function drawDensity(
  img: ImageData,
  density: Uint32Array,
  cols: number,
  levels: number,
  x0: number,
  w: number,
  rgb: [number, number, number],
) {
  const n = normaliser(density);
  const top = 6;
  const span = H - 12;
  for (let x = 0; x < w; x++) {
    const col = Math.min(cols - 1, Math.floor((x / w) * cols));
    for (let y = 0; y < span; y++) {
      const level = Math.min(levels - 1, Math.floor(((span - 1 - y) / span) * levels));
      const v = n(density[level * cols + col]!);
      if (!v) continue;
      const i = ((top + y) * W + x0 + x) * 4;
      img.data[i] = Math.min(255, img.data[i]! + rgb[0] * v);
      img.data[i + 1] = Math.min(255, img.data[i + 1]! + rgb[1] * v);
      img.data[i + 2] = Math.min(255, img.data[i + 2]! + rgb[2] * v);
      img.data[i + 3] = 255;
    }
  }
}

function render(ctx: CanvasRenderingContext2D, mode: Mode, d: ScopeData) {
  ctx.fillStyle = "#08090c";
  ctx.fillRect(0, 0, W, H);
  if (mode === "waveform" || mode === "parade") {
    const img = ctx.getImageData(0, 0, W, H);
    if (mode === "waveform") drawDensity(img, d.luma, d.width, d.levels, 0, W, [170, 255, 190]);
    else {
      const third = Math.floor(W / 3);
      const tints: [number, number, number][] = [
        [255, 70, 70],
        [70, 255, 110],
        [80, 140, 255],
      ];
      d.parade.forEach((p, c) =>
        drawDensity(img, p, d.width, d.levels, c * third, third - 2, tints[c]!),
      );
    }
    ctx.putImageData(img, 0, 0);
    graticule(ctx, 0, W);
    return;
  }
  if (mode === "histogram") {
    const top = 6;
    const span = H - 12;
    // scale to the tallest bin, ignoring the extreme ends so a clipped spike doesn't flatten the rest
    let max = 1;
    for (const h of d.hist) for (let i = 1; i < 255; i++) max = Math.max(max, h[i]!);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const colors = ["rgba(255,70,70,0.55)", "rgba(70,255,110,0.5)", "rgba(80,140,255,0.6)"];
    d.hist.slice(0, 3).forEach((h, c) => {
      ctx.fillStyle = colors[c]!;
      ctx.beginPath();
      ctx.moveTo(0, top + span);
      for (let i = 0; i < 256; i++)
        ctx.lineTo((i / 255) * W, top + span - Math.min(1, h[i]! / max) * span);
      ctx.lineTo(W, top + span);
      ctx.closePath();
      ctx.fill();
    });
    ctx.restore();
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < 256; i++) {
      const y = top + span - Math.min(1, d.hist[3][i]! / max) * span;
      if (i) ctx.lineTo((i / 255) * W, y);
      else ctx.moveTo(0, y);
    }
    ctx.stroke();
    return;
  }
  // vectorscope: square, centred
  const S = H;
  const ox = (W - S) / 2;
  const n = normaliser(d.vector);
  const img = ctx.getImageData(0, 0, W, H);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const cx = Math.floor((x / S) * d.vsize);
      const cy = Math.floor((y / S) * d.vsize);
      const v = n(d.vector[cy * d.vsize + cx]!);
      if (!v) continue;
      // tint each point by the hue it represents
      const cb = (cx + 0.5) / d.vsize - 0.5;
      const cr = 0.5 - (cy + 0.5) / d.vsize;
      const Y = 0.6;
      const r = Math.max(0, Math.min(1, Y + 1.5748 * cr));
      const b = Math.max(0, Math.min(1, Y + 1.8556 * cb));
      const g = Math.max(0, Math.min(1, (Y - 0.2126 * r - 0.0722 * b) / 0.7152));
      const i = (y * W + Math.round(ox) + x) * 4;
      img.data[i] = 40 + 215 * v * (0.35 + 0.65 * r);
      img.data[i + 1] = 40 + 215 * v * (0.35 + 0.65 * g);
      img.data[i + 2] = 40 + 215 * v * (0.35 + 0.65 * b);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const cxp = ox + S / 2;
  const cyp = S / 2;
  const toXY = (cb: number, cr: number) => [cxp + cb * S, cyp - cr * S] as const;
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.beginPath();
  ctx.arc(cxp, cyp, S / 2 - 1, 0, Math.PI * 2);
  ctx.moveTo(cxp - S / 2, cyp);
  ctx.lineTo(cxp + S / 2, cyp);
  ctx.moveTo(cxp, cyp - S / 2);
  ctx.lineTo(cxp, cyp + S / 2);
  ctx.stroke();
  // skin-tone line
  const a = (SKIN_LINE_DEG * Math.PI) / 180;
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = "rgba(255,200,150,0.55)";
  ctx.beginPath();
  ctx.moveTo(cxp, cyp);
  ctx.lineTo(cxp + Math.cos(a) * (S / 2 - 2), cyp - Math.sin(a) * (S / 2 - 2));
  ctx.stroke();
  ctx.setLineDash([]);
  // 75% colour-bar targets
  ctx.font = "9px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const t of TARGETS) {
    const [x, y] = toXY(...cbcr(...t.rgb));
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.strokeRect(x - 4, y - 4, 8, 8);
    // label just outside the target, but never beyond the scope's edge
    const [tcb, tcr] = cbcr(...t.rgb);
    const len = Math.hypot(tcb, tcr) || 1;
    const reach = Math.min(len * 1.32, 0.5 - 8 / S);
    const [lx, ly] = toXY((tcb / len) * reach, (tcr / len) * reach);
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.fillText(t.label, lx, ly);
  }
  ctx.restore();
}

/** Live scopes of the graded preview frame (before titles/captions). */
export function ScopesPanel() {
  const [open, setOpen] = useState(true);
  const [mode, setMode] = useState<Mode>("waveform");
  const [stats, setStats] = useState<{ crushed: number; clipped: number } | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(PREF) ?? "null") as {
        open?: boolean;
        mode?: Mode;
      } | null;
      if (saved?.mode && MODES.some((m) => m.id === saved.mode)) setMode(saved.mode);
      if (typeof saved?.open === "boolean") setOpen(saved.open);
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(PREF, JSON.stringify({ open, mode }));
    } catch {
      /* ignore */
    }
  }, [open, mode]);

  useEffect(() => {
    if (!open) return;
    return subscribeScopes((d) => {
      const ctx = canvas.current?.getContext("2d", { willReadFrequently: true });
      if (ctx) render(ctx, modeRef.current, d);
      setStats((s) =>
        s && Math.abs(s.crushed - d.crushed) < 0.0005 && Math.abs(s.clipped - d.clipped) < 0.0005
          ? s
          : { crushed: d.crushed, clipped: d.clipped },
      );
    });
  }, [open]);

  const pct = (v: number) => (v < 0.001 ? "0%" : `${(v * 100).toFixed(1)}%`);
  return (
    <section aria-labelledby="scopes-title" className="rounded-lg border p-3">
      <button
        id="scopes-title"
        className="flex w-full items-center justify-between text-xs font-semibold"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="flex items-center gap-1.5">
          <Activity className="h-3.5 w-3.5 text-primary" />
          Scopes
        </span>
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "" : "-rotate-90"}`} />
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <div role="tablist" aria-label="Scope type" className="flex flex-wrap gap-1">
            {MODES.map((m) => (
              <button
                key={m.id}
                role="tab"
                aria-selected={mode === m.id}
                onClick={() => setMode(m.id)}
                className="rounded px-2 py-1 text-[11px] text-muted-foreground aria-selected:bg-white/10 aria-selected:text-foreground"
              >
                {m.label}
              </button>
            ))}
          </div>
          <canvas
            ref={canvas}
            width={W}
            height={H}
            role="img"
            aria-label={`${MODES.find((m) => m.id === mode)!.label} of the graded frame`}
            className="h-auto w-full rounded border bg-[#08090c]"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>{MODES.find((m) => m.id === mode)!.hint}</span>
          </div>
          {stats && (
            <p className="tc text-[10px] text-muted-foreground">
              Crushed to black {pct(stats.crushed)} · Clipped to white {pct(stats.clipped)}
            </p>
          )}
          <p className="text-[10px] text-muted-foreground">
            Measures the graded video only — titles and captions are left out.
          </p>
        </div>
      )}
    </section>
  );
}
