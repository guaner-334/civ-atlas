/**
 * 滚轮事件归成"缩放"还是"平移"(纯计算,不碰 DOM,单测直接测)。和 Mac 自带的「地图」一样:
 *
 *   触控板两指滑动        → 平移(松手后系统接着发的惯性滚动也跟着滑)
 *   触控板两指捏合        → 缩放,跟着手指走(浏览器把捏合报成按着 Ctrl 的滚轮,deltaY = −100·ln(两指张开的倍数))
 *   鼠标滚轮              → 缩放(和以前一样;横向滚轮 / Shift + 滚轮不动地图)
 *   按住 ⌘ / Ctrl / Option 再滑 → 缩放(Magic Mouse、被当成触控板的顺滑滚轮也能缩放)
 *
 * 浏览器不说是触控板还是鼠标,只能看数值猜。一串连着的滚动(相邻两下不超过 GAP_MS)按开头定下来,中途不改
 * (惯性滚动的数值越来越小,不能让它半路变成别的):
 *   - 按行 / 按页滚(deltaMode ≠ 0,Firefox 的鼠标)、一下 ≥ 50 像素、正好是 Mac 鼠标一格(4.000244140625 像素)
 *     或 Windows 一行(100 / 3 像素)的整数倍 → 鼠标
 *   - 带横向分量(没按 Shift)或者别的小数值 → 触控板
 * 猜错的代价:顺滑滚动的鼠标(装了平滑滚动软件的)会被当成触控板,滚轮变成上下平移;按住 ⌘ 再滚就是缩放。
 *
 * 读 deltaMode 要在读 deltaX / deltaY 之前:Firefox 看谁先被读,先读 deltaMode 才报真实的"按行",否则全换算成像素
 * (换算成的像素和触控板分不开)。
 */

export interface WheelSample {
  deltaMode: number;
  deltaX: number;
  deltaY: number;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  /** 事件时间(毫秒,单调递增就行) */
  t: number;
}

export type WheelAction = { kind: 'zoom'; f: number } | { kind: 'pan'; dx: number; dy: number };

/** 一串滚动里相邻两下隔多久算断开(毫秒) */
export const GAP_MS = 300;
/** 鼠标滚轮:每像素缩放多少(和以前一样,Windows 上一格 100 像素 ≈ 1.16 倍) */
export const WHEEL_RATE = 0.0015;
/** 捏合:deltaY = −100·ln(倍数),按 1 / 100 换回去就正好跟手 */
export const PINCH_RATE = 0.01;
/** 一下最多缩放多少倍(防一下子跳太远) */
const MAX_STEP = 2;
/** 一行 / 一页折成多少像素(按行滚的鼠标) */
const LINE_PX = 40;
const PAGE_PX = 800;
/** Mac 上 Chrome、Safari 的鼠标滚轮慢慢转一格的像素数(转得快是它的整数倍) */
export const MAC_TICK = 4.000244140625;
/** Windows 上 Chrome 的滚轮一行(系统设置每格滚 1 行、2 行时一格就是它的 1、2 倍) */
const WIN_LINE = 100 / 3;
/** 一下这么多像素只会是鼠标滚轮(触控板一串滚动的头几下都很小) */
const MOUSE_MIN = 50;

const multipleOf = (a: number, unit: number) => {
  const n = Math.round(a / unit);
  return n >= 1 && Math.abs(a - n * unit) < 1e-4;
};

/**
 * 这一下一定是鼠标滚轮转了几格:按行 / 按页滚,正好是 Mac 一格、Windows 一行的整数倍,或者 ≥ 50 的整数像素
 * (捏合的读数是 100·ln 倍数,几乎不会是整数;捏得快时一下也能到四五十)
 */
export function wheelTick(mode: number, dy: number): boolean {
  if (mode !== 0) return true;
  const a = Math.abs(dy);
  return multipleOf(a, MAC_TICK) || multipleOf(a, WIN_LINE) || (a >= MOUSE_MIN && Number.isInteger(a));
}

/** 一串滚动开头这一下像不像鼠标滚轮(dy 已经折成像素):除了上面那些,≥ 50 像素的也算 */
export function mouseLike(mode: number, dy: number): boolean {
  return wheelTick(mode, dy) || Math.abs(dy) >= MOUSE_MIN;
}

const clampStep = (f: number) => (Number.isFinite(f) ? Math.min(MAX_STEP, Math.max(1 / MAX_STEP, f)) : 1);

/**
 * 一个读滚轮的"读头"(地图、地球仪各用一个):每来一下滚轮交给它,返回这一下该缩放还是平移。
 * dx / dy 是内容该往反方向挪的像素(和网页滚动同向:两指往上推 = dy > 0 = 地图往上走);null = 什么都不做
 */
export function createWheelReader() {
  let kind: 'mouse' | 'trackpad' | null = null;
  let last = -Infinity;
  return (e: WheelSample): WheelAction | null => {
    const mode = e.deltaMode;
    const unit = mode === 1 ? LINE_PX : mode === 2 ? PAGE_PX : 1;
    const dx = e.deltaX * unit;
    const dy = e.deltaY * unit;
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
    if (e.t - last > GAP_MS) kind = null;
    last = e.t;
    // 捏合、按着修饰键:缩放。鼠标滚轮按老的比例,捏合 / 触控板按跟手的比例
    if (e.ctrlKey || e.metaKey || e.altKey) {
      if (!dy) return null;
      return { kind: 'zoom', f: clampStep(Math.exp(-dy * (wheelTick(mode, dy) ? WHEEL_RATE : PINCH_RATE))) };
    }
    if (kind === null) {
      if (dx && !e.shiftKey) kind = 'trackpad';
      else if (dy) kind = mouseLike(mode, dy) ? 'mouse' : 'trackpad';
      else return null;
    } else if (kind === 'mouse' && dx && !e.shiftKey && mode === 0) {
      // 开头一下很大、看着像鼠标,接着出现了横向分量:其实是触控板甩得快
      kind = 'trackpad';
    }
    if (kind === 'trackpad') return dx || dy ? { kind: 'pan', dx, dy } : null;
    return dy ? { kind: 'zoom', f: clampStep(Math.exp(-dy * WHEEL_RATE)) } : null;
  };
}

/** 捏合(按着 Ctrl 的一下,数值又不像鼠标滚轮):网页别的地方收到它也不让浏览器放大整个页面 */
export function isPinchLike(e: Pick<WheelSample, 'deltaMode' | 'deltaY' | 'ctrlKey'>): boolean {
  if (!e.ctrlKey) return false;
  const mode = e.deltaMode;
  return !wheelTick(mode, e.deltaY);
}

/** 捏合倍数 → 一下 Ctrl 滚轮的 deltaY(Safari 的捏合、右下角的 + − 转成滚轮交给地球仪用) */
export const pinchDelta = (f: number) => -Math.log(f) / PINCH_RATE;

/**
 * Safari 的触控板捏合不发 Ctrl 滚轮,发 gesturestart / gesturechange(App 接住转成缩放)。
 * 万一同时也发了 Ctrl 滚轮,捏合进行中真实的 Ctrl 滚轮不再算一遍
 */
let gesturePinch = false;
export const setGesturePinch = (on: boolean) => {
  gesturePinch = on;
};
export const inGesturePinch = () => gesturePinch;

/** WheelEvent → WheelSample(先读 deltaMode,见文件开头) */
export function wheelSample(e: WheelEvent): WheelSample {
  const deltaMode = e.deltaMode;
  return { deltaMode, deltaX: e.deltaX, deltaY: e.deltaY, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, shiftKey: e.shiftKey, t: e.timeStamp };
}
