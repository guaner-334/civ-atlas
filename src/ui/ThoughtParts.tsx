/**
 * 思潮在界面上的几块(数和文字见 thoughtInfo.ts,地图上的画法见 render/civ/thoughts.ts):
 *
 *   ThoughtLegend      地图左上角的图例(和数据图层同一种框):"律法之说 各州有几成人信" + 五档色标;世上还没有思潮写"还没有人倡任何一说"。只看,点不了
 *   ThoughtPicker      图层面板「填色」选了思潮时多一行「看哪一说」(七说一排,这一年还没有人倡的灰着点不了,悬停写哪年才有人倡)+ 五档色标
 *   ThoughtSide        侧栏(手机是拉上来的抽屉)「思潮」一组:七说一说一行,单选圆点,点一行换一说;还没有思潮的年份换成一句话 + 跳过去
 *   RegionThoughtRow   州卡片概况「思潮」一行:最盛那说几成,小字"另有某说等 N 说";都不到半成不显示
 *   RegionThoughts     开着思潮图层时州卡片多的一组:这州到半成的几说,小条 + 百分数 + 比百年前;地图上正看的那说标出来,点一行换看那说
 *   PolityThoughtRow   国家卡片概况「思潮」一行:最盛那说(点了进朝政页的思潮那块)、几成,小字"另有某说等 N 说"
 *   CourtThoughts      朝政页「思潮」一块:一说一行(名字、哪年传入、近一千年小折线、几成、渐盛 / 渐衰),底下一句最盛那说出自哪座城
 */
import { useEffect, useMemo, useRef } from 'react';
import type { Civ } from '../gen/civ/types';
import { THOUGHTS, THOUGHT_COUNT, ideologyAt, thoughtOrigin } from '../gen/civ/ideology';
import { yearAt, spaced } from '../gen/era';
import { THOUGHT_BAND_NAMES, THOUGHT_COLORS, thoughtBand, thoughtEmerged, thoughtFocus } from '../render/civ/thoughts';
import { useEra } from './editsStore';
import { setThought, useCivShow } from './civView';
import { openInfoPage, setSheet } from './panelStore';
import { Row, jumpTo, rgb } from './panelParts';
import { useYear } from './WorldOverviewMarks';
import { TREND_NAMES, cheng, polityThoughtFoot, polityThoughtRows, regionThoughts, thoughtShort, thoughtSide } from './thoughtInfo';
import './thoughts.css';

