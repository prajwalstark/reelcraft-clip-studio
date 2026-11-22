import { expect, it, vi } from "vitest";

const looks = new Map<string, unknown>([
  [
    "warm",
    {
      id: "warm",
      name: "Warm",
      file: "w.cube",
      addedAt: 0,
      transform: {
        kind: "cdl",
        slope: [1, 1, 1],
        offset: [0, 0, 0],
        power: [1, 1, 1],
        saturation: 1,
      },
    },
  ],
]);
let gpu: object | null = {};
vi.mock("./library", () => ({ getLook: (id: string) => looks.get(id) ?? null }));
vi.mock("./gpu", () => ({ lookRenderer: () => gpu, lookGpuError: () => "Looks need WebGL2." }));
const job = await import("./job");
const { NEUTRAL_GRADE } = await import("./primaries");

it("normalises look references and drops malformed ones", () => {
  expect(job.lookRefOf({ lookId: "warm", intensity: 3 })).toEqual({ lookId: "warm", intensity: 1 });
  expect(job.lookRefOf({ lookId: "warm" })).toEqual({ lookId: "warm", intensity: 1 });
  expect(job.lookRefOf({ lookId: "" })).toBeNull();
  expect(job.lookRefOf({ lookId: 7 })).toBeNull();
  expect(job.lookRefOf(null)).toBeNull();
});

it("reads untrusted grading fields into a clean object", () => {
  expect(job.readGradable({})).toEqual({});
  const g = job.readGradable({
    colorGrade: { ...NEUTRAL_GRADE, saturation: 1.5 },
    grade: { lookId: "warm", intensity: 0.4 },
  });
  expect(g.colorGrade?.saturation).toBe(1.5);
  expect(g.grade).toEqual({ lookId: "warm", intensity: 0.4 });
  // neutral grades aren't kept
  expect(job.readGradable({ colorGrade: NEUTRAL_GRADE })).toEqual({});
});

it("builds a GPU job only when something is active", () => {
  expect(job.gradeJobFor({})).toBeNull();
  expect(job.gradeJobFor({ grade: { lookId: "warm", intensity: 0 } })).toBeNull();
  expect(job.gradeJobFor({ grade: { lookId: "missing", intensity: 1 } })).toBeNull();
  const j = job.gradeJobFor({
    colorGrade: {
      ...NEUTRAL_GRADE,
      curves: {
        y: [
          [0, 0.1],
          [1, 1],
        ],
      },
    },
    grade: { lookId: "warm", intensity: 0.5 },
  })!;
  expect(j.primary).toBeTruthy();
  expect(j.curves?.table).toBeInstanceOf(Float32Array);
  expect(j.look).toBe(looks.get("warm"));
  expect(j.intensity).toBe(0.5);
  // curve tables are cached per distinct curve set
  const again = job.gradeJobFor({
    colorGrade: {
      ...NEUTRAL_GRADE,
      curves: {
        y: [
          [0, 0.1],
          [1, 1],
        ],
      },
    },
  })!;
  expect(again.curves).toBe(j.curves);
});

it("refuses to export a grade it can't render", () => {
  expect(() =>
    job.assertGradeRenderable("Clip", { grade: { lookId: "missing", intensity: 1 } }),
  ).toThrow(/"Clip" uses a look that isn't/);
  expect(() =>
    job.assertGradeRenderable("Clip", { grade: { lookId: "warm", intensity: 1 } }),
  ).not.toThrow();
  gpu = null;
  expect(() =>
    job.assertGradeRenderable("Clip", { colorGrade: { ...NEUTRAL_GRADE, contrast: 1.2 } }),
  ).toThrow(/WebGL2/);
  expect(() => job.assertGradeRenderable("Clip", {})).not.toThrow();
  gpu = {};
});
