// Color "looks" imported from grading apps: 3D/1D LUTs (.cube, .3dl) and ASC CDL (.cdl/.cc/.ccc).
// DaVinci Resolve (right-click a clip → Generate LUT) and Premiere Pro (Lumetri → Export .cube)
// both export .cube; Resolve also exports CDL. Pure parsing + a CPU reference transform that the
// GPU shader is tested against.

export type Rgb = [number, number, number];

export interface Lut3D {
  kind: "lut3d";
  size: number; // N (N×N×N grid)
  /** RGB triples, red index fastest: ((b*N + g)*N + r)*3. */
  data: Float32Array;
  domainMin: Rgb;
  domainMax: Rgb;
}
export interface Lut1D {
  kind: "lut1d";
  size: number;
  /** RGB triples per entry. */
  data: Float32Array;
  domainMin: Rgb;
  domainMax: Rgb;
}
export interface Cdl {
  kind: "cdl";
  slope: Rgb;
  offset: Rgb;
  power: Rgb;
  saturation: number;
}
export type LookTransform = Lut3D | Lut1D | Cdl;

export interface Look {
  id: string;
  name: string;
  /** Original file name, for display. */
  file: string;
  transform: LookTransform;
  addedAt: number;
}

export const MAX_3D = 65;
export const MAX_1D = 65536;

const nums = (line: string) => line.trim().split(/\s+/).map(Number);
const finite = (v: number[]) => v.every(Number.isFinite);

/** Parse an Adobe/Resolve .cube file (1D or 3D). Throws with a readable message on bad input. */
export function parseCube(text: string): { transform: Lut3D | Lut1D; title?: string | undefined } {
  let size3 = 0;
  let size1 = 0;
  let title: string | undefined;
  let domainMin: Rgb = [0, 0, 0];
  let domainMax: Rgb = [1, 1, 1];
  const values: number[] = [];
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const key = line.split(/\s+/)[0]!.toUpperCase();
    if (key === "TITLE") title = line.slice(5).trim().replace(/^"|"$/g, "") || undefined;
    else if (key === "LUT_3D_SIZE") size3 = Number(line.split(/\s+/)[1]);
    else if (key === "LUT_1D_SIZE") size1 = Number(line.split(/\s+/)[1]);
    else if (key === "DOMAIN_MIN" || key === "DOMAIN_MAX") {
      const v = nums(line.slice(key.length));
      if (v.length !== 3 || !finite(v)) throw new Error(`Invalid ${key} line.`);
      if (key === "DOMAIN_MIN") domainMin = v as Rgb;
      else domainMax = v as Rgb;
    } else if (key === "LUT_1D_INPUT_RANGE" || key === "LUT_3D_INPUT_RANGE") {
      const [lo, hi] = nums(line.slice(key.length));
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) throw new Error(`Invalid ${key} line.`);
      domainMin = [lo!, lo!, lo!];
      domainMax = [hi!, hi!, hi!];
    } else if (/^[-+.\d]/.test(line)) {
      const v = nums(line);
      if (v.length !== 3 || !finite(v))
        throw new Error("A LUT data line doesn't have three numbers.");
      values.push(...v);
    }
    // Unknown keywords (e.g. LUT_IN_VIDEO_RANGE) are ignored, as other apps do.
  }
  if (size3 && size1)
    throw new Error("This .cube declares both a 1D and a 3D LUT; only one is supported.");
  if (!size3 && !size1) throw new Error("Not a .cube LUT: missing LUT_3D_SIZE or LUT_1D_SIZE.");
  if (domainMax.some((m, i) => !(m > domainMin[i]!)))
    throw new Error("DOMAIN_MAX must be greater than DOMAIN_MIN.");
  if (size3) {
    if (!Number.isInteger(size3) || size3 < 2 || size3 > MAX_3D)
      throw new Error(`3D LUT size ${size3} isn't supported (2–${MAX_3D}).`);
    if (values.length !== size3 ** 3 * 3)
      throw new Error(
        `Expected ${size3 ** 3} entries for a ${size3}³ LUT, found ${values.length / 3}.`,
      );
    return {
      transform: {
        kind: "lut3d",
        size: size3,
        data: Float32Array.from(values),
        domainMin,
        domainMax,
      },
      title,
    };
  }
  if (!Number.isInteger(size1) || size1 < 2 || size1 > MAX_1D)
    throw new Error(`1D LUT size ${size1} isn't supported (2–${MAX_1D}).`);
  if (values.length !== size1 * 3)
    throw new Error(`Expected ${size1} entries for a 1D LUT, found ${values.length / 3}.`);
  return {
    transform: {
      kind: "lut1d",
      size: size1,
      data: Float32Array.from(values),
      domainMin,
      domainMax,
    },
    title,
  };
}

