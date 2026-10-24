/**
 * 编大纲的一条(概览「大纲」页右边滑出的一栏;手机上整页):
 *
 *   发生什么   新加的先选种类(三组:会查会改 / 只查不改 / 不查不改);选好了一行「换一种」
 *   时间       按某一年(前后几年)/ 在某一条之后几年内;只讲故事只有年份
 *   谁         按种类:国家、州、城在地图上点(概览先收起,点完回来接着编);占据一片地方选作者标记,或在地图上现圈几州
 *              (圈好了可以存成作者标记);作者的人物、作者标记从列表里挑;前面有立国、分裂的情节时,国家也能挑"第 N 条立的国"
 *   你写的那句 导播的字幕
 *   推完怎么查 一句话(outlineInfo.ts 的 checkText)
 * 「好了」存进大纲(缺要填的不让存,写明缺什么);「删除这一条」连它硬改出来的干预一起去掉。上下箭头换到上一条 / 下一条(改过的先存)。
 * 草稿放在 outlineStore 里:在地图上点的时候概览收起,回来还在。
 */
import { useMemo, useState, type ReactNode } from 'react';
import type { Civ } from '../gen/civ/types';
import { populationAt } from '../gen/civ/growth';
import { ownersAt } from '../gen/civ/timeline';
import { rulerAt } from '../gen/civ/peopleInfo';
import {
  DISASTER_LEVEL_NAMES,
  DISASTER_NAMES,
  DISASTER_TYPES,
  INTERVENTION_YEAR_MAX,
  MARK_COLORS,
  PLOT_SPAN_DEFAULT,
  PLOT_SPAN_MAX,
  PLOT_TEXT_MAX,
  cleanPlot,
  keyCells,
  personKey,
  polityKey,
  regionKey,
  regionOfKey,
  settlementKey,
  type DisasterLevel,
  type DisasterType,
  type Plot,
  type PlotKind,
} from '../gen/edits';
import { eraText, eraYear, spaced, worldYear, yearAt, type Era } from '../gen/era';
import { addMark, getEdits, setOutlinePlots, useEdits } from './editsStore';
import { closeEdit, editPlot, getOutlineUi, nextPlotId, patchDraft, stopOutline, useOutlineUi, type PlotDraft } from './outlineStore';
import { getCivTime, setCivHighlight, setCivTime, setSelection } from './civView';
import { closeOverview } from './overviewStore';
import { cityStands, setPolityPick, type PolityPick } from './Interventions';
import { alivePolities } from './crownInfo';
import { Icon } from './icons';
import { rgb } from './panelParts';
import { PLOT_KIND_GROUPS, PLOT_KIND_INFO, areaText, charName, checkText, cityName, personKeyName, plotNo, plotPolityColor, plotPolityName, plotWindow, regionName, type OutlineCtx } from './outlineInfo';
import { plotLine } from './OutlineSide';

/** 在地图上点的时候提示条的来源(点完、取消以后概览回到「大纲」页) */
export const OUTLINE_PICK = 'outline';

/** 草稿 → 情节(缺要填的 = null) */
function draftPlot(d: PlotDraft): Plot | null {
  if (!d.kind) return null;
  const { pickA: _p, ...rest } = d;
  void _p;
  return cleanPlot(rest);
}

/** 草稿缺什么(写在「好了」旁边) */
function missingText(d: PlotDraft): string {
  const k = d.kind;
  if (!k) return '先选发生什么';
  const need: string[] = [];
  const has = (f: keyof PlotDraft) => d[f] !== undefined;
  if (['fall', 'hold', 'capital', 'crown', 'dynasty', 'revolt', 'collapse', 'war', 'ally', 'submit', 'peace'].includes(k) && !has('a')) need.push('国家');
  if (['war', 'ally', 'submit', 'peace'].includes(k) && !has('b')) need.push('另一国');
  if ((k === 'found' || k === 'split') && !has('region')) need.push('那一州');
  if (k === 'hold' && !has('mark') && !d.regions?.length) need.push('哪片地方');
  if (k === 'capital' && !has('city')) need.push('迁到哪座城');
  if (k === 'death' && !has('person')) need.push('哪一位');
  if (k === 'crown' && !has('char')) need.push('作者的人物');
  if (k === 'disaster') {
    if (d.type === 'plague' && !has('city')) need.push('从哪座城起');
    if (d.type === 'quake' && !has('region')) need.push('哪一处');
    if (d.type === 'famine' && !has('a') && !d.regions?.length) need.push('哪国闹饥荒');
  }
  if ((k === 'war' || k === 'ally' || k === 'submit' || k === 'peace') && has('a') && d.a === d.b) return '两国要不一样';
  return need.length ? `还要选${need.join('、')}` : '';
}

