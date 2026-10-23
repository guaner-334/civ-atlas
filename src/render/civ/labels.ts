/**
 * 文明叠加层 · 地图文字的数据来源:把 civ 里的东西变成一条条 LabelItem(和城镇符号 LabelMark),
 * 交给 render/labels/draw.ts 排版、避让、画。
 *
 *   地理名 —— 海洋、山脉、大河、湖泊、大岛、荒漠(civ.places;civLabelItems,不随年份变)
 *   国名、城名、城镇符号(civMapLayer,随年份变)—— 国名的摆法见 labels/polity.ts,
 *         城名的门槛、优先级、8 个方位见 labels/settlements.ts,符号画法见 civ/settlements.ts
 *   阶段 3 城市兴衰:故城遗址(毁了、还没重建的城)的记号和名字("古某城"),排在所有城镇之后、放大才出现
 *
 * 字号层级(CSS 像素,地图按 1300 像素宽显示、缩放 1 倍时)—— 按世界地图集的比例:大洋名大而疏排,海、湾依次小,
 * 山脉、荒漠、岛、河湖接近正文字号;放大地图时字号按 k^grow 变大(比地图放大得慢):
 *   国名 12–26(按国土拟合)· 大洋 19 · 海 14.5 / 12.5 / 11.5 · 湾 11.5 / 11 / 10.5 · 山脉 13 / 11.5 / 10.5 · 荒漠 13 / 11.5 / 10.5
 *   · 岛 12 / 11 / 10.5 · 国都 13.5 · 大城 12 · 城 11.5 · 河、湖 11.5 / 11 / 10.5 · 镇、村 10.5
 * 显示门槛:rank 1 总览就显示;rank 2 放大到 1.8 倍;rank 3 放大到 3 倍。城镇见 labels/settlements.ts。
 */
import type { Civ, Place } from '../../gen/civ/types';
import type { World } from '../../gen/world';
import type { Raster } from '../../gen/raster';
import { capitalAt, polityAlive, polityAllTitles } from '../../gen/civ/growth';
import { FONT_FANTASY, FONT_REALISTIC } from '../labels/fonts';
import { MIN_LABEL_PX, REF_MAP_CSS, SURFACE, type LabelItem, type LabelMark, type LabelView } from '../labels/draw';
import { ownerAtPoint, polityCandidates, polityLabels, polityOwnerGrid, territoryGrid, type ShapeFit } from '../labels/polity';
import { shapeLabelFit } from '../labels/shape';
import { cellPolygons } from '../marks';
import { cultureLabel, regionLabel, regionNamed } from '../../gen/civ/display';
import { NAME_GROW, NAME_MIN_ZOOM, NAME_PRIORITY, NAME_SIZE, SYMBOL_MIN_ZOOM, SYMBOL_PRIORITY, settlementNameItem } from '../labels/settlements';
import { RUIN, SYMBOL_BOX, SYMBOL_GROW, ruinsAt, settlementsAt, type SettlementMarkInfo } from './settlements';
import type { CivDrawParams, CivStyle } from './overlay';
import { nearX, wrapOf } from '../common';
import type { MapProj } from '../projection';
import type { Candidate } from '../labels/layout';
import { groupLabels, groupOwnerGrid } from '../labels/groups';
import { cultureNamesLead, cultureNamesOn, polityNamesLead, polityNamesOn } from './show';

const MIN_ZOOM = [1, 1, 1.8, 3];

type Kind = Place['kind'] | 'ocean' | 'bay';

interface Look {
  color: string;
  halo?: { color: string; width: number };
  weight: number;
  slant?: number;
}

const PAPER_HALO = 'rgba(241, 230, 201, 0.9)';

