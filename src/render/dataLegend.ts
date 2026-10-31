/**
 * 数据图层的图例内容:屏幕左上角的图例和导出的图例图片共用这一份,颜色、文字、数值不会一边一样一边不一样。
 *
 * 连续色阶(海拔、气温、降水、洋流)是"数值 → 颜色",导出图例图片和地图角上都能画;
 * 分类图层(板块、生物群落、气候分类)只有"颜色 → 名字",导出图例图片里画色块,地图上不硬塞一大块。
 */
import { BIOMES } from '../gen/biomes';
import { CLIMATE_CLASSES } from '../gen/koppen';
import { CURRENT_RAMP, ELEV_RAMP, PRECIP_RAMP, TEMP_RAMP, type LayerId } from './layers';
import type { RGB } from './common';
import { ATLAS_RIVER, ATLAS_SEA, ATLAS_SEA_EDGES, HYPSO, HYPSO_ARID, HYPSO_EDGES, HYPSO_SNOW, STIPPLE } from './atlasColors';

const hexRGB = (s: string): RGB => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];

export interface GradientLegend {
  kind: 'gradient';
  title: string;
  stops: [number, RGB][];
  /** 要写出来的刻度(和 stops 的数值在同一把尺上) */
  labels: number[];
  /** 刻度下面的一行小字:单位 + 读法 */
  unit: string;
}

export interface KeyItem {
  name: string;
  color: RGB;
}

export interface KeysLegend {
  kind: 'keys';
  title: string;
  keys: KeyItem[];
}

export interface ClimateClassItem {
  code: string;
  /** 完整名字,导出 / 屏幕上都写 */
  name: string;
  /** 图例里写的短名字(组名已经写了"温带""冷温带") */
  short: string;
  color: RGB;
  /** 屏幕上的 CSS 颜色 */
  css: string;
}

export interface ClimateGroup {
  name: string;
  letter: string;
  classes: ClimateClassItem[];
}

export interface ClimateLegend {
  kind: 'climate';
  title: string;
  subtitle: string;
  groups: ClimateGroup[];
  note: string;
}

export type DataLegend = GradientLegend | KeysLegend | ClimateLegend;

const CLIMATE_GROUPS: { name: string; letter: string }[] = [
  { name: 'A 热带', letter: 'A' },
  { name: 'B 干旱', letter: 'B' },
  { name: 'C 温带', letter: 'C' },
  { name: 'D 冷温带', letter: 'D' },
  { name: 'E 极地', letter: 'E' },
];
const shortName = (name: string) => name.replace(/^(冷温带|温带),/, '').replace('夏季', '夏').replace('冬季', '冬');

const PLATE_KEYS: KeyItem[] = [
  { name: '碰撞带(造山)', color: hexRGB('#c8281e') },
  { name: '张裂带(裂谷 / 洋中脊)', color: hexRGB('#1e5adc') },
  { name: '箭头 = 漂移方向', color: hexRGB('#222222') },
  { name: '偏暗 = 大洋板块', color: hexRGB('#56687d') },
];

