/** 工具插件替用的人翻年份、移地图、圈出国家和州(view.control@1):「工具」里开的和开发者模式载入的共用 */
import type { PluginSource } from '../../../plugin/host';
import type { PanelTarget } from '../../../plugin/types';
import { flyFocus, highlightOf } from '../../../plugin/viewControl';
import type { Civ } from '../../../gen/civ/types';
import type { World } from '../../../gen/world';
import { resolveKey } from '../../../gen/edits';
import { getCivHighlight, getCivTime, setCivHighlight, setCivTime } from '../../civView';
import { directorFlyTo } from '../../directorStore';

/** 正按着的鼠标、手指(任何地方:拖地图、捏合、拖时间轴……) */
const pressed = new Set<number>();
let watching = false;

function watchHands() {
  if (watching || typeof window === 'undefined') return;
  watching = true;
  const opt = { capture: true, passive: true };
  const up = (e: PointerEvent) => pressed.delete(e.pointerId);
  window.addEventListener('pointerdown', (e) => pressed.add(e.pointerId), opt);
  window.addEventListener('pointerup', up, opt);
  window.addEventListener('pointercancel', up, opt);
  // 在窗口外面松手收不到 pointerup
  window.addEventListener('pointermove', (e) => e.buttons === 0 && pressed.delete(e.pointerId), opt);
  window.addEventListener('blur', () => pressed.clear());
}

export const HANDS_BUSY = '用的人正按着地图或时间轴,松手以后再调';

/** 用的人正按着:插件翻年份、移地图都让给他 */
export function handsOn(): boolean {
  return pressed.size > 0 || getCivTime().scrubbing;
}

/** live = 插件还开着;圈的东西停了以后照样拿得掉 */
export function toolSteer(live: () => boolean): Required<Pick<PluginSource, 'seek' | 'fly' | 'highlight'>> {
  watchHands();
  let lit = 0;
  const stopped = '插件已经停了';
  return {
    seek: (year) => {
      if (!live()) return stopped;
      if (handsOn()) return HANDS_BUSY;
      setCivTime({ year, playing: false, scrubbing: false, story: false });
      return null;
    },
    fly: (focus) => {
      if (!live()) return stopped;
      if (handsOn()) return HANDS_BUSY;
      directorFlyTo(focus);
      return null;
    },
    highlight: (h) => {
      if (!h) {
        if (lit && getCivHighlight()?.stamp === lit) setCivHighlight(null);
        lit = 0;
        return;
      }
      if (!live()) return;
      setCivHighlight({ ...h, steady: true, still: true });
      lit = getCivHighlight()?.stamp ?? 0;
    },
  };
}

/** 用的人自己点了面板上的链接:年份翻过去,国、城、州飞过去(国、州还圈一下);不看插件有没有 view.control,找不到的不动 */
export function panelGo(to: PanelTarget, world: World, civ: Civ | null): void {
  if (!civ) return;
  if ('year' in to) {
    setCivTime({ year: Math.min(civ.endYear, Math.max(0, to.year)), playing: false, scrubbing: false, story: false });
    return;
  }
  const r = resolveKey(civ, to.key);
  if (!r) return;
  const arg = r.kind === 'polity' ? { polities: [to.key] } : r.kind === 'region' ? { regions: [to.key] } : r.kind === 'settlement' ? { settlements: [to.key] } : null;
  if (!arg) return;
  const year = () => getCivTime().year ?? civ.endYear;
  try {
    directorFlyTo(flyFocus(world, () => civ, arg, year));
    if (r.kind !== 'settlement') setCivHighlight(highlightOf(civ, arg, year));
  } catch {
    // 那一年地图上没有这一处
  }
}