/**
 * Parse an Autodesk/Lustre .3dl 3D LUT. The optional first numeric line lists the input mesh
 * (its length is the grid size); entries are integers with blue varying fastest. Output bit
 * depth is inferred from the largest value (10/12/14/16-bit).
 */
export function parse3dl(text: string): { transform: Lut3D } {
  const rows: number[][] = [];
  for (const raw of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line || /^[a-z]/i.test(line)) continue; // keywords such as "3DMESH" / "Mesh"
    const v = nums(line);
    if (!finite(v)) throw new Error("A .3dl line contains something that isn't a number.");
    rows.push(v);
  }
  // The optional mesh line lists the input grid: it starts at 0, strictly increases, and the
  // remaining rows form a cube of exactly its length. (A 3-point mesh looks like an entry, so
  // it's identified by structure, not by length.)
  let mesh: number[] | null = null;
  const first = rows[0];
  if (
    first &&
    first[0] === 0 &&
    first.every((v, i) => i === 0 || v > first[i - 1]!) &&
    (first.length !== 3 || rows.length - 1 === 27) &&
    rows.length - 1 === first.length ** 3
  )
    mesh = rows.shift()!;
  const entries = rows.filter((r) => r.length === 3);
  if (entries.length !== rows.length) throw new Error("Each .3dl entry needs three numbers.");
  const size = mesh ? mesh.length : Math.round(Math.cbrt(entries.length));
  if (size < 2 || size > MAX_3D || size ** 3 !== entries.length)
    throw new Error(
      `A .3dl with ${entries.length} entries isn't a supported cube (2³–${MAX_3D}³).`,
    );
  const max = Math.max(...entries.flat());
  const bits = [10, 12, 14, 16].find((b) => max <= 2 ** b - 1) ?? 16;
  const scale = 2 ** bits - 1;
  const data = new Float32Array(size ** 3 * 3);
  // File order: r slowest, g, b fastest. Store red-fastest like .cube.
  let k = 0;
  for (let r = 0; r < size; r++)
    for (let g = 0; g < size; g++)
      for (let b = 0; b < size; b++) {
        const e = entries[k++]!;
        const o = ((b * size + g) * size + r) * 3;
        data[o] = e[0]! / scale;
        data[o + 1] = e[1]! / scale;
        data[o + 2] = e[2]! / scale;
      }
  return { transform: { kind: "lut3d", size, data, domainMin: [0, 0, 0], domainMax: [1, 1, 1] } };
}

/** Parse an ASC CDL (.cdl / .cc / .ccc). Uses the first ColorCorrection found. */
export function parseCdl(text: string): { transform: Cdl; title?: string | undefined } {
  const tag = (name: string) =>
    text.match(new RegExp(`<${name}>([^<]*)</${name}>`, "i"))?.[1]?.trim();
  const triple = (name: string, fallback: Rgb): Rgb => {
    const s = tag(name);
    if (s === undefined) return fallback;
    const v = nums(s);
    if (v.length !== 3 || !finite(v)) throw new Error(`Invalid <${name}> in CDL.`);
    return v as Rgb;
  };
  if (!/<(SOPNode|SatNode|Slope|Offset|Power|Saturation)\b/i.test(text))
    throw new Error("Not an ASC CDL: no SOPNode or SatNode found.");
  const slope = triple("Slope", [1, 1, 1]);
  const offset = triple("Offset", [0, 0, 0]);
  const power = triple("Power", [1, 1, 1]);
  const satText = tag("Saturation");
  const saturation = satText === undefined ? 1 : Number(satText);
  if (!Number.isFinite(saturation) || saturation < 0)
    throw new Error("Invalid <Saturation> in CDL.");
  if (power.some((p) => p <= 0)) throw new Error("CDL power values must be positive.");
  const title = text.match(/<ColorCorrection[^>]*\bid="([^"]+)"/i)?.[1] ?? tag("Description");
  return { transform: { kind: "cdl", slope, offset, power, saturation }, title };
}