/** 五档色标:半成、一成、三成、五成、七成 */
export function ThoughtBands() {
  return (
    <div className="th-bands">
      <div className="th-bar">
        {THOUGHT_COLORS.map((c, i) => (
          <i key={i} style={{ background: rgb(c) }} />
        ))}
      </div>
      <div className="th-ticks">
        {THOUGHT_BAND_NAMES.map((t, i) => (
          <span key={t} style={{ left: `${(i * 100) / THOUGHT_BAND_NAMES.length}%` }}>
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

/** 地图左上角的图例 */
export function ThoughtLegend({ civ, phone = false }: { civ: Civ; phone?: boolean }) {
  const show = useCivShow();
  const year = useYear(civ);
  const k = thoughtFocus(civ, show, year);
  return (
    <div className={`legend th-legend${phone ? ' phone' : ''}${k < 0 ? ' empty' : ''}`} data-thought={k}>
      <div className="lg-title">
        {k < 0 ? (
          '还没有人倡任何一说'
        ) : (
          <>
            {THOUGHTS[k].name}
            <span>各州有几成人信</span>
          </>
        )}
      </div>
      <ThoughtBands />
    </div>
  );
}

/** 图层面板:「看哪一说」一行 + 五档色标 */
export function ThoughtPicker({ civ }: { civ: Civ | null }) {
  const show = useCivShow();
  const era = useEra();
  const year = useYear(civ);
  if (!civ?.ideology) return null;
  const on = thoughtFocus(civ, show, year);
  return (
    <>
      <div className="lp-sec">看哪一说</div>
      <div className="lp-fills grat-seg th-pick" role="radiogroup" aria-label="看哪一说">
        {THOUGHTS.map((t, k) => {
          const live = thoughtEmerged(civ, k, year);
          const o = thoughtOrigin(civ.ideology!, k);
          return (
            <button
              key={t.name}
              className={k === on ? 'on' : live ? undefined : 'dim'}
              role="radio"
              aria-checked={k === on}
              aria-disabled={!live}
              data-thought={k}
              title={live ? t.name : o ? `${yearAt(o.year, era)}才有人倡` : `这个世界到 ${yearAt(civ.endYear, era)}还没有人倡`}
              onClick={() => live && setThought(k)}
            >
              {thoughtShort(k)}
            </button>
          );
        })}
      </div>
      <ThoughtBands />
    </>
  );
}

/** 侧栏「思潮」一组 */
export function ThoughtSide({ civ, year }: { civ: Civ; year: number }) {
  const era = useEra();
  const show = useCivShow();
  const side = useMemo(() => thoughtSide(civ, year, era), [civ, year, era]);
  const on = thoughtFocus(civ, show, year);
  if (side.empty)
    return (
      <section className="sb-sec">
        <div className="sb-sec-head">
          <span>思潮</span>
        </div>
        <div className="sb-group" data-testid="thoughts">
          <div className="th-empty">
            <b>{side.empty.title}</b>
            <p>{side.empty.text}</p>
            {side.empty.jump !== null && (
              <button className="th-jump" data-act="first-thought" onClick={() => jumpTo(side.empty!.jump!)}>
                跳到{spaced(yearAt(side.empty.jump, era))}
              </button>
            )}
          </div>
        </div>
        {side.order && <p className="sb-note">{side.order}</p>}
      </section>
    );
  return (
    <section className="sb-sec">
      <div className="sb-sec-head">
        <span>思潮</span>
      </div>
      <div className="sb-group" data-testid="thoughts" role="radiogroup" aria-label="看哪一说">
        {side.rows.map((r) => (
          <button
            key={r.k}
            className={`sb-row two th-row${r.k === on ? ' on' : ''}${r.live ? '' : ' dim'}`}
            role="radio"
            aria-checked={r.k === on}
            aria-disabled={!r.live}
            data-thought={r.k}
            onClick={() => r.live && setThought(r.k)}
          >
            <i className="th-dot" aria-hidden="true" />
            <span className="sb-row-main">
              <b>{r.name}</b>
              <small>{r.sub}</small>
            </span>
            <span className="sb-row-side">{r.n !== null ? `${r.n} 州` : ''}</span>
          </button>
        ))}
        {side.never && (
          <div className="sb-row static th-never">
            <span className="sb-row-main">
              <small>{side.never}</small>
            </span>
          </div>
        )}
      </div>
      <p className="sb-note">颜色越深，这一州信这一说的人越多；不到半成不上色。点一行换一说看，拖时间轴看它怎么传开。</p>
    </section>
  );
}

/** 一州到半成的几说(这一年;还没有人倡的不算) */
function regionShares(civ: Civ, id: number, year: number): { k: number; share: number }[] {
  if (!civ.ideology) return [];
  const v = ideologyAt(civ.ideology, year);
  const out: { k: number; share: number }[] = [];
  for (let k = 0; k < THOUGHT_COUNT; k++) {
    const a = v[id * THOUGHT_COUNT + k] ?? 0;
    if (thoughtBand(a) >= 0 && thoughtEmerged(civ, k, year)) out.push({ k, share: a });
  }
  return out.sort((a, b) => b.share - a.share || a.k - b.k);
}

/** "另有律法之说等 2 说";只另有一说:"另有律法之说" */
const others = (list: { k: number }[]) =>
  list.length > 2 ? `另有${THOUGHTS[list[1].k].name}等 ${list.length - 1} 说` : list.length === 2 ? `另有${THOUGHTS[list[1].k].name}` : '';

/** 州卡片概况「思潮」一行(放在「信仰」下面) */
export function RegionThoughtRow({ civ, id, year }: { civ: Civ; id: number; year: number }) {
  const list = useMemo(() => regionShares(civ, id, year), [civ, id, year]);
  if (!list.length) return null;
  const more = others(list);
  return (
    <Row k="思潮">
      {THOUGHTS[list[0].k].name} {cheng(list[0].share)}
      {more && <em className="cp-num-note">{more}</em>}
    </Row>
  );
}

/** 开着思潮图层时州卡片多的一组 */
export function RegionThoughts({ civ, id, year, polity }: { civ: Civ; id: number; year: number; polity: number }) {
  const era = useEra();
  const show = useCivShow();
  const list = useMemo(() => (show.ideology ? regionThoughts(civ, id, year, polity, era) : []), [show.ideology, civ, id, year, polity, era]);
  if (!show.ideology || !list.length) return null;
  const on = thoughtFocus(civ, show, year);
  return (
    <section className="cp-sec" data-sec="thoughts">
      <div className="cp-sec-head">
        <span>思潮</span>
        <span className="cp-count">比百年前</span>
      </div>
      <div className="cp-group th-group">
        {list.map((t) => (
          <button key={t.k} className={`th-li${t.k === on ? ' on' : ''}`} data-thought={t.k} onClick={() => setThought(t.k)} title={`地图上看${t.name}`}>
            <span className="th-k">
              <b>{t.name}</b>
              {t.sub && <small>{t.sub}</small>}
            </span>
            <span className="th-share" aria-hidden="true">
              <i style={{ width: `${Math.round(Math.min(1, t.share) * 100)}%` }} />
            </span>
            <span className="th-pct">{Math.round(t.share * 100)}%</span>
            <span className={`th-tr ${t.trend}`}>{TREND_NAMES[t.trend]}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

/** 从国家卡片「思潮」一行点进来:朝政页打开后滚到「思潮」那块 */
let scrollToThoughts = false;

/** 国家卡片概况「思潮」一行(放在「国教」下面;国中各说都不到半成的不显示) */
export function PolityThoughtRow({ civ, id, year }: { civ: Civ; id: number; year: number }) {
  const list = useMemo(() => polityThoughtRows(civ, id, year), [civ, id, year]);
  if (!list.length) return null;
  const more = others(list);
  const open = () => {
    scrollToThoughts = true;
    openInfoPage('court');
    setSheet('full');
  };
  return (
    <Row k="思潮" className="th-row-v">
      <button className="ins-link" data-act="court-thoughts" onClick={open} title="看这一国的思潮">
        {list[0].name}
      </button>
      <em className="cp-num-note">
        {cheng(list[0].share)}
        {more && `，${more}`}
      </em>
    </Row>
  );
}

/** 近一千年的小折线 */
function Spark({ series, w = 72, h = 20 }: { series: number[]; w?: number; h?: number }) {
  const n = series.length;
  if (!n) return null;
  const pts = series.map((x, i) => [(i / Math.max(1, n - 1)) * (w - 3), h - 2 - Math.min(1, x) * (h - 4)] as const);
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg className="th-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <line x1="0" x2={w} y1={h - 2} y2={h - 2} className="base" />
      <polyline points={pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')} />
      <circle cx={lx} cy={ly} r="2.2" />
    </svg>
  );
}

/** 朝政页「思潮」一块(放在「历次改制」后面、「历次议事」前面) */
export function CourtThoughts({ civ, id, year }: { civ: Civ; id: number; year: number }) {
  const era = useEra();
  const list = useMemo(() => polityThoughtRows(civ, id, year, era), [civ, id, year, era]);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!scrollToThoughts) return;
    scrollToThoughts = false;
    ref.current?.scrollIntoView({ block: 'start' });
  }, []);
  if (!civ.ideology) return null;
  const foot = polityThoughtFoot(civ, list[0], era);
  return (
    <section className="cp-sec" data-sec="thoughts" ref={ref}>
      <div className="cp-sec-head">
        <span>思潮</span>
        {list.length > 0 && <span className="cp-count">{list.length} 说</span>}
      </div>
      <div className="cp-group fs-group">
        {list.length ? (
          list.map((t) => (
            <div key={t.k} className="fs-li th-cli" data-thought={t.k}>
              <span className="fs-k th-ck">
                {t.name}
                {t.sub && <small>{t.sub}</small>}
              </span>
              <Spark series={t.series} />
              <span className="fs-n th-cn">
                {cheng(t.share)}
                <small>{t.trend === 'up' ? '↑ 渐盛' : t.trend === 'down' ? '↓ 渐衰' : ' '}</small>
              </span>
            </div>
          ))
        ) : (
          <div className="fs-li">
            <span className="fs-k ct-none">国中还没有成形的思潮</span>
          </div>
        )}
      </div>
      {foot && <div className="ct-foot">{foot}</div>}
    </section>
  );
}
