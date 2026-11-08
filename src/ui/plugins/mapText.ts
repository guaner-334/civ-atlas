/** 地图插件在插件页、选插件那一页上的几句话(网站自己的说法,作者改不了)。纯计算,单测直接测 */
import type { MapManifest } from '../../plugin/pluginMap';
import type { AddsRow } from './pluginText';

export const isMap = (m: { role: string }): boolean => m.role === 'map';

/** 一个世界最多几个地图插件 */
export const MAP_PICK_MAX = 4;

/** 三个口子的叫法(按出手的先后) */
export const MAP_STAGE_TEXT: Readonly<Record<string, string>> = { height: '改海拔', climate: '改气候', layers: '出图层' };
const STAGE_WHEN: Readonly<Record<string, string>> = { height: '海拔定下以后', climate: '气温降水算好以后', layers: '地图长好以后' };
const ORDER = ['height', 'climate', 'layers'];

const stagesOf = (map: Pick<MapManifest, 'stages'>): string[] => [...map.stages].sort((a, b) => (ORDER.indexOf(a) + 1 || 9) - (ORDER.indexOf(b) + 1 || 9));
const stageText = (k: string) => MAP_STAGE_TEXT[k] ?? k;

/** 装好以后提示条第二行:去哪选它 */
export const mapWhere = (): string => '新建世界时，在「地图」那一步的「地图插件」里选上它';

/** 选插件那一页名字下面那行:「改海拔」「改气候、出 1 张图层」 */
export function mapBrief(map: Pick<MapManifest, 'stages' | 'layers'>): string {
  return stagesOf(map)
    .map((k) => (k === 'layers' ? `出 ${map.layers?.length ?? 1} 张图层` : stageText(k)))
    .join('、');
}

/** 插件页「它在长地图时做什么」 */
export function mapRows(map: MapManifest, phone: boolean): AddsRow[] {
  const stages = stagesOf(map);
  const when: AddsRow = phone ? { k: '哪一步', v: stages.map(stageText).join('、') } : { k: '在哪一步出手', v: stages.map((k) => (STAGE_WHEN[k] ? `${stageText(k)}（${STAGE_WHEN[k]}）` : stageText(k))).join('、') };
  const height = stages.includes('height');
  const climate = stages.includes('climate');
  const after = height ? ['湖', '气候', '河', '森林草原沙漠', '文明'] : [...(phone ? [] : ['海冰']), '河', '森林草原沙漠', '文明'];
  const what: AddsRow =
    height || climate
      ? { k: '会改什么', v: [...(height ? ['海拔（跨过海平面的地方海陆跟着变）'] : []), ...(climate ? ['气温、降水'] : [])].join('；'), small: `后面的${after.join('、')}跟着变` }
      : { k: '会改什么', v: '不改地图' };
  const layers = map.layers ?? [];
  const layer: AddsRow = layers.length
    ? { k: '图层', v: `${phone ? '' : `${layers.length} 张：`}${layers.map((l) => `「${l.title}」${l.classes?.length ? `（${l.classes.length} 类）` : ''}`).join('')}`, small: '存进世界，在图层面板「插件图层」里' }
    : { k: '图层', v: '不加' };
  const params = Object.values(map.params ?? {});
  const one = params.length === 1 ? params[0] : null;
  const knobs: AddsRow = params.length
    ? { k: '滑条', v: one ? `1 个：${one.label}（${one.min}–${one.max}，默认 ${one.default}）` : `${params.length} 个：${params.map((p) => p.label).join('、')}`, ...(phone ? {} : { small: '新建世界选它时拨' }) }
    : { k: '滑条', v: '没有' };
  const cost: AddsRow = { k: '多花多久', v: '没量过' };
  return [when, what, layer, knobs, cost];
}

/** 插件页「怎么用」(电脑) */
export const MAP_USE: readonly (readonly [string, string])[] = [
  ['新建世界', '在「地图」那一步的「地图插件」里选上它，最多选 4 个'],
  ['长好的世界', '地图不变；想换，就以它为底稿另建一个世界'],
  ['别人打开', '看、接着推都不用装；要改地形，得装同一版'],
];
