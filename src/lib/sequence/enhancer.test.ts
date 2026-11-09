import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_ENHANCEMENT,
  ENHANCE_PRESETS,
  FrameEnhancer,
  enhancementActive,
  validEnhancement,
} from "./enhancer";
import { dimensions, fresh, parseSequence } from "./model";
afterEach(() => vi.restoreAllMocks());
function gpu() {
  const gl = {
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    COMPILE_STATUS: 3,
    LINK_STATUS: 4,
    ARRAY_BUFFER: 5,
    STATIC_DRAW: 6,
    FLOAT: 7,
    TEXTURE0: 8,
    TEXTURE_2D: 9,
    TEXTURE_MIN_FILTER: 10,
    TEXTURE_MAG_FILTER: 11,
    LINEAR: 12,
    TEXTURE_WRAP_S: 13,
    TEXTURE_WRAP_T: 14,
    CLAMP_TO_EDGE: 15,
    UNPACK_FLIP_Y_WEBGL: 16,
    MAX_TEXTURE_SIZE: 17,
    MAX_RENDERBUFFER_SIZE: 18,
    MAX_VIEWPORT_DIMS: 19,
    RGBA: 20,
    UNSIGNED_BYTE: 21,
    TRIANGLE_STRIP: 22,
    NO_ERROR: 0,
    createShader: vi.fn(() => ({})),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => true),
    deleteShader: vi.fn(),
    createProgram: vi.fn(() => ({})),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => true),
    useProgram: vi.fn(),
    createBuffer: vi.fn(() => ({})),
    createTexture: vi.fn(() => ({})),
    bindBuffer: vi.fn(),
    bufferData: vi.fn(),
    getAttribLocation: vi.fn(() => 0),
    enableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn(),
    activeTexture: vi.fn(),
    bindTexture: vi.fn(),
    texParameteri: vi.fn(),
    pixelStorei: vi.fn(),
    getUniformLocation: vi.fn((_: unknown, name: string) => ({ name })),
    uniform1i: vi.fn(),
    uniform1f: vi.fn(),
    uniform2f: vi.fn(),
    isContextLost: vi.fn(() => false),
    getParameter: vi.fn((p: number) => (p === 19 ? new Int32Array([4096, 4096]) : 4096)),
    viewport: vi.fn(),
    texImage2D: vi.fn(),
    drawArrays: vi.fn(),
    getError: vi.fn(() => 0),
    deleteTexture: vi.fn(),
    deleteBuffer: vi.fn(),
    deleteProgram: vi.fn(),
    getExtension: vi.fn(() => ({ loseContext: vi.fn() })),
  };
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    drawImage: vi.fn(),
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(((type: string) =>
    type === "webgl" ? gl : ctx) as unknown as typeof HTMLCanvasElement.prototype.getContext);
  return { gl, ctx };
}
describe("video enhancement", () => {
  it("loads old projects and round-trips valid enhancements", () => {
    expect(parseSequence(fresh()).enhancement).toBeUndefined();
    const s = { ...fresh(), enhancement: ENHANCE_PRESETS.balanced };
    expect(parseSequence(JSON.parse(JSON.stringify(s))).enhancement).toEqual(s.enhancement);
    expect(() => parseSequence({ ...s, enhancement: { ...s.enhancement, exposure: NaN } })).toThrow(
      "enhancement",
    );
    expect(() => parseSequence({ ...s, enhancement: { ...s.enhancement, sharpen: 2 } })).toThrow(
      "enhancement",
    );
  });
  it("bypasses neutral and disabled settings", () => {
    expect(enhancementActive(DEFAULT_ENHANCEMENT)).toBe(false);
    expect(enhancementActive({ ...DEFAULT_ENHANCEMENT, enabled: true })).toBe(false);
    expect(enhancementActive(ENHANCE_PRESETS.balanced)).toBe(true);
    expect(validEnhancement({ ...DEFAULT_ENHANCEMENT, contrast: 10 })).toBe(false);
  });
  it("uses exact UHD landscape, portrait and square dimensions", () => {
    expect(dimensions(fresh(), 2160)).toEqual({ width: 3840, height: 2160 });
    expect(dimensions({ ...fresh(), aspect: "9:16" }, 2160)).toEqual({ width: 2160, height: 3840 });
    expect(dimensions({ ...fresh(), aspect: "1:1" }, 2160)).toEqual({ width: 2160, height: 2160 });
  });
  it("reuses GPU resources and applies saved controls at UHD resolution", () => {
    const { gl, ctx } = gpu(),
      enhancer = new FrameEnhancer(),
      canvas = document.createElement("canvas");
    canvas.width = 3840;
    canvas.height = 2160;
    enhancer.apply(canvas, ENHANCE_PRESETS.balanced);
    enhancer.apply(canvas, ENHANCE_PRESETS.vivid);
    expect(gl.createProgram).toHaveBeenCalledTimes(1);
    expect(gl.createTexture).toHaveBeenCalledTimes(1);
    expect(gl.viewport).toHaveBeenCalledTimes(1);
    expect(gl.viewport).toHaveBeenCalledWith(0, 0, 3840, 2160);
    expect(gl.uniform2f).toHaveBeenCalledWith({ name: "texel" }, 1 / 3840, 1 / 2160);
    expect(gl.uniform1f).toHaveBeenCalledWith({ name: "sharpen" }, 0.25);
    expect(gl.pixelStorei).toHaveBeenCalledWith(gl.UNPACK_FLIP_Y_WEBGL, true);
    expect(ctx.drawImage).toHaveBeenCalledTimes(2);
    enhancer.dispose();
    enhancer.dispose();
    expect(gl.deleteTexture).toHaveBeenCalledTimes(1);
  });
  it("stops on insufficient GPU limits or context loss instead of silently omitting effects", () => {
    const { gl } = gpu(),
      enhancer = new FrameEnhancer();
    expect(() => enhancer.checkSize(8192, 2160)).toThrow("lower export resolution");
    gl.isContextLost.mockReturnValue(true);
    expect(() => enhancer.checkSize(3840, 2160)).toThrow("context was lost");
    enhancer.dispose();
  });
  it("fails clearly when WebGL is unavailable", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    expect(() => new FrameEnhancer()).toThrow("requires WebGL");
  });
});
