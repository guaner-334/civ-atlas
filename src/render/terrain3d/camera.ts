/**
 * 立体地形的镜头:绕着一个看点转(朝向、俯角、远近),看点能在地面上平移。
 * 朝向 0 = 从南边往北看(北在上);朝向变大 = 镜头往东绕(画面上的北往左转)。
 * 纯计算(4×4 矩阵按列存,和 WebGL 一样)。
 */

export interface ReliefCam {
  /** 朝向(度) */
  yaw: number;
  /** 俯角(度,0 = 平视,90 = 正上方往下看) */
  pitch: number;
  /** 镜头离看点多远(公里) */
  dist: number;
  /** 看点(公里;x 朝东、z 朝南,y 向上) */
  tx: number;
  ty: number;
  tz: number;
  /** 视野(竖直方向,度) */
  fov: number;
}

/** 视野(竖直方向,度):窄一点,远处的山不显得太小。手机竖着拿,竖直方向放宽一些(横向才不至于太窄) */
export const FOV = 32;
export const FOV_PHONE = 46;
export const PITCH_MIN = 8;
export const PITCH_MAX = 88;

export type Mat4 = Float32Array;

/** 镜头所在的位置 */
export function eyeOf(c: ReliefCam): [number, number, number] {
  const yw = (c.yaw * Math.PI) / 180;
  const pt = (c.pitch * Math.PI) / 180;
  return [c.tx + c.dist * Math.sin(yw) * Math.cos(pt), c.ty + c.dist * Math.sin(pt), c.tz + c.dist * Math.cos(yw) * Math.cos(pt)];
}

/** 从镜头看过去的变换(lookAt) */
export function viewMatrix(c: ReliefCam): Mat4 {
  const [ex, ey, ez] = eyeOf(c);
  let fx = c.tx - ex;
  let fy = c.ty - ey;
  let fz = c.tz - ez;
  const fl = Math.hypot(fx, fy, fz) || 1;
  fx /= fl;
  fy /= fl;
  fz /= fl;
  // 右 = 前 × 上(0, 1, 0)
  let rx = -fz;
  let rz = fx;
  const rl = Math.hypot(rx, rz) || 1;
  rx /= rl;
  rz /= rl;
  // 上 = 右 × 前
  const ux = -rz * fy;
  const uy = rz * fx - rx * fz;
  const uz = rx * fy;
  const m = new Float32Array(16);
  m[0] = rx;
  m[4] = 0;
  m[8] = rz;
  m[1] = ux;
  m[5] = uy;
  m[9] = uz;
  m[2] = -fx;
  m[6] = -fy;
  m[10] = -fz;
  m[12] = -(rx * ex + rz * ez);
  m[13] = -(ux * ex + uy * ey + uz * ez);
  m[14] = fx * ex + fy * ey + fz * ez;
  m[15] = 1;
  return m;
}

/**
 * 透视投影。shiftX、shiftY:画面中心挪多少(-1 … 1,占半个画面的比例;往右、往上为正)——
 * 宽屏左边有卡片,看点要落在卡片右边那一块的正中
 */
export function projMatrix(aspect: number, near: number, far: number, shiftX = 0, shiftY = 0, fov = FOV): Mat4 {
  const f = 1 / Math.tan((fov * Math.PI) / 360);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[8] = -shiftX;
  m[9] = -shiftY;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

export function mul(a: Mat4, b: Mat4): Mat4 {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}

/** 一点投到画面上(-1 … 1,y 朝上);在镜头后面 = null */
export function project(m: Mat4, x: number, y: number, z: number): [number, number] | null {
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  if (w <= 1e-6) return null;
  return [(m[0] * x + m[4] * y + m[8] * z + m[12]) / w, (m[1] * x + m[5] * y + m[9] * z + m[13]) / w];
}

/** 远近两个裁切面:按镜头离看点多远定 */
export function clipPlanes(c: ReliefCam, size: number): [number, number] {
  return [Math.max(0.5, c.dist * 0.05), c.dist + size * 3];
}

/** 刚打开时的角度:电脑从南偏东一点往北看、俯角 28°,四周留一圈空;手机竖屏俯角大一些、视野宽一些,左右顶满(两个近角略出屏) */
export interface FitOpts {
  yaw: number;
  pitch: number;
  fov: number;
  /** 左右、上下各留看得见那一块宽、高的几成 */
  margin: [number, number];
}
export const FIT_DESKTOP: FitOpts = { yaw: 10, pitch: 28, fov: FOV, margin: [0.06, 0.08] };
export const FIT_PHONE: FitOpts = { yaw: 8, pitch: 36, fov: FOV_PHONE, margin: [-0.03, 0.04] };

/**
 * 刚打开时的样子:远近让整块沙盘(连同最高处)落在画面里看得见的那一块。
 * rect = 画面里看得见的那一块(像素:左、上、右、下),W、H = 整个画面
 */
export function fitCam(kmX: number, kmZ: number, top: number, W: number, H: number, rect: [number, number, number, number], o: FitOpts = FIT_DESKTOP): ReliefCam {
  const { margin } = o;
  const cam: ReliefCam = { yaw: o.yaw, pitch: o.pitch, dist: 1, tx: 0, ty: top * 0.25, tz: 0, fov: o.fov };
  const corners: [number, number, number][] = [];
  for (const sx of [-0.5, 0.5]) for (const sz of [-0.5, 0.5]) for (const y of [0, top]) corners.push([sx * kmX, y, sz * kmZ]);
  const [shX, shY] = rectShift(W, H, rect);
  const fits = (d: number) => {
    cam.dist = d;
    const [n, f] = clipPlanes(cam, Math.max(kmX, kmZ));
    const m = mul(projMatrix(W / H, n, f, shX, shY, cam.fov), viewMatrix(cam));
    for (const [x, y, z] of corners) {
      const p = project(m, x, y, z);
      if (!p) return false;
      const px = ((p[0] + 1) / 2) * W;
      const py = ((1 - p[1]) / 2) * H;
      const mx = (rect[2] - rect[0]) * margin[0];
      const my = (rect[3] - rect[1]) * margin[1];
      if (px < rect[0] + mx || px > rect[2] - mx || py < rect[1] + my || py > rect[3] - my) return false;
    }
    return true;
  };
  let lo = Math.max(kmX, kmZ) * 0.2;
  let hi = Math.max(kmX, kmZ) * 20;
  for (let i = 0; i < 40; i++) {
    const mid = Math.sqrt(lo * hi);
    if (fits(mid)) hi = mid;
    else lo = mid;
  }
  cam.dist = hi;
  return cam;
}

/** 看得见的那一块的中心相对整个画面中心挪了多少(给 projMatrix) */
export function rectShift(W: number, H: number, rect: [number, number, number, number]): [number, number] {
  const cx = (rect[0] + rect[2]) / 2;
  const cy = (rect[1] + rect[3]) / 2;
  return [(cx / W) * 2 - 1, 1 - (cy / H) * 2];
}
