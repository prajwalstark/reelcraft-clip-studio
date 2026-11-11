import { describe, expect, it } from "vitest";
import { SKIN_LINE_DEG, TARGETS, analyzeFrame, cbcr } from "./scopes";

/** Build an RGBA frame from rows of [r, g, b] pixels. */
function frame(rows: [number, number, number][][]) {
  const h = rows.length;
  const w = rows[0]!.length;
  const data = new Uint8ClampedArray(w * h * 4);
  rows.forEach((row, y) =>
    row.forEach(([r, g, b], x) => {
      const i = (y * w + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }),
  );
  return { data, w, h };
}
const angle = ([cb, cr]: [number, number]) => ((Math.atan2(cr, cb) * 180) / Math.PI + 360) % 360;

describe("Rec.709 colour difference", () => {
  it("places the colour-bar targets correctly around the circle", () => {
    const deg = Object.fromEntries(TARGETS.map((t) => [t.label, angle(cbcr(...t.rgb))]));
    // how far two angles are from being exactly opposite (0 = opposite)
    const apart = (a: number, b: number) => Math.abs(((((a - b) % 360) + 360) % 360) - 180);
    // complementary colours sit exactly opposite each other
    expect(apart(deg["R"]!, deg["Cy"]!)).toBeCloseTo(0, 6);
    expect(apart(deg["G"]!, deg["Mg"]!)).toBeCloseTo(0, 6);
    expect(apart(deg["B"]!, deg["Yl"]!)).toBeCloseTo(0, 6);
    // red is up and slightly left (Cr > 0, Cb < 0), yellow left, blue right
    expect(deg["R"]!).toBeGreaterThan(95);
    expect(deg["R"]!).toBeLessThan(110);
    expect(deg["Yl"]!).toBeGreaterThan(165);
    expect(deg["Yl"]!).toBeLessThan(185);
    expect(Math.min(deg["B"]!, 360 - deg["B"]!)).toBeLessThan(10);
    // going clockwise from red: magenta, blue, cyan, green, yellow
    const order = ["R", "Mg", "B", "Cy", "G", "Yl"].map((k) => deg[k]!);
    for (let i = 1; i < order.length; i++) {
      const step = (order[i - 1]! - order[i]! + 360) % 360;
      expect(step).toBeGreaterThan(20);
      expect(step).toBeLessThan(100);
    }
    // greys have no chroma
    expect(cbcr(0.5, 0.5, 0.5)[0]).toBeCloseTo(0);
    expect(cbcr(0.5, 0.5, 0.5)[1]).toBeCloseTo(0);
  });
  it("puts a typical skin tone close to the skin-tone line", () => {
    const skin = angle(cbcr(0.87, 0.67, 0.55)); // a warm, light skin tone
    expect(Math.abs(skin - SKIN_LINE_DEG)).toBeLessThan(12);
  });
});

describe("analyzeFrame", () => {
  const black: [number, number, number] = [0, 0, 0];
  const white: [number, number, number] = [255, 255, 255];
  const red: [number, number, number] = [255, 0, 0];

  it("histograms each channel and luma, and reports crushed / clipped shares", () => {
    const { data, w, h } = frame([[black, white, red, white]]);
    const s = analyzeFrame(data, w, h);
    expect(s.pixels).toBe(4);
    expect(s.hist[0][255]).toBe(3); // red channel: two whites + red
    expect(s.hist[1][0]).toBe(2); // green 0: black + red
    expect(s.hist[3][255]).toBe(2); // luma of the whites
    expect(s.hist[3][Math.round(0.2126 * 255)]).toBe(1); // luma of pure red = 54
    expect(s.crushed).toBeCloseTo(0.25);
    expect(s.clipped).toBeCloseTo(0.5);
  });

  it("plots the waveform per column: dark left, bright right", () => {
    const { data, w, h } = frame([
      [black, white],
      [black, white],
    ]);
    const s = analyzeFrame(data, w, h, 128);
    expect(s.luma[0 * w + 0]).toBe(2); // column 0 at level 0
    expect(s.luma[127 * w + 1]).toBe(2); // column 1 at the top level
    expect(s.luma.reduce((a, b) => a + b, 0)).toBe(4);
  });

  it("separates channels in the RGB parade", () => {
    const { data, w, h } = frame([[red]]);
    const s = analyzeFrame(data, w, h, 128);
    expect(s.parade[0][127]).toBe(1); // red at the top
    expect(s.parade[1][0]).toBe(1); // green at the bottom
    expect(s.parade[2][0]).toBe(1); // blue at the bottom
  });

  it("places greys at the vectorscope centre and red up-left of it", () => {
    const { data, w, h } = frame([[[128, 128, 128], red]]);
    const s = analyzeFrame(data, w, h, 128, 64);
    const cells = [...s.vector.keys()].filter((k) => s.vector[k]);
    const pos = cells.map((k) => [k % 64, Math.floor(k / 64)]);
    const centre = pos.find(([x, y]) => Math.abs(x! - 32) <= 1 && Math.abs(y! - 32) <= 1);
    expect(centre).toBeTruthy();
    const other = pos.find((p) => p !== centre)!;
    expect(other[0]).toBeLessThan(32); // Cb < 0 → left
    expect(other[1]).toBeLessThan(10); // Cr ≈ +0.5 → near the top
  });

  it("ignores fully transparent pixels", () => {
    const { data, w, h } = frame([[white, white]]);
    data[7] = 0;
    expect(analyzeFrame(data, w, h).pixels).toBe(1);
  });
});
