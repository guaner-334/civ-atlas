/**
 * 立体模式里的画布:镜头、拖动 / 滚轮 / 手势、什么时候画一帧(只在动了的时候画)。
 *   电脑:左键拖动转(左右转方向、上下改俯角)、滚轮拉近拉远、右键拖动平移、双击回到刚打开时的角度
 *   手机:单指转;双指捏合远近、一起上下推改俯角(往上推更斜)、拧转方向
 * 指南针、复位、远近按钮由 View.tsx 调 north / reset / zoomBy。
 */
import { ReliefGL, PALETTE, type ReliefTexPart } from '../../render/terrain3d/gl';
import type { ReliefMesh } from '../../render/terrain3d/relief';
import { FIT_DESKTOP, FIT_PHONE, PITCH_MAX, PITCH_MIN, clipPlanes, fitCam, mul, project, projMatrix, rectShift, viewMatrix, type ReliefCam } from '../../render/terrain3d/camera';

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

  /** 起伏倍数(滑条):刚打开的角度跟着最高处的高度挪一点,看点不动 */
  setEx(ex: number): void {
    this.ex = ex;
    this.kick();
  }

  get maxTex(): number {
    return this.gl.maxTex;
  }

  /** 回到刚打开时的角度(按现在的起伏重新定远近) */
  reset(): void {
    if (!this.cam || !this.gl.ready) return;
    this.home = this.fit();
    this.tween({ ...this.home });
  }

  /** 转回正北(朝向 0,别的不变) */
  north(): void {
    if (!this.cam) return;
    let yaw = this.cam.yaw % 360;
    if (yaw > 180) yaw -= 360;
    if (yaw < -180) yaw += 360;
    this.cam.yaw = yaw;
    this.tween({ ...this.cam, yaw: 0 });
  }

  /** 拉近(f > 1)、拉远 */
  zoomBy(f: number): void {
    if (!this.cam) return;
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

  private render() {
    const cam = this.cam;
    const s = this.gl.size;
    const W = this.canvas.width;
    const H = this.canvas.height;
    if (!cam || !s) {
      this.gl.draw(W, H, new Float32Array(16), new Float32Array(16), this.ex, [0, 1], PALETTE);
      return;
    }
    const [shX, shY] = rectShift(this.W, this.H, this.rect());
    const [n, f] = clipPlanes(cam, Math.max(s.kmX, s.kmZ) + ((s.maxElev / 1000) * this.ex));
    const mv = viewMatrix(cam);
    const mvp = mul(projMatrix(this.W / this.H, n, f, shX, shY, cam.fov), mv);
    this.gl.draw(W, H, mv, mvp, this.ex, [cam.dist * 0.55, cam.dist * 1.9], PALETTE);
    reliefDebug().frames++;
    // 北在画面上朝哪:看点往北挪一点,投到画面上比一比
    const a = project(mvp, cam.tx, cam.ty, cam.tz);
    const b = project(mvp, cam.tx, cam.ty, cam.tz - s.kmZ * 0.05);
    if (a && b) this.onNorth((Math.atan2((b[0] - a[0]) * this.W, (b[1] - a[1]) * this.H) * 180) / Math.PI);
  }

  // ---- 拖动、滚轮、手势 ----

  private down(e: PointerEvent) {
    this.onTouch();
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
      // 两个手指一起往上 / 往下推(同一个方向)才改俯角:往上推更斜
      const dy1 = a.y - t.ys[0];
      const dy2 = b.y - t.ys[1];
      if (dy1 * dy2 > 0) cam.pitch = clampPitch(cam.pitch + (cy - t.cy) * 0.25);
      this.two = { d, a: ang, cy, ys: [a.y, b.y] };
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
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    // 触控板捏合(ctrl + 滚轮)的量小,放大一点
    this.cam.dist = this.clampDist(this.cam.dist * Math.exp(dy * (e.ctrlKey ? 0.01 : 0.0015)));
    this.kick();
  }
}

function clampPitch(p: number): number {
  return Math.min(PITCH_MAX, Math.max(PITCH_MIN, p));
}