/** 两种画风各自的文字颜色 / 光晕 / 字重 */
const LOOKS: Record<'fantasy' | 'realistic' | 'data', Record<Kind, Look>> = {
  // 手绘风:墨色楷体,文字周围一圈纸色光晕;水系用靛蓝墨
  fantasy: {
    ocean: { color: 'rgba(44, 76, 92, 0.72)', weight: 500, halo: { color: 'rgba(176, 198, 197, 0.55)', width: 2 } },
    sea: { color: 'rgba(44, 76, 92, 0.78)', weight: 500, halo: { color: 'rgba(176, 198, 197, 0.55)', width: 2 } },
    bay: { color: 'rgba(44, 76, 92, 0.85)', weight: 500, halo: { color: 'rgba(176, 198, 197, 0.6)', width: 2 } },
    mountains: { color: 'rgb(78, 52, 32)', weight: 500, halo: { color: PAPER_HALO, width: 2.6 } },
    desert: { color: 'rgb(122, 84, 40)', weight: 500, halo: { color: PAPER_HALO, width: 2.4 } },
    island: { color: 'rgb(58, 45, 34)', weight: 500, halo: { color: PAPER_HALO, width: 2.4 } },
    river: { color: 'rgb(38, 78, 116)', weight: 500, halo: { color: PAPER_HALO, width: 2.2 } },
    lake: { color: 'rgb(38, 78, 116)', weight: 500, halo: { color: PAPER_HALO, width: 2.2 } },
  },
  // 写实风:宋体,半透明白色描边;海名用浅色、不描边(深色海面上本身就清楚),水系字向右斜(地图惯例)
  realistic: {
    ocean: { color: 'rgba(205, 225, 240, 0.78)', weight: 500, slant: 0.2, halo: { color: 'rgba(10, 34, 58, 0.35)', width: 1.6 } },
    sea: { color: 'rgba(205, 225, 240, 0.82)', weight: 500, slant: 0.2, halo: { color: 'rgba(10, 34, 58, 0.35)', width: 1.6 } },
    bay: { color: 'rgba(214, 232, 245, 0.88)', weight: 500, slant: 0.2, halo: { color: 'rgba(10, 34, 58, 0.4)', width: 1.6 } },
    mountains: { color: 'rgb(62, 42, 26)', weight: 700, halo: { color: 'rgba(255, 255, 255, 0.62)', width: 2.4 } },
    desert: { color: 'rgb(104, 64, 24)', weight: 700, halo: { color: 'rgba(255, 255, 255, 0.6)', width: 2.4 } },
    island: { color: 'rgb(34, 34, 30)', weight: 700, halo: { color: 'rgba(255, 255, 255, 0.62)', width: 2.2 } },
    river: { color: 'rgb(20, 70, 122)', weight: 500, slant: 0.2, halo: { color: 'rgba(255, 255, 255, 0.66)', width: 2.2 } },
    lake: { color: 'rgb(20, 70, 122)', weight: 500, slant: 0.2, halo: { color: 'rgba(255, 255, 255, 0.66)', width: 2.2 } },
  },
  // 数据图层:底色五颜六色,一律深色字 + 白描边
  data: {
    ocean: { color: 'rgba(16, 40, 64, 0.85)', weight: 500, slant: 0.2, halo: { color: 'rgba(255, 255, 255, 0.6)', width: 2 } },
    sea: { color: 'rgba(16, 40, 64, 0.85)', weight: 500, slant: 0.2, halo: { color: 'rgba(255, 255, 255, 0.6)', width: 2 } },
    bay: { color: 'rgba(16, 40, 64, 0.85)', weight: 500, slant: 0.2, halo: { color: 'rgba(255, 255, 255, 0.6)', width: 2 } },
    mountains: { color: 'rgb(40, 30, 20)', weight: 700, halo: { color: 'rgba(255, 255, 255, 0.7)', width: 2.2 } },
    desert: { color: 'rgb(70, 44, 16)', weight: 700, halo: { color: 'rgba(255, 255, 255, 0.7)', width: 2.2 } },
    island: { color: 'rgb(30, 30, 30)', weight: 700, halo: { color: 'rgba(255, 255, 255, 0.7)', width: 2.2 } },
    river: { color: 'rgb(16, 56, 104)', weight: 500, slant: 0.2, halo: { color: 'rgba(255, 255, 255, 0.7)', width: 2 } },
    lake: { color: 'rgb(16, 56, 104)', weight: 500, slant: 0.2, halo: { color: 'rgba(255, 255, 255, 0.7)', width: 2 } },
  },
};

/** 字号 [rank 1, 2, 3]、字距、放大时字号增长幂、优先级基数 */
const TYPE: Record<Kind, { size: [number, number, number]; tracking: [number, number]; grow: number; priority: number }> = {
  ocean: { size: [19, 16.5, 14.5], tracking: [1.4, 3.2], grow: 0.5, priority: 100 },
  sea: { size: [14.5, 12.5, 11.5], tracking: [0.8, 1.9], grow: 0.5, priority: 88 },
  bay: { size: [11.5, 11, 10.5], tracking: [0.3, 0.9], grow: 0.5, priority: 60 },
  mountains: { size: [13, 11.5, 10.5], tracking: [0.4, 1.4], grow: 0.45, priority: 92 },
  desert: { size: [13, 11.5, 10.5], tracking: [0.5, 1.4], grow: 0.45, priority: 84 },
  island: { size: [12, 11, 10.5], tracking: [0.1, 0.6], grow: 0.4, priority: 80 },
  river: { size: [11.5, 11, 10.5], tracking: [0.12, 0.12], grow: 0.35, priority: 76 },
  lake: { size: [11.5, 11, 10.5], tracking: [0.05, 0.05], grow: 0.35, priority: 72 },
};

function kindOf(p: Place): Kind {
  // 用户改过名的(阶段 4)按原来的名字分:改了名的大洋照旧按大洋写
  const name = p.defaultName ?? p.name;
  if (p.kind === 'sea') return name.endsWith('洋') ? 'ocean' : name.endsWith('湾') ? 'bay' : 'sea';
  return p.kind;
}

