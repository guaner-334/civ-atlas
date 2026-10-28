/**
 * 人物关系图的摆法(纯计算,不碰 DOM;RelationGraph.tsx 照它画)。坐标都是图那一块(标题栏下面)里的像素,一个人的 x、y 是他头像的圆心。
 *
 * 电脑(deskLayout):中间一条家谱 —— 父辈在上;兄弟在他上面一排,兄在左、弟在右(各最多 3 格);儿子、侄子在下一排(最多 6 格)。
 *   左边姻亲、作者的人物(作者的人物居中时:其他、经历里写到),右边君臣、对手(师友);一簇一块白底,一簇一根线连回中心那张卡片。
 *   一簇最多 8 格(一边两簇 6 格,三簇 4 格;窗口矮时再少),放不下时留最要紧的(即位的、有冲突的、名气大的),最后一格"还有 N 位"。
 *   兄弟、儿子那几排碰到两边的簇时少放几格。没有家谱的(将领、名臣)卡片挪到中间偏一点,簇挨着它。
 *   多看一层:祖父摆在父亲上面,侄子挂在各自父亲下面;整簇都是隔一层的人时,那根线从经过的那位连过去。
 * 手机(stackLayout;电脑上图那一块太窄时也用):上面家谱(兄弟每边 1 格、儿子一排 4 格),下面一簇一条、左右滑。
 *
 * 线的样子(画的时候按 kind 上样式):血亲实线、姻亲虚线、君臣细线、作者的人物点线(他的颜色);对手和有杀伐的那条是红的;多看一层的淡灰细线。
 */
import { CLUSTER_NAME, INLAW_ORDER, isElder, type Cluster, type RelGraph, type RelNode } from './relationInfo';

export type EdgeKind = Cluster | 'faint' | 'clash';

export interface LNode {
  n: RelNode;
  x: number;
  y: number;
  /** 头像直径 */
  size: number;
  /** 悬停时高亮的那条线(从中心卡片连到他) */
  hover: string;
  /** 悬停说明放在哪一边:−1 左、1 右 */
  side: -1 | 1;
}

export interface LMore {
  k: string;
  x: number;
  y: number;
  size: number;
  /** 还有几位 */
  count: number;
  /** 格子下面那行字:"还有 2 位兄长" */
  label: string;
  /** 点开的名单的标题:"兄长""姻亲" */
  title: string;
  /** 这一簇(这一排)的全部 */
  list: RelNode[];
}

export interface LBlock {
  cluster: Cluster;
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  count: number;
  /** 整簇都是隔一层的人 */
  dim: boolean;
}

export interface LEdge {
  d: string;
  kind: EdgeKind;
  /** 作者的人物那条点线的颜色 */
  color?: string | null;
  /** 线头的小圆点(连到簇的那一头) */
  dot?: [number, number];
}

export interface Layout {
  cx: number;
  cy: number;
  nodes: LNode[];
  mores: LMore[];
  blocks: LBlock[];
  edges: LEdge[];
  /** 图要多高(比那一块高时上下滑) */
  height: number;
}

/** 一簇白底的宽、两格的间距、一行的高 */
export const BLOCK_W = 232;
const CELL_X = 100;
const CELL_Y = 100;
/** 一个人那一格的半宽(名字两行写在头像下面) */
const HALF = 52;
/** 中心卡片的高(电脑 / 手机) */
export const CARD_H = 92;
export const PHONE_CARD_H = 72;
/** 电脑上图那一块窄于这个就换成手机那样上下排 */
export const DESK_MIN_W = 820;

/** 一排人排先后;超过 cap 个时留 cap−1 个(先留即位的、有冲突的、名气大的),最后一格是"还有 N 位"。多看一层的人排在自己的关系后面 */
export function capped(list: readonly RelNode[], cap: number, order: (a: RelNode, b: RelNode) => number): { shown: RelNode[]; more: number; all: RelNode[] } {
  const all = [...list].sort((a, b) => Number(a.dim) - Number(b.dim) || order(a, b));
  const c = Math.max(1, Math.floor(cap));
  if (all.length <= c) return { shown: all, more: 0, all };
  const keep = new Set(
    [...all].sort((a, b) => Number(a.dim) - Number(b.dim) || Number(b.ruler) - Number(a.ruler) || Number(b.clash) - Number(a.clash) || b.fame - a.fame).slice(0, c - 1),
  );
  return { shown: all.filter((n) => keep.has(n)), more: all.length - (c - 1), all };
}

