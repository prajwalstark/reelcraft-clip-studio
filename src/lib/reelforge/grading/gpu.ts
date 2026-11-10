// GPU application of looks (3D/1D LUTs, CDL) for the Shorts compositor — same pass for preview
// and export. Uses WebGL2 (3D textures, half-float LUT storage with hardware trilinear
// filtering). The CPU reference in looks.ts is what the shader is tested against.
import type { Look, LookTransform } from "./looks";

const VERTEX = `#version 300 es
in vec2 position; out vec2 uv;
void main() { uv = position * 0.5 + 0.5; gl_Position = vec4(position, 0.0, 1.0); }`;

const FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 uv; out vec4 color;
uniform sampler2D image;
uniform sampler3D lut3;
uniform sampler2D lut1;
uniform int mode;          // 1 = 3D LUT, 2 = 1D LUT, 3 = CDL
uniform vec3 dmin; uniform vec3 dmax; uniform float size; uniform float intensity;
uniform vec3 slope; uniform vec3 offs; uniform vec3 power; uniform float sat;
float tap(float u) { return (u * (size - 1.0) + 0.5) / size; }
void main() {
  vec4 s = texture(image, uv);
  vec3 c = s.rgb;
  vec3 u = clamp((c - dmin) / (dmax - dmin), 0.0, 1.0);
  vec3 g;
  if (mode == 1) {
    g = texture(lut3, vec3(tap(u.r), tap(u.g), tap(u.b))).rgb;
  } else if (mode == 2) {
    g = vec3(texture(lut1, vec2(tap(u.r), 0.5)).r, texture(lut1, vec2(tap(u.g), 0.5)).g, texture(lut1, vec2(tap(u.b), 0.5)).b);
  } else {
    vec3 sop = pow(clamp(c * slope + offs, 0.0, 1.0), power);
    float l = dot(sop, vec3(0.2126, 0.7152, 0.0722));
    g = l + sat * (sop - l);
  }
  color = vec4(clamp(mix(c, g, intensity), 0.0, 1.0), s.a);
}`;

/** A 1D LUT longer than this is resampled before upload (texture width limits). */
const MAX_1D_TEXELS = 4096;

function rgbaFrom(data: Float32Array, entries: number) {
  const out = new Float32Array(entries * 4);
  for (let i = 0; i < entries; i++) {
    out[i * 4] = data[i * 3]!;
    out[i * 4 + 1] = data[i * 3 + 1]!;
    out[i * 4 + 2] = data[i * 3 + 2]!;
    out[i * 4 + 3] = 1;
  }
  return out;
}

function resample1D(data: Float32Array, size: number, target: number) {
  const out = new Float32Array(target * 3);
  for (let i = 0; i < target; i++) {
    const p = (i / (target - 1)) * (size - 1);
    const a = Math.min(size - 2, Math.floor(p));
    const f = p - a;
    for (let c = 0; c < 3; c++)
      out[i * 3 + c] = data[a * 3 + c]! * (1 - f) + data[(a + 1) * 3 + c]! * f;
  }
  return out;
}

export class LookRenderer {
  readonly canvas = document.createElement("canvas");
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private image: WebGLTexture;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private textures = new Map<string, { tex: WebGLTexture; target: number; size: number }>();

  constructor() {
    const gl = this.canvas.getContext("webgl2", {
      alpha: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
      antialias: false,
    });
    if (!gl) throw new Error("Looks need WebGL2, which isn't available in this browser.");
    this.gl = gl;
    const compile = (type: number, code: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, code);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS))
        throw new Error(`Look shader failed: ${gl.getShaderInfoLog(sh)}`);
      return sh;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error("Look shader failed to link.");
    gl.useProgram(program);
    this.program = program;
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const pos = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
    for (const n of [
      "image",
      "lut3",
      "lut1",
      "mode",
      "dmin",
      "dmax",
      "size",
      "intensity",
      "slope",
      "offs",
      "power",
      "sat",
    ])
      this.u[n] = gl.getUniformLocation(program, n);
    gl.uniform1i(this.u["image"]!, 0);
    gl.uniform1i(this.u["lut3"]!, 1);
    gl.uniform1i(this.u["lut1"]!, 2);
    this.image = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.image);
    for (const [k, v] of [
      [gl.TEXTURE_MIN_FILTER, gl.NEAREST],
      [gl.TEXTURE_MAG_FILTER, gl.NEAREST],
      [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
      [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
    ] as const)
      gl.texParameteri(gl.TEXTURE_2D, k, v);
    // Placeholder textures so every sampler is always complete.
    this.upload("__empty3d", {
      kind: "lut3d",
      size: 2,
      data: new Float32Array(24),
      domainMin: [0, 0, 0],
      domainMax: [1, 1, 1],
    });
    this.upload("__empty1d", {
      kind: "lut1d",
      size: 2,
      data: new Float32Array(6),
      domainMin: [0, 0, 0],
      domainMax: [1, 1, 1],
    });
  }

  private upload(key: string, t: LookTransform) {
    const gl = this.gl;
    const existing = this.textures.get(key);
    if (existing) return existing;
    if (t.kind === "cdl") return null;
    const tex = gl.createTexture()!;
    let entry;
    if (t.kind === "lut3d") {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_3D, tex);
      gl.texImage3D(
        gl.TEXTURE_3D,
        0,
        gl.RGBA16F,
        t.size,
        t.size,
        t.size,
        0,
        gl.RGBA,
        gl.FLOAT,
        rgbaFrom(t.data, t.size ** 3),
      );
      for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R])
        gl.texParameteri(gl.TEXTURE_3D, p, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      entry = { tex, target: gl.TEXTURE_3D, size: t.size };
    } else {
      const size = Math.min(t.size, MAX_1D_TEXELS);
      const data = size === t.size ? t.data : resample1D(t.data, t.size, size);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA16F,
        size,
        1,
        0,
        gl.RGBA,
        gl.FLOAT,
        rgbaFrom(data, size),
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      entry = { tex, target: gl.TEXTURE_2D, size };
    }
    this.textures.set(key, entry);
    return entry;
  }

  /** Forget a look's GPU texture (after it's deleted from the library). */
  release(id: string) {
    const e = this.textures.get(id);
    if (e) this.gl.deleteTexture(e.tex);
    this.textures.delete(id);
  }

  /**
   * Grade the rectangle (x, y, w, h) of `ctx`'s canvas in place with `look`. Pixels outside the
   * rectangle (letterbox bars, later text layers) are untouched.
   */
  apply(
    ctx: CanvasRenderingContext2D,
    look: Look,
    intensity: number,
    x: number,
    y: number,
    w: number,
    h: number,
  ) {
    const gl = this.gl;
    const src = ctx.canvas;
    const W = src.width;
    const H = src.height;
    // Clip the rectangle to the canvas, in whole pixels.
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(W, Math.ceil(x + w));
    const y1 = Math.min(H, Math.ceil(y + h));
    if (x1 <= x0 || y1 <= y0 || intensity <= 0) return;
    if (gl.isContextLost())
      throw new Error("The GPU context for looks was lost. Reload the page and try again.");
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
    }
    gl.viewport(0, 0, W, H);
    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.image);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src as TexImageSource);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    const t = look.transform;
    const lut = this.upload(look.id, t);
    const e3 = this.textures.get("__empty3d")!;
    const e1 = this.textures.get("__empty1d")!;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, t.kind === "lut3d" ? lut!.tex : e3.tex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, t.kind === "lut1d" ? lut!.tex : e1.tex);
    gl.uniform1i(this.u["mode"]!, t.kind === "lut3d" ? 1 : t.kind === "lut1d" ? 2 : 3);
    gl.uniform1f(this.u["intensity"]!, Math.min(1, intensity));
    if (t.kind === "cdl") {
      gl.uniform3fv(this.u["slope"]!, t.slope);
      gl.uniform3fv(this.u["offs"]!, t.offset);
      gl.uniform3fv(this.u["power"]!, t.power);
      gl.uniform1f(this.u["sat"]!, t.saturation);
      gl.uniform3fv(this.u["dmin"]!, [0, 0, 0]);
      gl.uniform3fv(this.u["dmax"]!, [1, 1, 1]);
      gl.uniform1f(this.u["size"]!, 2);
    } else {
      gl.uniform3fv(this.u["dmin"]!, t.domainMin);
      gl.uniform3fv(this.u["dmax"]!, t.domainMax);
      gl.uniform1f(this.u["size"]!, lut!.size);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (gl.getError() !== gl.NO_ERROR) throw new Error("Applying the look failed on the GPU.");
    // Copy back just the graded rectangle, 1:1 (a clip path + "copy" compositing corrupted
    // edge pixels in Chrome; a same-size source→destination draw is exact).
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.filter = "none";
    ctx.imageSmoothingEnabled = false;
    const rw = x1 - x0;
    const rh = y1 - y0;
    ctx.clearRect(x0, y0, rw, rh);
    ctx.drawImage(this.canvas, x0, y0, rw, rh, x0, y0, rw, rh);
    ctx.restore();
  }
}

let renderer: LookRenderer | null = null;
let unavailable: string | null = null;

/** Shared renderer, created on first use. Returns null (with a reason) if WebGL2 is missing. */
export function lookRenderer(): LookRenderer | null {
  if (renderer || unavailable) return renderer;
  if (typeof WebGL2RenderingContext === "undefined") {
    unavailable = "Looks need WebGL2, which isn't available in this browser.";
    return null;
  }
  try {
    renderer = new LookRenderer();
  } catch (e) {
    unavailable = e instanceof Error ? e.message : String(e);
  }
  return renderer;
}
export const lookGpuError = () => (lookRenderer() ? null : unavailable);
