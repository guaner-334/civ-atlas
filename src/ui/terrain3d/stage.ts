/**
 * 立体模式里的画布:镜头、拖动 / 滚轮 / 手势、什么时候画一帧(只在动了的时候画)。
 *   电脑:左键拖动转(左右转方向、上下改俯角)、滚轮拉近拉远、右键拖动平移、双击回到刚打开时的角度
 *   手机:单指转;双指捏合远近、一起上下推改俯角(往上推更斜)、拧转方向
 * 指南针、复位、远近按钮由 View.tsx 调 north / reset / zoomBy。
 * 角度(写进网址):angle / setAngle,按"这块屏幕刚打开时那么远"算远近(手机、电脑打开都是那么大的一块);每画一帧告诉外面一声(onView)。
 * 导出这一面:snapshot 按几倍像素密度把看得见的那一块单独画一张(天色底、地形;山名由 View.tsx 画上)。
 */
import { ReliefGL, PALETTE, type ReliefPalette, type ReliefTexPart } from '../../render/terrain3d/gl';
import type { ReliefMesh } from '../../render/terrain3d/relief';
import {
  FIT_DESKTOP,
  FIT_PHONE,
  PITCH_MAX,
  PITCH_MIN,
  angleOf,
  camOfAngle,
  clipPlanes,
  fitCam,
  mul,
  project,
  projMatrix,
  rectShift,
  viewMatrix,
  type Mat4,
  type ReliefAngle,
  type ReliefCam,
} from '../../render/terrain3d/camera';

/** 立体的天色底(和 terrain3d.css 里 .rv 的底色一样:从上往下) */
export const SKY: [string, string] = ['#b0c4da', '#e2e8ee'];

/** 导出这一面画好的那张:天色底 + 地形;pins = 山顶在这张图上的位置(像素;落在镜头后面 = null) */
export interface ReliefSnap {
  canvas: HTMLCanvasElement;
  pins: ([number, number] | null)[];
}

/** 冒烟检查、测速看的(window.__wfRelief) */
export interface ReliefDebug {
  /** 现在画的是哪一档 */
  level: 'none' | 'coarse' | 'fine';
  /** 点「立起来看」到粗的、细的画出来各多少毫秒 */
  coarseMs?: number;
  fineMs?: number;
  /** 两档各算了多久(后台线程,毫秒) */
  coarseCalc?: number;
  fineCalc?: number;
  /** 贴图大小、每单位几像素、网格点数 */
  tex?: [number, number];
  S?: number;
  verts?: number;
  ex?: number;
  /** 方框里最高处(米,粗的一档) */
  maxElev?: number;
  /** 贴着的是哪种上色(render/terrain3d/relief.ts 的 ReliefLook) */
  look?: string;
  /** 最近一次写进网址的角度 */
  angle?: ReliefAngle;
  frames: number;
}

export function reliefDebug(): ReliefDebug {
  const g = window as unknown as { __wfRelief?: ReliefDebug };
  g.__wfRelief ??= { level: 'none', frames: 0 };
  return g.__wfRelief;
}

export class ReliefStage {
  private gl: ReliefGL;
  private canvas: HTMLCanvasElement;
  private cam: ReliefCam | null = null;
  private home: ReliefCam | null = null;
  private ex = 12;
  private pal: ReliefPalette = PALETTE;
  private raf = 0;
  private anim: { from: ReliefCam; to: ReliefCam; t0: number; ms: number } | null = null;
  private W = 1;
  private H = 1;
  private dpr = 1;
  private ptrs = new Map<number, { x: number; y: number }>();
  private drag: { mode: 'turn' | 'pan'; x: number; y: number } | null = null;
  private two: { d: number; a: number; cy: number; ys: [number, number] } | null = null;
  private ro: ResizeObserver;
  private off: (() => void)[] = [];
  /** 画面里看得见的那一块(CSS 像素:左、上、右、下);宽屏让开左边的卡片、底下的控件条 */
  rect: () => [number, number, number, number];
  /** 每画一帧告诉外面北在画面上朝哪(度,顺时针;0 = 朝上) */
  onNorth: (deg: number) => void = () => {};
  /** 第一次按下(手机上收起操作提示) */
  onTouch: () => void = () => {};
  /** 每画一帧告诉外面几个钉子(山顶)在画面上的位置(CSS 像素;落在镜头后面 = null) */
  onPins: (pts: ([number, number] | null)[]) => void = () => {};
  /** 每画一帧告诉外面一声(转了、拉了、换了起伏:角度写进网址用) */
  onView: () => void = () => {};
  private pins: ({ x: number; z: number; h: number } | null)[] = [];
  /** 动过镜头没有(拖、滚轮、指南针、远近、复位;网址带来的角度细的一档换上时再摆一次,动过就不摆) */
  touched = false;

