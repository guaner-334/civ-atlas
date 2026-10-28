/**
 * 立体地形的显卡画法(WebGL2,自己写的一小段,不用 3D 库):
 *   - 地面:网格(relief.ts 的 buildMesh),高度 × 起伏倍数在顶点着色器里乘;法线按坡度 × 倍数现算
 *   - 颜色 = 贴图(画风现成的那一份,自带平面地图的明暗)× 光照(光从正西、高 30°)× 影子;远处淡淡一层天色
 *   - 影子:每个像素往西看的地平线坡度(relief.ts 的 horizonSlopes)× 倍数,比太阳还陡就在影子里(边上软一点)
 *   - 切面:四边从地面一直到平的底,上浅下深
 * 一块沙盘一份 ReliefModel(网格 + 贴图 + 地平线);先出粗的、细的算好了换上(换的时候旧的放掉)。
 */
import { SUN_ALT, SUN_TAN, type ReliefMesh } from './relief';
import type { Mat4 } from './camera';

const VS_GROUND = `#version 300 es
layout(location = 0) in vec2 aXZ;
layout(location = 1) in float aH;
layout(location = 2) in vec2 aG;
uniform mat4 uMVP;
uniform mat4 uMV;
uniform float uEx;
uniform vec2 uKm;
out vec2 vUv;
out vec3 vN;
out float vDepth;
void main() {
  float y = aH * 0.001 * uEx;
  vec3 p = vec3(aXZ.x, y, aXZ.y);
  vUv = aXZ / uKm + 0.5;
  vN = vec3(-aG.x * 0.001 * uEx, 1.0, -aG.y * 0.001 * uEx);
  vDepth = -(uMV * vec4(p, 1.0)).z;
  gl_Position = uMVP * vec4(p, 1.0);
}`;

const FS_GROUND = `#version 300 es
precision highp float;
in vec2 vUv;
in vec3 vN;
in float vDepth;
uniform sampler2D uTex;
uniform sampler2D uHz;
uniform vec3 uL;
uniform float uEx;
uniform float uSunTan;
uniform float uAmb;
uniform float uDif;
uniform float uShadow;
uniform float uBright;
uniform vec3 uFog;
uniform vec3 uFogR;
out vec4 o;
void main() {
  vec3 c = texture(uTex, vUv).rgb * uBright;
  vec3 n = normalize(vN);
  // 地平线坡度 × 倍数比太阳高度陡多少:陡过一点点就开始暗,软边
  float over = texture(uHz, vUv).r * 0.001 * uEx - uSunTan;
  float lit = 1.0 - smoothstep(0.0, 0.1, over);
  float ndl = max(dot(n, uL), 0.0) * mix(1.0 - uShadow, 1.0, lit);
  c *= (uAmb + uDif * ndl) / (uAmb + uDif * max(uL.y, 0.0));
  float f = clamp((vDepth - uFogR.x) / (uFogR.y - uFogR.x), 0.0, 1.0);
  o = vec4(mix(c, uFog, f * f * uFogR.z), 1.0);
}`;

const VS_SKIRT = `#version 300 es
layout(location = 0) in vec2 aXZ;
layout(location = 1) in float aH;
layout(location = 2) in vec2 aTT;
uniform mat4 uMVP;
uniform float uEx;
uniform float uBase;
out float vT;
out float vTone;
void main() {
  float y = mix(aH * 0.001 * uEx, uBase, aTT.x);
  vT = aTT.x;
  vTone = aTT.y;
  gl_Position = uMVP * vec4(aXZ.x, y, aXZ.y, 1.0);
}`;

const FS_SKIRT = `#version 300 es
precision mediump float;
in float vT;
in float vTone;
uniform vec3 uTop;
uniform vec3 uBot;
out vec4 o;
void main() {
  o = vec4(mix(uTop, uBot, vT) * vTone, 1.0);
}`;

/** 画风不同,切面和远处的天色不同 */
export interface ReliefPalette {
  /** 切面上沿、底的颜色(0–1) */
  top: [number, number, number];
  bottom: [number, number, number];
  /** 远处淡入的天色、淡多少 */
  fog: [number, number, number];
  fogAmt: number;
}

