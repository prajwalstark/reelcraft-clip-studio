import { describe, expect, it } from "vitest";
import type { Rgb } from "./looks";
import {
  NEUTRAL_GRADE,
  applyColorGrade,
  bakeCurves,
  evalCurve,
  gradeActive,
  hsvToRgb,
  primaryParams,
  readColorGrade,
  rgbToHsv,
  wheelChroma,
  type ColorGrade,
} from "./primaries";

const grade = (p: Partial<ColorGrade>) => ({ ...NEUTRAL_GRADE, ...p });
const run = (g: ColorGrade, rgb: Rgb) =>
  applyColorGrade(rgb, primaryParams(g), bakeCurves(g.curves));
const close = (a: Rgb, b: Rgb, digits = 4) =>
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, digits));
const luma = (c: Rgb) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

describe("neutral grade", () => {
  it("leaves every colour unchanged, including through baked curves", () => {
    for (const c of [
      [0, 0, 0],
      [1, 1, 1],
      [0.2, 0.5, 0.8],
      [0.9, 0.1, 0.3],
    ] as Rgb[])
      close(run(NEUTRAL_GRADE, c), c, 3);
    expect(gradeActive(NEUTRAL_GRADE)).toBe(false);
  });
});

describe("colour wheels", () => {
  it("maps the puck angle to a hue and stays luminance-neutral in average", () => {
    const red = wheelChroma({ x: 1, y: 0, master: 0 });
    expect(red[0]).toBeCloseTo(1);
    expect(red[1]).toBeCloseTo(-0.5);
    expect(red[2]).toBeCloseTo(-0.5);
    const blue = wheelChroma({
      x: Math.cos((4 * Math.PI) / 3),
      y: Math.sin((4 * Math.PI) / 3),
      master: 0,
    });
    expect(blue[2]).toBeCloseTo(1);
    expect(red.reduce((a, b) => a + b, 0)).toBeCloseTo(0);
  });

  it("lift moves shadows most, gain moves highlights most, gamma moves midtones", () => {
    const up = { x: 0, y: 0, master: 0.5 };
    const lift = grade({ lift: up });
    expect(run(lift, [0, 0, 0])[0]).toBeGreaterThan(0.1);
    expect(run(lift, [1, 1, 1])[0]).toBeCloseTo(1);
    const gain = grade({ gain: { ...up, master: -0.5 } });
    expect(run(gain, [0, 0, 0])[0]).toBeCloseTo(0);
    expect(run(gain, [1, 1, 1])[0]).toBeLessThan(0.75);
    const gamma = grade({ gamma: up });
    expect(run(gamma, [0, 0, 0])[0]).toBeCloseTo(0);
    expect(run(gamma, [1, 1, 1])[0]).toBeCloseTo(1);
    expect(run(gamma, [0.5, 0.5, 0.5])[0]).toBeGreaterThan(0.55);
  });

  it("offset shifts everything; a red puck warms the image", () => {
    const o = run(grade({ offset: { x: 0, y: 0, master: 0.5 } }), [0.3, 0.3, 0.3]);
    expect(o[0]).toBeCloseTo(0.4);
    const warm = run(grade({ gain: { x: 1, y: 0, master: 0 } }), [0.5, 0.5, 0.5]);
    expect(warm[0]).toBeGreaterThan(0.5);
    expect(warm[2]).toBeLessThan(0.5);
  });
});

describe("temperature, tint, contrast, saturation", () => {
  it("warm raises red and lowers blue; tint to magenta lowers green", () => {
    const w = run(grade({ temperature: 1 }), [0.5, 0.5, 0.5]);
    expect(w[0]).toBeGreaterThan(0.5);
    expect(w[2]).toBeLessThan(0.5);
    expect(run(grade({ tint: 1 }), [0.5, 0.5, 0.5])[1]).toBeLessThan(0.5);
  });
  it("contrast pivots around the pivot point", () => {
    const g = grade({ contrast: 1.5, pivot: 0.4 });
    close(run(g, [0.4, 0.4, 0.4]), [0.4, 0.4, 0.4]);
    expect(run(g, [0.6, 0.6, 0.6])[0]).toBeCloseTo(0.7);
    expect(run(g, [0.2, 0.2, 0.2])[0]).toBeCloseTo(0.1);
  });
  it("saturation 0 gives grey at the Rec.709 luma", () => {
    const c: Rgb = [0.8, 0.3, 0.1];
    const out = run(grade({ saturation: 0 }), c);
    out.forEach((v) => expect(v).toBeCloseTo(luma(c), 3));
  });
});

