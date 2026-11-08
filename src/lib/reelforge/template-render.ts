import type { templateFrame } from "./templates";

/** Decorations are generated locally; no external template footage, fonts or audio. */
export function drawTemplateDecorations(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  frame: NonNullable<ReturnType<typeof templateFrame>>,
) {
  const { settings: s, progress, sweep } = frame;
  ctx.save();
  ctx.strokeStyle = s.accent;
  ctx.fillStyle = s.accent;
  ctx.lineWidth = Math.max(1, h * 0.002);
  const margin = w * 0.06;
  if (s.id === "weekend" || s.id === "rhythm") {
    ctx.globalAlpha = 0.55;
    ctx.strokeRect(margin, h * 0.06, w - margin * 2, h * 0.88);
    ctx.globalAlpha = 0.9;
    ctx.fillRect(margin, h * 0.06, (w - margin * 2) * progress, h * 0.003);
  } else if (s.id === "momentum") {
    ctx.globalAlpha = 0.9;
    ctx.fillRect(margin, h * 0.12, w * (0.12 + 0.3 * progress), h * 0.008);
    ctx.fillRect(margin, h * 0.9, (w - margin * 2) * progress, h * 0.004);
  } else if (s.id === "prism") {
    ctx.globalAlpha = 0.8;
    const length = w * 0.12;
    for (const [x, y, sx, sy] of [
      [margin, h * 0.08, 1, 1],
      [w - margin, h * 0.08, -1, 1],
      [margin, h * 0.92, 1, -1],
      [w - margin, h * 0.92, -1, -1],
    ]) {
      ctx.beginPath();
      ctx.moveTo(x! + sx! * length, y!);
      ctx.lineTo(x!, y!);
      ctx.lineTo(x!, y! + sy! * length);
      ctx.stroke();
    }
    ctx.globalAlpha = Math.sin(sweep * Math.PI) * 0.16 * s.intensity;
    ctx.fillRect((sweep * 1.2 - 0.2) * w, 0, w * 0.2, h);
  } else {
    const vignette = ctx.createRadialGradient(
      w * 0.5,
      h * 0.45,
      w * 0.2,
      w * 0.5,
      h * 0.45,
      h * 0.75,
    );
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(1, `rgba(0,0,0,${0.45 * s.intensity})`);
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = s.accent;
    ctx.fillRect(w * 0.42, h * 0.82, w * 0.16, h * 0.002);
  }
  ctx.restore();
}