/** 去掉草稿里这种情节用不上的字段(换了种类时) */
function draftFor(d: PlotDraft, kind: PlotKind): PlotDraft {
  const keep: (keyof PlotDraft)[] = ['id', 'year', 'span', 'after', 'text', 'a', 'b', 'region', 'regions', 'mark', 'city', 'person', 'how', 'char', 'name', 'type', 'level'];
  const out = { kind } as PlotDraft;
  for (const k of keep) if (d[k] !== undefined) (out as unknown as Record<string, unknown>)[k] = d[k];
  if (kind === 'disaster' && !out.type) out.type = 'famine';
  if (kind === 'story') delete out.span;
  return out;
}

/** 年份输入框(设了纪年写纪年的年数,前面一个"前"的小按钮) */
function YearField({ y, era, onChange, label }: { y: number; era?: Era; onChange: (y: number) => void; label: string }) {
  const shown = era ? eraYear(y, era) : { pre: false, n: y };
  const [text, setText] = useState<string | null>(null);
  const put = (s: string, pre = shown.pre) => {
    setText(s);
    const n = Number(s);
    if (s.trim() === '' || !Number.isFinite(n)) return;
    const v = era ? (n < 1 ? NaN : worldYear(pre, Math.floor(n), era)) : Math.floor(n);
    if (Number.isFinite(v) && v >= 0 && v <= INTERVENTION_YEAR_MAX) onChange(v);
  };
  const t = text ?? String(shown.n);
  const bad = text !== null && String(shown.n) !== text.trim();
  return (
    <>
      {era && (
        <button className="ol-pick" style={{ color: 'var(--ink)' }} onClick={() => put(t, !shown.pre)} title="纪年前 / 纪年后">
          {shown.pre ? `${era.name}前` : era.name}
        </button>
      )}
      <input className={`ol-in${bad ? ' bad' : ''}`} inputMode="numeric" aria-label={label} value={t} onChange={(e) => put(e.target.value)} onBlur={() => setText(null)} />
    </>
  );
}

/** 年数输入框(前后几年、之后几年内) */
function SpanField({ v, onChange, label }: { v: number; onChange: (v: number) => void; label: string }) {
  const [text, setText] = useState<string | null>(null);
  const t = text ?? String(v);
  return (
    <input
      className="ol-in"
      inputMode="numeric"
      aria-label={label}
      value={t}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value.trim() !== '' && Number.isFinite(n) && n >= 0 && n <= PLOT_SPAN_MAX) onChange(Math.round(n));
      }}
      onBlur={() => setText(null)}
    />
  );
}

/** 一个国家(稳定键或 `plot:编号`)的小牌子 */
function PolityTag({ o, k, year, onClear }: { o: OutlineCtx; k: string | undefined; year: number; onClear?: () => void }) {
  if (!k) return <span className="side">还没选</span>;
  const c = plotPolityColor(o, k);
  return (
    <span className="ol-tag">
      {c && <i className="ol-sw" style={{ background: rgb(c), marginRight: 0 }} />}
      {plotPolityName(o, k, year)}
      {onClear && (
        <button className="x" onClick={onClear} title="不填" aria-label="不填">
          <Icon name="close" size={12} />
        </button>
      )}
    </span>
  );
}

/** 一行:左边的名字、中间的值、右边的按钮 */
function Line({ k, children, side }: { k?: string; children: ReactNode; side?: ReactNode }) {
  return (
    <div className="ol-line">
      {k !== undefined && <span className="k">{k}</span>}
      <span className="v">{children}</span>
      {side}
    </div>
  );
}

