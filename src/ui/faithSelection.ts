/**
 * 选中一种信仰(宗教卡片开着)时地图上怎么画:
 *   - 选中的样子画在它的城上:大教 = 圣城,教派 = 分出时那国的国都(外面一圈细环 + 名字底下的光晕,和选中一座城一样);民间信仰不画
 *   - 信仰图层上别的信仰变淡(faithFocus,见 render/civ/faith.ts 的 faithColors)
 * 选中一个民族(民族卡片开着)时:民族填色上别的民族变淡(cultureFocus,见 render/civ/territory.ts 的 fieldColors);地图上不圈
 */
import type { Civ } from '../gen/civ/types';
import type { SelectionTarget } from '../render/civ/highlight';
import { setSelection, type MapSelection } from './civView';
import { mapTarget } from './flyTo';
import { requestFly } from './panelStore';

/** 地图上画选中用的目标(人物换成他的国家,见 flyTo.ts 的 mapTarget;信仰换成它的城;其余照旧) */
export function selectionOnMap(civ: Civ | null, picked: MapSelection | null): SelectionTarget | null {
  const sel = mapTarget(civ, picked);
  if (!sel || sel.kind !== 'faith') return sel;
  const f = civ?.religion?.faiths[sel.id];
  const city = f?.kind === 'great' ? f.holy : f?.kind === 'sect' ? f.seat : undefined;
  return city !== undefined && civ?.settlements[city] ? { kind: 'settlement', id: city } : null;
}

/** 选中的信仰(没选信仰 = null) */
export function faithFocusOf(sel: MapSelection | null): number | null {
  return sel?.kind === 'faith' ? sel.id : null;
}

/** 选中的民族(没选民族 = null) */
export function cultureFocusOf(sel: MapSelection | null): number | null {
  return sel?.kind === 'culture' ? sel.id : null;
}

/** 开民族卡片,地图转到这一族这一年人最多的州(侧栏、世界概览、搜索里点民族;点地图、卡片里的族名只开卡片) */
export function openCulture(id: number) {
  setSelection({ kind: 'culture', id });
  requestFly('culture');
}
