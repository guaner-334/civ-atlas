/**
 * 照故事找世界的结果(FinderPage.tsx 的第二、三页):
 *
 *   搜的时候   顶上是这次的条件;进度(推到第几个、找到几个全合几个差一条、还要多久、「停下」);全合的一行行加上;
 *              差一条的收着,写差在哪几类(点「展开」列出来)
 *   搜完       「推完 200 个世界：6 个全合，18 个差一条」、「再搜 200 个」(接着往后)、排序;选中的一行带「用这个世界」「为什么合、后来怎样」
 *   没找到     卡在哪几条(每条几个世界合,最少的标黄)、放宽一点试试(点了马上换,不用重推;再点换回来)、差一条的列出来(差在哪)
 *   一个结果   谁是谁(点一行地图飞过去)、条件逐条(打勾带实数)、后来怎样;「用这个世界」「换一种配法」
 *
 * 一行 = 一个世界最合的那种配法:小图、种子和开场年份、谁是谁、隘口多高(手机上只写谁是谁)。
 * 名字要那个世界生成好了才有的(国都、邻国、隘口在哪一带、交界那州)由 App 生成好以后交进来(preview)。
 */
import { useMemo, useState, type ReactNode } from 'react';
import type { Civ } from '../gen/civ/types';
import type { World } from '../gen/world';
import {
  condList,
  relaxCounts,
  relaxHints,
  relaxQuery,
  relaxVariants,
  sortRows,
  summarize,
  type FinderCand,
  type FinderPlace,
  type FinderQuery,
  type FinderRow,
  type FinderSort,
  type RelaxHint,
  type Verdict,
} from '../gen/finder/query';
import {
  finderBusy,
  finderEstimate,
  moreFinder,
  selectFinder,
  setFinderPage,
  setFinderSort,
  setFinderVariant,
  stopFinder,
  toggleFinderNear,
  type FinderUi,
} from './finderStore';
import { checkLines, condBrief, hintText, missText, nations, nearSummary, querySummary, stuckLines, type PlaceNames } from './finderText';
import { foundDetail, laterSummary, storyYears, type FoundDetail } from './finderInfo';
import { thumbUrl } from './finderThumb';
import { RoleTag, aboutMinutes } from './FinderConds';
import { Icon } from './icons';

/** 打开着的那个世界(App 生成好了交进来;还在生成 = null) */
export interface FinderPreview {
  seed: number;
  world: World;
  civ: Civ;
}

/** 地图上要飞过去的:故事里第几国 / 第几处地方 */
export type FinderFlyTo = { role: number } | { place: number };

/** 隘口、交界、港口的小图标(地图上的小牌子、列表、侧栏同一套) */
export function PlaceGlyph({ kind, size = 13 }: { kind: FinderPlace['kind']; size?: number }) {
  return (
    <svg className="fd-glyph" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      {kind === 'pass' ? (
        <path d="M3 19l5-9 4 5 4-5 5 9" />
      ) : kind === 'junction' ? (
        <>
          <circle cx="12" cy="12" r="2.6" />
          <path d="M12 3.5v6M4.6 17.4l5.2-3.6M19.4 17.4l-5.2-3.6" />
        </>
      ) : (
        <>
          <circle cx="12" cy="5.5" r="2" />
          <path d="M12 7.5V20M8.5 11h7M5 14c0 3.5 3 6 7 6s7-2.5 7-6" />
        </>
      )}
    </svg>
  );
}

export function PlaceIcon({ kind, small }: { kind: FinderPlace['kind']; small?: boolean }) {
  return (
    <span className={`fd-ic ${kind}${small ? ' sm' : ''}`}>
      <PlaceGlyph kind={kind} size={small ? 11 : 13} />
    </span>
  );
}

/** 地方叫什么("隘口""三国交界""港口") */
export function placeTitle(q: FinderQuery, pl: FinderPlace): string {
  if (pl.kind === 'pass') return '隘口';
  if (pl.kind === 'port') return '港口';
  const c = condList(q)[pl.cond]?.cond;
  return c?.kind === 'junction' ? `${nations(c.min)}交界` : '交界';
}

