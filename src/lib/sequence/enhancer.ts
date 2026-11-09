/** Spatial enhancement, not AI reconstruction. Shared by preview and export. */
export interface Enhancement {
  enabled: boolean;
  exposure: number; // stops, -2..2
  contrast: number; // 0.5..1.5
  saturation: number; // 0..2
  sharpen: number; // 0..1
}
export const DEFAULT_ENHANCEMENT: Enhancement = {
  enabled: false,
  exposure: 0,
  contrast: 1,
  saturation: 1,
  sharpen: 0,
};
export const ENHANCE_PRESETS = {
  balanced: { enabled: true, exposure: 0.1, contrast: 1.08, saturation: 1.08, sharpen: 0.2 },
  lowLight: { enabled: true, exposure: 0.5, contrast: 1.04, saturation: 1.04, sharpen: 0.1 },
  vivid: { enabled: true, exposure: 0, contrast: 1.12, saturation: 1.2, sharpen: 0.25 },
} satisfies Record<string, Enhancement>;
export function validEnhancement(value: unknown): value is Enhancement {
  if (!value || typeof value !== "object") return false;
  const e = value as Enhancement;
  return (
    typeof e.enabled === "boolean" &&
    Number.isFinite(e.exposure) &&
    e.exposure >= -2 &&
    e.exposure <= 2 &&
    Number.isFinite(e.contrast) &&
    e.contrast >= 0.5 &&
    e.contrast <= 1.5 &&
    Number.isFinite(e.saturation) &&
    e.saturation >= 0 &&
    e.saturation <= 2 &&
    Number.isFinite(e.sharpen) &&
    e.sharpen >= 0 &&
    e.sharpen <= 1
  );
}
export function enhancementActive(e: Enhancement | undefined) {
  return (
    !!e?.enabled && (e.exposure !== 0 || e.contrast !== 1 || e.saturation !== 1 || e.sharpen !== 0)
  );
}
const VERTEX = `attribute vec2 position; varying vec2 uv;
void main(){uv=(position+1.0)*0.5;gl_Position=vec4(position,0.0,1.0);}`;
const FRAGMENT = `precision highp float;
varying vec2 uv; uniform sampler2D image; uniform vec2 texel;
uniform float exposure; uniform float contrast; uniform float saturation; uniform float sharpen;
void main(){
  vec4 center=texture2D(image,uv);
  vec3 neighbors=texture2D(image,uv+vec2(texel.x,0.0)).rgb+texture2D(image,uv-vec2(texel.x,0.0)).rgb+texture2D(image,uv+vec2(0.0,texel.y)).rgb+texture2D(image,uv-vec2(0.0,texel.y)).rgb;
  vec3 color=center.rgb+sharpen*(center.rgb-neighbors*0.25);
  color*=exp2(exposure);
  color=(color-0.5)*contrast+0.5;
  float luma=dot(color,vec3(0.2126,0.7152,0.0722));
  color=mix(vec3(luma),color,saturation);
  gl_FragColor=vec4(clamp(color,0.0,1.0),center.a);
}`;
/** One reusable GPU pass; no CPU pixel readback, including at UHD sizes. */
export class FrameEnhancer {
  private canvas = document.createElement("canvas");
  private gl: WebGLRenderingContext;
  private program: WebGLProgram | null = null;
  private buffer: WebGLBuffer | null = null;
  private texture: WebGLTexture | null = null;
  private width = 0;
  private height = 0;
  private disposed = false;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  constructor() {
    const gl = this.canvas.getContext("webgl", {
      alpha: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
      antialias: false,
    });
    if (!gl)
      throw new Error(
        "Video Enhancer requires WebGL. Enable hardware acceleration or turn off enhancement.",
      );
    this.gl = gl;
    const compile = (type: number, code: string) => {
      const shader = gl.createShader(type);
      if (!shader) throw new Error("Cannot allocate enhancement shader.");
      gl.shaderSource(shader, code);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        gl.deleteShader(shader);
        throw new Error("Video enhancement shader is unsupported on this device.");
      }
      return shader;
    };
    let vertex: WebGLShader | undefined, fragment: WebGLShader | undefined;
    try {
      vertex = compile(gl.VERTEX_SHADER, VERTEX);
      fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT);
      this.program = gl.createProgram();
      if (!this.program) throw new Error("Cannot allocate enhancement program.");
      gl.attachShader(this.program, vertex);
      gl.attachShader(this.program, fragment);
      gl.linkProgram(this.program);
      if (!gl.getProgramParameter(this.program, gl.LINK_STATUS))
        throw new Error("Cannot initialize video enhancement.");
      gl.useProgram(this.program);
      this.buffer = gl.createBuffer();
      this.texture = gl.createTexture();
      if (!this.buffer || !this.texture)
        throw new Error("Not enough GPU resources for video enhancement.");
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
        gl.STATIC_DRAW,
      );
      const position = gl.getAttribLocation(this.program, "position");
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      for (const name of ["image", "texel", "exposure", "contrast", "saturation", "sharpen"])
        this.uniforms[name] = gl.getUniformLocation(this.program, name);
      gl.uniform1i(this.uniforms["image"]!, 0);
    } catch (e) {
      this.dispose();
      throw e;
    } finally {
      if (vertex) gl.deleteShader(vertex);
      if (fragment) gl.deleteShader(fragment);
    }
  }
  checkSize(width: number, height: number) {
    const gl = this.gl;
    if (this.disposed || gl.isContextLost())
      throw new Error(
        "Enhancement GPU context was lost. Retry with a lower resolution or disable enhancement.",
      );
    const textureLimit = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
      renderLimit = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number,
      viewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
    if (
      width > Math.min(textureLimit, renderLimit, viewport[0]!) ||
      height > Math.min(textureLimit, renderLimit, viewport[1]!)
    )
      throw new Error(
        `This device cannot enhance ${width}×${height}. Choose a lower export resolution.`,
      );
  }
  apply(target: HTMLCanvasElement, e: Enhancement) {
    if (!enhancementActive(e)) return;
    this.checkSize(target.width, target.height);
    const gl = this.gl;
    if (this.width !== target.width || this.height !== target.height) {
      this.width = target.width;
      this.height = target.height;
      this.canvas.width = this.width;
      this.canvas.height = this.height;
      gl.viewport(0, 0, this.width, this.height);
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, target);
    gl.uniform2f(this.uniforms["texel"]!, 1 / this.width, 1 / this.height);
    for (const name of ["exposure", "contrast", "saturation", "sharpen"] as const)
      gl.uniform1f(this.uniforms[name]!, e[name]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (gl.isContextLost() || gl.getError() !== gl.NO_ERROR)
      throw new Error(
        "Video enhancement failed on the GPU. Try a lower resolution; the export was stopped.",
      );
    const ctx = target.getContext("2d");
    if (!ctx) throw new Error("Cannot composite enhanced frame.");
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "copy";
    ctx.drawImage(this.canvas, 0, 0);
    ctx.restore();
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.gl.deleteTexture(this.texture);
    this.gl.deleteBuffer(this.buffer);
    this.gl.deleteProgram(this.program);
    this.gl.getExtension("WEBGL_lose_context")?.loseContext();
    this.canvas.width = 1;
    this.canvas.height = 1;
  }
}