const byBorn = (a: RelNode, b: RelNode) => a.born - b.born;
const bornDesc = (a: RelNode, b: RelNode) => b.born - a.born;
const bySort = (a: RelNode, b: RelNode) => a.sort - b.sort || a.born - b.born;
/** 一簇里的先后:姻亲按外祖父、岳父、女婿、外孙;别的按年份 */
export function clusterOrder(k: Cluster): (a: RelNode, b: RelNode) => number {
  if (k === 'inlaw') return (a, b) => rank(a.word) - rank(b.word) || bySort(a, b);
  return bySort;
}
/** 姻亲的先后(多看一层的"父亲的女婿"按最后的称呼排) */
const rank = (w: string) => {
  const i = INLAW_ORDER.findIndex((t) => w.endsWith(t));
  return i < 0 ? INLAW_ORDER.length : i;
};

/** 下一排点开的名单叫什么 */
const downTitle = (list: RelNode[]) => (list.every((n) => n.word === '子' || n.word === '养子') ? '子嗣' : '晚辈');

const LEFT_K: Cluster[] = ['inlaw', 'author', 'other', 'story'];
const RIGHT_K: Cluster[] = ['court', 'friend', 'rival'];

/** 父母(推演人物的"父""养父";作者人物写的"父亲""母亲""养母"……) */
export const isParent = (n: RelNode) => !n.dim && /^(养?父|[生养义]?父亲|[生养义]?母亲?|[生养义][父母])$/.test(n.word);

/**
 * 上一辈那一排:父母在正中(父亲 dx = 0、母亲在他右边),别的长辈按生年分到两边(比父亲年长的在左);
 * 最多 cap 格,父母一定画出来,放不下的最后一格"还有 N 位"(cells 里 n = null 的那格)
 */
export function upRow(ups: readonly RelNode[], cap: number): { cells: { n: RelNode | null; dx: number }[]; more: number; all: RelNode[] } {
  const parents = ups.filter(isParent).sort((a, b) => Number(/母/.test(a.word)) - Number(/母/.test(b.word)) || a.born - b.born);
  const rest = capped(
    ups.filter((n) => !isParent(n)),
    Math.max(1, cap - parents.length),
    byBorn,
  );
  const all = [...ups].sort((a, b) => Number(a.dim) - Number(b.dim) || a.born - b.born);
  if (!parents.length) {
    const n = rest.shown.length + (rest.more ? 1 : 0);
    const cells = [...rest.shown, ...(rest.more ? [null] : [])].map((c, i) => ({ n: c, dx: i - (n - 1) / 2 }));
    return { cells, more: rest.more, all };
  }
  const cells: { n: RelNode | null; dx: number }[] = parents.map((n, i) => ({ n, dx: i }));
  const pBorn = parents[0].born;
  let l = 0;
  let r = parents.length - 1;
  for (const n of rest.shown) cells.push(!n.dim && n.born < pBorn ? { n, dx: -++l } : { n, dx: ++r });
  if (rest.more) cells.push({ n: null, dx: ++r });
  return { cells, more: rest.more, all };
}

interface Group {
  via: LNode;
  kids: RelNode[];
}

/** 多看一层的人按经过的那位分组(那位摆出来了的才算;从左到右) */
function groupBy(list: readonly RelNode[], pos: Map<string, LNode>): Group[] {
  const by = new Map<string, RelNode[]>();
  for (const n of list) {
    const v = n.via ?? '';
    if (!by.has(v)) by.set(v, []);
    by.get(v)!.push(n);
  }
  const out: Group[] = [];
  for (const [v, kids] of by) {
    const via = pos.get(v);
    if (via) out.push({ via, kids: [...kids].sort((a, b) => a.born - b.born) });
  }
  return out.sort((a, b) => a.via.x - b.via.x);
}

/**
 * 一排多看一层的人:每组照 want 摆在经过的那位附近,两两至少隔 gap、整排平移到离想要的位置最近;
 * 超出 [lo, hi] 就每组少放一位再排,一位都放不下就不放
 */
