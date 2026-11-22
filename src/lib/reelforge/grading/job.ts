// Shared glue between a clip's grading settings and the GPU pass, used by both the Shorts
// editor (Clip) and Sequence Studio (timeline Item). Anything with optional `colorGrade`
// (wheels/curves) and `grade` (imported look) can be graded.
import type { GradeSettings } from "../core";
import { lookGpuError, lookRenderer, type GradeJob } from "./gpu";
import { getLook } from "./library";
import {
  bakeCurves,
  curvesActive,
  gradeActive,
  primaryParams,
  readColorGrade,
  type ColorGrade,
} from "./primaries";

export interface Gradable {
  colorGrade?: ColorGrade | undefined;
  grade?: GradeSettings | undefined;
}

/** Normalised look reference, or null when there's no look. */
export function lookRefOf(g: unknown): GradeSettings | null {
  const o = g as Partial<GradeSettings> | null | undefined;
  if (!o || typeof o.lookId !== "string" || !o.lookId || o.lookId.length > 100) return null;
  const i = typeof o.intensity === "number" && Number.isFinite(o.intensity) ? o.intensity : 1;
  return { lookId: o.lookId, intensity: Math.min(1, Math.max(0, i)) };
}

/** Validate untrusted grading fields (from a project file) into a clean Gradable. */
export function readGradable(x: Gradable): Gradable {
  const colorGrade = readColorGrade(x.colorGrade);
  const grade = lookRefOf(x.grade);
  return { ...(colorGrade ? { colorGrade } : {}), ...(grade ? { grade } : {}) };
}

export const isGraded = (x: Gradable) =>
  (!!x.colorGrade && gradeActive(x.colorGrade)) ||
  (!!lookRefOf(x.grade) && lookRefOf(x.grade)!.intensity > 0);

// Curve tables are baked once per distinct curve set (previews redraw every frame).
const bakedCurves = new Map<string, { table: Float32Array; key: string }>();
function curveTable(curves: ColorGrade["curves"]) {
  const key = JSON.stringify(curves);
  let hit = bakedCurves.get(key);
  if (!hit) {
    if (bakedCurves.size > 32) bakedCurves.clear();
    hit = { table: bakeCurves(curves), key };
    bakedCurves.set(key, hit);
  }
  return hit;
}

/** What the GPU grading pass should apply, or null when nothing is active. */
export function gradeJobFor(x: Gradable): GradeJob | null {
  const cg = x.colorGrade && gradeActive(x.colorGrade) ? x.colorGrade : null;
  const g = lookRefOf(x.grade);
  const look = g && g.intensity > 0 ? getLook(g.lookId) : null;
  if (!cg && !look) return null;
  return {
    primary: cg ? primaryParams(cg) : null,
    curves: cg && curvesActive(cg.curves) ? curveTable(cg.curves) : null,
    look,
    intensity: g?.intensity ?? 1,
  };
}

/**
 * Throws before an export starts if a grade can't be rendered, so it is never silently
 * dropped from the exported file. `label` names the clip in the message.
 */
export function assertGradeRenderable(label: string, x: Gradable) {
  if (x.colorGrade && gradeActive(x.colorGrade) && !lookRenderer())
    throw new Error(lookGpuError() ?? "Colour grading can't be rendered in this browser.");
  const g = lookRefOf(x.grade);
  if (!g || !(g.intensity > 0)) return;
  if (!getLook(g.lookId))
    throw new Error(
      `"${label}" uses a look that isn't in this browser's library. Re-import it, or set the look to None.`,
    );
  if (!lookRenderer())
    throw new Error(lookGpuError() ?? "Looks can't be rendered in this browser.");
}
