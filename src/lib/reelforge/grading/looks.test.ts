import { describe, expect, it } from "vitest";
import {
  applyLook,
  identity3D,
  parse3dl,
  parseCdl,
  parseCube,
  parseLookFile,
  type Rgb,
} from "./looks";

const close = (a: Rgb, b: Rgb, eps = 1e-4) =>
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, -Math.log10(eps)));

/** A 2³ .cube that swaps red and blue. */
const SWAP_RB = `# comment
TITLE "Swap R/B"
LUT_3D_SIZE 2
0 0 0
0 0 1
0 1 0
0 1 1
1 0 0
1 0 1
1 1 0
1 1 1
`;

describe("parseCube", () => {
  it("reads a 3D LUT with title, comments and red-fastest order", () => {
    const { transform, title } = parseCube(SWAP_RB);
    expect(title).toBe("Swap R/B");
    expect(transform).toMatchObject({ kind: "lut3d", size: 2 });
    close(applyLook(transform, [1, 0, 0]), [0, 0, 1]);
    close(applyLook(transform, [0.2, 0.5, 0.9]), [0.9, 0.5, 0.2]);
  });

  it("reads a 1D LUT and its input range", () => {
    const { transform } = parseCube("LUT_1D_SIZE 2\nLUT_1D_INPUT_RANGE 0 2\n0 0 0\n1 0.5 0.25\n");
    expect(transform.kind).toBe("lut1d");
    // input 1 is halfway through the 0..2 domain
    close(applyLook(transform, [1, 1, 1]), [0.5, 0.25, 0.125]);
  });

  it("honours DOMAIN_MIN/MAX", () => {
    const { transform } = parseCube(
      `DOMAIN_MIN 0 0 0\nDOMAIN_MAX 0.5 0.5 0.5\n${SWAP_RB.split("\n").slice(3).join("\n")}LUT_3D_SIZE 2\n`,
    );
    close(applyLook(transform, [0.25, 0, 0]), [0, 0, 0.5]);
  });

  it("accepts files saved with a byte-order mark and Windows line endings", () => {
    const { transform } = parseCube("\uFEFF" + SWAP_RB.replace(/\n/g, "\r\n"));
    expect(transform).toMatchObject({ kind: "lut3d", size: 2 });
  });

  it("explains malformed files", () => {
    expect(() => parseCube("0 0 0\n")).toThrow(/missing LUT_3D_SIZE/);
    expect(() => parseCube("LUT_3D_SIZE 2\n0 0 0\n")).toThrow(/Expected 8 entries/);
    expect(() => parseCube("LUT_3D_SIZE 99\n")).toThrow(/isn't supported/);
    expect(() => parseCube("LUT_3D_SIZE 2\n0 0\n")).toThrow(/three numbers/);
  });
});

describe("parse3dl", () => {
  it("reads blue-fastest integer entries and infers 12-bit output", () => {
    // Entries listed r slowest, b fastest; this table swaps red and blue.
    const rows: string[] = ["0 1023"];
    for (const r of [0, 1])
      for (const g of [0, 1])
        for (const b of [0, 1]) rows.push(`${b * 4095} ${g * 4095} ${r * 4095}`);
    const { transform } = parse3dl(rows.join("\n"));
    expect(transform.size).toBe(2);
    close(applyLook(transform, [1, 0, 0]), [0, 0, 1]);
    close(applyLook(transform, [0, 1, 0]), [0, 1, 0]);
  });

  it("infers the size without a mesh line and rejects partial cubes", () => {
    const rows: string[] = [];
    for (let i = 0; i < 8; i++) rows.push("0 0 0");
    expect(parse3dl(rows.join("\n")).transform.size).toBe(2);
    expect(() => parse3dl(rows.slice(1).join("\n"))).toThrow(/isn't a supported cube/);
  });
});

describe("parseCdl", () => {
  const xml = `<ColorDecisionList><ColorDecision><ColorCorrection id="warm_look">
    <SOPNode><Slope>1.2 1.0 0.8</Slope><Offset>0.02 0 -0.02</Offset><Power>1 1 1.1</Power></SOPNode>
    <SatNode><Saturation>0.9</Saturation></SatNode></ColorCorrection></ColorDecision></ColorDecisionList>`;

  it("reads slope/offset/power/saturation and the correction id", () => {
    const { transform, title } = parseCdl(xml);
    expect(title).toBe("warm_look");
    expect(transform).toEqual({
      kind: "cdl",
      slope: [1.2, 1, 0.8],
      offset: [0.02, 0, -0.02],
      power: [1, 1, 1.1],
      saturation: 0.9,
    });
  });

  it("applies the ASC CDL formula", () => {
    const { transform } = parseCdl(xml);
    const out = applyLook(transform, [0.5, 0.5, 0.5]);
    const sop: Rgb = [0.62, 0.5, Math.pow(0.38, 1.1)];
    const l = 0.2126 * sop[0] + 0.7152 * sop[1] + 0.0722 * sop[2];
    close(out, sop.map((v) => l + 0.9 * (v - l)) as Rgb);
  });

  it("defaults missing nodes and rejects non-CDL", () => {
    expect(
      parseCdl("<ColorCorrection><SatNode><Saturation>0</Saturation></SatNode></ColorCorrection>")
        .transform,
    ).toMatchObject({
      slope: [1, 1, 1],
      saturation: 0,
    });
    expect(() => parseCdl("<xml/>")).toThrow(/Not an ASC CDL/);
  });
});

describe("applyLook", () => {
  it("is neutral for an identity LUT and blends by intensity", () => {
    const id = identity3D(17);
    close(applyLook(id, [0.3, 0.6, 0.9]), [0.3, 0.6, 0.9], 1e-5);
    const { transform } = parseCube(SWAP_RB);
    close(applyLook(transform, [1, 0, 0], 0.25), [0.75, 0, 0.25]);
    close(applyLook(transform, [1, 0, 0], 0), [1, 0, 0]);
  });

  it("chooses a parser by extension", () => {
    expect(parseLookFile("Film.CUBE", SWAP_RB).transform.kind).toBe("lut3d");
    expect(() => parseLookFile("look.drx", "")).toThrow(/Use \.cube/);
  });
});