export function OutlineEditor({ civ, phone }: { civ: Civ; phone?: boolean }) {
  const edits = useEdits();
  const era = edits.era;
  const { edit } = useOutlineUi();
  const plots = useMemo(() => edits.outline?.plots ?? [], [edits.outline]);
  const o: OutlineCtx = useMemo(() => ({ civ, plots, review: edits.outline?.review, marks: edits.marks, characters: edits.characters }), [civ, plots, edits.outline?.review, edits.marks, edits.characters]);
  const [choosing, setChoosing] = useState(false);
  if (!edit) return null;
  const d = edit.draft;
  const idx = plots.findIndex((p) => p.id === d.id);
  const fresh = idx < 0;
  const n = fresh ? Math.min(edit.at < 0 ? plots.length : edit.at, plots.length) + 1 : idx + 1;
  const title = fresh ? `第 ${n} 条（新加的）` : `第 ${n} 条`;
  const plot = draftPlot(d);
  const missing = plot ? '' : missingText(d);
  const before = fresh ? plots.slice(0, n - 1) : plots.slice(0, idx);
  const changed = fresh || !plot || JSON.stringify(plot) !== JSON.stringify(plots[idx]);
  const asPlot = { ...d, kind: d.kind ?? 'story' } as Plot;
  const w = plotWindow(o, asPlot);
  /** 在地图上点用哪一年(没发生时硬改的那一年,夹进推演年数) */
  const at = Math.min(civ.endYear, Math.max(0, w.at));

  // ---- 存、删、换一条 ----
  const save = (): boolean => {
    if (!plot) return false;
    if (getOutlineUi().run) stopOutline();
    const next = plots.slice();
    if (fresh) next.splice(n - 1, 0, plot);
    else next[idx] = plot;
    setOutlinePlots(next);
    return true;
  };
  const done = () => {
    if (!changed) return closeEdit();
    if (save()) closeEdit();
  };
  const remove = () => {
    if (fresh) return closeEdit();
    deletePlot(plots, idx);
  };
  const go = (j: number) => {
    if (j < 0 || j >= plots.length) return;
    if (changed && !fresh && !save()) return;
    setChoosing(false);
    editPlot({ ...plots[j] });
  };
  const canGo = !fresh && (!changed || !!plot);

  // ---- 在地图上点 ----
  const pick = (pk: Omit<PolityPick, 'source' | 'year'>) => {
    closeOverview();
    setCivTime({ year: at, playing: false, scrubbing: false, story: false });
    setPolityPick({ ...pk, source: OUTLINE_PICK, year: at });
  };
  const when = yearAt(at, era);
  const alive = () => new Set(alivePolities(civ, at).map((x) => x.id));
  const pickPolity = (field: 'a' | 'b', what: string) =>
    pick({
      prompt: `第 ${n} 条：在地图上点${what}`,
      sub: `${when}还在的国家都能选`,
      eligible: alive(),
      accept: (id) => {
        patchDraft({ [field]: polityKey(civ, id) });
        return null;
      },
    });
  const pickRegion = (field: 'region', what: string) =>
    pick({
      prompt: `第 ${n} 条：在地图上点${what}`,
      sub: when,
      target: 'region',
      accept: (r) => {
        patchDraft({ [field]: regionKey(civ, r) });
        return null;
      },
    });
  const pickCity = (what: string, owner?: string) => {
    const own = owner ? ownersAt(civ, at).polity : null;
    const oid = owner ? o.civ.polities.findIndex((_, i) => polityKey(civ, i) === owner) : -1;
    const ok = new Set(civ.settlements.filter((s) => cityStands(civ, s.id, at) && populationAt(s, at) > 0 && (!own || oid < 0 || own[s.region] === oid)).map((s) => s.id));
    pick({
      prompt: `第 ${n} 条：在地图上点${what}`,
      sub: oid >= 0 ? `${when}${plotPolityName(o, owner, at)}的城` : `${when}还在的城`,
      target: 'settlement',
      eligible: ok,
      accept: (id) => {
        if (!ok.has(id)) return '这座城选不了';
        patchDraft({ city: settlementKey(civ, id) });
        return null;
      },
    });
  };
  const pickRuler = () =>
    pick({
      prompt: `第 ${n} 条：在地图上点一国，选它那时的君主`,
      sub: `${when}还在的国家都能选`,
      eligible: alive(),
      accept: (id) => {
        const r = rulerAt(civ, id, at);
        if (!r) return `${when}这国没有君主`;
        patchDraft({ person: personKey(civ, r.id) });
        return null;
      },
    });
  /** 在地图上圈几州(点一州加进来,再点一下去掉;圈好了「好了」,或存成作者标记) */
  const circle = (field: 'regions') => {
    const cells = keyCells(civ.regions);
    const start = (getOutlineUi().edit?.draft[field] ?? []).map((k) => regionOfKey(k, cells)).filter((r) => r >= 0 && r < civ.regions.count);
    const finish = () => {
      setCivHighlight(null);
      setPolityPick(null);
    };
    const make = (list: number[]): PolityPick => {
      setCivHighlight(list.length ? { regions: list, polities: [], year: at, steady: true } : null);
      return {
        prompt: `第 ${n} 条：在地图上点州，圈出这片地方`,
        sub: list.length ? `已圈 ${list.length} 州，再点一州去掉` : '点一州加进来，再点一下去掉',
        source: OUTLINE_PICK,
        target: 'region',
        year: at,
        keep: true,
        actions: [
          {
            label: '存成作者标记',
            act: 'outline-save-mark',
            onClick: () => {
              if (!list.length) return finish();
              const id = addMark({ title: `第 ${n} 条圈的地方`, color: MARK_COLORS[n % MARK_COLORS.length], from: at, regions: list.map((r) => regionKey(civ, r)) });
              if (id > 0) patchDraft({ mark: id, regions: undefined });
              finish();
            },
          },
          { label: '好了', primary: true, act: 'outline-circle-done', onClick: finish },
        ],
        accept: (r) => {
          const now = (getOutlineUi().edit?.draft[field] ?? []).map((k) => regionOfKey(k, cells));
          const has = now.includes(r);
          const next = has ? now.filter((x) => x !== r) : [...now, r];
          patchDraft({ [field]: next.length ? next.map((x) => regionKey(civ, x)) : undefined });
          setPolityPick(make(next));
          return null;
        },
      };
    };
    closeOverview();
    setCivTime({ year: at, playing: false, scrubbing: false, story: false });
    setPolityPick(make(start));
  };
  const lookMark = (id: number) => {
    closeOverview();
    setSelection({ kind: 'mark', id });
  };

  // ---- 前面立起来的国家(`plot:编号`) ----
  const made = before.filter((p) => p.kind === 'found' || p.kind === 'split');
  const madePick = (field: 'a' | 'b') =>
    made.length > 0 && (
      <select
        className="ol-in"
        aria-label="前面立的国"
        value={d[field]?.startsWith('plot:') ? d[field] : ''}
        onChange={(e) => e.target.value && patchDraft({ [field]: e.target.value })}
        style={{ width: 'auto', color: 'var(--link)' }}
      >
        <option value="">前面立的国…</option>
        {made.map((p) => (
          <option key={p.id} value={`plot:${p.id}`}>
            第 {plotNo(plots, p.id)} 条立的国
          </option>
        ))}
      </select>
    );
  const mapBtn = (onClick: () => void, label = phone ? '地图上点' : '在地图上点') => (
    <button className="ol-pick" onClick={onClick}>
      <Icon name="pin" size={13} />
      {label}
    </button>
  );
  const polityLine = (k: string, field: 'a' | 'b', what: string, optional = false) => (
    <Line
      k={k}
      side={
        <>
          {madePick(field)}
          {mapBtn(() => pickPolity(field, what))}
        </>
      }
    >
      <PolityTag o={o} k={d[field]} year={at} onClear={optional && d[field] ? () => patchDraft({ [field]: undefined }) : undefined} />
      {optional && !d[field] && <span className="side">可不填</span>}
    </Line>
  );
  const regionLine = (k: string, what: string, optional = false) => (
    <Line k={k} side={mapBtn(() => pickRegion('region', what))}>
      {d.region ? (
        <span className="ol-tag">
          {regionName(civ, d.region)}
          {optional && (
            <button className="x" onClick={() => patchDraft({ region: undefined })} title="不填" aria-label="不填">
              <Icon name="close" size={12} />
            </button>
          )}
        </span>
      ) : (
        <span className="side">还没选</span>
      )}
    </Line>
  );
  const cityLine = (k: string, what: string, owner?: string) => (
    <Line k={k} side={mapBtn(() => pickCity(what, owner))}>
      {d.city ? <span className="ol-tag">{cityName(civ, d.city)}</span> : <span className="side">还没选</span>}
    </Line>
  );

  // ---- 谁(按种类) ----
  let whoLabel = '谁';
  let who: ReactNode = null;
  switch (d.kind) {
    case 'found':
      whoLabel = '在哪、国号';
      who = (
        <>
          {regionLine('哪一州', '在哪一州立国')}
          <Line k="国号">
            <input className="ol-in wide" placeholder="可不填，推演自己起" value={d.name ?? ''} maxLength={12} onChange={(e) => patchDraft({ name: e.target.value || undefined })} />
          </Line>
        </>
      );
      break;
    case 'fall':
      who = (
        <>
          {polityLine('谁亡', 'a', '亡的那一国')}
          {polityLine('亡于', 'b', '灭它的那一国', true)}
        </>
      );
      break;
    case 'hold': {
      whoLabel = '谁、哪片地方';
      const byMark = d.regions === undefined && (d.mark !== undefined || (edits.marks?.length ?? 0) > 0);
      const marks = (edits.marks ?? []).filter((m) => m.regions?.length || m.at);
      const a = d.mark !== undefined ? areaText(o, { mark: d.mark }) : null;
      who = (
        <>
          {polityLine('谁', 'a', '占这片地方的国家')}
          <Line k="哪片地方">
            <span className="ol-seg" role="radiogroup">
              <button className={byMark ? 'on' : ''} onClick={() => patchDraft({ regions: undefined, mark: d.mark ?? marks[0]?.id })} disabled={!marks.length}>
                作者标记
              </button>
              <button className={byMark ? '' : 'on'} onClick={() => patchDraft({ mark: undefined, regions: d.regions ?? [] })}>
                现圈几州
              </button>
            </span>
          </Line>
          {byMark ? (
            <Line
              k=""
              side={
                d.mark !== undefined && (
                  <button className="ol-pick" onClick={() => lookMark(d.mark!)}>
                    在地图上看
                  </button>
                )
              }
            >
              <select className="ol-in" aria-label="作者标记" value={d.mark ?? ''} onChange={(e) => patchDraft({ mark: Number(e.target.value) || undefined })}>
                {d.mark === undefined && <option value="">选一个作者标记</option>}
                {marks.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title}
                  </option>
                ))}
              </select>
              {a && <span className="side">{a.n} 州</span>}
            </Line>
          ) : (
            <Line k="" side={mapBtn(() => circle('regions'), phone ? '地图上圈' : '在地图上圈')}>
              {d.regions?.length ? <span className="ol-tag">已圈 {d.regions.length} 州</span> : <span className="side">还没圈</span>}
            </Line>
          )}
          {!marks.length && byMark === false && <div className="ol-note" style={{ padding: '0 12px 8px' }}>还没有圈了地方的作者标记；在地图上圈几州，可以存成作者标记。</div>}
        </>
      );
      break;
    }
    case 'war':
      who = (
        <>
          {polityLine('谁', 'a', '开战的那一国')}
          {polityLine('攻谁', 'b', '被攻的那一国')}
        </>
      );
      break;
    case 'ally':
    case 'peace':
      whoLabel = '两国';
      who = (
        <>
          {polityLine('这一国', 'a', '一国')}
          {polityLine('和', 'b', '另一国')}
        </>
      );
      break;
    case 'submit':
      who = (
        <>
          {polityLine('谁称臣', 'a', '称臣的那一国')}
          {polityLine('向谁', 'b', '受它称臣的那一国')}
        </>
      );
      break;
    case 'capital':
      who = (
        <>
          {polityLine('谁', 'a', '迁都的那一国')}
          {cityLine('迁到', '新国都', d.a?.startsWith('polity:') ? d.a : undefined)}
        </>
      );
      break;
    case 'death': {
      const owner = d.person ? personKeyName(civ, d.person) : '';
      who = (
        <>
          <Line k="谁" side={mapBtn(pickRuler)}>
            {d.person ? <span className="ol-tag">{owner}</span> : <span className="side">点一国，选它那时的君主</span>}
          </Line>
          <Line k="怎么死">
            <span className="ol-seg" role="radiogroup">
              {(
                [
                  [undefined, '去世'],
                  ['murdered', '遇弑'],
                  ['battle', '战死'],
                ] as const
              ).map(([v, t]) => (
                <button key={t} className={d.how === v ? 'on' : ''} onClick={() => patchDraft({ how: v })}>
                  {t}
                </button>
              ))}
            </span>
          </Line>
        </>
      );
      break;
    }
    case 'crown': {
      const chars = edits.characters ?? [];
      who = (
        <>
          <Line k="谁">
            {chars.length ? (
              <select className="ol-in" aria-label="作者的人物" value={d.char ?? ''} onChange={(e) => patchDraft({ char: Number(e.target.value) || undefined })}>
                {d.char === undefined && <option value="">选一位作者的人物</option>}
                {chars.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name || charName(o, c.id)}
                  </option>
                ))}
              </select>
            ) : (
              <span className="side">还没有作者的人物；先在概览的「人物」页捏一个</span>
            )}
          </Line>
          {polityLine('即哪国君位', 'a', '他即位的那一国')}
        </>
      );
      break;
    }
    case 'split':
      who = (
        <>
          {regionLine('哪一州', '起事自立的那一州')}
          {polityLine('从哪国分出', 'a', '它从哪国分出去', true)}
        </>
      );
      break;
    case 'disaster': {
      const type = d.type ?? 'famine';
      who = (
        <>
          <Line k="什么灾">
            <span className="ol-seg" role="radiogroup">
              {DISASTER_TYPES.map((t: DisasterType) => (
                <button key={t} className={type === t ? 'on' : ''} onClick={() => patchDraft({ type: t })}>
                  {DISASTER_NAMES[t]}
                </button>
              ))}
            </span>
          </Line>
          <Line k="轻重">
            <span className="ol-seg" role="radiogroup">
              {([1, 2, 3] as DisasterLevel[]).map((l) => (
                <button key={l} className={(d.level ?? 2) === l ? 'on' : ''} onClick={() => patchDraft({ level: l === 2 ? undefined : l })}>
                  {DISASTER_LEVEL_NAMES[l]}
                </button>
              ))}
            </span>
          </Line>
          {type === 'plague' && cityLine('从哪座城起', '瘟疫从哪座城起')}
          {type === 'quake' && regionLine('哪一处', '地震水旱的那一处（连同附近一圈州）')}
          {type === 'famine' && polityLine('哪国', 'a', '闹饥荒的国家')}
        </>
      );
      break;
    }
    case 'dynasty':
    case 'revolt':
    case 'collapse':
      who = polityLine('哪国', 'a', PLOT_KIND_INFO[d.kind].name === '民变' ? '闹民变的国家' : '那一国');
      break;
    case 'story':
      whoLabel = '在哪（可不填）';
      who = (
        <Line side={mapBtn(() => pickRegion('region', '镜头去的那一州'))}>
          {d.region ? (
            <span className="ol-tag">
              {regionName(civ, d.region)}
              <button className="x" onClick={() => patchDraft({ region: undefined })} title="不填" aria-label="不填">
                <Icon name="close" size={12} />
              </button>
            </span>
          ) : (
            <span className="side" style={{ color: 'var(--ink-3)' }}>
              不填，镜头停在上一条的地方
            </span>
          )}
        </Line>
      );
      break;
  }

  // ---- 时间 ----
  const rel = d.after !== undefined;
  const span = d.span ?? PLOT_SPAN_DEFAULT;
  const story = d.kind === 'story';
  const timeBox = (
    <div className="ol-f">
      <label>时间</label>
      <div className="ol-box">
        {!story && before.length > 0 && (
          <Line k="按">
            <span className="ol-seg" role="radiogroup">
              <button className={rel ? '' : 'on'} onClick={() => patchDraft({ after: undefined })}>
                某一年
              </button>
              <button className={rel ? 'on' : ''} onClick={() => patchDraft({ after: before[before.length - 1].id, span: d.span ?? 50 })}>
                在某一条之后
              </button>
            </span>
          </Line>
        )}
        {rel && !story ? (
          <Line k="在">
            第
            <select className="ol-in" aria-label="在第几条之后" value={d.after} onChange={(e) => patchDraft({ after: Number(e.target.value) })}>
              {before.map((p) => (
                <option key={p.id} value={p.id}>
                  {plotNo(plots, p.id)}（{plotLine(p).slice(0, 10)}）
                </option>
              ))}
            </select>
            条之后
            <SpanField v={span} label="之后几年内" onChange={(v) => patchDraft({ span: v })} />
            年内
          </Line>
        ) : (
          <Line k="哪一年" side={!story && !phone && <span className="side">{eraText(`第 ${w.lo}–${w.hi} 年`, era)}</span>}>
            <YearField y={d.year} era={era} label="哪一年" onChange={(y) => patchDraft({ year: y })} />
            年
            {!story && (
              <>
                ，前后
                <SpanField v={span} label="前后几年" onChange={(v) => patchDraft({ span: v === PLOT_SPAN_DEFAULT ? undefined : v })} />年
              </>
            )}
          </Line>
        )}
      </div>
    </div>
  );

  // ---- 发生什么 ----
  const kinds = (
    <div className="ol-kinds">
      {PLOT_KIND_GROUPS.map((g) => (
        <div key={g.head} className="ol-kgrp">
          <small>{g.head}</small>
          <div className={`ol-box${g.inline ? ' ol-kinline' : ''}`}>
            {g.kinds.map((k) =>
              g.inline ? (
                <button key={k} className={d.kind === k ? 'on' : ''} data-kind={k} onClick={() => (setChoosing(false), editPlot(draftFor(d, k), edit.at))}>
                  {PLOT_KIND_INFO[k].name}
                </button>
              ) : (
                <button key={k} className={`ol-krow${d.kind === k ? ' on' : ''}`} data-kind={k} onClick={() => (setChoosing(false), editPlot(draftFor(d, k), edit.at))}>
                  <b>{PLOT_KIND_INFO[k].name}</b>
                  <span>{PLOT_KIND_INFO[k].desc}</span>
                </button>
              ),
            )}
          </div>
        </div>
      ))}
    </div>
  );

  const body =
    !d.kind || choosing ? (
      <>
        <div className="ol-note">先选这一条发生什么，下面再填谁、哪一年。</div>
        {kinds}
      </>
    ) : (
      <>
        <div className="ol-f">
          <label>发生什么</label>
          <div className="ol-box">
            <Line
              side={
                <button className="ol-pick" data-act="outline-kind" onClick={() => setChoosing(true)}>
                  换一种 <Icon name="chevron" size={12} />
                </button>
              }
            >
              <b style={{ fontWeight: 500 }}>{PLOT_KIND_INFO[d.kind].name}</b>
            </Line>
          </div>
        </div>
        {timeBox}
        {who && (
          <div className="ol-f">
            <label>{whoLabel}</label>
            <div className="ol-box">{who}</div>
          </div>
        )}
        <div className="ol-f">
          <label>你写的那句</label>
          <textarea className="ol-area" rows={phone ? 3 : 2} maxLength={PLOT_TEXT_MAX} value={d.text ?? ''} placeholder="写一句你想让观众看到的话" onChange={(e) => patchDraft({ text: e.target.value || undefined })} />
          <div className="ol-note">{story ? `不查、不改历史。导播放到${spaced(yearAt(d.year, era))}照样停下来，打出这句。` : phone ? '导播放到这一条时打出这句。' : '导播放到这一条时打出这句；导出视频选「按大纲」时也用它当字幕。'}</div>
        </div>
        {!story && (
          <div className="ol-f">
            <label>推完怎么查</label>
            <div className="ol-note">{eraText(checkText(o, asPlot), era)}</div>
          </div>
        )}
      </>
    );

  if (phone)
    return (
      <>
        <div className="ol-ph-hd">
          <button className="back" onClick={closeEdit}>
            <Icon name="back" size={16} />
            大纲
          </button>
          <b>{title}</b>
          <button className="ol-link" data-act="outline-done" disabled={!!d.kind && !plot} onClick={done}>
            好了
          </button>
        </div>
        <div className="ol-ph-body">
          {body}
          {missing && d.kind && <div className="ol-note warn">{missing}</div>}
        </div>
        {!fresh && (
          <div className="ol-ph-ft">
            <button className="ol-btn red" data-act="outline-delete" onClick={remove}>
              删除这一条
            </button>
          </div>
        )}
      </>
    );
  return (
    <div className="ol-peek" data-testid="outline-peek" onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), closeEdit())}>
      <div className="ol-peek-hd">
        <b>{title}</b>
        <button className="ol-ic" title="上一条" aria-label="上一条" disabled={!canGo || idx <= 0} onClick={() => go(idx - 1)}>
          <Icon name="up" size={15} />
        </button>
        <button className="ol-ic" title="下一条" aria-label="下一条" disabled={!canGo || idx >= plots.length - 1} onClick={() => go(idx + 1)}>
          <Icon name="down" size={15} />
        </button>
        <button className="ol-ic" title="不改了" aria-label="关闭" onClick={closeEdit}>
          <Icon name="close" size={14} />
        </button>
      </div>
      <div className="ol-peek-body">{body}</div>
      <div className="ol-peek-ft">
        {!fresh && (
          <button className="ol-link red" data-act="outline-delete" style={{ fontSize: 13.5 }} onClick={remove}>
            删除这一条
          </button>
        )}
        <span className="sp">{d.kind ? missing : ''}</span>
        <button className="ol-btn small" onClick={closeEdit}>
          取消
        </button>
        <button className="ol-btn small primary" data-act="outline-done" disabled={!plot} onClick={done}>
          好了
        </button>
      </div>
    </div>
  );
}

