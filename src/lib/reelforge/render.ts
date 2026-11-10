import { templateCaptionStyle, templateFrame } from "./templates";
import { drawTemplateDecorations } from "./template-render";
import { titleOf, videoFilter } from "./editing";
// Browser-only frame compositor shared by preview and export.
import { activeCaptions, computeLayout, type Caption, type CaptionStyle, type Clip, type Framing } from "./core";
import { captionWords, layoutWords, popScale, wordPhases } from "./caption-words";

export const CAPTION_FONT = '"Instrument Sans", system-ui, sans-serif';

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const w of para.split(/\s+/)) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width > maxW && line) {
        out.push(line);
        line = w;
      } else line = test;
    }
    if (line) out.push(line);
  }
  return out;
}

export function drawFrame(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  outW: number,
  outH: number,
  framing: Framing,
  captions: Caption[] | null,
  style: CaptionStyle,
  t: number,
  clip?: Clip,
) {
  const motion = clip ? templateFrame(clip, t) : null;
  style = templateCaptionStyle(clip, style);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, outW, outH);
  if (video.videoWidth) {
    const l = computeLayout(video.videoWidth, video.videoHeight, outW, outH, motion ? { ...framing, zoom: framing.zoom * motion.zoom } : framing);
    ctx.save();
    ctx.filter = clip ? videoFilter(clip, outH) : "none";
    ctx.drawImage(video, l.dx, l.dy, l.dw, l.dh);
    ctx.restore();
  }
  if (motion) drawTemplateDecorations(ctx, outW, outH, motion);
  if (clip) {
    const title = titleOf(clip);
    if (title.enabled && t >= title.start && t < title.end) {
      ctx.save();
      if (motion) ctx.globalAlpha = motion.titleAlpha;
      const fs = title.size / 100 * outH;
      ctx.font = `800 ${fs}px ${CAPTION_FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const lines = wrap(ctx, title.text, outW * Math.min(0.84, 2 * Math.min(title.x, 1 - title.x)));
      const lh = fs * 1.22;
      lines.forEach((line, i) => {
        const x = title.x * outW, y = title.y * outH + (motion?.titleOffsetY ?? 0) * outH + (i - (lines.length - 1) / 2) * lh;
        if (title.background) {
          const width = Math.min(outW * .9, ctx.measureText(line).width + fs * .6);
          ctx.fillStyle = 'rgba(0,0,0,.7)';
          ctx.fillRect(x - width / 2, y - lh / 2, width, lh);
        }
        ctx.fillStyle = title.color;
        ctx.fillText(line, x, y, outW * .9);
      });
      if (motion?.settings.subtitle) {
        ctx.font = `600 ${outH * .022}px ${CAPTION_FONT}`;
        ctx.fillStyle = motion.settings.accent;
        const subtitleY = Math.min(outH * .94, title.y * outH + (lines.length + 1) * lh / 2 + outH * .02 + motion.titleOffsetY * outH);
        ctx.fillText(motion.settings.subtitle, title.x * outW, subtitleY, outW * Math.min(.8, 2 * Math.min(title.x, 1-title.x)));
      }
      ctx.restore();
    }
  }
  if (!captions) return;
  const act = activeCaptions(captions, t);
  if (!act.length) return;
  const fs = (style.size / 100) * outH;
  ctx.font = `${style.weight} ${fs}px ${CAPTION_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (style.animation && style.animation !== "none") {
    drawAnimatedCaptions(ctx, act, style, t, outW, outH, fs);
    return;
  }
  const text = act.map((c) => c.text).join("\n");
  const lines = wrap(ctx, style.uppercase ? text.toUpperCase() : text, outW * 0.84);
  const lh = fs * 1.22;
  const top = style.y * outH - (lines.length * lh) / 2;
  lines.forEach((ln, i) => {
    const y = top + lh * i + lh / 2;
    const w = ctx.measureText(ln).width;
    if (style.bg) {
      ctx.fillStyle = "rgba(0,0,0,0.62)";
      const px = fs * 0.35;
      ctx.beginPath();
      ctx.roundRect(outW / 2 - w / 2 - px, y - lh / 2, w + px * 2, lh, fs * 0.2);
      ctx.fill();
    } else {
      ctx.lineWidth = fs * 0.14;
      ctx.strokeStyle = "rgba(0,0,0,0.85)";
      ctx.lineJoin = "round";
      ctx.strokeText(ln, outW / 2, y);
    }
    ctx.fillStyle = style.color;
    ctx.fillText(ln, outW / 2, y);
  });
}

/** Dark text on light accents, white on dark ones. */
export function contrastText(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  if (!Number.isFinite(n) || hex.length !== 7) return "#0b0b0d";
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.35 ? "#0b0b0d" : "#ffffff";
}

/** Word-by-word captions: karaoke fill, highlight pill, pop or reveal. */
function drawAnimatedCaptions(
  ctx: CanvasRenderingContext2D,
  active: Caption[],
  style: CaptionStyle,
  t: number,
  outW: number,
  outH: number,
  fs: number,
) {
  const mode = style.animation!;
  const accent = style.accent ?? "#c8ff3d";
  const words = active.flatMap((c, ci) =>
    captionWords(c).map((w, i) => ({
      ...w,
      br: w.br || (ci > 0 && i === 0),
      text: style.uppercase ? w.text.toUpperCase() : w.text,
    })),
  );
  if (!words.length) return;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  // Extra word spacing so the highlight pill and the popped word don't crowd their neighbours.
  const gap = mode === "highlight" ? fs * 0.24 : mode === "pop" ? fs * 0.16 : 0;
  const measure = (s: string) => ctx.measureText(s).width + (s === " " ? gap : 0);
  const lines = layoutWords(words, measure, outW * 0.84, outW / 2);
  const phases = wordPhases(words, t);
  const lh = fs * 1.22;
  const top = style.y * outH - (lines.length * lh) / 2;
  let k = 0;
  lines.forEach((line, li) => {
    const y = top + lh * li + lh / 2;
    const base = k;
    k += line.words.length;
    const shown =
      mode === "reveal" ? line.words.filter((_, j) => phases[base + j] !== "future") : line.words;
    if (!shown.length) return;
    if (style.bg) {
      // The box spans the words on screen, so with "reveal" it grows as words appear.
      const first = shown[0]!;
      const last = shown.at(-1)!;
      const px = fs * 0.35;
      ctx.fillStyle = "rgba(0,0,0,0.62)";
      ctx.beginPath();
      ctx.roundRect(first.x - px, y - lh / 2, last.x + last.width - first.x + px * 2, lh, fs * 0.2);
      ctx.fill();
    }
    line.words.forEach((w, j) => {
      const phase = phases[base + j]!;
      if (mode === "reveal" && phase === "future") return;
      let color = style.color;
      let scale = 1;
      let alpha = 1;
      let lift = 0;
      if (mode === "karaoke" && phase !== "future") color = accent;
      if (mode === "highlight" && phase === "current") {
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.roundRect(w.x - fs * 0.16, y - lh * 0.45, w.width + fs * 0.32, lh * 0.9, fs * 0.18);
        ctx.fill();
        color = contrastText(accent);
      }
      if (mode === "pop" && phase === "current") {
        color = accent;
        scale = popScale(w, t);
      }
      if (mode === "reveal") {
        const k2 = Math.min(1, Math.max(0, (t - w.start) / 0.14));
        alpha = k2;
        lift = (1 - k2) * fs * 0.25;
      }
      ctx.save();
      ctx.globalAlpha *= alpha;
      ctx.translate(w.x + w.width / 2, y + lift);
      if (scale !== 1) ctx.scale(scale, scale);
      const highlighted = mode === "highlight" && phase === "current";
      if (!style.bg && !highlighted) {
        ctx.lineWidth = fs * 0.14;
        ctx.strokeStyle = "rgba(0,0,0,0.85)";
        ctx.lineJoin = "round";
        ctx.strokeText(w.text, -w.width / 2, 0);
      }
      ctx.fillStyle = color;
      ctx.fillText(w.text, -w.width / 2, 0);
      ctx.restore();
    });
  });
  ctx.textAlign = "center";
}
