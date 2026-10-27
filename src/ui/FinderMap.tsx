/**
 * 照故事找世界时地图上的东西(找世界那一页的左边卡片在 FinderPage.tsx):
 *
 *   条件页     地图淡着(电脑),右边正中一张小卡片说接下来会怎样
 *   选中一个   顶上正中一条:"种子 74，第 2050 年  大景王朝、帕莱亚王国  [用这个世界]"(差一条的写"差一条";还在生成写"正在打开");
 *              地图上贴小牌子:故事里每国一块(角色色块 + 国名,立在国都上),隘口、交界、港口各一个图标(电脑上带名字,手机上只画图标);
 *              差一条的,差的那一处下面挂一句"差这条：…"。手机左上一个圆的返回
 * 小牌子每帧跟着地图走(拖动、缩放、地球仪转动都跟得上),出了地图就藏起来。
 */
import { useLayoutEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { condList, type FinderCand, type FinderPlace, type FinderQuery } from '../gen/finder/query';
import type { WorldToClient } from './EventPins';
import { setFinderPage, type FinderUi } from './finderStore';
import { foundDetail } from './finderInfo';
import { missText } from './finderText';
import { aboutMinutes, RoleTag } from './FinderConds';
import { PlaceIcon, pickedOf, placeTitle, useFinderSummary, variantOf, type FinderPreview } from './FinderResults';
import { finderEstimate } from './finderStore';
import { Icon } from './icons';

interface Pin {
  key: string;
  x: number;
  y: number;
  /** 挂在点下面(差这条那一句)/ 立在点上面 */
  below?: boolean;
  body: React.ReactNode;
}

/** 选中的那一个(条件按放宽以后的门槛说) */
function usePicked(ui: FinderUi) {
  const sum = useFinderSummary(ui);
  return useMemo(() => (sum ? pickedOf([...sum.full, ...sum.near], ui.sel) : null), [sum, ui.sel]);
}

/** 差的那一条落在哪一处:隘口条件 → 那处隘口;交界 → 那州;别的 → 那一国的国都 */
function missAt(q: FinderQuery, cand: FinderCand, places: readonly FinderPlace[], checks: readonly { ok: boolean }[]): { cell: number } | null {
  const i = checks.findIndex((c) => !c.ok);
  if (i < 0) return null;
  const ref = condList(q)[i];
  const pl = places.find((p) => p.cond === i);
  if (pl) return { cell: pl.cell };
  const role = ref.role >= 0 ? ref.role : 0;
  return cand.capitals[role] ? { cell: cand.capitals[role].cell } : null;
}

export function FinderPins({ ui, phone, preview, toClient }: { ui: FinderUi; phone: boolean; preview: FinderPreview | null; toClient: MutableRefObject<WorldToClient | null> }) {
  const picked = usePicked(ui);
  const run = ui.run;
  const ready = !!picked && !!preview && preview.seed === picked.row.seed && ui.page !== 'conds';
  const pins = useMemo((): Pin[] => {
    if (!ready || !run || !picked || !preview) return [];
    const q = run.query;
    const vq = variantOf(q, ui.variant);
    const { cand, places, verdict } = picked;
    const d = foundDetail(preview.world, preview.civ, cand, places);
    const X = preview.world.mesh.x;
    const Y = preview.world.mesh.y;
    const out: Pin[] = [];
    cand.capitals.forEach((c, i) =>
      out.push({
        key: `r${i}`,
        x: X[c.cell],
        y: Y[c.cell],
        body: (
          <span className="fd-pin-lb role">
            <RoleTag q={q} i={i} small />
            {cand.names[i]}
          </span>
        ),
      }),
    );
    // 电脑上点开一个结果时港口不标(那一页上看的是两国和隘口、交界;列表、搜的时候照标)
    for (const pl of d.places) {
      if (pl.kind === 'port' && !phone && ui.page === 'detail') continue;
      out.push({
        key: `p${pl.cond}${pl.kind}${pl.cell}`,
        x: pl.x,
        y: pl.y,
        body: phone ? (
          <span className="fd-pin-ic">
            <PlaceIcon kind={pl.kind} />
          </span>
        ) : (
          <span className="fd-pin-lb">
            <PlaceIcon kind={pl.kind} />
            {placeTitle(q, pl)}
            {pl.kind !== 'pass' && pl.name && <span className="g">{pl.name}</span>}
          </span>
        ),
      });
    }
    if (verdict.misses > 0 && !phone) {
      const at = missAt(vq, cand, places, verdict.checks);
      if (at) out.push({ key: 'miss', x: X[at.cell], y: Y[at.cell], below: true, body: <span className="fd-pin-lb warn">差这条：{missText(vq, { verdict, cand }, true)}</span> });
    }
    return out;
  }, [ready, run, picked, preview, ui.variant, ui.page, phone]);
  const layer = useRef<HTMLDivElement>(null);
  const els = useRef(new Map<string, HTMLDivElement>());
  useLayoutEffect(() => {
    if (!pins.length) return;
    let raf = 0;
    const frame = () => {
      const el = layer.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      for (const p of pins) {
        const e = els.current.get(p.key);
        if (!e) continue;
        const c = toClient.current?.(p.x, p.y) ?? null;
        const x = c ? c[0] - rect.left : NaN;
        const y = c ? c[1] - rect.top : NaN;
        if (!(x >= 0 && y >= 0 && x <= rect.width && y <= rect.height)) {
          e.style.visibility = 'hidden';
          continue;
        }
        e.style.visibility = 'visible';
        e.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
      }
      raf = requestAnimationFrame(frame);
    };
    frame();
    return () => cancelAnimationFrame(raf);
  }, [pins, toClient]);
  if (!pins.length) return null;
  return (
    <div ref={layer} className={`fd-pins${phone ? ' phone' : ''}`} aria-hidden="true">
      {pins.map((p) => (
        <div
          key={p.key}
          className={`fd-pin${p.below ? ' below' : ''}`}
          ref={(e) => {
            if (e) els.current.set(p.key, e);
            else els.current.delete(p.key);
          }}
        >
          <div className="fd-pin-in">
            {p.body}
            {!p.below && <i className="fd-pin-stem" />}
          </div>
        </div>
      ))}
    </div>
  );
}

/** 地图上盖着的:条件页的淡色和说明卡片、顶上的一条、手机左上的返回 */
export function FinderOverlay({ ui, phone, preview, loading, onUse }: { ui: FinderUi; phone: boolean; preview: FinderPreview | null; loading: boolean; onUse: () => void }) {
  const picked = usePicked(ui);
  const run = ui.run;
  const conds = ui.page === 'conds' || !run;
  if (conds) {
    if (phone) return null;
    const q = ui.query;
    const pass = condList(q).some((r) => r.cond.kind === 'pass');
    const where = pass ? '隘口在哪' : condList(q).some((r) => r.cond.kind === 'junction') ? '交界在哪' : '它们在哪';
    const m = aboutMinutes(finderEstimate(ui.count, false));
    return (
      <>
        <div className="fd-dim" />
        <div className="fd-hintcard" data-testid="finder-hint">
          <b>条件定好，点「开始找」</b>
          <span>
            会把种子 1–{ui.count} 的世界各推一遍，{m.startsWith('约') ? `大${m}` : m}。找到的在左边一个个列出来，点一个，在这里打开那个世界开场那年的地图，标出是哪几国、{where}。
          </span>
        </div>
      </>
    );
  }
  const back = (
    <button className="fd-round-back" data-act="finder-map-back" aria-label="返回" onClick={() => setFinderPage(ui.page === 'detail' ? 'results' : 'conds')}>
      <Icon name="back" size={18} />
    </button>
  );
  if (!picked) return phone ? back : null;
  const { row, cand, verdict } = picked;
  const ready = !!preview && preview.seed === row.seed && !loading;
  const names = phone ? (cand.names[0] ?? '') : cand.names.join('、');
  const fit = verdict.misses === 0;
  return (
    <>
      {phone && back}
      <div className={`fd-pill${phone ? ' phone' : ''}`} data-testid="finder-pill">
        <b>
          种子 {row.seed}，第 {cand.year} 年
        </b>
        {names && <span className="g">{names}</span>}
        {!ready ? (
          <span className="g">正在打开…</span>
        ) : !fit ? (
          !phone && <span className="warn">差一条</span>
        ) : (
          !phone &&
          ui.page !== 'detail' && (
            <button className="fd-btn small primary" data-act="finder-use-pill" onClick={onUse}>
              用这个世界
            </button>
          )
        )}
      </div>
    </>
  );
}