/** 地理名 → 标注 */
export function placeLabelItems(places: Place[], style: CivStyle): LabelItem[] {
  const looks = LOOKS[style];
  const family = style === 'fantasy' ? FONT_FANTASY : FONT_REALISTIC;
  return places.map((p, id) => {
    const kind = kindOf(p);
    const t = TYPE[kind];
    const look = looks[kind];
    const rank = Math.max(1, Math.min(3, Math.round(p.rank)));
    const item: LabelItem = {
      text: p.name,
      path: p.path,
      layout: 'line',
      size: t.size[rank - 1],
      grow: t.grow,
      tracking: t.tracking,
      minZoom: MIN_ZOOM[rank],
      // 同一级里,大的先放
      priority: t.priority - (rank - 1) * 30 + Math.min(9, Math.log2(1 + (p.size ?? 0)) * 0.8),
      family,
      weight: look.weight,
      color: look.color,
      halo: look.halo,
      slant: look.slant,
      pick: { kind: 'place', id },
    };
    switch (p.kind) {
      case 'sea':
        item.on = SURFACE.sea;
        item.tolerance = 0.06;
        break;
      case 'mountains':
        item.layout = 'curve';
        item.on = SURFACE.land | SURFACE.lake;
        item.tolerance = 0.08;
        break;
      case 'desert':
        // 字号按世界地图比例变小以后,一条穿过荒漠的河在字下面占的比例变大了:余量给到和山脉一样
        item.on = SURFACE.land | SURFACE.lake;
        item.tolerance = 0.08;
        break;
      case 'island':
        // 岛大就写在岛上,放不下就写在岛旁边的海上
        item.on = SURFACE.land | SURFACE.lake;
        item.radius = p.size ?? 0;
        item.around = SURFACE.sea;
        break;
      case 'river':
        // 字排在河的一侧;河道蒙版是格子化的,紧贴自己那条河的采样点难免擦到一点,给一点余量
        item.layout = 'river';
        item.on = SURFACE.land | SURFACE.lake;
        item.radius = p.size ?? 0;
        item.tolerance = 0.06;
        break;
      case 'lake':
        item.layout = 'point';
        item.inside = SURFACE.lake;
        item.on = SURFACE.land;
        item.radius = (p.size ?? 0) * 0.9;
        item.tolerance = 0.04;
        break;
    }
    return item;
  });
}

/** 地理名:不随年份变。"地名"关掉时为空;打开了「州」时加上州名 */
export function civLabelItems(p: CivDrawParams): LabelItem[] {
  if (!p.show.labels) return [];
  const items = placeLabelItems(p.civ.places, p.style);
  return p.show.regions ? items.concat(regionLabelItems(p)) : items;
}

// ---------------------------------------------------------------------------
// 州名(打开「州」时)

/** 州名:字号(CSS 像素,参照宽度、缩放 1 倍)、放大时字号增长幂、从几倍出现、优先级(最低:城镇、村子、山河湖海的名字都放好了再放)、字距(疏排) */
const REGION_NAME = { size: 10, grow: 0.25, minZoom: 2.4, priority: 8 };
const REGION_TRACKING: [number, number] = [0.35, 1.8];

/** 州名的颜色:比地理名淡一点(州是底下的一层) */
const REGION_LOOK: Record<'fantasy' | 'realistic' | 'data', Look> = {
  fantasy: { color: 'rgba(96,72,50,0.85)', weight: 500, halo: { color: PAPER_HALO, width: 2.2 } },
  realistic: { color: 'rgba(46,40,34,0.85)', weight: 500, halo: { color: 'rgba(255,255,255,0.6)', width: 2 } },
  data: { color: 'rgba(30,30,30,0.85)', weight: 500, halo: { color: 'rgba(255,255,255,0.7)', width: 2 } },
};

/** 每个州的名字顺着州的形状排的路径(世界坐标):按州划分存,名字字数变了(改名)再算 */
const regionFits = new WeakMap<Civ['regions'], Map<number, { n: number; fit: ShapeFit | null }>>();

function regionFit(world: World, civ: Civ, r: number, n: number): ShapeFit | null {
  let m = regionFits.get(civ.regions);
  if (!m) regionFits.set(civ.regions, (m = new Map()));
  const hit = m.get(r);
  if (hit && hit.n === n) return hit.fit;
  const R = civ.regions;
  const cells: number[] = [];
  for (let k = R.cellStart[r]; k < R.cellStart[r + 1]; k++) cells.push(R.cells[k]);
  const ref = world.mesh.x[R.seat[r]];
  const polys = cellPolygons(world.mesh, cells, ref);
  let fit: ShapeFit | null = null;
  if (polys.length) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of polys) {
      for (let i = 0; i < p.length; i += 2) {
        if (p[i] < x0) x0 = p[i];
        if (p[i] > x1) x1 = p[i];
        if (p[i + 1] < y0) y0 = p[i + 1];
        if (p[i + 1] > y1) y1 = p[i + 1];
      }
    }
    fit = shapeLabelFit(polys, [x0, y0, x1, y1], n);
  }
  m.set(r, { n, fit });
  return fit;
}

/**
 * 州名:有名字的州,名字顺着州的形状排(狭长的州顺着长的方向、略带弧度,很窄很高的竖排),疏排;
 * 放大到州在画面上放得下名字时才出现(放不下就不写),排在城名之后。每个字要落在本州里(查州栅格)
 */