/** 某个数据图层的图例内容;连续色阶的 labels 在 stops 的范围内 */
export function dataLegend(layer: LayerId): DataLegend {
  switch (layer) {
    case 'elevation':
      return { kind: 'gradient', title: '海拔', stops: ELEV_RAMP, labels: [-4000, 0, 2200, 5500], unit: '海拔 米' };
    case 'temperature':
      return { kind: 'gradient', title: '气温', stops: TEMP_RAMP, labels: [-30, -15, 0, 15, 30], unit: '年均温 °C' };
    case 'precipitation':
      return { kind: 'gradient', title: '降水', stops: PRECIP_RAMP, labels: [0, 600, 1200, 2000, 3200], unit: '年降水 mm · 白箭头 = 盛行风' };
    case 'currents':
      return { kind: 'gradient', title: '洋流', stops: CURRENT_RAMP, labels: [-6, -3, 0, 3, 6], unit: '水温和同纬度比（°C），箭头是洋流方向' };
    case 'plates':
      return { kind: 'keys', title: '板块', keys: PLATE_KEYS };
    case 'climate':
      return {
        kind: 'climate',
        title: '气候分类',
        subtitle: '(估算,按柯本 - 盖格)',
        groups: CLIMATE_GROUPS.map((g) => ({
          ...g,
          classes: CLIMATE_CLASSES.filter((c) => c.code[0] === g.letter).map((c) => ({
            code: c.code,
            name: c.name,
            short: c.code.length > 1 ? shortName(c.name) : '',
            color: hexRGB(c.color),
            css: c.color,
          })),
        })),
        note: '由年均温、年降水和离海远近推算;世界里没有逐月降水,不分干湿季(f / s / w)。',
      };
    default:
      return {
        kind: 'keys',
        title: '生物群落',
        keys: BIOMES.filter((b) => b.legend).map((b) => ({ name: b.name, color: b.real })),
      };
  }
}

/** 连续色阶才在地图角上画;分类图层在图例图片里画,不在地图上压一大块 */
export function isGradientLegend(layer: LayerId): boolean {
  return dataLegend(layer).kind === 'gradient';
}

/** 图例里要写的全部字(先加载字体,免得第一张图用后备字体) */
export function dataLegendText(layer: LayerId): string {
  const l = dataLegend(layer);
  let s = l.title;
  if (l.kind === 'gradient') s += l.unit + l.labels.join('') + '0123456789.-°C';
  else if (l.kind === 'keys') s += l.keys.map((k) => k.name).join('');
  else s += l.subtitle + l.note + l.groups.map((g) => g.name + g.classes.map((c) => c.code + c.name + c.short).join('')).join('');
  return s;
}

/** 地理图的海拔色标:一档一档(和地图上的层色一样),刻度写在档与档的分界上 */
export interface BandsLegend {
  title: string;
  subtitle: string;
  /** 从最深的海到最高的山,每档一个颜色 */
  colors: RGB[];
  /** 刻度:写在第 at 档的左边界上 */
  ticks: { at: number; label: string }[];
  /** 手机上缩短的那一条只写这几个刻度(最后一个带单位) */
  phoneTicks: { at: number; label: string }[];
  /** 色标下面一行:干旱低地、沙漠(点)、冰雪、河流 */
  keys: { name: string; color: RGB; kind: 'box' | 'dots' | 'line' }[];
  dots: RGB;
  river: string;
}

/** 分界(米)→ 第几档的左边界:海由深到浅 8 档,接着陆地由低到高 8 档 */
function bandAt(m: number): number {
  const sea = ATLAS_SEA_EDGES.indexOf(m);
  if (sea >= 0) return sea + 1;
  if (m === 0) return ATLAS_SEA.length;
  return ATLAS_SEA.length + HYPSO_EDGES.indexOf(m) + 1;
}

const minus = (m: number) => (m < 0 ? `−${-m}` : `${m}`);

/** 地理图左上角的海拔色标 */
export function atlasLegend(): BandsLegend {
  return {
    title: '海拔',
    subtitle: '米,海里是水深',
    colors: [...ATLAS_SEA, ...HYPSO],
    ticks: [-6000, -3000, -1000, 0, 500, 2000, 5000].map((m) => ({ at: bandAt(m), label: minus(m) })),
    phoneTicks: [-3000, 0, 2000, 5000].map((m, i, a) => ({ at: bandAt(m), label: i === a.length - 1 ? `${m} 米` : minus(m) })),
    keys: [
      { name: '干旱低地', color: HYPSO_ARID, kind: 'box' },
      { name: '沙漠', color: HYPSO_ARID, kind: 'dots' },
      { name: '冰雪', color: HYPSO_SNOW, kind: 'box' },
      { name: '河流', color: [0, 0, 0], kind: 'line' },
    ],
    dots: STIPPLE,
    river: ATLAS_RIVER,
  };
}
