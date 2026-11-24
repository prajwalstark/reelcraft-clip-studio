import { describe, expect, it } from "vitest";
import {
  addItem,
  addTitle,
  assetOf,
  clipRect,
  fresh,
  parseSequence,
  patchItem,
  removeAsset,
  splitItem,
  visualItems,
  type Sequence,
} from "./model";
import {
  type AnimType,
  DEFAULT_TITLE,
  PRESETS,
  charCount,
  readTitle,
  titleAnimAt,
  titleLayout,
  titleName,
  wordCount,
} from "./titles";

function withVideo(): Sequence {
  const s = fresh();
  s.assets = [
    {
      id: "cam",
      name: "cam.mp4",
      kind: "video",
      size: 1,
      lastModified: 1,
      duration: 20,
      origin: 0,
      width: 1920,
      height: 1080,
      hasAudio: true,
      peaks: [],
    },
  ];
  return addItem(s, "cam", "V1", 0);
}

describe("readTitle", () => {
  it("keeps a valid title and fills/cleans the rest", () => {
    expect(readTitle(DEFAULT_TITLE)).toEqual(DEFAULT_TITLE);
    const t = readTitle({
      text: "x".repeat(900),
      font: "comic",
      weight: 950,
      size: 9,
      color: "red",
      align: "justify",
      lineHeight: -1,
      outline: 0.5,
      outlineColor: "#ABCDEF",
      background: "#123456",
      backgroundOpacity: 2,
      shadow: "yes",
    })!;
    expect(t.text).toHaveLength(500);
    expect(t).toMatchObject({
      font: "sans",
      weight: 800,
      size: 0.4,
      color: "#ffffff",
      align: "center",
      lineHeight: 0.8,
      outline: 0.25,
      outlineColor: "#abcdef",
      background: "#123456",
      backgroundOpacity: 1,
      shadow: false,
    });
    expect(readTitle({ size: 0.1 })).toBeNull();
    expect(readTitle("Hello")).toBeNull();
  });
  it("names titles by their first non-empty line", () => {
    expect(titleName({ ...DEFAULT_TITLE, text: "\n  Hello world \nmore" })).toBe("T · Hello world");
    expect(titleName({ ...DEFAULT_TITLE, text: "   " })).toBe("T · Empty title");
  });
});

describe("titleLayout", () => {
  it("scales with the frame height and grows with lines, box and outline", () => {
    const one = titleLayout({ ...DEFAULT_TITLE, shadow: false }, 1080);
    const half = titleLayout({ ...DEFAULT_TITLE, shadow: false }, 540);
    expect(one.fontPx).toBeCloseTo(108);
    expect(half.w).toBeCloseTo(one.w / 2);
    expect(half.h).toBeCloseTo(one.h / 2);
    const two = titleLayout({ ...DEFAULT_TITLE, shadow: false, text: "A\nB" }, 1080);
    expect(two.lines).toHaveLength(2);
    expect(two.h - one.h).toBeCloseTo(one.lineH);
    const boxed = titleLayout({ ...DEFAULT_TITLE, shadow: false, background: "#000000" }, 1080);
    expect(boxed.margin).toBeGreaterThan(one.margin);
    const outlined = titleLayout({ ...DEFAULT_TITLE, shadow: false, outline: 0.1 }, 1080);
    expect(outlined.margin - one.margin).toBeCloseTo(10.8);
  });
});

describe("title clips", () => {
  it("go on the highest free unlocked video track at the playhead", () => {
    let s = withVideo();
    s = addTitle(s, 30);
    expect(s.items[1]).toMatchObject({ track: "V3", start: 30, frames: 150, assetId: "" });
    s = addTitle(s, 60); // V3 busy → V2
    expect(s.items[2]!.track).toBe("V2");
    s.tracks = s.tracks.map((t) => (t.id === "V1" ? { ...t, locked: true } : t));
    s = addTitle(s, 90); // V3, V2 busy, V1 locked → V3 anyway (overlapping)
    expect(s.items[3]!.track).toBe("V3");
    expect(() => addTitle(s, 0, { track: "A1" })).toThrow(/video tracks/);
  });
  it("have a stand-in source with no file or audio, and survive media removal", () => {
    let s = addTitle(withVideo(), 0);
    const t = s.items[1]!;
    expect(assetOf(s, t)).toMatchObject({ kind: "title", hasAudio: false, name: "T · Your title" });
    s = removeAsset(s, "cam");
    expect(s.items.map((c) => c.title?.text)).toEqual(["Your title"]);
  });
  it("are placed by their laid-out text and draw above lower tracks", () => {
    const s = addTitle(withVideo(), 0, { x: 0.25, y: 0.8 });
    const t = s.items[1]!;
    const r = clipRect(s, t, 0, 1920, 1080);
    const L = titleLayout(t.title!, 1080);
    expect(r.w).toBeCloseTo(L.w);
    expect(r.x + r.w / 2).toBeCloseTo(480);
    expect(r.y + r.h / 2).toBeCloseTo(864);
    expect(visualItems(s, 0).at(-1)!.id).toBe(t.id);
  });
  it("edit through patchItem, cleaning values and refusing to become media", () => {
    let s = addTitle(withVideo(), 0);
    const id = s.items[1]!.id;
    s = patchItem(s, id, { title: { ...s.items[1]!.title!, size: 5, text: "New" } });
    expect(s.items[1]!.title).toMatchObject({ size: 0.4, text: "New" });
    s = patchItem(s, id, { frames: 900 }); // titles can be any length
    expect(s.items[1]!.frames).toBe(900);
    expect(() => patchItem(s, id, { track: "A1" })).toThrow();
    // A media clip can't be turned into a title.
    const media = patchItem(s, s.items[0]!.id, { title: DEFAULT_TITLE });
    expect(media.items[0]!.title).toBeUndefined();
  });
  it("split into two titles with the same text", () => {
    let s = addTitle(withVideo(), 0);
    s = splitItem(s, s.items[1]!.id, 60);
    expect(s.items.filter((c) => c.title?.text === "Your title")).toHaveLength(2);
  });
  it("save and load, and bad titles are rejected", () => {
    const s = addTitle(withVideo(), 0, { title: PRESETS[1]!.title });
    const raw = JSON.parse(JSON.stringify(s));
    expect(parseSequence(raw).items[1]!.title).toEqual(s.items[1]!.title);
    raw.items[1].title.size = 99; // clamped on load
    expect(parseSequence(raw).items[1]!.title!.size).toBe(0.4);
    raw.items[1].assetId = "cam"; // a title must not point at media
    expect(() => parseSequence(raw)).toThrow(/title/);
    raw.items[1].assetId = "";
    raw.items[1].title = { nope: true };
    expect(() => parseSequence(raw)).toThrow(/title/);
    raw.items[1].title = DEFAULT_TITLE;
    raw.items[1].track = "A2";
    expect(() => parseSequence(raw)).toThrow();
  });
});