/** 第 variant 种门槛下的条件(放宽以后的门槛,说法跟着变) */
export function variantOf(q: FinderQuery, variant: number): FinderQuery {
  return variant ? relaxQuery(q, relaxVariants(q)[variant] ?? []) : q;
}

/** 选中的那一行、那种配法(换一种配法时是别的组合) */
export function pickedOf(rows: readonly FinderRow[], sel: { seed: number; alt: number } | null): { row: FinderRow; cand: FinderCand; verdict: Verdict; places: FinderPlace[] } | null {
  if (!sel) return null;
  const row = rows.find((r) => r.seed === sel.seed);
  if (!row) return null;
  const alt = sel.alt >= 0 ? row.alts[sel.alt] : null;
  return alt ? { row, cand: alt.cand, verdict: alt.verdict, places: alt.places } : { row, cand: row.cand, verdict: row.verdict, places: row.places };
}

/** 结果的汇总(这次的条件、放宽哪种、怎么排) */
export function useFinderSummary(ui: FinderUi) {
  const run = ui.run;
  return useMemo(() => (run ? summarize(run.query, run.reports, ui.variant, ui.sort) : null), [run?.query, run?.reports, ui.variant, ui.sort]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** 隘口那一条量出来的口子、山脊(米;cond = 哪一条隘口条件,不给 = 第一条;没有隘口条件 = null) */
function passOf(q: FinderQuery, cand: FinderCand, cond?: number): { height: number; ridge: number } | null {
  const i = cond ?? condList(q).findIndex((r) => r.cond.kind === 'pass');
  const f = i >= 0 ? cand.facts[i] : null;
  return f && f[0] !== null && f[1] !== null ? { height: Math.round(f[0]), ridge: Math.round(f[1] / 10) * 10 } : null;
}

/** 每国一行里州数后面补的("6 个邻国""5 个港口") */
function roleExtra(q: FinderQuery, role: number, cand: FinderCand): string {
  const list = condList(q);
  const i = list.findIndex((r) => r.role === role && r.cond.kind === 'neighbors');
  const v = i >= 0 ? cand.facts[i]?.[0] : null;
  if (v !== null && v !== undefined) return `，${v} 个邻国`;
  const k = list.findIndex((r) => r.role === role && r.cond.kind === 'ports');
  const w = k >= 0 ? cand.facts[k]?.[0] : null;
  return w !== null && w !== undefined && w > 1 ? `，${w} 个港口` : '';
}

function Thumb({ cand }: { cand: FinderCand }) {
  const url = cand.thumb ? thumbUrl(cand.thumb) : null;
  return url ? <img className="fd-thumb" src={url} alt="" /> : <span className="fd-thumb" />;
}

/** 列表里的一行 */
function ResultRow({ q, row, on, near, phone, actions }: { q: FinderQuery; row: FinderRow; on: boolean; near: boolean; phone: boolean; actions: ReactNode }) {
  const cand = row.cand;
  const pass = passOf(q, cand);
  const junction = row.places.find((p) => p.kind === 'junction');
  const title = `种子 ${row.seed}，第 ${cand.year} 年${phone ? '' : '开场'}`;
  const pick = () => {
    selectFinder({ seed: row.seed, alt: -1 });
    if (phone) setFinderPage('detail');
  };
  return (
    <div className={`fd-res${on ? ' on' : ''}${near ? ' near' : ''}`} data-seed={row.seed} role="button" tabIndex={0} onClick={pick} onKeyDown={(e) => e.key === 'Enter' && pick()}>
      <Thumb cand={cand} />
      <div className="fd-res-m">
        <div className="fd-res-t">
          <span>{title}</span>
          {!near && <span className="fit">全合</span>}
        </div>
        {near ? (
          <>
            <div className="fd-ln">
              {cand.roles.map((_, i) => (
                <span key={i} className="fd-ln-part">
                  <RoleTag q={q} i={i} small />
                  {cand.names[i]}
                  {i === 0 && <span className="g"> {cand.sizes[i]} 州</span>}
                </span>
              ))}
              {!cand.roles.length && junction && <span className="g">{nations(junction.polities.length)}交界</span>}
            </div>
            <div className="fd-miss">差：{missText(q, row)}</div>
          </>
        ) : (
          <>
            {cand.roles.map((_, i) => (
              <div key={i} className="fd-ln">
                <RoleTag q={q} i={i} small />
                {cand.names[i]}{' '}
                <span className="g">
                  {cand.sizes[i]} 州{i === 0 && !phone ? roleExtra(q, i, cand) : ''}
                </span>
              </div>
            ))}
            {!phone && pass && (
              <div className="fd-ln">
                <PlaceIcon kind="pass" small />
                隘口 {pass.height} 米 <span className="g">山脊约 {pass.ridge} 米</span>
              </div>
            )}
            {!phone && !pass && junction && (
              <div className="fd-ln">
                <PlaceIcon kind="junction" small />
                {placeTitle(q, junction)} <span className="g">{junction.polities.length} 国碰头</span>
              </div>
            )}
          </>
        )}
        {on && !near && actions}
      </div>
    </div>
  );
}

/** 「卡在哪几条」:最少的三条,其余的合成一行("别的 5 条 · 47 个起") */
function Stuck({ q, passCount, searched }: { q: FinderQuery; passCount: readonly number[]; searched: number }) {
  const lines = stuckLines(q, passCount);
  const top = lines.slice(0, 3);
  const rest = lines.slice(3);
  const bar = (n: number) => <span className="fd-hb">{<i style={{ width: `${Math.max(2, (n / Math.max(1, searched)) * 100)}%` }} />}</span>;
  return (
    <section>
      <div className="fd-sec-head">
        <span>卡在哪几条</span>
        <span className="fd-sec-note">{searched} 个里有几个合这一条</span>
      </div>
      <div className="fd-grp">
        {top.map((l, k) => (
          <div key={l.cond} className={`fd-cnt${k < 2 && l.count < searched ? ' hot' : ''}`}>
            <span className="c">{l.text}</span>
            {bar(l.count)}
            <span className="a">{l.count} 个</span>
          </div>
        ))}
        {rest.length > 0 && (
          <div className="fd-cnt">
            <span className="c g">别的 {rest.length} 条</span>
            {bar(rest[0].count)}
            <span className="a">{rest[0].count} 个起</span>
          </div>
        )}
      </div>
    </section>
  );
}

function Relax({ q, hints, variant }: { q: FinderQuery; hints: readonly RelaxHint[]; variant: number }) {
  if (!hints.length) return null;
  return (
    <section>
      <div className="fd-sec-head">
        <span>放宽一点试试</span>
        <span className="fd-sec-note">点了马上出，不用重推</span>
      </div>
      <div className="fd-grp">
        {hints.map((h) => (
          <button key={h.variant} className={`fd-row fd-relax${variant === h.variant ? ' on' : ''}`} data-variant={h.variant} aria-pressed={variant === h.variant} onClick={() => setFinderVariant(h.variant)}>
            <span className="fd-v">{hintText(q, h)}</span>
            <span className="fd-side link">{h.full ? `${h.full} 个全合` : `${h.near} 个差一条`}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

const SORTS: readonly (readonly [FinderSort, string])[] = [
  ['fit', '最合的在前'],
  ['early', '开场早的在前'],
  ['late', '开场晚的在前'],
  ['pass', '隘口最险的在前'],
];

/** 顶上:返回、标题和一句话(搜的时候是这次的条件,搜完是推完几个、找到几个) */
function ResultsTop({ ui, phone, busy, full, near }: { ui: FinderUi; phone: boolean; busy: boolean; full: number; near: number }) {
  const run = ui.run!;
  const q = run.query;
  const sum = querySummary(q);
  const searched = run.reports.length;
  const done = run.progress?.state === 'done';
  const next = { from: Math.max(...run.reports.map((r) => r.seed), 0) + 1, count: ui.count };
  const hasPass = condList(q).some((r) => r.cond.kind === 'pass');
  const more = (
    <div className="fd-more">
      <button className="fd-btn small" data-act="finder-more" onClick={moreFinder}>
        再搜 {ui.count} 个
      </button>
      <span className="fd-more-note">
        种子 {next.from}–{next.from + next.count - 1}，{aboutMinutes(finderEstimate(next.count, phone))}
      </span>
      <span className="fd-flex" />
      {full > 0 && !phone && (
        <span className="fd-val pick plain">
          {SORTS.find((s) => s[0] === ui.sort)?.[1]}
          <Icon name="down" size={12} />
          <select aria-label="排序" value={ui.sort} onChange={(e) => setFinderSort(e.target.value as FinderSort)}>
            {SORTS.filter((s) => s[0] !== 'pass' || hasPass).map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </select>
        </span>
      )}
    </div>
  );
  if (phone)
    return (
      <div className="fd-sheet-hd">
        <div className="fd-sheet-row">
          <b>照故事找世界</b>
          <button className="fd-link" data-act="finder-conds" onClick={() => setFinderPage('conds')}>
            改条件
          </button>
        </div>
        {!busy && (
          <>
            <div className="fd-lead strong">{full ? `推完 ${searched} 个世界：${full} 个全合，${near} 个差一条。` : `推完 ${searched} 个世界，没有全合的。`}</div>
            {more}
          </>
        )}
      </div>
    );
  return (
    <div className="fd-top">
      <button className="fd-back" data-act="finder-conds" onClick={() => setFinderPage('conds')}>
        <Icon name="back" size={15} />
        改条件
      </button>
      <div className="fd-title">照故事找世界</div>
      {busy ? (
        <div className="fd-lead roles">
          {sum.roles.map((t, i) => (
            <div key={i}>
              <RoleTag q={q} i={i} small /> {t}
            </div>
          ))}
          {sum.together && <div className="g">一起：{sum.together}</div>}
        </div>
      ) : (
        <>
          <div className="fd-lead strong">
            {full ? `推完 ${searched} 个世界：${full} 个全合，${near} 个差一条。` : `推完 ${searched} 个世界，没有全合的。`}
            {!done && run.progress?.state === 'stopped' && run.progress.done < run.progress.total ? '（停下了）' : ''}
          </div>
          {more}
        </>
      )}
    </div>
  );
}

function Progress({ ui, phone }: { ui: FinderUi; phone: boolean }) {
  const p = ui.run?.progress;
  if (!p) return null;
  const at = Math.min(p.total, p.done + 1);
  const left = p.etaMs > 0 ? `还要${aboutMinutes(p.etaMs)}` : '';
  const paused = p.state === 'paused';
  return (
    <div className="fd-grp fd-prog" data-testid="finder-progress">
      <div className="l1">
        <span>{paused ? `暂停在第 ${p.done} / ${p.total} 个世界` : `正在推第 ${at} / ${p.total} 个世界`}</span>
        <button className="fd-btn small" data-act="finder-stop" onClick={stopFinder}>
          {!phone && <i className="fd-stop" />}
          停下
        </button>
      </div>
      <div className="fd-bar">
        <i style={{ width: `${(p.done / Math.max(1, p.total)) * 100}%` }} />
      </div>
      <div className="l3">
        找到 {p.full} 个全合、{p.near} 个差一条。
        {phone ? '锁屏或切走会暂停，回来接着算。' : paused ? '页面切到后台时先停着，回来接着算。' : `在后台算，地图照样能拖、能点${left ? `；${left}` : ''}。`}
        {p.error ? ` ${p.error}` : ''}
      </div>
    </div>
  );
}

export function FinderResults({ ui, phone, onUse }: { ui: FinderUi; phone: boolean; onUse: () => void }) {
  const run = ui.run!;
  const q = run.query;
  const vq = variantOf(q, ui.variant);
  const sum = useFinderSummary(ui)!;
  const busy = finderBusy(ui);
  const base = useMemo(() => (ui.variant ? summarize(q, run.reports, 0) : sum), [q, run.reports, ui.variant, sum]);
  const hints = useMemo(() => (busy || base.full.length ? [] : relaxHints(q, run.reports)), [busy, base.full.length, q, run.reports]);
  // 换了放宽的那种以后,原来那几种还要列着(点了的那一行亮着)
  const shownHints = useMemo(() => {
    if (!ui.variant || hints.some((h) => h.variant === ui.variant)) return hints;
    const h = relaxCounts(q, run.reports).find((x) => x.variant === ui.variant);
    return h ? [...hints, h] : hints;
  }, [hints, ui.variant, q, run.reports]);
  const none = !busy && !base.full.length && run.reports.length > 0;
  const selSeed = ui.sel?.seed ?? null;
  const actions = !busy && !phone && (
    <div className="fd-acts">
      <button
        className="fd-btn primary small"
        data-act="finder-use"
        onClick={(e) => {
          e.stopPropagation();
          onUse();
        }}
      >
        用这个世界
      </button>
      <button
        className="fd-btn small"
        data-act="finder-detail"
        onClick={(e) => {
          e.stopPropagation();
          setFinderPage('detail');
        }}
      >
        为什么合、后来怎样
      </button>
    </div>
  );
  const rows = (list: readonly FinderRow[], near: boolean) => (
    <div className="fd-grp fd-list">
      {list.map((r) => (
        <ResultRow key={r.seed} q={vq} row={r} on={r.seed === selSeed} near={near} phone={phone} actions={actions} />
      ))}
    </div>
  );
  const nearList = sum.near;
  const nearOpen = ui.nearOpen || none;
  return (
    <>
      <ResultsTop ui={ui} phone={phone} busy={busy} full={base.full.length} near={base.near.length} />
      <div className={`fd-body${!busy ? ' fade' : ''}`} data-page="results">
        {busy && <Progress ui={ui} phone={phone} />}
        {none && <Stuck q={q} passCount={base.passCount} searched={run.reports.length} />}
        {none && <Relax q={q} hints={shownHints} variant={ui.variant} />}
        {sum.full.length > 0 && (
          <section>
            <div className="fd-sec-head">
              <span>
                全合<em>{sum.full.length} 个{busy && !phone ? '，最合的在前' : ''}</em>
              </span>
            </div>
            {rows(sum.full, false)}
          </section>
        )}
        {nearList.length > 0 && (
          <section>
            <div className="fd-sec-head">
              <span>
                差一条<em>{nearList.length} 个</em>
              </span>
              {!none && (
                <button className="fd-link" data-act="finder-near" onClick={toggleFinderNear}>
                  {ui.nearOpen ? '收起' : '展开'}
                </button>
              )}
            </div>
            {nearOpen ? rows(nearList, true) : <div className="fd-grp"><div className="fd-row g">差在：{nearSummary(vq, nearList)}</div></div>}
          </section>
        )}
        {!busy && !sum.full.length && !nearList.length && run.reports.length > 0 && <div className="fd-grp"><div className="fd-row g">差一条的也没有。改宽一点条件，或者再搜一批。</div></div>}
      </div>
    </>
  );
}

/** 几个国名连成一句,一行放得下的几个(最多三个),放不下的写"等" */
function fewNames(names: readonly string[], max = 15): string {
  const out: string[] = [];
  let len = 0;
  for (const n of names) {
    if (out.length >= 3 || (out.length && len + n.length + 1 > max)) break;
    out.push(n);
    len += n.length + 1;
  }
  return `${out.join('、')}${out.length < names.length ? '等' : ''}`;
}

/** 「谁是谁」里一处地方的小字 */
function placeNote(q: FinderQuery, pl: FoundDetail['places'][number], cand: FinderCand, phone: boolean): string {
  if (pl.kind === 'pass') {
    const p = passOf(q, cand, pl.cond);
    if (!p) return pl.name ? `${pl.name}一带` : '';
    return phone ? `口子 ${p.height} 米，山脊约 ${p.ridge} 米` : `${pl.name}一带，口子 ${p.height} 米，两边山脊约 ${p.ridge} 米`;
  }
  if (pl.kind === 'port') return pl.name;
  const own = pl.owner === null ? '无主' : `归${pl.owner}`;
  if (phone || !cand.roles.length) return `${pl.name}，${own}`;
  const who = cand.roles.length === 2 ? '两国' : cand.roles.length === 3 ? '三国' : '';
  return `${pl.name}，${own}${pl.others.length ? `；${who}和${pl.others.join('、')}在这里碰头` : ''}`;
}

export function FinderDetail({ ui, phone, preview, onUse, onFly }: { ui: FinderUi; phone: boolean; preview: FinderPreview | null; onUse: () => void; onFly: (to: FinderFlyTo) => void }) {
  const run = ui.run!;
  const q = run.query;
  const vq = variantOf(q, ui.variant);
  const sum = useFinderSummary(ui)!;
  const picked = pickedOf([...sum.full, ...sum.near], ui.sel);
  const [open, setOpen] = useState<'checks' | 'later' | null>(null);
  const ready = !!picked && !!preview && preview.seed === picked.row.seed;
  const detail = useMemo(() => (ready ? foundDetail(preview!.world, preview!.civ, picked!.cand, picked!.places) : null), [ready, preview, picked?.cand, picked?.places]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!picked) return null;
  const { row, cand, verdict } = picked;
  const fit = verdict.misses === 0;
  const names: PlaceNames = new Map();
  for (const pl of detail?.places ?? []) if (pl.name) names.set(pl.cond, pl.name);
  const lines = checkLines(vq, verdict.checks, cand.facts, cand.year, names);
  const okAll = lines.every((l) => l.ok);
  const later = ready ? laterSummary(preview!.civ, q, cand, storyYears(q)) : '';
  const alts = row.alts.length;
  const nextAlt = () => selectFinder({ seed: row.seed, alt: ui.sel && ui.sel.alt + 1 < alts ? ui.sel.alt + 1 : -1 });
  const back = () => setFinderPage('results');
  // 隘口、交界在前,港口在后(电脑上「谁是谁」不列港口:港口那一条在条件逐条里写着最近的是哪座)
  const order = { pass: 0, junction: 1, port: 2 } as const;
  const places = (detail?.places ?? []).filter((pl) => phone || pl.kind !== 'port').sort((a, b) => order[a.kind] - order[b.kind]);
  const who = (
    <div className="fd-grp">
      {cand.roles.map((_, i) => {
        const d = detail?.roles[i];
        return (
          <button key={`r${i}`} className="fd-row who" data-act="fly-role" onClick={() => onFly({ role: i })}>
            <RoleTag q={q} i={i} />
            <span className="fd-v">
              {cand.names[i]}
              {!phone && d && (
                <small>
                  {d.capital ? `都${d.capital}` : ''}
                  {d.neighbors.length ? `${d.capital ? '；' : ''}和${fewNames(d.neighbors)}接壤` : ''}
                </small>
              )}
            </span>
            <span className="fd-side">{cand.sizes[i]} 州</span>
          </button>
        );
      })}
      {places.map((pl, k) => (
        <button key={`p${k}`} className="fd-row who" data-act={`fly-${pl.kind}`} onClick={() => onFly({ place: (detail?.places ?? []).indexOf(pl) })}>
          <PlaceIcon kind={pl.kind} />
          <span className="fd-v">
            {placeTitle(q, pl)}
            <small>{placeNote(vq, pl, cand, phone)}</small>
          </span>
        </button>
      ))}
      {!detail && <div className="fd-row g">正在打开这个世界…</div>}
    </div>
  );
  const checks = (
    <div className="fd-grp fd-checks">
      {lines.map((l, k) => (
        <div key={k} className="fd-ck">
          <span className={l.ok ? 'y' : 'n'}>{l.ok ? <Icon name="check" size={13} /> : <Icon name="close" size={13} />}</span>
          <span className="c">{l.text}</span>
          <span className="a">{l.value}</span>
        </div>
      ))}
    </div>
  );
  const story = (
    <div className="fd-grp fd-later">
      {cand.story.slice(0, 6).map((s, k) => (
        <div key={k}>
          <span className="yr">{s.year}</span>
          {s.text}
        </div>
      ))}
      {!cand.story.length && <div className="g">开场以后这几国没有大事。</div>}
      {later && <p>{later}</p>}
    </div>
  );
  const title = (
    <div className="fd-title fd-title-fit">
      种子 {row.seed}，第 {cand.year} 年开场<span className={fit ? 'fit' : 'fit miss'}>{fit ? '全合' : '差一条'}</span>
    </div>
  );
  const altBtn = alts > 0 && (
    <button className="fd-btn" data-act="finder-alt" onClick={nextAlt}>
      换一种配法<span className="g">（还有 {alts} 种）</span>
    </button>
  );
  if (phone) {
    const firstLine = cand.story[0] ? `${cand.story[0].year === cand.year ? '开场' : `${cand.story[0].year} 年`}${cand.story[0].text}` : '';
    return (
      <>
        <div className="fd-sheet-hd">
          <button className="fd-back" data-act="finder-results" onClick={back}>
            <Icon name="back" size={15} />
            全部结果
          </button>
          {title}
        </div>
        <div className="fd-body" data-page="detail">
          {who}
          <div className="fd-grp">
            <button className="fd-row" data-act="finder-checks" onClick={() => setOpen(open === 'checks' ? null : 'checks')}>
              <span className="fd-v">条件逐条</span>
              <span className={`fd-side ${okAll ? 'ok' : 'warn'}`}>{okAll ? `${lines.length} 条都合` : `差 ${lines.filter((l) => !l.ok).length} 条`}</span>
              <Icon name={open === 'checks' ? 'down' : 'chevron'} size={14} />
            </button>
            {open === 'checks' && checks}
            <button className="fd-row" data-act="finder-later" onClick={() => setOpen(open === 'later' ? null : 'later')}>
              <span className="fd-v">
                后来<small className="one">{later || firstLine}</small>
              </span>
              <Icon name={open === 'later' ? 'down' : 'chevron'} size={14} />
            </button>
            {open === 'later' && story}
          </div>
          {altBtn}
        </div>
        <footer className="fd-foot">
          <button className="fd-btn primary big" data-act="finder-use" onClick={onUse}>
            用这个世界
          </button>
        </footer>
      </>
    );
  }
  return (
    <>
      <div className="fd-top">
        <button className="fd-back" data-act="finder-results" onClick={back}>
          <Icon name="back" size={15} />
          全部结果
        </button>
        {title}
        <div className="fd-acts top">
          <button className="fd-btn primary grow" data-act="finder-use" onClick={onUse}>
            用这个世界
          </button>
          {altBtn}
        </div>
      </div>
      <div className="fd-body" data-page="detail">
        <section>
          <div className="fd-sec-head">
            <span>谁是谁</span>
            <span className="fd-sec-note">点一行，地图飞过去</span>
          </div>
          {who}
        </section>
        <section>
          <div className="fd-sec-head">
            <span>条件逐条</span>
            <span className="fd-sec-note">这个世界里的数</span>
          </div>
          {checks}
        </section>
        <section>
          <div className="fd-sec-head">
            <span>后来</span>
            <span className="fd-sec-note">照常推下去，还没加干预</span>
          </div>
          {story}
        </section>
      </div>
    </>
  );
}

/** 地图顶上那一条里写的("种子 74，第 2050 年 大景王朝、帕莱亚王国") */
export function pillText(q: FinderQuery, cand: FinderCand, seed: number, phone: boolean): { head: string; names: string } {
  const names = phone ? (cand.names[0] ?? '') : cand.names.join('、');
  return { head: `种子 ${seed}，第 ${cand.year} 年`, names: names || (cand.roles.length ? '' : condBrief(q, -1, q.together[0] ?? { kind: 'span', years: 0 })) };
}