export const PALETTE: ReliefPalette = { top: [0x6e / 255, 0x63 / 255, 0x55 / 255], bottom: [0x3d / 255, 0x36 / 255, 0x2f / 255], fog: [0xc9 / 255, 0xd6 / 255, 0xe3 / 255], fogAmt: 0.32 };

/** 一块沙盘在显卡上的那一份 */
interface Model {
  kmX: number;
  kmZ: number;
  maxElev: number;
  vao: WebGLVertexArrayObject;
  vbo: WebGLBuffer;
  ibo: WebGLBuffer;
  count: number;
  skirtVao: WebGLVertexArrayObject;
  skirtVbo: WebGLBuffer;
  skirtCount: number;
  tex: WebGLTexture;
  hz: WebGLTexture;
}

/** 一块沙盘的贴图来源:整张(粗的一档常是一张)或几条横条(各算各的,按 y 拼起来) */
export interface ReliefTexPart {
  y: number;
  img: TexImageSource;
}

export class ReliefGL {
  readonly gl: WebGL2RenderingContext;
  private ground: WebGLProgram;
  private skirt: WebGLProgram;
  private gu: Record<string, WebGLUniformLocation | null>;
  private su: Record<string, WebGLUniformLocation | null>;
  private model: Model | null = null;
  private aniso: number;
  private anisoExt: EXT_texture_filter_anisotropic | null;
  /** 显卡贴图最大边长 */
  readonly maxTex: number;

  /** 浏览器不支持 WebGL2 = 抛错 */
  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('no webgl2');
    this.gl = gl;
    this.ground = program(gl, VS_GROUND, FS_GROUND);
    this.skirt = program(gl, VS_SKIRT, FS_SKIRT);
    this.gu = uniforms(gl, this.ground, ['uMVP', 'uMV', 'uEx', 'uKm', 'uTex', 'uHz', 'uL', 'uSunTan', 'uAmb', 'uDif', 'uShadow', 'uBright', 'uFog', 'uFogR']);
    this.su = uniforms(gl, this.skirt, ['uMVP', 'uEx', 'uBase', 'uTop', 'uBot']);
    this.anisoExt = gl.getExtension('EXT_texture_filter_anisotropic');
    this.aniso = this.anisoExt ? Math.min(16, gl.getParameter(this.anisoExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number) : 0;
    this.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
  }

  /** 有没有一块能画的 */
  get ready(): boolean {
    return !!this.model;
  }

  get size(): { kmX: number; kmZ: number; maxElev: number } | null {
    const m = this.model;
    return m ? { kmX: m.kmX, kmZ: m.kmZ, maxElev: m.maxElev } : null;
  }

