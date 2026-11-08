import { titleOf, videoFilter } from "./editing";
// Browser-only frame compositor shared by preview and export.
import { activeCaptions, computeLayout, type Caption, type CaptionStyle, type Clip, type Framing } from "./core";

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
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, outW, outH);
  if (video.videoWidth) {
    const l = computeLayout(video.videoWidth, video.videoHeight, outW, outH, framing);
    ctx.save();
    ctx.filter = clip ? videoFilter(clip, outH) : "none";
    ctx.drawImage(video, l.dx, l.dy, l.dw, l.dh);
    ctx.restore();
  }
  if (clip) {
    const title = titleOf(clip);
    if (title.enabled && t >= title.start && t < title.end) {
      ctx.save();
      const fs = title.size / 100 * outH;
      ctx.font = `800 ${fs}px ${CAPTION_FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const lines = wrap(ctx, title.text, outW * Math.min(0.84, 2 * Math.min(title.x, 1 - title.x)));
      const lh = fs * 1.22;
      lines.forEach((line, i) => {
        const x = title.x * outW, y = title.y * outH + (i - (lines.length - 1) / 2) * lh;
        if (title.background) {
          const width = Math.min(outW * .9, ctx.measureText(line).width + fs * .6);
          ctx.fillStyle = 'rgba(0,0,0,.7)';
          ctx.fillRect(x - width / 2, y - lh / 2, width, lh);
        }
        ctx.fillStyle = title.color;
        ctx.fillText(line, x, y, outW * .9);
      });
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