describe("title animations", () => {
  const base = { ...DEFAULT_TITLE, text: "Hello big world" };
  const at = (t: typeof base, offset: number, frames = 150) => titleAnimAt(t, offset, frames, 30);
  it("enter over their duration and exit in reverse at the end", () => {
    const t = {
      ...base,
      animIn: { type: "fade" as const, duration: 1 },
      animOut: { type: "fade" as const, duration: 0.5 },
    };
    expect(at(t, 0).alpha).toBe(0);
    expect(at(t, 15).alpha).toBeCloseTo(1 - 0.5 ** 3); // ease-out, half way
    expect(at(t, 30).alpha).toBe(1);
    expect(at(t, 100).alpha).toBe(1);
    expect(at(t, 149).alpha).toBe(0); // last frame: gone
    expect(at(t, 149 - 15).alpha).toBe(1); // exit starts 0.5 s before the end
  });
  it("share a clip too short for both", () => {
    const t = {
      ...base,
      animIn: { type: "fade" as const, duration: 2 },
      animOut: { type: "fade" as const, duration: 2 },
    };
    // 30-frame clip: each gets 15 frames, meeting in the middle.
    expect(at(t, 0, 30).alpha).toBe(0);
    expect(at(t, 15, 30).alpha).toBeGreaterThan(0.99);
    expect(at(t, 7, 30).alpha).toBeLessThan(0.99);
    expect(at(t, 29, 30).alpha).toBe(0);
  });
  it("move, scale and reveal as described", () => {
    const run = (type: AnimType, offset: number) =>
      at({ ...base, animIn: { type, duration: 1 } }, offset);
    expect(run("rise", 0)).toMatchObject({ alpha: 0, dy: 0.6, dx: 0 });
    expect(run("slide", 0).dx).toBe(-1.5);
    expect(run("rise", 30)).toMatchObject({ alpha: 1, dy: 0 });
    expect(run("pop", 0).scale).toBeCloseTo(0.6);
    // Pop overshoots past 100 % before settling.
    expect(Math.max(...Array.from({ length: 30 }, (_, f) => run("pop", f).scale))).toBeGreaterThan(
      1,
    );
    expect(run("typewriter", 0).reveal).toEqual({ mode: "chars", progress: 0 });
    expect(run("typewriter", 15).reveal).toEqual({ mode: "chars", progress: 7 }); // 15 characters × ½, rounded down
    expect(run("typewriter", 30).reveal).toBeUndefined(); // settled: full text
    expect(run("words", 10).reveal).toEqual({ mode: "words", progress: 1 }); // 3 words × ⅓
    expect(charCount({ ...base, text: "ab\ncd" })).toBe(4);
    expect(wordCount({ ...base, text: "  one\ntwo  three " })).toBe(3);
  });
  it("an exit typewriter un-types from the end", () => {
    const t = { ...base, animOut: { type: "typewriter" as const, duration: 1 } };
    expect(at(t, 149).reveal).toEqual({ mode: "chars", progress: 0 });
    expect(at(t, 149 - 15).reveal).toEqual({ mode: "chars", progress: 7 });
  });
  it("are validated and clamped when read", () => {
    const t = readTitle({
      ...base,
      animIn: { type: "words", duration: 99 },
      animOut: { type: "spin", duration: 1 },
    })!;
    expect(t.animIn).toEqual({ type: "words", duration: 5 });
    expect(t.animOut).toBeUndefined();
    expect(readTitle({ ...base, animIn: { type: "fade" } })!.animIn).toEqual({
      type: "fade",
      duration: 0.5,
    });
  });
  it("a split keeps the entrance on the first half and the exit on the second", () => {
    let s = addTitle(withVideo(), 0, {
      title: { animIn: { type: "rise", duration: 0.5 }, animOut: { type: "fade", duration: 0.5 } },
    });
    s = splitItem(s, s.items[1]!.id, 60);
    const [head, tail] = s.items.slice(1);
    expect(head!.title!.animIn?.type).toBe("rise");
    expect(head!.title!.animOut).toBeUndefined();
    expect(tail!.title!.animIn).toBeUndefined();
    expect(tail!.title!.animOut?.type).toBe("fade");
  });
  it("presets bring their animations; old titles without them still load", () => {
    expect(PRESETS.every((p) => p.title.animIn)).toBe(true);
    const s = addTitle(withVideo(), 0);
    const raw = JSON.parse(JSON.stringify(s));
    expect(parseSequence(raw).items[1]!.title!.animIn).toBeUndefined();
  });
});