  /**
   * 换上一块沙盘:网格、贴图(w × h,可以分几条)、地平线坡度(w × h,米 / 公里)。旧的那一块放掉
   */
  setModel(mesh: ReliefMesh, kmX: number, kmZ: number, w: number, h: number, parts: ReliefTexPart[], horizon: Float32Array): void {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.verts, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 20, 8);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 20, 12);
    const ibo = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.index, gl.STATIC_DRAW);
    const skirtVao = gl.createVertexArray()!;
    gl.bindVertexArray(skirtVao);
    const skirtVbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, skirtVbo);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.skirt, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 20, 8);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 20, 12);
    gl.bindVertexArray(null);

    const tex = this.colorTexture(w, h, parts);
    const hz = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, hz);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R16F, w, h);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RED, gl.FLOAT, horizon);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    clampEdges(gl);

    this.dropModel();
    this.model = { kmX, kmZ, maxElev: mesh.maxElev, vao, vbo, ibo, count: mesh.index.length, skirtVao, skirtVbo, skirtCount: mesh.skirt.length / 5, tex, hz };
  }

  /** 只换贴图(换了画风;网格、地平线不变)。尺寸要和现在这块一样 */
  setColor(w: number, h: number, parts: ReliefTexPart[]): void {
    const m = this.model;
    if (!m) return;
    const tex = this.colorTexture(w, h, parts);
    this.gl.deleteTexture(m.tex);
    m.tex = tex;
  }

  private colorTexture(w: number, h: number, parts: ReliefTexPart[]): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const levels = Math.floor(Math.log2(Math.max(w, h))) + 1;
    gl.texStorage2D(gl.TEXTURE_2D, levels, gl.RGBA8, w, h);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    for (const p of parts) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, p.y, gl.RGBA, gl.UNSIGNED_BYTE, p.img);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    if (this.anisoExt && this.aniso > 1) gl.texParameterf(gl.TEXTURE_2D, this.anisoExt.TEXTURE_MAX_ANISOTROPY_EXT, this.aniso);
    clampEdges(gl);
    return tex;
  }

  private dropModel(): void {
    const m = this.model;
    if (!m) return;
    const gl = this.gl;
    gl.deleteVertexArray(m.vao);
    gl.deleteVertexArray(m.skirtVao);
    gl.deleteBuffer(m.vbo);
    gl.deleteBuffer(m.ibo);
    gl.deleteBuffer(m.skirtVbo);
    gl.deleteTexture(m.tex);
    gl.deleteTexture(m.hz);
    this.model = null;
  }

  /** 画一帧。W、H = 画布像素;mv、mvp 按镜头算好;ex = 起伏倍数 */
  draw(W: number, H: number, mv: Mat4, mvp: Mat4, ex: number, fog: [number, number], pal: ReliefPalette): void {
    const gl = this.gl;
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const m = this.model;
    if (!m) return;
    const alt = (SUN_ALT * Math.PI) / 180;
    gl.useProgram(this.ground);
    const u = this.gu;
    gl.uniformMatrix4fv(u.uMVP, false, mvp);
    gl.uniformMatrix4fv(u.uMV, false, mv);
    gl.uniform1f(u.uEx, ex);
    gl.uniform2f(u.uKm, m.kmX, m.kmZ);
    gl.uniform3f(u.uL, -Math.cos(alt), Math.sin(alt), 0);
    gl.uniform1f(u.uSunTan, SUN_TAN);
    gl.uniform1f(u.uAmb, 0.5);
    gl.uniform1f(u.uDif, 0.9);
    gl.uniform1f(u.uShadow, 0.55);
    gl.uniform1f(u.uBright, 1.06);
    gl.uniform3f(u.uFog, pal.fog[0], pal.fog[1], pal.fog[2]);
    gl.uniform3f(u.uFogR, fog[0], fog[1], pal.fogAmt);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, m.tex);
    gl.uniform1i(u.uTex, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, m.hz);
    gl.uniform1i(u.uHz, 1);
    gl.bindVertexArray(m.vao);
    gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_INT, 0);

    gl.useProgram(this.skirt);
    const s = this.su;
    gl.uniformMatrix4fv(s.uMVP, false, mvp);
    gl.uniform1f(s.uEx, ex);
    gl.uniform1f(s.uBase, baseDepth(m.maxElev, ex, m.kmX, m.kmZ));
    gl.uniform3f(s.uTop, pal.top[0], pal.top[1], pal.top[2]);
    gl.uniform3f(s.uBot, pal.bottom[0], pal.bottom[1], pal.bottom[2]);
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(m.skirtVao);
    gl.drawArrays(gl.TRIANGLES, 0, m.skirtCount);
    gl.enable(gl.CULL_FACE);
    gl.bindVertexArray(null);
  }

  /** 放掉显卡上的东西(关掉立体时) */
  dispose(): void {
    this.dropModel();
    const gl = this.gl;
    gl.deleteProgram(this.ground);
    gl.deleteProgram(this.skirt);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

/** 沙盘的底在海面下多深(公里):最高处立起来的 12%,至少短边的 2% */
export function baseDepth(maxElev: number, ex: number, kmX: number, kmZ: number): number {
  return -Math.max(((maxElev / 1000) * ex) * 0.12, Math.min(kmX, kmZ) * 0.02);
}

function clampEdges(gl: WebGL2RenderingContext) {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

function program(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!;
  for (const [type, src] of [
    [gl.VERTEX_SHADER, vs],
    [gl.FRAGMENT_SHADER, fs],
  ] as const) {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
  return p;
}

function uniforms(gl: WebGL2RenderingContext, p: WebGLProgram, names: string[]): Record<string, WebGLUniformLocation | null> {
  const o: Record<string, WebGLUniformLocation | null> = {};
  for (const n of names) o[n] = gl.getUniformLocation(p, n);
  return o;
}