function regionLabelItems(p: CivDrawParams): LabelItem[] {
  const { civ, world, raster } = p;
  const look = REGION_LOOK[p.style === 'fantasy' ? 'fantasy' : p.style === 'realistic' ? 'realistic' : 'data'];
  const family = p.style === 'fantasy' ? FONT_FANTASY : FONT_REALISTIC;
  const grid = territoryGrid(world, raster, civ);
  const owner = { grid, owner: grid.region };
  const out: LabelItem[] = [];
  for (let r = 0; r < civ.regions.count; r++) {
    if (!regionNamed(civ, r)) continue;
    const text = regionLabel(civ, r);
    const fit = regionFit(world, civ, r, [...text].length);
    if (!fit) continue;
    out.push({
      text,
      path: fit.path,
      layout: 'curve',
      size: REGION_NAME.size,
      grow: REGION_NAME.grow,
      tracking: REGION_TRACKING,
      minZoom: REGION_NAME.minZoom,
      priority: REGION_NAME.priority,
      family,
      weight: look.weight,
      color: look.color,
      halo: look.halo,
      area: (wx, wy) => ownerAtPoint(owner, wx, wy) === r,
      tolerance: 0.15,
      space: 0.3,
      place: (px, view) => polityCandidates(text, fit.path, px, REGION_TRACKING, view, fit.vertical, MIN_LABEL_PX * view.dpr),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 国名、城名、城镇符号(随年份变)

/** 回放时国名每隔多少年重新拟合一次 */
const FAST_STEP = 20;
/** 回放时按当年国土核对国名:每个采样点周围这么远(世界单位)以内也得是本国的(拟合时的位置不一定离新国界够远) */
const LOST_MARGIN = 3;
/** 国名:放大地图时字号跟着长的幂(比国土长得慢,放大后照样在国土里) */
const POLITY_GROW = 0.45;
/** 国名字距(字宽的倍数)[最小, 最大]:大字疏排 */
const POLITY_TRACKING: [number, number] = [0.5, 2.4];

const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
/** 本国颜色往墨色里调:国名带一点本国的颜色,又足够深、认得清 */
function inkOf(c: [number, number, number], ink: [number, number, number], t: number, alpha: number): string {
  return `rgba(${clamp255(c[0] * (1 - t) + ink[0] * t)},${clamp255(c[1] * (1 - t) + ink[1] * t)},${clamp255(c[2] * (1 - t) + ink[2] * t)},${alpha})`;
}

/** 国名越小越要清楚:0 = 大字(≥ 18 CSS 像素),1 = 最小的字 */
const smallness = (css: number) => Math.max(0, Math.min(1, (18 - css) / 7));

/**
 * 配角名(不是跟着填色的那种名字,如信仰、时代、民族填色上写的国名):小一号(主角的七成,最大 15 CSS 像素)、
 * 灰墨不带颜色、字距收紧;排在国都名之后、城镇符号之前(排在符号之后几乎放不上);四周多留白(两个字宽),
 * 不和别的大字排成一行、读成一个名字
 */
const SIDE_SCALE = 0.7;
const SIDE_MAX_CSS = 15;
const SIDE_PRIORITY = 100.1;
const SIDE_SPACE = 2;
const SIDE_TRACKING: [number, number] = [0.3, 1.1];
/** 配角名先试正中,再往上下(竖排的往左右)挪开一两个字高:正中多半已经有别的大字 */
const SIDE_SHIFTS = [0, 1.9, -1.9, 3, -3, 4.2, -4.2];
function* sideShift(gen: () => Iterable<Candidate>, px: number, vertical = false): Generator<Candidate> {
  for (const s of SIDE_SHIFTS) {
    for (const c of gen()) {
      if (!s) yield c;
      else {
        const d = s * (c.px ?? px);
        yield { ...c, glyphs: c.glyphs.map((g) => (vertical ? { ...g, x: g.x + d } : { ...g, y: g.y + d })) };
      }
    }
  }
}
/** 配角名一律灰墨(手绘:纸色光晕;别的底图:白光晕),不加粗 */
function sideLook(style: CivStyle): Look {
  return style === 'fantasy'
    ? { color: 'rgba(96, 82, 68, 0.88)', weight: 500, halo: { color: 'rgba(241, 230, 201, 0.82)', width: 2.2 } }
    : { color: 'rgba(66, 62, 58, 0.82)', weight: 500, halo: { color: 'rgba(255, 255, 255, 0.66)', width: 2 } };
}

/** 族名:斜体(向右倾约 11°,和写实底图上河湖名的斜度一样)、疏排 */
const CULTURE_SLANT = 0.2;
const CULTURE_TRACKING: [number, number] = [0.6, 2.4];
/** 一族分成好几片时,除了最大那片,至少几州的片才写(1–3 州的碎片不写,悬停照样看得到是哪族) */
const PIECE_MIN_REGIONS = 4;
/**
 * 一族的小片:州数不到最大那片的 PIECE_SMALL,放大到 PIECE_ZOOM 倍才写;字号拟合出来不到 PIECE_MIN_CSS(CSS 像素)的,
 * 放大到字长到这么大再写(字号不随片的大小无限变小,太小的片宁可等放大)
 */
const PIECE_SMALL = 0.4;
const PIECE_ZOOM = 2;
const PIECE_MIN_CSS = 13;
/** 族名当主角(民族填色):带本族颜色(比国名多带一点),手绘不加粗、纸色光晕,别的底图加粗、白光晕 */
function cultureLook(style: CivStyle, c: [number, number, number]): Look {
  return style === 'fantasy'
    ? { color: inkOf(c, [56, 30, 18], 0.58, 0.96), weight: 500, halo: { color: 'rgba(241, 230, 201, 0.86)', width: 2.5 } }
    : { color: inkOf(c, [30, 22, 18], 0.52, 0.96), weight: 700, halo: { color: 'rgba(255, 255, 255, 0.7)', width: 2.2 } };
}

/** 国名、城名的颜色 / 光晕 / 字重。国名带一点本国的颜色;字越小颜色越深、光晕越浓 */
function civLooks(style: CivStyle) {
  if (style === 'fantasy') {
    return {
      polity: (c: [number, number, number], css: number): Look => {
        const t = smallness(css);
        return {
          color: inkOf(c, [56, 30, 18], 0.62 + 0.2 * t, 0.9 + 0.08 * t),
          weight: 500,
          halo: { color: `rgba(241, 230, 201, ${(0.7 + 0.22 * t).toFixed(2)})`, width: 2.2 + 0.4 * t },
        };
      },
      town: (kind: number): Look => ({
        color: kind >= 3 ? 'rgb(48, 30, 18)' : 'rgb(62, 42, 28)',
        weight: 500,
        halo: { color: PAPER_HALO, width: 2.3 },
      }),
    };
  }
  return {
    polity: (c: [number, number, number], css: number): Look => {
      const t = smallness(css);
      return {
        color: inkOf(c, [30, 22, 18], 0.55 + 0.25 * t, 0.9 + 0.08 * t),
        weight: 700,
        halo: { color: `rgba(255, 255, 255, ${(0.55 + 0.25 * t).toFixed(2)})`, width: 2 + 0.4 * t },
      };
    },
    town: (kind: number): Look => ({
      color: kind >= 3 ? 'rgb(20, 18, 16)' : 'rgb(38, 34, 30)',
      weight: kind === 4 ? 700 : 500,
      halo: { color: 'rgba(255, 255, 255, 0.78)', width: 2.2 },
    }),
  };
}

/**
 * 故城遗址(阶段 3 城市兴衰):记号从几倍出现、名字从几倍出现(按被毁前的级别:村、镇、城、大城);
 * 名字还没到出现门槛时记号排在所有文字之后(挤就不画)
 */
const RUIN_SYMBOL_ZOOM = [3.4, 2.6, 1.9, 1.6];
const RUIN_NAME_ZOOM = [4.5, 3.6, 2.8, 2.2];
/** 优先级(按被毁前的级别):村镇的遗址排在村镇之后;城、大城的遗址排在镇的名字之前(不被镇名挤掉),城名之后 */
const RUIN_PRIORITY = [25, 32, 50, 62];
const RUIN_NAME_PRIORITY = [15, 22, 40, 50];
/** 遗址名的写法:"古揽霄城"(字体子集里有的字) */
export const RUIN_PREFIX = '古';

/** 视口层上随年份变的东西:国名、族名、城名(文字)和城镇符号 */
export interface CivMapLayer {
  items: LabelItem[];
  marks: (LabelMark & SettlementMarkInfo)[];
  /** items 里哪些是配角名(不是跟着填色的那种名字):拖时间轴、回放停稳以后才出来(淡入) */
  sides: ReadonlySet<LabelItem>;
}

/**
 * 这一年的国名、族名、城名、城镇符号。
 * 国名:「地图上写」勾了国名时(没勾过按填色的默认:国家、信仰、时代填色写);国家填色上是主角(大字、带本国颜色),
 * 别的填色上是配角(小一号、灰墨)。族名:勾了族名时(默认民族填色写);民族填色上是主角(斜体、带本族颜色),
 * 别的填色上是配角(小一号、灰墨,照旧斜体)。城镇符号和城名:"国家"或"道路"打开时。和"地名"开关无关。
 * fast(回放 / 拖时间轴):城名只排国都和大城的(城一建起、一升级名字就出来),城、镇、村的名字停下来再补上 ——
 * 放大地图时回放,每帧也不用排几百个小地名;主角名(国名、族名)每 20 年重新拟合一次,不会每帧抖动。
 * sides:写不写配角名(不给 = 不是 fast 就写);拖时间轴、回放时配角名先收起,停稳了再出来(界面上停稳 0.3 秒后淡入)
 */
export function civMapLayer(p: CivDrawParams, opt: { fast?: boolean; proj?: MapProj | null; sides?: boolean } = {}): CivMapLayer {
  const { civ, world, raster, style } = p;
  const items: LabelItem[] = [];
  const marks: (LabelMark & SettlementMarkInfo)[] = [];
  const sides = new Set<LabelItem>();
  const sidesOn = opt.sides ?? !opt.fast;
  // 回放 / 拖时间轴时主角名每 FAST_STEP 年才重新拟合一次(见下面国名那段)
  const fitYear = opt.fast ? Math.max(0, Math.floor(p.year / FAST_STEP) * FAST_STEP) : p.year;
  const looks = civLooks(style);
  const family = style === 'fantasy' ? FONT_FANTASY : FONT_REALISTIC;
  // 国都 → 国名那一条(国名给自家国都名留位置)
  const polityItemOfCapital = new Map<number, LabelItem>();
  const lead = polityNamesLead(p.show);
  if (polityNamesOn(p.show) && civ.polities.length && (lead || sidesOn)) {
    // 回放 / 拖时间轴时国名每 FAST_STEP 年才重新拟合一次:国土几乎每帧都在变,每帧重排国名会一直抖。
    // 阶段 3 有了战争,国土会缩小、国家会灭亡,早几年拟合的位置不一定还在国土里:
    // 当年已经灭亡的国家不写;国名的每个字按"当年"的国土核对(落在已经丢掉的土地上的摆法筛掉,都不行就先不写,下次重排再出来)
    // 弯边投影:按投影后的国土拟合(路径是地图平面坐标);查"字落没落在本国国土上"照样用世界坐标的国土栅格
    const proj = opt.proj ?? undefined;
    const { labels, field: fitField } = polityLabels(world, raster, civ, fitYear, { refCss: REF_MAP_CSS, proj });
    const field = proj ? polityOwnerGrid(world, raster, civ, p.year) : fitYear === p.year || !fitField ? fitField : polityOwnerGrid(world, raster, civ, p.year);
    for (const l of labels) {
      const pol = civ.polities[l.polity];
      if (!polityAlive(pol, p.year)) continue;
      const look = lead ? looks.polity(pol.color, (l.size * REF_MAP_CSS) / world.width) : sideLook(style);
      const tracking = lead ? POLITY_TRACKING : SIDE_TRACKING;
      const id = l.polity;
      const item: LabelItem = {
        text: l.text,
        path: l.path,
        layout: 'curve',
        size: 0,
        sizeWorld: lead ? l.size : Math.min(l.size * SIDE_SCALE, (SIDE_MAX_CSS * world.width) / REF_MAP_CSS),
        grow: POLITY_GROW,
        tracking,
        minZoom: 1,
        // 国名排在国都、国都名之后,大多数山名之前;大国先放。配角排在国都名之后、城镇符号之前
        priority: lead ? 101 + Math.min(4.9, Math.log2(1 + l.regions) * 0.7) : SIDE_PRIORITY + Math.min(0.35, Math.log2(1 + l.regions) * 0.05),
        family,
        weight: look.weight,
        color: look.color,
        halo: look.halo,
        area: !field
          ? undefined
          : fitYear === p.year
            ? (wx, wy) => ownerAtPoint(field, wx, wy) === id
            : // 早几年拟合的位置可能贴着新国界:连周围 LOST_MARGIN 以内都是本国的才算
              (wx, wy) =>
                ownerAtPoint(field, wx, wy) === id &&
                ownerAtPoint(field, wx - LOST_MARGIN, wy) === id &&
                ownerAtPoint(field, wx + LOST_MARGIN, wy) === id &&
                ownerAtPoint(field, wx, wy - LOST_MARGIN) === id &&
                ownerAtPoint(field, wx, wy + LOST_MARGIN) === id,
        place: function* (px, view) {
          const min = MIN_LABEL_PX * view.dpr;
          const planar = !!l.planar;
          const gen = function* () {
            yield* polityCandidates(l.text, l.path, px, tracking, view, l.vertical, min, planar);
            if (!l.alt) return;
            // 备选路径绕开国都;字号按它自己拟合的大小(相对主路径)换算
            const f = l.alt.size / l.size;
            for (const c of polityCandidates(l.text, l.alt.path, Math.max(min, px * f), tracking, view, l.alt.vertical, min, planar)) yield { ...c, px: c.px ?? Math.max(min, px * f) };
          };
          yield* lead ? gen() : sideShift(gen, px, l.vertical);
        },
        planar: !!l.planar,
        tolerance: 0.1,
        space: lead ? 0.35 : SIDE_SPACE,
        pick: { kind: 'polity', id },
      };
      items.push(item);
      if (!lead) sides.add(item);
      polityItemOfCapital.set(capitalAt(pol, p.year), item);
    }
  }
  const cultureLead = cultureNamesLead(p.show);
  if (cultureNamesOn(p.show) && civ.cultures.length && (cultureLead || sidesOn)) {
    // 族名:一族住的每一片各自拟合(labels/groups.ts);和国名一样回放时每 20 年重排一次,每个字按当年这一族的地盘核对
    const labels = groupLabels(world, raster, civ, fitYear, 'culture', (id) => (civ.cultures[id] ? cultureLabel(civ.cultures[id]) : null), {
      refCss: REF_MAP_CSS,
      minPiece: PIECE_MIN_REGIONS,
      proj: opt.proj ?? undefined,
    });
    const field = groupOwnerGrid(world, raster, civ, p.year, 'culture');
    const cssPerWorld = REF_MAP_CSS / world.width;
    for (const l of labels) {
      const id = l.id;
      const look = cultureLead ? cultureLook(style, civ.cultures[id].color) : sideLook(style);
      const tracking = cultureLead ? CULTURE_TRACKING : SIDE_TRACKING;
      // 小片(不是最大那片):州数不到最大那片四成的放大到 2 倍才写;字小的放大到 13 号再写
      // (按当主角的字号算:当配角时也在同一个倍数出来)
      const minZoom = l.main
        ? 1
        : Math.max(l.regions < l.mainRegions * PIECE_SMALL ? PIECE_ZOOM : 1, Math.pow(PIECE_MIN_CSS / (l.size * cssPerWorld), 1 / POLITY_GROW));
      const grade = Math.min(0.35, Math.log2(1 + l.regions) * 0.05);
      const item: LabelItem = {
        text: l.text,
        path: l.path,
        layout: 'curve',
        size: 0,
        sizeWorld: cultureLead ? l.size : Math.min(l.size * SIDE_SCALE, SIDE_MAX_CSS / cssPerWorld),
        grow: POLITY_GROW,
        tracking,
        minZoom,
        // 主角:最大那片和国名一样(大族先放),小片排在国都名之前;配角:国都名之后、城镇符号之前,小片再靠后一点
        priority: cultureLead ? (l.main ? 101 + Math.min(4.9, Math.log2(1 + l.regions) * 0.7) : 100.6 + grade) : SIDE_PRIORITY - (l.main ? 0 : 0.08) + grade,
        family,
        weight: look.weight,
        color: look.color,
        halo: look.halo,
        slant: CULTURE_SLANT,
        area:
          fitYear === p.year
            ? (wx, wy) => ownerAtPoint(field, wx, wy) === id
            : (wx, wy) =>
                ownerAtPoint(field, wx, wy) === id &&
                ownerAtPoint(field, wx - LOST_MARGIN, wy) === id &&
                ownerAtPoint(field, wx + LOST_MARGIN, wy) === id &&
                ownerAtPoint(field, wx, wy - LOST_MARGIN) === id &&
                ownerAtPoint(field, wx, wy + LOST_MARGIN) === id,
        place: (px, view) => {
          const gen = () => polityCandidates(l.text, l.path, px, tracking, view, l.vertical, MIN_LABEL_PX * view.dpr, !!l.planar);
          return cultureLead ? gen() : sideShift(gen, px, l.vertical);
        },
        planar: !!l.planar,
        tolerance: 0.1,
        space: cultureLead ? 0.35 : SIDE_SPACE,
        territory: true,
      };
      items.push(item);
      if (!cultureLead) sides.add(item);
    }
  }
  if ((p.show.polities || p.show.routes) && civ.settlements.length) {
    const { x: mx, y: my } = world.mesh;
    const boxes = SYMBOL_BOX[style === 'fantasy' ? 'fantasy' : 'realistic'];
    for (const e of settlementsAt(civ, p.year)) {
      const k = e.kind;
      const mark: LabelMark & SettlementMarkInfo = {
        id: e.s.id,
        x: mx[e.s.cell],
        y: my[e.s.cell],
        box: boxes[k],
        grow: SYMBOL_GROW,
        minZoom: SYMBOL_MIN_ZOOM[k],
        priority: SYMBOL_PRIORITY[k],
        forced: k === 4,
        softBelow: k <= 1 ? NAME_MIN_ZOOM[k] : undefined,
        kind: k,
        color: e.color,
        polity: e.polity,
      };
      marks.push(mark);
      if (!e.s.name || (opt.fast && k < 3)) continue;
      const look = looks.town(k);
      const name = settlementNameItem(
          {
            text: e.s.name,
            size: NAME_SIZE[k],
            grow: NAME_GROW,
            tracking: [0.04, 0.04],
            minZoom: NAME_MIN_ZOOM[k],
            priority: NAME_PRIORITY[k],
            family,
            weight: look.weight,
            color: look.color,
            halo: look.halo,
          },
          mark,
          0.04,
          // 国都、大城多试一圈远一点的位置
          k >= 3 ? 2 : 1,
      );
      name.pick = { kind: 'settlement', id: e.s.id };
      items.push(name);
      const pi = k === 4 ? polityItemOfCapital.get(e.s.id) : undefined;
      if (pi) pi.keepRoomFor = name;
    }
    // 故城遗址:淡淡的记号,放大后写"古某城"
    const ruinLook =
      style === 'fantasy'
        ? { color: 'rgba(92,70,52,0.9)', weight: 500, halo: { color: PAPER_HALO, width: 2.1 } }
        : { color: 'rgba(58,52,48,0.9)', weight: 500, halo: { color: 'rgba(255, 255, 255, 0.7)', width: 2 } };
    for (const { s, rank } of ruinsAt(civ, p.year)) {
      const mark: LabelMark & SettlementMarkInfo = {
        id: s.id,
        x: mx[s.cell],
        y: my[s.cell],
        box: boxes[RUIN],
        grow: SYMBOL_GROW,
        minZoom: RUIN_SYMBOL_ZOOM[rank],
        priority: RUIN_PRIORITY[rank],
        softBelow: RUIN_NAME_ZOOM[rank],
        kind: RUIN,
      };
      marks.push(mark);
      if (!s.name || opt.fast) continue;
      const name = settlementNameItem(
        {
          text: RUIN_PREFIX + s.name,
          size: NAME_SIZE[0] - 0.5,
          grow: NAME_GROW,
          tracking: [0.04, 0.04],
          minZoom: RUIN_NAME_ZOOM[rank],
          priority: RUIN_NAME_PRIORITY[rank],
          family,
          weight: ruinLook.weight,
          color: ruinLook.color,
          halo: ruinLook.halo,
        },
        mark,
      );
      name.pick = { kind: 'settlement', id: s.id };
      items.push(name);
    }
  }
  return { items, marks, sides };
}

/** 这个文明的地图文字可能用到的所有字(地理名 + 各国历朝各档国号 + 族名 + 城名):字体一次加载好,回放时不用再等 */
export function civLabelChars(civ: Civ): string {
  const set = new Set<string>();
  const add = (s: string) => {
    for (const c of s) set.add(c);
  };
  for (const p of civ.places) add(p.name);
  for (let r = 0; r < civ.regions.count; r++) if (regionNamed(civ, r)) add(regionLabel(civ, r));
  for (const p of civ.polities) for (const t of polityAllTitles(p)) add(t);
  for (const c of civ.cultures) add(cultureLabel(c));
  for (const s of civ.settlements) add(s.name);
  add(RUIN_PREFIX);
  return [...set].sort().join('');
}

/** 河道蒙版的格子大小(世界单位) */
const RIVER_CELL = 3;
const riverMasks = new WeakMap<World, Map<number, { gw: number; gh: number; m: Uint8Array }>>();

/**
 * 河道蒙版:较大的河(流量 ≥ 2 倍成河门槛)经过的格子,按河宽再往外放宽一点。
 * 陆上的字(山、荒漠、岛、河名本身)不压在河上;每个世界(每种格子大小)只算一次。
 */
function riverMask(world: World, cell = RIVER_CELL) {
  let byCell = riverMasks.get(world);
  if (!byCell) riverMasks.set(world, (byCell = new Map()));
  let hit = byCell.get(cell);
  if (hit) return hit;
  const gw = Math.ceil(world.width / cell);
  const gh = Math.ceil(world.height / cell);
  const m = new Uint8Array(gw * gh);
  const thr = world.riverThreshold * 2;
  // 河道的 x 按相邻两点展开(跨 180° 经线的河段不横穿整张图),格子列下标取模
  const W = wrapOf(world);
  const mark = (x: number, y: number, r: number) => {
    const x0 = Math.floor((x - r) / cell);
    const x1 = Math.floor((x + r) / cell);
    const y0 = Math.max(0, Math.floor((y - r) / cell));
    const y1 = Math.min(gh - 1, Math.floor((y + r) / cell));
    for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) m[yy * gw + (((xx % gw) + gw) % gw)] = 1;
  };
  for (const r of world.rivers) {
    const pts = r.pts;
    for (let i = 0; i + 5 < pts.length; i += 3) {
      const f = pts[i + 2];
      if (f < thr) continue;
      const ax = pts[i];
      const ay = pts[i + 1];
      const bx = nearX(pts[i + 3], ax, W);
      const by = pts[i + 4];
      const half = 0.6 + 3 * Math.min(1, Math.sqrt((f - world.riverThreshold) / 1000));
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 1.5));
      for (let k = 0; k <= steps; k++) mark(ax + ((bx - ax) * k) / steps, ay + ((by - ay) * k) / steps, half);
    }
  }
  hit = { gw, gh, m };
  byCell.set(cell, hit);
  return hit;
}

/**
 * 视口参数里和画风有关的部分:地面查询(含河道)、手绘风罗盘不许压、边框留白。
 * 再带上 wrap(东西相连):地面查询的 x 按整圈取模;frameLeft = 外框左边的世界 x(罗盘在外框左下角,跟着外框走)
 */
export function labelViewExtras(p: CivDrawParams, frameLeft = 0): Pick<LabelView, 'surface' | 'reserved' | 'margin' | 'worldW' | 'worldH' | 'wrap'> {
  const { raster, world } = p;
  const { w, h, scale, water } = raster;
  const W = world.width;
  const H = world.height;
  const rm = riverMask(world);
  const wrap = wrapOf(world);
  const surface = (wx: number, wy: number) => {
    const u = wx - wrap * Math.floor(wx / wrap);
    const x = Math.min(w - 1, Math.floor(u * scale));
    const y = Math.floor(wy * scale);
    if (y < 0 || y >= h) return -1;
    const s = water[y * w + x];
    if (s === 0 && rm.m[Math.floor(wy / RIVER_CELL) * rm.gw + Math.min(rm.gw - 1, Math.floor(u / RIVER_CELL))]) return 3;
    return s;
  };
  // 手绘风左下角的罗盘(render/fantasy.ts 的 drawFrame:中心 (95, H − 95),半径 46,上面还有个"北"字)
  const L = frameLeft;
  const reserved: [number, number, number, number][] = p.style === 'fantasy' ? [[L + 95 - 58, H - 95 - 72, L + 95 + 58, H - 95 + 56]] : [];
  return { surface, reserved, margin: p.style === 'fantasy' ? 16 : 6, worldW: W, worldH: H, wrap };
}

/**
 * 再让开几块画布上的矩形(画布像素 [x0, y0, x1, y1]):地图上盖着的按钮、面板、时间轴下面不放字和符号。
 * 换成和 reserved 同一套的坐标(世界坐标;弯边投影 = 地图平面坐标),接在 view 原有的 reserved 后面返回(不改 view)
 */
export function reserveCanvasBoxes(
  view: Pick<LabelView, 'scale' | 'ox' | 'oy' | 'reserved'>,
  boxes: readonly (readonly [number, number, number, number])[],
): [number, number, number, number][] {
  const s = view.scale;
  const out = [...(view.reserved ?? [])];
  if (!(s > 0)) return out;
  for (const b of boxes) out.push([(b[0] - view.ox) / s, (b[1] - view.oy) / s, (b[2] - view.ox) / s, (b[3] - view.oy) / s]);
  return out;
}

/**
 * 地面查询(和 labelViewExtras 的 surface 一样:0 陆地 / 1 海 / 2 湖 / 3 陆上的河道;出界 −1),河道蒙版的格子大小可以另给。
 * 地球仪放大很多时(等效缩放十几倍)一个字只有三四个世界单位宽,3 个单位的格子太粗:紧挨着河排的河名、跨过小河的山名
 * 会被整格判成"压着河",放不上去 —— 地球仪用 1 个单位的细格子
 */
export function labelSurface(world: World, raster: Raster, cell = RIVER_CELL): (wx: number, wy: number) => number {
  const { w, h, scale, water } = raster;
  const rm = riverMask(world, cell);
  const wrap = wrapOf(world);
  return (wx: number, wy: number) => {
    const u = wx - wrap * Math.floor(wx / wrap);
    const x = Math.min(w - 1, Math.floor(u * scale));
    const y = Math.floor(wy * scale);
    if (y < 0 || y >= h) return -1;
    const s = water[y * w + x];
    if (s === 0 && rm.m[Math.min(rm.gh - 1, Math.floor(wy / cell)) * rm.gw + Math.min(rm.gw - 1, Math.floor(u / cell))]) return 3;
    return s;
  };
}