  private phone: boolean;

  constructor(canvas: HTMLCanvasElement, rect: () => [number, number, number, number], phone: boolean) {
    this.canvas = canvas;
    this.phone = phone;
    this.rect = rect;
    this.gl = new ReliefGL(canvas);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();
    const on = <K extends keyof HTMLElementEventMap>(type: K, f: (e: HTMLElementEventMap[K]) => void, opt?: AddEventListenerOptions) => {
      canvas.addEventListener(type, f as EventListener, opt);
      this.off.push(() => canvas.removeEventListener(type, f as EventListener, opt));
    };
    on('pointerdown', (e) => this.down(e));
    on('pointermove', (e) => this.move(e));
    on('pointerup', (e) => this.up(e));
    on('pointercancel', (e) => this.up(e));
    on('wheel', (e) => this.wheel(e), { passive: false });
    on('dblclick', () => this.reset());
    on('contextmenu', (e) => e.preventDefault());
  }

  /** 换上一块(粗的或细的);第一次换上时按这一块定刚打开的角度 */
  setModel(mesh: ReliefMesh, kmX: number, kmZ: number, w: number, h: number, parts: ReliefTexPart[], horizon: Float32Array): void {
    this.gl.setModel(mesh, kmX, kmZ, w, h, parts, horizon);
    if (!this.home) {
      this.home = this.fit();
      this.cam = { ...this.home };
    }
    this.kick();
  }

  setColor(w: number, h: number, parts: ReliefTexPart[]): void {
    this.gl.setColor(w, h, parts);
    this.kick();
  }

  /** 钉在沙盘上的几个点(公里,方框中心为原点;h = 海拔米,跟着起伏倍数升降):山名立在这儿 */
  setPins(pins: ({ x: number; z: number; h: number } | null)[]): void {
    this.pins = pins;
    this.kick();
  }

  /** 切面、光照、远处天色跟着画风换(手绘一套,别的一套) */
  setPalette(pal: ReliefPalette): void {
    if (pal === this.pal) return;
    this.pal = pal;
    this.kick();
  }

  /** 起伏倍数(滑条):刚打开的角度跟着最高处的高度挪一点,看点不动 */
  setEx(ex: number): void {
    this.ex = ex;
    this.kick();
  }

  get maxTex(): number {
    return this.gl.maxTex;
  }

  /** 现在的起伏倍数 */
  get exNow(): number {
    return this.ex;
  }

  /** 现在的角度(远近按现在的起伏、这块屏幕刚打开时那么远算);还没换上一块 = null */
  angle(): ReliefAngle | null {
    const s = this.gl.size;
    if (!this.cam || !s) return null;
    return angleOf(this.cam, this.fit(), s.kmX, s.kmZ);
  }

  /** 转到某个角度(网址带来的;第一次换上一块以后调) */
  setAngle(a: ReliefAngle): void {
    const s = this.gl.size;
    if (!this.cam || !s) return;
    this.anim = null;
    const c = camOfAngle(a, this.fit(), s.kmX, s.kmZ);
    this.cam = { ...c, dist: this.clampDist(c.dist) };
    this.kick();
  }

