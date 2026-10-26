/**
 * 文明叠加层 · 关隘:civ.places 里 kind = 'pass' 的(gen/civ/passSites.ts 挑的名关、打过守关战的口子)画成符号 + 关名,
 * 和城镇一起排(符号先放,名字绕着符号找 8 个方位,见 labels/settlements.ts);符号的画法在 settlements.ts(PASS)。
 *
 *   什么时候有:名关从大路修通那年起,打过守关战的从那一仗那年起(Place.pass.since),之后一直在
 *   出现:名关放大到 1.5 倍出符号、2.2 倍出名字;这一年以前在这里打过守关战的,总览就有符号、1.5 倍出名字
 *   让位:符号排在城之下、村镇之上;名字排在城名、山名、河名之下,镇名之上 —— 挤的时候村镇让关
 *   名字:字号同城名(11);手绘用山名的褐墨,写实、数据图层和山名一样深色带白边;旁边不写海拔(点开卡片看)
 *
 * 回放、拖时间轴时(fast)只画符号,停下来再写名字。
 */
import type { Civ } from '../../gen/civ/types';
import type { World } from '../../gen/world';
import type { LabelItem, LabelMark } from '../labels/draw';
import { NAME_GROW, settlementNameItem } from '../labels/settlements';
import { PASS, SYMBOL_BOX, SYMBOL_GROW, type SettlementMarkInfo } from './settlements';

/** 符号从几倍出现:[名关, 打过守关战的] */
export const PASS_SYMBOL_ZOOM = [1.5, 1] as const;
/** 名字从几倍出现:[名关, 打过守关战的] */
export const PASS_NAME_ZOOM = [2.2, 1.5] as const;
/** 符号、名字的优先级(城的符号 100、城名 70;镇的符号 60、镇名 45;见 labels/settlements.ts) */
export const PASS_SYMBOL_PRIORITY = 72;
export const PASS_NAME_PRIORITY = 68;
/** 名字字号(CSS 像素,参照宽度、缩放 1 倍)、字距 */
const PASS_NAME_SIZE = 11;
const PASS_TRACKING = 0.06;

/** 关隘符号的编号 = 这个数 + civ.places 的下标(和城镇的编号 —— Settlement.id —— 分开) */
export const PASS_MARK_BASE = 1 << 24;

/** 符号编号 → 关隘在 civ.places 里的下标;不是关隘的符号 = −1 */
export function passOfMark(id: number): number {
  return id >= PASS_MARK_BASE ? id - PASS_MARK_BASE : -1;
}

/** 这一年地图上有的关隘(civ.places 的下标,按下标排) */
export function passesAt(civ: Civ, year: number): number[] {
  const out: number[] = [];
  civ.places.forEach((p, i) => {
    if (p.kind === 'pass' && p.pass && p.pass.since <= year) out.push(i);
  });
  return out;
}

/**
 * 这一年的关口符号和关名。look = 名字的颜色(civ/labels.ts 的 passLook);family = 字体;fast = 回放 / 拖时间轴(只画符号)
 */
export function passLabels(
  civ: Civ,
  world: World,
  year: number,
  style: 'fantasy' | 'realistic' | 'data',
  look: { color: string; weight: number; halo?: { color: string; width: number } },
  family: string,
  fast = false,
): { marks: (LabelMark & SettlementMarkInfo)[]; items: LabelItem[] } {
  const marks: (LabelMark & SettlementMarkInfo)[] = [];
  const items: LabelItem[] = [];
  const { x, y } = world.mesh;
  const box = SYMBOL_BOX[style === 'fantasy' ? 'fantasy' : 'realistic'][PASS];
  for (const id of passesAt(civ, year)) {
    const p = civ.places[id];
    const cell = p.cell!;
    const t = p.pass!.stand !== undefined && p.pass!.stand <= year ? 1 : 0;
    const mark: LabelMark & SettlementMarkInfo = {
      id: PASS_MARK_BASE + id,
      x: x[cell],
      y: y[cell],
      box,
      grow: SYMBOL_GROW,
      minZoom: PASS_SYMBOL_ZOOM[t],
      priority: PASS_SYMBOL_PRIORITY,
      kind: PASS,
      place: id,
    };
    marks.push(mark);
    if (!p.name || fast) continue;
    const name = settlementNameItem(
      {
        text: p.name,
        size: PASS_NAME_SIZE,
        grow: NAME_GROW,
        tracking: [PASS_TRACKING, PASS_TRACKING],
        minZoom: PASS_NAME_ZOOM[t],
        priority: PASS_NAME_PRIORITY,
        family,
        weight: look.weight,
        color: look.color,
        halo: look.halo,
      },
      mark,
      PASS_TRACKING,
    );
    name.pick = { kind: 'place', id };
    items.push(name);
  }
  return { marks, items };
}