function placeRow(groups: Group[], want: (g: Group, i: number, n: number) => number, gap: number, [lo, hi]: [number, number]): { g: Group; n: RelNode; x: number; i: number }[] {
  const most = Math.max(0, ...groups.map((g) => g.kids.length));
  for (let per = most; per >= 1; per--) {
    const cells = groups.flatMap((g) => {
      const ks = g.kids.slice(0, per);
      return ks.map((n, i) => ({ g, n, i, w: want(g, i, ks.length) }));
    });
    cells.sort((a, b) => a.w - b.w);
    const xs = cells.map((c) => c.w);
    for (let i = 1; i < xs.length; i++) xs[i] = Math.max(xs[i], xs[i - 1] + gap);
    const shift = cells.reduce((s, c, i) => s + c.w - xs[i], 0) / (cells.length || 1);
    const at = xs.map((x) => Math.round(x + shift));
    if (!at.length || (at[0] - HALF >= lo && at[at.length - 1] + HALF <= hi)) return cells.map((c, i) => ({ g: c.g, n: c.n, x: at[i], i: c.i }));
  }
  return [];
}

/**
 * 电脑:家谱居中、两边分簇。W、H = 图那一块的宽高;cardW = 中心卡片的宽(按字算好的)
 */
export function deskLayout(g: RelGraph, W: number, H: number, cardW: number): Layout {
  const S = (slot: RelNode['slot'] | Cluster) => g.nodes.filter((n) => n.slot === slot);
  const ups = S('up');
  const sames = S('same');
  const downs = S('down');
  const up2 = S('up2');
  const down2 = S('down2');
  const family = ups.length + sames.length + downs.length + up2.length + down2.length > 0;
  const sides: [Cluster[], -1 | 1][] = [
    [LEFT_K.filter((k) => S(k).length), -1],
    [RIGHT_K.filter((k) => S(k).length), 1],
  ];
  const oneSide = !family && (sides[0][0].length === 0) !== (sides[1][0].length === 0);
  const half = cardW / 2;
  // 中心:有家谱的照稿子的高度;没有家谱的上下居中;空的时候偏上(下面写原因)
  const cy = !g.own ? Math.round((H - 216) / 2) : family ? 330 + (up2.length ? 155 : 0) : Math.round((H - 56) / 2);
  const cx = oneSide ? Math.round(W / 2 + (sides[0][0].length ? 144 : -144)) : Math.round(W / 2);
  const yUp = cy - 290;
  const yBar = cy - 214;
  const ySame = cy - 160;
  const cardTop = cy - CARD_H / 2;
  const cardBot = cy + CARD_H / 2;
  const yBar2 = cy + 112;
  const yDown = cy + 178;
  const yUp2 = yUp - 150;
  // 家谱最下面到哪(图比那一块高时上下滑)
  const lowest = down2.length ? (downs.length ? yDown + 150 : cy + 190) + 50 : downs.length ? yDown + 62 : cardBot;
  const HH = Math.max(H, lowest + 60);

  const nodes: LNode[] = [];
  const mores: LMore[] = [];
  const blocks: LBlock[] = [];
  const edges: LEdge[] = [];
  const pos = new Map<string, LNode>();
  const put = (n: RelNode, x: number, y: number, hover: string, side: -1 | 1, size = n.dim ? 36 : 48) => {
    const l: LNode = { n, x, y, size, hover, side };
    nodes.push(l);
    pos.set(n.k, l);
    return l;
  };
  const blood = (n: RelNode | null): EdgeKind => (n && n.dim ? 'faint' : n && n.clash ? 'clash' : 'blood');

  // ---- 两边的簇(先排,家谱那几排让着它们)
  const top = 14;
  const bottom = HH - 48;
  for (const [keys, side] of sides) {
    const nk = keys.length;
    if (!nk) continue;
    const room = (bottom - top - (nk - 1) * 16) / nk;
    const fit = Math.max(1, Math.floor((room - 40) / CELL_Y)) * 2;
    keys.forEach((k, bi) => {
      const list = S(k);
      const cap = Math.min(nk >= 3 ? 4 : nk === 2 ? 6 : 8, fit);
      const C = capped(list, cap, clusterOrder(k));
      const cells = C.shown.length + (C.more ? 1 : 0);
      const bh = 40 + Math.ceil(cells / 2) * CELL_Y;
      const bx = oneSide ? (side < 0 ? cx - 240 - BLOCK_W : cx + 240) : side < 0 ? 22 : W - 22 - BLOCK_W;
      let by: number;
      if (nk === 1) by = Math.max(top, Math.min(cy - bh / 2, bottom - bh));
      else if (bi === 0) by = top;
      else if (bi === nk - 1) by = bottom - bh;
      else by = top + ((bottom - top) * bi) / (nk - 1) - bh / 2;
      by = Math.round(by);
      const dim = list.every((n) => n.dim);
      blocks.push({ cluster: k, x: bx, y: by, w: BLOCK_W, h: bh, title: CLUSTER_NAME[k], count: list.length, dim });
      const xy = (i: number): [number, number] => [bx + 16 + 50 + (i % 2) * CELL_X, by + 40 + 30 + Math.floor(i / 2) * CELL_Y];
      C.shown.forEach((n, i) => {
        const [x, y] = xy(i);
        put(n, x, y, '', side < 0 ? 1 : -1);
      });
      if (C.more) {
        const [x, y] = xy(C.shown.length);
        mores.push({ k: `more-${k}`, x, y, size: 48, count: C.more, label: `还有 ${C.more} 位`, title: CLUSTER_NAME[k], list: C.all });
      }
    });
  }
  /** 一排人在 y 这一行左右最远能放到哪(两边的簇占着的地方让开) */
  const limits = (y0: number, y1: number): [number, number] => {
    let lo = 8;
    let hi = W - 8;
    for (const b of blocks) {
      if (b.y > y1 + 8 || b.y + b.h < y0 - 8) continue;
      if (b.x + b.w / 2 < cx) lo = Math.max(lo, b.x + b.w + 8);
      else hi = Math.min(hi, b.x - 8);
    }
    return [lo, hi];
  };

  // ---- 中心
  // ---- 上一辈:父亲(母亲)在他正上方,家谱线只从父母连下来;别的长辈(叔伯……)按生年分到两边
  const up = upRow(ups, 3);
  for (const c of up.cells) {
    const x = cx + c.dx * 112;
    if (c.n) put(c.n, x, yUp, `M${cx} ${cardTop}V${yBar}H${x}V${yUp + 70}`, x < cx ? -1 : 1);
    else mores.push({ k: 'more-up', x, y: yUp, size: 48, count: up.more, label: `还有 ${up.more} 位`, title: '父辈', list: up.all });
  }
  // 再上一辈(多看一层):父辈上面(祖父在父亲正上方,别的往右排)
  const upGroups = groupBy(up2, pos).filter((g) => g.via.y === yUp);
  placeRow(upGroups, (g, i) => g.via.x + i * 100, 100, limits(yUp2 - 30, yUp2 + 64)).forEach(({ g, n, x, i }) => {
    const d = `M${g.via.x} ${yUp - 26}V${yUp2 + 50}`;
    put(n, x, yUp2, d, x < cx ? -1 : 1);
    if (i === 0) edges.push({ d, kind: 'faint' });
  });

  // ---- 同辈:兄在左、弟在右
  // 多看一层挂侄子时兄弟往外让,竖线不穿过中心卡片(有儿子那一排时不挂侄子)
  const sx0 = !downs.length && down2.some((n) => sames.some((s) => s.k === n.via)) ? 178 : 74;
  const sx = 108;
  const [loS, hiS] = limits(ySame - 30, ySame + 64);
  const fitL = Math.max(1, Math.min(3, Math.floor((cx - sx0 - HALF - loS) / sx) + 1));
  const fitR = Math.max(1, Math.min(3, Math.floor((hiS - cx - sx0 - HALF) / sx) + 1));
  const elders = capped(
    sames.filter((n) => isElder(n.word)),
    fitL,
    bornDesc,
  );
  const youngers = capped(
    sames.filter((n) => !isElder(n.word)),
    fitR,
    byBorn,
  );
  const xs: [number, RelNode | null][] = [];
  for (const [C, side, title] of [
    [elders, -1, '兄长'],
    [youngers, 1, '弟弟'],
  ] as const) {
    C.shown.forEach((n, i) => {
      const x = cx + side * (sx0 + i * sx);
      put(n, x, ySame, `M${cx} ${cardTop}V${yBar}H${x}V${ySame - 28}`, side);
      xs.push([x, n]);
    });
    if (C.more) {
      const x = cx + side * (sx0 + C.shown.length * sx);
      const list = [...C.all].sort(byBorn);
      const w = list.every((n) => n.word.includes(side < 0 ? '兄' : '弟')) ? title : '';
      mores.push({ k: `more-same${side}`, x, y: ySame, size: 48, count: C.more, label: `还有 ${C.more} 位${w}`, title: w || '同辈', list });
      xs.push([x, null]);
    }
  }
  // 家谱线:父 → 横杠 → 兄弟和他
  const parentXs = up.cells.filter((c) => c.n && isParent(c.n)).map((c) => cx + c.dx * 112);
  if (parentXs.length || xs.length) {
    for (const x of parentXs) edges.push({ d: `M${x} ${yUp + 70}V${yBar}`, kind: 'blood' });
    const all = [cx, ...parentXs, ...xs.map((p) => p[0])];
    const lo = Math.min(...all);
    const hi = Math.max(...all);
    if (hi > lo) edges.push({ d: `M${lo} ${yBar}H${hi}`, kind: 'blood' });
    for (const [x, n] of xs) edges.push({ d: `M${x} ${yBar}V${ySame - 28}`, kind: blood(n) });
    edges.push({ d: `M${cx} ${yBar}V${cardTop}`, kind: 'blood' });
  }

  // ---- 下一辈
  const [loD, hiD] = limits(yDown - 30, yDown + 64);
  const fitD = Math.max(1, Math.min(6, Math.floor((Math.min(cx - loD, hiD - cx) - HALF) / 53) + 1));
  const downC = capped(downs, fitD, byBorn);
  const nd = downC.shown.length + (downC.more ? 1 : 0);
  const dxs: [number, RelNode | null][] = [];
  downC.shown.forEach((n, i) => {
    const x = cx + (i - (nd - 1) / 2) * 106;
    put(n, x, yDown, `M${cx} ${cardBot}V${yBar2}H${x}V${yDown - 28}`, x < cx ? -1 : 1);
    dxs.push([x, n]);
  });
  if (downC.more) {
    const x = cx + (nd - 1 - (nd - 1) / 2) * 106;
    mores.push({ k: 'more-down', x, y: yDown, size: 48, count: downC.more, label: `还有 ${downC.more} 位`, title: downTitle(downC.all), list: [...downC.all].sort(byBorn) });
    dxs.push([x, null]);
  }
  if (dxs.length) {
    edges.push({ d: `M${cx} ${cardBot}V${yBar2}`, kind: 'blood' });
    const lo = Math.min(...dxs.map((d) => d[0]));
    const hi = Math.max(...dxs.map((d) => d[0]));
    if (hi > lo) edges.push({ d: `M${lo} ${yBar2}H${hi}`, kind: 'blood' });
    for (const [x, n] of dxs) edges.push({ d: `M${x} ${yBar2}V${yDown - 28}`, kind: blood(n) });
  }
  // 再下一辈(多看一层):孙子在儿子那一排下面;没有儿子那一排时侄子挂在兄弟下面、往外排。一排里按各自的父亲从左到右,挤不下的少放
  const groups = groupBy(down2, pos);
  const rowOf = (via: LNode) => (via.y === yDown ? yDown + 150 : cy + 190);
  for (const [gs, outward] of [
    [groups.filter((g) => g.via.y === yDown), false],
    [downs.length ? [] : groups.filter((g) => g.via.y === ySame), true],
  ] as const) {
    if (!gs.length) continue;
    const yy = rowOf(gs[0].via);
    const placed = placeRow(gs, (g, i, n) => (outward ? g.via.x + (g.via.x < cx ? -1 : 1) * (i * 92 + 30) : g.via.x + (i - (n - 1) / 2) * 92), 92, limits(yy - 30, yy + 64));
    for (const g of gs) {
      const mine = placed.filter((p) => p.g === g);
      if (!mine.length) continue;
      const vp = g.via;
      const top2 = vp.y + 72;
      const xs2 = mine.map((p) => p.x);
      edges.push({ d: `M${vp.x} ${top2}V${yy - 50}`, kind: 'faint' });
      edges.push({ d: `M${Math.min(vp.x, ...xs2)} ${yy - 50}H${Math.max(vp.x, ...xs2)}`, kind: 'faint' });
      for (const p of mine) {
        put(p.n, p.x, yy, `M${vp.x} ${top2}V${yy - 50}H${p.x}V${yy - 20}`, p.x < cx ? -1 : 1);
        edges.push({ d: `M${p.x} ${yy - 50}V${yy - 20}`, kind: 'faint' });
      }
    }
  }

  // ---- 簇连回中心:从卡片侧边(整簇隔一层的从经过的那位)连到这一簇
  for (const b of blocks) {
    const side = b.x + b.w / 2 < cx ? -1 : 1;
    const list = S(b.cluster);
    const viaNode = b.dim && list[0]?.via ? pos.get(list[0].via) : undefined;
    const ex = side < 0 ? b.x + b.w : b.x;
    const ey = b.y + Math.min(b.h / 2, 120);
    const kind: EdgeKind = b.dim ? 'faint' : b.cluster;
    const color = b.cluster === 'author' ? list.find((n) => n.color)?.color : null;
    if (viaNode) {
      const sx1 = viaNode.x + side * 30;
      const tx = b.x + b.w / 2;
      edges.push({ d: `M${sx1} ${viaNode.y}C${tx} ${viaNode.y} ${tx} ${viaNode.y} ${tx} ${b.y}`, kind, dot: [tx, b.y] });
    } else {
      const sx1 = cx + side * half;
      const mx = (sx1 + ex) / 2;
      edges.push({ d: `M${sx1} ${cy}C${mx} ${cy} ${mx} ${ey} ${ex} ${ey}`, kind, color, dot: [ex, ey] });
    }
    // 悬停:从卡片侧边连到这一格(整簇隔一层的从经过的那位)
    for (const l of nodes) {
      if (l.n.cluster !== b.cluster || l.hover || l.x < b.x || l.x > b.x + b.w || l.y < b.y || l.y > b.y + b.h) continue;
      const ex2 = l.x - side * 28;
      if (viaNode) {
        const sx1 = viaNode.x + side * 30;
        l.hover = `M${sx1} ${viaNode.y}C${l.x} ${viaNode.y} ${l.x} ${viaNode.y} ${l.x} ${l.y - 28}`;
      } else {
        const sx1 = cx + side * half;
        const mx = (sx1 + ex2) / 2;
        l.hover = `M${sx1} ${cy}C${mx} ${cy} ${mx} ${l.y} ${ex2} ${l.y}`;
      }
    }
  }
  return { cx, cy, nodes, mores, blocks, edges, height: HH };
}