/** Pick a parser from the file name. */
export function parseLookFile(
  fileName: string,
  text: string,
): { transform: LookTransform; title?: string | undefined } {
  const ext = fileName.toLowerCase().split(".").pop();
  if (ext === "cube") return parseCube(text);
  if (ext === "3dl") return parse3dl(text);
  if (ext === "cdl" || ext === "cc" || ext === "ccc") return parseCdl(text);
  throw new Error("Unsupported look file. Use .cube, .3dl, .cdl, .cc or .ccc.");
}

export const LOOK_ACCEPT = ".cube,.3dl,.cdl,.cc,.ccc";

// ---------- CPU reference transform (tests + fallback) ----------
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const toUnit = (v: number, i: number, lo: Rgb, hi: Rgb) =>
  clamp01((v - lo[i]!) / (hi[i]! - lo[i]!));

function sample3D(l: Lut3D, rgb: Rgb): Rgb {
  const N = l.size;
  const p = rgb.map((v, i) => toUnit(v, i, l.domainMin, l.domainMax) * (N - 1));
  const i0 = p.map((v) => Math.min(N - 2, Math.floor(v)));
  const f = p.map((v, i) => v - i0[i]!);
  const at = (r: number, g: number, b: number, c: number) => l.data[((b * N + g) * N + r) * 3 + c]!;
  const out: Rgb = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    let acc = 0;
    for (let dr = 0; dr < 2; dr++)
      for (let dg = 0; dg < 2; dg++)
        for (let db = 0; db < 2; db++) {
          const w = (dr ? f[0]! : 1 - f[0]!) * (dg ? f[1]! : 1 - f[1]!) * (db ? f[2]! : 1 - f[2]!);
          acc += w * at(i0[0]! + dr, i0[1]! + dg, i0[2]! + db, c);
        }
    out[c] = acc;
  }
  return out;
}

function sample1D(l: Lut1D, rgb: Rgb): Rgb {
  const N = l.size;
  return rgb.map((v, c) => {
    const p = toUnit(v, c, l.domainMin, l.domainMax) * (N - 1);
    const i = Math.min(N - 2, Math.floor(p));
    const f = p - i;
    return l.data[i * 3 + c]! * (1 - f) + l.data[(i + 1) * 3 + c]! * f;
  }) as Rgb;
}

export const REC709_LUMA: Rgb = [0.2126, 0.7152, 0.0722];

function applyCdl(c: Cdl, rgb: Rgb): Rgb {
  const sop = rgb.map((v, i) =>
    Math.pow(clamp01(v * c.slope[i]! + c.offset[i]!), c.power[i]!),
  ) as Rgb;
  const l = sop[0] * REC709_LUMA[0] + sop[1] * REC709_LUMA[1] + sop[2] * REC709_LUMA[2];
  return sop.map((v) => l + c.saturation * (v - l)) as Rgb;
}

/** Apply a look to one display-referred RGB value (0..1), mixed with the original by `intensity`. */
export function applyLook(t: LookTransform, rgb: Rgb, intensity = 1): Rgb {
  const graded =
    t.kind === "lut3d"
      ? sample3D(t, rgb)
      : t.kind === "lut1d"
        ? sample1D(t, rgb)
        : applyCdl(t, rgb);
  return graded.map((v, i) => clamp01(rgb[i]! + (v - rgb[i]!) * intensity)) as Rgb;
}

/** An identity 3D LUT of size N (useful for tests and as a neutral starting point). */
export function identity3D(N: number): Lut3D {
  const data = new Float32Array(N ** 3 * 3);
  for (let b = 0; b < N; b++)
    for (let g = 0; g < N; g++)
      for (let r = 0; r < N; r++) {
        const o = ((b * N + g) * N + r) * 3;
        data[o] = r / (N - 1);
        data[o + 1] = g / (N - 1);
        data[o + 2] = b / (N - 1);
      }
  return { kind: "lut3d", size: N, data, domainMin: [0, 0, 0], domainMax: [1, 1, 1] };
}
