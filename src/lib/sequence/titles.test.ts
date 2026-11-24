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
import { DEFAULT_TITLE, PRESETS, readTitle, titleLayout, titleName } from "./titles";

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
