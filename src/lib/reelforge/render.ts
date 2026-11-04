// Browser-only frame compositor shared by preview and export.
import { activeCaptions, computeLayout, type Caption, type CaptionStyle, type Framing } from "./core";

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
) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, outW, outH);
  if (video.videoWidth) {
    const l = computeLayout(video.videoWidth, video.videoHeight, outW, outH, framing);
    ctx.drawImage(video, l.dx, l.dy, l.dw, l.dh);
  }
  if (!captions) return;
  const act = activeCaptions(captions, t);
  if (!act.length) return;
  const fs = (style.size / 100) * outH;
  ctx.font = `${style.weight} ${fs}px ${CAPTION_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
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
