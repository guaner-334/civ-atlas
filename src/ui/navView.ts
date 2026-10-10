/**
 * 浏览器后退记的"世界里开着的东西"(nav.ts 的 NavLayer)和界面上的几个 store 之间来回换:
 *
 *   layerNow(civ)          现在开着的:选中的东西(带稳定键)、世界概览哪一页(编年史只看哪一国)、史书读哪一部;
 *                          正在新建、还没存的作者标记 / 人物(编号 0)= null(这时不算变了,存好了才算一张卡片)
 *   applyLayer(civ, l)     打开 l 记着的(稳定键在这份历史里找不到的卡片就不开),没记着的收起;返回实际开着的
 *
 * civ 用地图上那一份(时间轴那一段、试推演时是试推演的),和选中的编号对得上。
 */
import type { Civ } from '../gen/civ/types';
import { polityKey, resolveKey } from '../gen/edits';
import { clearSelection, getChronicle, getSelection, setSelection, type MapSelection } from './civView';
import { OVERVIEW_TABS, closeOverview, getOverview, openOverview, type OverviewTab } from './overviewStore';
import { closeBookReader, getBook, openBookReader } from './bookStore';
import { getEdits } from './editsStore';
import { resolvePersonKey, selectionKey } from './flyTo';
import type { NavLayer, NavSel } from './nav';

export function layerNow(civ: Civ): NavLayer | null {
  const l: NavLayer = {};
  const { sel } = getSelection();
  if (sel) {
    if ((sel.kind === 'mark' || sel.kind === 'character') && sel.id === 0) return null;
    l.sel = { kind: sel.kind, id: sel.id, key: selectionKey(civ, sel) };
  }
  const ov = getOverview();
  if (ov.open) {
    const p = ov.tab === 'chronicle' ? getChronicle().polity : null;
    l.ov = p !== null && civ.polities[p] ? { tab: ov.tab, polity: polityKey(civ, p) } : { tab: ov.tab };
  }
  const r = getBook().reader;
  if (r.open) l.book = r.key ?? '';
  return l;
}

/** 记着的卡片在这份历史里是哪一个(找不到 = null) */
export function resolveSel(civ: Civ, s: NavSel): MapSelection | null {
  if (s.kind === 'mark') return getEdits().marks?.some((m) => m.id === s.id) ? { kind: 'mark', id: s.id } : null;
  if (s.kind === 'character') return getEdits().characters?.some((c) => c.id === s.id) ? { kind: 'character', id: s.id } : null;
  if (!s.key) return null;
  if (s.kind === 'person') {
    const id = resolvePersonKey(civ, s.key);
    return id >= 0 ? { kind: 'person', id } : null;
  }
  const r = resolveKey(civ, s.key);
  return r && r.kind === s.kind && r.kind !== 'dynasty' ? ({ kind: r.kind, id: r.id } as MapSelection) : null;
}

export function applyLayer(civ: Civ, l: NavLayer): NavLayer {
  const sel = l.sel ? resolveSel(civ, l.sel) : null;
  if (sel) setSelection(sel);
  else clearSelection();
  const tab = l.ov && (OVERVIEW_TABS as readonly string[]).includes(l.ov.tab) ? (l.ov.tab as OverviewTab) : null;
  if (tab) {
    const p = l.ov?.polity ? resolveKey(civ, l.ov.polity) : null;
    openOverview(tab, tab === 'chronicle' ? { polity: p && p.kind === 'polity' ? p.id : null } : {});
  } else closeOverview();
  if (l.book !== undefined) openBookReader(l.book || null);
  else closeBookReader();
  return layerNow(civ) ?? {};
}