  /**
   * 导出这一面:看得见的那一块(rect,CSS 像素)按 sc 倍像素密度单独画一张 —— 天色底 + 地形(画布临时换成这么大画一帧,马上换回去重画)。
   * 还没换上一块 = null
   */
  snapshot(rect: [number, number, number, number], sc: number): ReliefSnap | null {
    const s = this.gl.size;
    if (!this.cam || !s) return null;
    const [l, t, r, b] = rect;
    const cw = Math.max(1, Math.round((r - l) * sc));
    const ch = Math.max(1, Math.round((b - t) * sc));
    const out = document.createElement('canvas');
    out.width = cw;
    out.height = ch;
    const ctx = out.getContext('2d')!;
    // 天色底:和屏幕上一样从整个画面的顶到底渐变,这一块取中间那一段
    const g = ctx.createLinearGradient(0, -t * sc, 0, (this.H - t) * sc);
    g.addColorStop(0, SKY[0]);
    g.addColorStop(1, SKY[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cw, ch);
    const cvs = this.canvas;
    const ow = cvs.width;
    const oh = cvs.height;
    let pins: ([number, number] | null)[] = [];
    try {
      cvs.width = cw;
      cvs.height = ch;
      // 整个画面的投影上再加一步:只取 rect 那一块铺满
      const crop = new Float32Array(16);
      crop[0] = this.W / (r - l);
      crop[5] = this.H / (b - t);
      crop[10] = 1;
      crop[15] = 1;
      crop[12] = (this.W - l - r) / (r - l);
      crop[13] = (t + b - this.H) / (b - t);
      const mvp = this.draw(cw, ch, crop);
      ctx.drawImage(cvs, 0, 0);
      pins = this.pins.map((p) => {
        const q = p && mvp && project(mvp, p.x, p.h * 0.001 * this.ex, p.z);
        return q ? [((q[0] + 1) / 2) * cw, ((1 - q[1]) / 2) * ch] : null;
      });
    } finally {
      cvs.width = ow;
      cvs.height = oh;
      // 马上照屏幕的样子重画(不等下一帧,画布不闪空)
      this.render();
    }
    return { canvas: out, pins };
  }

  /** 回到刚打开时的角度(按现在的起伏重新定远近) */
  reset(): void {
    if (!this.cam || !this.gl.ready) return;
    this.touched = true;
    this.home = this.fit();
    this.tween({ ...this.home });
  }

  /** 转回正北(朝向 0,别的不变) */
  north(): void {
    if (!this.cam) return;
    this.touched = true;
    let yaw = this.cam.yaw % 360;
    if (yaw > 180) yaw -= 360;
    if (yaw < -180) yaw += 360;
    this.cam.yaw = yaw;
    this.tween({ ...this.cam, yaw: 0 });
  }

  /** 拉近(f > 1)、拉远 */
  zoomBy(f: number): void {
    if (!this.cam) return;
    this.touched = true;
    this.tween({ ...this.cam, dist: this.clampDist(this.cam.dist / f) });
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    for (const f of this.off) f();
    this.gl.dispose();
  }

  /** 测速用:一直转 ms 毫秒,回报画了几帧、最慢一帧多少毫秒 */
  spin(ms: number): Promise<{ frames: number; ms: number; fps: number; worst: number }> {
    return new Promise((resolve) => {
      const t0 = performance.now();
      let last = t0;
      let frames = 0;
      let worst = 0;
      const step = (t: number) => {
        if (this.cam) this.cam.yaw += 0.6;
        this.render();
        frames++;
        worst = Math.max(worst, t - last);
        last = t;
        if (t - t0 < ms) requestAnimationFrame(step);
        else resolve({ frames, ms: t - t0, fps: (frames * 1000) / (t - t0), worst });
      };
      requestAnimationFrame(step);
    });
  }

  private fit(): ReliefCam {
    const s = this.gl.size!;
    return fitCam(s.kmX, s.kmZ, (s.maxElev / 1000) * this.ex, this.W, this.H, this.rect(), this.phone ? FIT_PHONE : FIT_DESKTOP);
  }

  private clampDist(d: number): number {
    const h = this.home?.dist ?? d;
    return Math.min(h * 3, Math.max(h * 0.15, d));
  }

  private resize() {
    const r = this.canvas.getBoundingClientRect();
    this.W = Math.max(1, r.width);
    this.H = Math.max(1, r.height);
    const w = Math.round(this.W * this.dpr);
    const h = Math.round(this.H * this.dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.kick();
  }

  private tween(to: ReliefCam, ms = 420) {
    if (!this.cam) return;
    this.anim = { from: { ...this.cam }, to, t0: performance.now(), ms };
    this.kick();
  }

  /** 下一帧画一次 */
  private kick() {
    if (!this.raf) this.raf = requestAnimationFrame(() => this.frame());
  }

  private frame() {
    this.raf = 0;
    const a = this.anim;
    if (a && this.cam) {
      const t = Math.min(1, (performance.now() - a.t0) / a.ms);
      const e = 1 - Math.pow(1 - t, 3);
      for (const k of ['yaw', 'pitch', 'dist', 'tx', 'ty', 'tz', 'fov'] as const) this.cam[k] = a.from[k] + (a.to[k] - a.from[k]) * e;
      if (t >= 1) this.anim = null;
      else this.kick();
    }
    this.render();
  }

  /** 按现在的镜头画一帧到 W × H 像素的画布上(crop = 投影上再加的一步,导出时用);返回用的变换(还没换上一块 = null) */
  private draw(W: number, H: number, crop?: Mat4): Mat4 | null {
    const cam = this.cam;
    const s = this.gl.size;
    if (!cam || !s) {
      this.gl.draw(W, H, new Float32Array(16), new Float32Array(16), this.ex, [0, 1], this.pal);
      return null;
    }
    const [shX, shY] = rectShift(this.W, this.H, this.rect());
    const [n, f] = clipPlanes(cam, Math.max(s.kmX, s.kmZ) + ((s.maxElev / 1000) * this.ex));
    const mv = viewMatrix(cam);
    let mvp = mul(projMatrix(this.W / this.H, n, f, shX, shY, cam.fov), mv);
    if (crop) mvp = mul(crop, mvp);
    this.gl.draw(W, H, mv, mvp, this.ex, [cam.dist * 0.55, cam.dist * 1.9], this.pal);
    return mvp;
  }

  private render() {
    const cam = this.cam;
    const s = this.gl.size;
    const mvp = this.draw(this.canvas.width, this.canvas.height);
    if (!cam || !s || !mvp) return;
    reliefDebug().frames++;
    // 北在画面上朝哪:看点往北挪一点,投到画面上比一比
    const a = project(mvp, cam.tx, cam.ty, cam.tz);
    const b = project(mvp, cam.tx, cam.ty, cam.tz - s.kmZ * 0.05);
    if (a && b) this.onNorth((Math.atan2((b[0] - a[0]) * this.W, (b[1] - a[1]) * this.H) * 180) / Math.PI);
    if (this.pins.length) {
      this.onPins(
        this.pins.map((p) => {
          const q = p && project(mvp, p.x, p.h * 0.001 * this.ex, p.z);
          return q ? [((q[0] + 1) / 2) * this.W, ((1 - q[1]) / 2) * this.H] : null;
        }),
      );
    }
    this.onView();
  }

  // ---- 拖动、滚轮、手势 ----

  private down(e: PointerEvent) {
    this.onTouch();
    this.touched = true;
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // 拿不到(手指已经抬起来了):照常跟着这根手指
    }
    this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.anim = null;
    if (this.ptrs.size === 1) this.drag = { mode: e.button === 2 || e.shiftKey ? 'pan' : 'turn', x: e.clientX, y: e.clientY };
    else this.startTwo();
  }

  private startTwo() {
    const [p, q] = [...this.ptrs.values()];
    this.drag = null;
    this.two = { d: Math.hypot(q.x - p.x, q.y - p.y), a: Math.atan2(q.y - p.y, q.x - p.x), cy: (p.y + q.y) / 2, ys: [p.y, q.y] };
  }

  private move(e: PointerEvent) {
    const p = this.ptrs.get(e.pointerId);
    if (!p || !this.cam) return;
    p.x = e.clientX;
    p.y = e.clientY;
    const cam = this.cam;
    if (this.two && this.ptrs.size >= 2) {
      const [a, b] = [...this.ptrs.values()];
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const cy = (a.y + b.y) / 2;
      const t = this.two;
      if (t.d > 0 && d > 0) cam.dist = this.clampDist(cam.dist * (t.d / d));
      let da = ang - t.a;
      if (da > Math.PI) da -= 2 * Math.PI;
      if (da < -Math.PI) da += 2 * Math.PI;
      cam.yaw -= (da * 180) / Math.PI;
      // 两个手指一起往上 / 往下推(同一个方向)才改俯角:往上推更斜。一次只来一根手指的移动,
      // 两根都挪过了再比(没挪的那根留着上一次的位置);一上一下(捏合)不算
      const dy1 = a.y - t.ys[0];
      const dy2 = b.y - t.ys[1];
      let ys = t.ys;
      if (dy1 * dy2 > 0) {
        cam.pitch = clampPitch(cam.pitch + ((dy1 + dy2) / 2) * 0.25);
        ys = [a.y, b.y];
      } else if (dy1 * dy2 < 0) ys = [a.y, b.y];
      this.two = { d, a: ang, cy, ys };
      this.kick();
      return;
    }
    const g = this.drag;
    if (!g) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    g.x = e.clientX;
    g.y = e.clientY;
    if (g.mode === 'turn') {
      cam.yaw -= dx * 0.3;
      cam.pitch = clampPitch(cam.pitch + dy * 0.2);
    } else this.pan(dx, dy);
    this.kick();
  }

  /** 平移:画面跟着手走(在地面上挪看点),看点不出沙盘 */
  private pan(dx: number, dy: number) {
    const cam = this.cam!;
    const s = this.gl.size!;
    const k = (2 * cam.dist * Math.tan((cam.fov * Math.PI) / 360)) / this.H;
    const yw = (cam.yaw * Math.PI) / 180;
    // 右 = (cos, 0, -sin);往前(地面上)= (-sin, 0, -cos)
    const rx = Math.cos(yw);
    const rz = -Math.sin(yw);
    const fx = -Math.sin(yw);
    const fz = -Math.cos(yw);
    const sp = 1 / Math.max(0.35, Math.sin((cam.pitch * Math.PI) / 180));
    cam.tx = Math.min(s.kmX / 2, Math.max(-s.kmX / 2, cam.tx - rx * dx * k + fx * dy * k * sp));
    cam.tz = Math.min(s.kmZ / 2, Math.max(-s.kmZ / 2, cam.tz - rz * dx * k + fz * dy * k * sp));
  }

  private up(e: PointerEvent) {
    this.ptrs.delete(e.pointerId);
    if (this.ptrs.size >= 2) this.startTwo();
    else if (this.ptrs.size === 1) {
      const [p] = [...this.ptrs.values()];
      this.two = null;
      this.drag = { mode: 'turn', x: p.x, y: p.y };
    } else {
      this.two = null;
      this.drag = null;
    }
  }

  private wheel(e: WheelEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!this.cam) return;
    this.anim = null;
    this.touched = true;
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    // 触控板捏合(ctrl + 滚轮)的量小,放大一点
    this.cam.dist = this.clampDist(this.cam.dist * Math.exp(dy * (e.ctrlKey ? 0.01 : 0.0015)));
    this.kick();
  }
}

function clampPitch(p: number): number {
  return Math.min(PITCH_MAX, Math.max(PITCH_MIN, p));
}