describe("curves", () => {
  it("monotone interpolation passes through points without overshoot", () => {
    const pts: [number, number][] = [
      [0, 0],
      [0.25, 0.1],
      [0.5, 0.9],
      [1, 1],
    ];
    expect(evalCurve(pts, 0.25)).toBeCloseTo(0.1);
    expect(evalCurve(pts, 0.5)).toBeCloseTo(0.9);
    for (let x = 0; x <= 1; x += 0.01) {
      const y = evalCurve(pts, x);
      expect(y).toBeGreaterThanOrEqual(-1e-9);
      expect(y).toBeLessThanOrEqual(1 + 1e-9);
    }
    let prev = -1;
    for (let x = 0; x <= 1; x += 0.01) {
      const y = evalCurve(pts, x);
      expect(y).toBeGreaterThanOrEqual(prev - 1e-9); // monotone data → monotone curve
      prev = y;
    }
  });
  it("hue curves wrap smoothly between hue 1 and 0", () => {
    const pts: [number, number][] = [
      [0.1, 0.8],
      [0.9, 0.6],
    ];
    expect(evalCurve(pts, 0.999, true)).toBeCloseTo(evalCurve(pts, 0.001, true), 2);
  });
  it("a red-channel curve changes red only; Y curve changes all channels", () => {
    const lift: [number, number][] = [
      [0, 0.2],
      [1, 1],
    ];
    const r = run(grade({ curves: { r: lift } }), [0, 0, 0]);
    expect(r[0]).toBeCloseTo(0.2, 2);
    expect(r[1]).toBeCloseTo(0);
    const y = run(grade({ curves: { y: lift } }), [0, 0, 0]);
    y.forEach((v) => expect(v).toBeCloseTo(0.2, 2));
  });
  it("Hue vs Sat can desaturate one hue and leave others alone", () => {
    // kill saturation around red (hue 0/1), keep it elsewhere
    const g = grade({
      curves: {
        hueSat: [
          [0, 0],
          [0.15, 0.5],
          [0.85, 0.5],
        ],
      },
    });
    const red = run(g, [0.9, 0.1, 0.1]);
    expect(Math.max(...red) - Math.min(...red)).toBeLessThan(0.05);
    close(run(g, [0.1, 0.1, 0.9]), [0.1, 0.1, 0.9], 2);
  });
  it("Hue vs Hue rotates the chosen hue", () => {
    const g = grade({
      curves: {
        hueHue: [
          [0, 0.5 + 1 / 3],
          [0.1, 0.5],
          [0.9, 0.5],
        ],
      },
    });
    const out = run(g, [0.9, 0.1, 0.1]); // red pushed a third of a turn → green
    expect(out[1]).toBeGreaterThan(out[0]);
  });
});

describe("helpers and validation", () => {
  it("round-trips HSV", () => {
    close(hsvToRgb(rgbToHsv([0.2, 0.6, 0.9])), [0.2, 0.6, 0.9]);
  });
  it("normalises untrusted grade data and treats neutral as none", () => {
    expect(readColorGrade(null)).toBeNull();
    expect(readColorGrade({})).toBeNull();
    const g = readColorGrade({
      lift: { x: 3, y: 4, master: 9 },
      contrast: 5,
      curves: {
        r: [[0, 0]],
        y: [
          [0, 0.1],
          [1, 1],
        ],
      },
    });
    expect(g!.lift.x).toBeCloseTo(0.6);
    expect(g!.lift.y).toBeCloseTo(0.8);
    expect(g!.lift.master).toBe(1);
    expect(g!.contrast).toBe(2);
    expect(g!.curves.r).toBeUndefined(); // too few points
    expect(g!.curves.y).toEqual([
      [0, 0.1],
      [1, 1],
    ]);
  });
});
