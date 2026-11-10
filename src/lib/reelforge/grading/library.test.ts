// @vitest-environment node
// Node's structured clone keeps typed arrays/blobs intact through fake IndexedDB, like browsers.
import "fake-indexeddb/auto";
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("./gpu", () => ({ lookRenderer: () => ({}), lookGpuError: () => null }));
const lib = await import("./library");

const cube = (name: string) =>
  new File(
    [`TITLE "${name}"\nLUT_3D_SIZE 2\n0 0 0\n0 0 1\n0 1 0\n0 1 1\n1 0 0\n1 0 1\n1 1 0\n1 1 1\n`],
    `${name}.cube`,
  );

beforeEach(async () => {
  await lib._resetLooksForTests();
  await new Promise((r) => {
    const req = indexedDB.deleteDatabase("reelcraft-looks");
    req.onsuccess = req.onerror = req.onblocked = r;
  });
});

it("imports, persists across a reload and deletes looks", async () => {
  const a = await lib.importLook(cube("Teal Orange"));
  expect(a.name).toBe("Teal Orange");
  expect(lib.describeLook(a)).toBe("3D LUT · 2³");
  await lib._resetLooksForTests(); // simulate a page reload (memory cleared, DB kept)
  await lib.loadLooks();
  expect(lib.getLooks().map((l) => l.name)).toEqual(["Teal Orange"]);
  const restored = lib.getLooks()[0]!;
  expect(restored.transform.kind).toBe("lut3d");
  expect(restored.transform.kind === "lut3d" && restored.transform.data).toBeInstanceOf(
    Float32Array,
  );
  await lib.deleteLook(restored.id);
  expect(lib.getLooks()).toEqual([]);
  // still resolvable this session, so queued exports keep their look
  expect(lib.getLook(restored.id)?.name).toBe("Teal Orange");
});

it("rejects bad files with a readable message", async () => {
  await expect(lib.importLook(new File(["hello"], "x.cube"))).rejects.toThrow(/LUT_3D_SIZE/);
  await expect(lib.importLook(new File(["x"], "grade.drx"))).rejects.toThrow(/Use \.cube/);
});

it("blocks exports whose look is missing instead of dropping the grade", async () => {
  const clip = {
    id: "c",
    title: "Intro",
    start: 0,
    end: 1,
    framing: { aspect: "9:16", fit: "fill", zoom: 1, fx: 0.5, fy: 0.5 },
  } as const;
  expect(() => lib.assertGradeReady({ ...clip, grade: { lookId: "gone", intensity: 1 } })).toThrow(
    /isn't in this browser's library/,
  );
  expect(() =>
    lib.assertGradeReady({ ...clip, grade: { lookId: "gone", intensity: 0 } }),
  ).not.toThrow();
  expect(() => lib.assertGradeReady(clip)).not.toThrow();
  const look = await lib.importLook(cube("Warm"));
  expect(() =>
    lib.assertGradeReady({ ...clip, grade: { lookId: look.id, intensity: 0.5 } }),
  ).not.toThrow();
});