// ---------------------------------------------------------------------------
// 手机:上面家谱,下面一簇一条

export interface Strip {
  cluster: Cluster;
  title: string;
  list: RelNode[];
}

export interface StackLayout extends Layout {
  /** 下面一簇一条从哪儿开始(家谱那一块的高) */
  stripsTop: number;
  strips: Strip[];
}

const STRIP_K: Cluster[] = ['inlaw', 'court', 'rival', 'author', 'friend', 'other', 'story'];

/** 手机(或电脑上图那一块太窄):W = 宽;top = 上面留给路径那一行的高 */
export function stackLayout(g: RelGraph, W: number, top: number): StackLayout {
  const S = (slot: RelNode['slot'] | Cluster) => g.nodes.filter((n) => n.slot === slot);
  const cx = Math.round(W / 2);
  const up = upRow([...S('up'), ...S('up2')], 2);
  const sames = S('same');
  const spine = up.all.length + sames.length > 0;
  const yUp = 62 + top;
  const yBar = 124 + top;
  const ySame = 168 + top;
  // 没有家谱的卡片在最上面(一位关系都没有的往下挪,下面写原因)
  const cy = (spine ? (sames.length ? 286 : 210) : g.own ? 76 : 206) + top;
  const half = PHONE_CARD_H / 2;
  const yBar2 = cy + 66;
  const yDown = cy + 114;
  const nodes: LNode[] = [];
  const mores: LMore[] = [];
  const edges: LEdge[] = [];
  const put = (n: RelNode, x: number, y: number, hover: string) => nodes.push({ n, x, y, size: 44, hover, side: x < cx ? -1 : 1 });
  // 父母在正中,别的长辈在两边(手机上最多 2 格)
  for (const c of up.cells) {
    const x = cx + c.dx * 90;
    if (c.n) put(c.n, x, yUp, '');
    else mores.push({ k: 'more-up', x, y: yUp, size: 44, count: up.more, label: `还有 ${up.more} 位`, title: '父辈', list: up.all });
  }
  const parentXs = up.cells.filter((c) => c.n && isParent(c.n)).map((c) => cx + c.dx * 90);
  const xs: number[] = [];
  for (const [list, side, title, order] of [
    [sames.filter((n) => isElder(n.word)), -1, '兄长', bornDesc],
    [sames.filter((n) => !isElder(n.word)), 1, '弟弟', byBorn],
  ] as const) {
    if (!list.length) continue;
    // 每边 1 格,多了第二格是"还有 N 位"(正好两位就都画出来)
    const C = capped(list, 2, order);
    C.shown.forEach((n, i) => {
      put(n, cx + side * (92 + i * 82), ySame, '');
      xs.push(cx + side * (92 + i * 82));
    });
    if (C.more) {
      const all = [...C.all].sort(byBorn);
      const x = cx + side * (92 + C.shown.length * 82);
      mores.push({ k: `more-same${side}`, x, y: ySame, size: 44, count: C.more, label: `还有 ${C.more} 位`, title: all.every((n) => n.word.includes(side < 0 ? '兄' : '弟')) ? title : '同辈', list: all });
      xs.push(x);
    }
  }
  if (parentXs.length || xs.length) {
    for (const x of parentXs) edges.push({ d: `M${x} ${yUp + 64}V${yBar}`, kind: 'blood' });
    const lo = Math.min(cx, ...parentXs, ...xs);
    const hi = Math.max(cx, ...parentXs, ...xs);
    if (hi > lo) edges.push({ d: `M${lo} ${yBar}H${hi}`, kind: 'blood' });
    for (const x of xs) edges.push({ d: `M${x} ${yBar}V${ySame - 26}`, kind: 'blood' });
    edges.push({ d: `M${cx} ${yBar}V${cy - half - 4}`, kind: 'blood' });
  }
  const downs = capped([...S('down'), ...S('down2')], 4, byBorn);
  const nd = downs.shown.length + (downs.more ? 1 : 0);
  const dx: number[] = [];
  downs.shown.forEach((n, i) => {
    const x = cx + (i - (nd - 1) / 2) * 88;
    put(n, x, yDown, '');
    dx.push(x);
  });
  if (downs.more) {
    const x = cx + (nd - 1 - (nd - 1) / 2) * 88;
    mores.push({ k: 'more-down', x, y: yDown, size: 44, count: downs.more, label: `还有 ${downs.more} 位`, title: downTitle(downs.all), list: [...downs.all].sort(byBorn) });
    dx.push(x);
  }
  if (dx.length) {
    edges.push({ d: `M${cx} ${cy + half + 4}V${yBar2}`, kind: 'blood' });
    if (dx.length > 1) edges.push({ d: `M${Math.min(...dx)} ${yBar2}H${Math.max(...dx)}`, kind: 'blood' });
    for (const x of dx) edges.push({ d: `M${x} ${yBar2}V${yDown - 25}`, kind: 'blood' });
  }
  const strips: Strip[] = [];
  for (const k of STRIP_K) {
    const list = S(k);
    if (!list.length) continue;
    const order = clusterOrder(k);
    strips.push({ cluster: k, title: CLUSTER_NAME[k], list: [...list].sort((a, b) => Number(a.dim) - Number(b.dim) || order(a, b)) });
  }
  const stripsTop = dx.length ? yDown + 92 : cy + half + 34;
  return { cx, cy, nodes, mores, blocks: [], edges, height: stripsTop, stripsTop, strips };
}