/** 新加一条的草稿:年份 = 时间轴停的那一年 */
export function newDraft(civ: Civ, plots: readonly Plot[]): PlotDraft {
  const t = getCivTime().year;
  return { id: nextPlotId(plots), year: Math.max(0, Math.floor(t ?? civ.endYear / 2)) };
}

/** 照这一条复制一份(新编号),放在它后面 */
export function copyPlot(plots: readonly Plot[], i: number) {
  if (getOutlineUi().run) stopOutline();
  const next = plots.slice();
  next.splice(i + 1, 0, { ...plots[i], id: nextPlotId(plots) });
  setOutlinePlots(next);
}

/** 删一条(连它硬改出来的干预) */
export function deletePlot(plots: readonly Plot[], i: number) {
  if (getOutlineUi().run) stopOutline();
  const id = plots[i].id;
  const ivs = getEdits().interventions;
  setOutlinePlots(
    plots.filter((p) => p.id !== id),
    ivs.some((v) => v.plot === id) ? ivs.filter((v) => v.plot !== id) : undefined,
  );
  const e = getOutlineUi().edit;
  if (e?.draft.id === id) closeEdit();
}

/** 把第 from 条挪到第 to 个位置 */
export function movePlot(plots: readonly Plot[], from: number, to: number) {
  if (from === to || from < 0 || from >= plots.length) return;
  if (getOutlineUi().run) stopOutline();
  const next = plots.slice();
  const [p] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, to)), 0, p);
  setOutlinePlots(next);
}
