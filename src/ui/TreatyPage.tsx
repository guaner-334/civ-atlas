/**
 * 干预页「立约」「划中立地」点开,卡片换成的填写页(和方针页同一种做法,不弹窗;下的令先进待推演的单子,pendingStore.ts;
 * 推演里怎么办见 gen/civ/treaties.ts 的 decree)。
 *
 * 立约(TreatyPage):
 *   生效年份  −100 −10 [年份] +10(逐年推演:固定"第 N 年年初(下一步)")
 *   和谁立约  本国 + 一到三国(「＋ 在地图上点」:地图压暗、国家浮出名牌,点一个加上、再点去掉,「好了」/ Esc 回来);
 *             演一国时下面一句换成"对方肯不肯照推演的规矩定"(干预带 ask)
 *   约定      互不侵犯 / 有限竞争(三国以上默认有限竞争)
 *   期限      十年 / 二十年 / 三十年 / 五十年 / 一直(两国默认二十年,三国以上三十年)
 *   背约      照推演 / 约期内不许背约
 *   居间      可不选:默认挑和约里两国以上接壤、州最多的那国,能去掉、在地图上换
 *   同时划中立地  可不划:约里几国碰得最多的那一州(推荐的头一处),「换一处 ›」在地图上点;三国以上默认划
 *   编年史    推完以后编年史大致怎么写
 * 划中立地(ZonePage):
 *   生效年份
 *   放在哪    按推演数据挑的几处(treatyIv.ts 的 zoneChoices;头一处标"推荐"),地图上同时浮出带序号的名牌,点名牌也能选;
 *             「在地图上点别处」:只能点碰到两国以上(连同本国)的州
 *   共建的国家  碰到这州的几国都算上,可以去掉;写明原属哪国、由谁让出,几国还没有约的同时立一个互不侵犯之约(三十年)
 *   送人去    照推演 / 不送人去
 *   到什么时候  跟着约 / 一直 / 到某一年
 *   编年史
 * 底部:返回 / 加入待推演(逐年推演写「加入」)。
 */
import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MutableRefObject, type ReactNode } from 'react';
import type { WorldToClient } from './EventPins';
import type { Civ } from '../gen/civ/types';
import type { World } from '../gen/world';
import { polityAlive } from '../gen/civ/growth';
import { regionLabel } from '../gen/civ/story/display';
import { END_YEAR_MAX, TREATY_OTHERS_MAX, polityKey, regionKey, type Intervention } from '../gen/edits';
import { spaced, yearAt, yearSpanAt } from '../gen/era';
import { useEra } from './editsStore';
import { useNarrow } from './device';
import { queueIntervention } from './pendingStore';
import { nextAt, nextYear, useStepwise } from './stepwiseStore';
import { STEP_LOOK_WHY, StepEffectTime, useStepView } from './Stepwise';
import { defaultYear, getPolityPick, interventionText, nameAt, setPolityPick, usePolityPick, type PolityPick } from './Interventions';
import { YearRow, jumpTo, rgb, useYearInput } from './panelParts';
import { NationLifeHead } from './LifeHead';
import { closeCmdPage } from './panelStore';
import { getCivHighlight, setCivHighlight } from './civView';
import { alivePolities } from './crownInfo';
import { useRole } from './roleStore';
import { rolePolity } from './policyInfo';
import { nationsWord } from './treatyRows';
import { mediatorFor, setZonePlates, sharedTreaty, treatyPreview, useZonePlates, zoneChoiceAt, zoneChoiceText, zoneChoices, zonePlateText, zonePreview, type ZoneChoice } from './treatyIv';
import { treatyTitle } from '../gen/civ/story/treatyInfo';
import './policy.css';
import './treaty.css';

/** 期限的几档(0 = 一直) */
const TERMS = [10, 20, 30, 50, 0] as const;
const TERM_NAMES: Record<number, string> = { 10: '十年', 20: '二十年', 30: '三十年', 50: '五十年', 0: '一直' };

interface PageProps {
  civ: Civ;
  world: World;
  id: number;
  year: number;
  from?: number;
}

/** 两页共用:生效年份、逐年推演、演一国、在地图上点、名字 */
function useForm(civ: Civ, id: number, year: number, from?: number) {
  const era = useEra();
  const phone = useNarrow();
  const sw = useStepwise();
  const step = sw.on;
  const look = useStepView().look;
  const p = civ.polities[id];
  const key = polityKey(civ, id);
  const lo = Math.ceil(p.founded);
  const last = Math.ceil(civ.endYear) - 1;
  const hi = Math.max(lo, Math.min(last, p.ended !== undefined ? Math.ceil(p.ended) - 1 : last));
  const [msg, setMsg] = useState<string | null>(null);
  const clear = () => setMsg(null);
  const yi = useYearInput(from ?? defaultYear(p, year), lo, hi, clear);
  const y = step ? nextYear(sw) : yi.y;
  /** 看国土、谁跟谁接壤用哪一年(逐年推演的下一步还没算出来:按"现在"看) */
  const yv = step ? Math.min(nextAt(sw), civ.endYear) : y;
  const name = nameAt(p, y);
  const shown = nameAt(p, year);
  // 演一国时下的:对方肯不肯照推演的规矩定
  const role = useRole();
  const ask = !!role && rolePolity(civ, role) === id;
  /** 加不了的原因 */
  const base = (() => {
    if (step && look !== null) return STEP_LOOK_WHY;
    if (!step && !yi.valid) return `生效年份要在${spaced(yearSpanAt(lo, hi, era))}之间`;
    if (!polityAlive(p, yv)) return yv < p.founded ? `${yearAt(y, era)}还没立国` : `${yearAt(y, era)}已亡`;
    return null;
  })();
  return { era, phone, step, sw, p, key, yi, y, yv, name, shown, ask, base, msg, setMsg, clear };
}

/** 生效年份那一块(逐年推演:第 N 年年初,下一步) */
function EffectYear({ f, note }: { f: ReturnType<typeof useForm>; note: string }) {
  if (f.step) return <StepEffectTime phone={f.phone} />;
  return (
    <div className="cp-from">
      <span className="cp-k">生效年份</span>
      <YearRow yi={f.yi} label="生效年份" />
      <span className="cp-note">{note}</span>
    </div>
  );
}

/** 一组(灰底圆角):标题、标题后面的小字、内容 */
function Group({ title, em, children, act }: { title: string; em?: string; children: ReactNode; act?: string }) {
  return (
    <div className="cp-form tr-grp" data-group={act}>
      <span className="cp-form-title">
        {title}
        {em && <em className="pol-ttl-em">{em}</em>}
      </span>
      {children}
    </div>
  );
}

/** 一排几选一 */
function Seg<T extends string | number>({ items, on, set, label, act }: { items: readonly [T, string][]; on: T; set: (v: T) => void; label: string; act: string }) {
  return (
    <div className="cp-dur pol-seg" role="radiogroup" aria-label={label}>
      {items.map(([v, t]) => (
        <button key={String(v)} role="radio" aria-checked={on === v} className={on === v ? 'on' : ''} data-act={`${act}-${v}`} onClick={() => set(v)}>
          {t}
        </button>
      ))}
    </div>
  );
}

/** 国家的小圆角块:颜色点、名字,本国写"本国",别的带 ✕ 去掉 */
function Chip({ civ, q, y, self, onDrop }: { civ: Civ; q: number; y: number; self?: boolean; onDrop?: () => void }) {
  const P = civ.polities[q];
  const n = P ? nameAt(P, y) : '(新历史里没有的国家)';
  return (
    <span className={`pol-chip${self ? ' tr-self' : ''}`} data-polity={q}>
      {P && <i className="cr-dot" style={{ background: rgb(P.color) }} />}
      {n}
      {self ? (
        <em>本国</em>
      ) : (
        <button aria-label={`去掉${n}`} title={`去掉${n}`} onClick={onDrop}>
          ✕
        </button>
      )}
    </span>
  );
}

/** 下令;加不了 = 原因 */
function order(civ: Civ, id: number, shown: string, v: Intervention): string | null {
  return queueIntervention(v, interventionText(civ, v, -1, shown), { self: id, target: null, shown });
}

// ---------------------------------------------------------------------------
// 立约

export function TreatyPage({ civ, world, id, year, from }: PageProps) {
  const f = useForm(civ, id, year, from);
  const { y, yv, name, key, ask, era } = f;
  const alive = useMemo(() => alivePolities(civ, yv), [civ, yv]);
  const others = useMemo(() => new Set(alive.map((x) => x.id).filter((q) => q !== id)), [alive, id]);
  const [ps, setPs] = useState<number[]>([]);
  const psRef = useRef(ps);
  psRef.current = ps;
  // 约定、期限、居间、同时划中立地:没动过就跟着几国走(三国以上:有限竞争、三十年、划中立地)
  const [kind, setKind] = useState<'pact' | 'limited' | null>(null);
  const [term, setTerm] = useState<number | null>(null);
  const [keep, setKeep] = useState(false);
  const [by, setBy] = useState<number | null | undefined>(undefined);
  const [zoneOn, setZoneOn] = useState<boolean | null>(null);
  const [zoneAt, setZoneAt] = useState<number | null>(null);
  const multi = ps.length >= 2;
  const limited = (kind ?? (multi ? 'limited' : 'pact')) === 'limited';
  const years = term ?? (multi ? 30 : 20);
  const parties = useMemo(() => [id, ...ps], [id, ps]);
  const guess = useMemo(() => mediatorFor(civ, parties, yv), [civ, parties, yv]);
  const mid = by === undefined ? guess : by === null ? -1 : by;
  const best = useMemo(() => (ps.length ? (zoneChoices(civ, world, id, yv, 1, parties)[0] ?? null) : null), [civ, world, id, yv, parties, ps.length]);
  const picked = useMemo(() => (zoneAt !== null ? zoneChoiceAt(civ, world, id, zoneAt, yv, parties) : null), [civ, world, id, zoneAt, yv, parties]);
  const zc: ZoneChoice | null = picked ?? best;
  const zoned = !!zc && (zoneOn ?? multi);

  // 在地图上点:和谁立约(几国)/ 居间(一国)/ 中立地换一处(一州)
  const source = `treaty:${id}`;
  const pk = usePolityPick();
  const picking = pk?.source === source;
  useEffect(
    () => () => {
      if (getPolityPick()?.source === source) setPolityPick(null);
    },
    [source],
  );
  const pickParties = () => {
    f.clear();
    jumpTo(f.step ? Math.min(y, f.sw.now) : y);
    const make = (list: number[]): PolityPick => ({
      prompt: f.phone ? `点要和${name}立约的国家（已选 ${list.length} 国）` : `点要和${name}立约的国家（可以几国，已选 ${list.length} 国）`,
      sub: f.phone ? '再点一次去掉' : '再点一次去掉；选好了点「好了」',
      source,
      self: id,
      eligible: others,
      year: yv,
      keep: true,
      on: new Set(list),
      marks: new Map(list.map((q) => [q, '立约 ✓'])),
      actions: [{ label: '好了', act: 'treaty-pick-done', primary: true, onClick: () => setPolityPick(null) }],
      accept: (q) => {
        if (!others.has(q)) return `${yearAt(y, era)}这个国家不在`;
        const cur = psRef.current;
        const next = cur.includes(q) ? cur.filter((x) => x !== q) : cur.length >= TREATY_OTHERS_MAX ? null : [...cur, q];
        if (!next) return `最多和 ${TREATY_OTHERS_MAX} 国立约`;
        psRef.current = next;
        setPs(next);
        setPolityPick(make(next));
        return null;
      },
    });
    setPolityPick(make(psRef.current));
  };
  const pickMediator = () => {
    f.clear();
    jumpTo(f.step ? Math.min(y, f.sw.now) : y);
    const ok = new Set([...others].filter((q) => !ps.includes(q)));
    setPolityPick({
      prompt: `点居间的国家`,
      sub: '约里的国家不能居间',
      source,
      self: id,
      eligible: ok,
      year: yv,
      accept: (q) => {
        if (!ok.has(q)) return ps.includes(q) ? '约里的国家不能居间' : `${yearAt(y, era)}这个国家不在`;
        setBy(q);
        return null;
      },
    });
  };
  const pickZone = () => {
    f.clear();
    jumpTo(f.step ? Math.min(y, f.sw.now) : y);
    setPolityPick({
      prompt: '点要划成中立地的一州',
      sub: '要碰到约里两国以上',
      source,
      target: 'region',
      year: yv,
      accept: (r) => {
        if (!zoneChoiceAt(civ, world, id, r, yv, parties)) return `${regionLabel(civ, r)}做不了中立地：要碰到约里两国以上、有人住、不是国都`;
        setZoneAt(r);
        setZoneOn(true);
        return null;
      },
    });
  };

  const why = f.base ?? (ps.length ? null : '先选和谁立约');
  const v: Intervention = {
    kind: 'treaty',
    a: key,
    ps: ps.map((q) => polityKey(civ, q)),
    from: y,
    ...(years > 0 ? { term: years } : {}),
    ...(limited ? { limited: true as const } : {}),
    ...(keep ? { keep: true as const } : {}),
    ...(mid >= 0 ? { by: polityKey(civ, mid) } : {}),
    ...(zoned && zc ? { zone: regionKey(civ, zc.region) } : {}),
    ...(ask ? { ask: true as const } : {}),
  };
  const go = () => {
    if (why) return;
    const err = order(civ, id, f.shown, v);
    if (err) return f.setMsg(err);
    closeCmdPage();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || picking) return;
    e.stopPropagation();
    closeCmdPage();
  };

  return (
    <div className="cr-page" onKeyDown={onKey}>
      <div className="cp-body cr-form tr-form" data-treaty="form">
        <NationLifeHead kinds={['treaty']} polity={id} />
        <EffectYear f={f} note="从这年起立约，之前的历史不变。" />
        <Group title="和谁立约" act="parties">
          <span className="pol-chips">
            <Chip civ={civ} q={id} y={y} self />
            {ps.map((q) => (
              <Chip key={q} civ={civ} q={q} y={y} onDrop={() => setPs(psRef.current.filter((x) => x !== q))} />
            ))}
            {ps.length < TREATY_OTHERS_MAX && (
              <button className="cp-step pol-add" data-act="treaty-pick" onClick={() => (picking ? setPolityPick(null) : pickParties())}>
                ＋ 在地图上点
              </button>
            )}
          </span>
          {ask ? (
            <span className="cp-note tr-role">你在演{name}：对方肯不肯，照推演的规矩定（国力相近、都怕同一个强邻的更肯）。</span>
          ) : (
            <span className="cp-note">一国或几国都行，几国之间两两互不侵犯。</span>
          )}
        </Group>
        <Group title="约定" act="kind">
          <Seg label="约定" act="treaty-kind" items={[['pact', '互不侵犯'], ['limited', '有限竞争']] as const} on={limited ? 'limited' : 'pact'} set={setKind} />
          <span className="cp-note">有限竞争：互不侵犯，还要各守今疆，不占对方旁边的无主之地，不收对方的藩属。</span>
        </Group>
        <Group title="期限" act="term">
          <Seg label="期限" act="treaty-term" items={TERMS.map((t) => [t, TERM_NAMES[t]] as [number, string])} on={years} set={setTerm} />
          <span className="cp-note">到期照推演看续不续：几国还都怕同一个强邻、约期里没打过仗的，多半续约。</span>
        </Group>
        <Group title="背约" act="keep">
          <Seg label="背约" act="treaty-keep" items={[['no', '照推演'], ['keep', '约期内不许背约']] as const} on={keep ? 'keep' : 'no'} set={(k) => setKeep(k === 'keep')} />
          <span className="cp-note">照推演：一国强了、对方弱了，或者共同的强邻没了，可能背约开战。</span>
        </Group>
        <Group title="居间" em="可不选" act="by">
          <span className="pol-chips">
            {mid >= 0 && <Chip civ={civ} q={mid} y={y} onDrop={() => setBy(null)} />}
            <button className="cp-step pol-add" data-act="treaty-pick-by" onClick={() => (picking ? setPolityPick(null) : pickMediator())}>
              ＋ 在地图上点
            </button>
          </span>
          <span className="cp-note">编年史写上居间那国派去的使臣（那国的名臣）。</span>
        </Group>
        <Group title="同时划中立地" em="可不划" act="zone">
          {zc ? (
            <div className="tr-check">
              <button className={`tr-box${zoned ? ' on' : ''}`} role="checkbox" aria-checked={zoned} aria-label="同时划中立地" data-act="treaty-zone" onClick={() => setZoneOn(!zoned)}>
                {zoned ? '✓' : ''}
              </button>
              <span className="tr-check-t">
                {regionLabel(civ, zc.region)}
                <em>{zonePlateText(zc)}</em>
              </span>
              <button className="ins-link" data-act="treaty-zone-pick" onClick={() => (picking ? setPolityPick(null) : pickZone())}>
                换一处 ›
              </button>
            </div>
          ) : (
            <span className="cp-note">{ps.length ? '约里几国之间没有合适的州（要碰到两国以上、有人住、不是国都）。' : '先选和谁立约。'}</span>
          )}
        </Group>
        {ps.length > 0 && (
          <div className="tr-sum">
            <span>编年史</span>
            <span>{treatyPreview(civ, { a: id, ps, limited, term: years, keep, by: mid, zone: zoned && zc ? zc.region : -1 }, y)}</span>
          </div>
        )}
        {(f.msg || why) && <div className="cp-msg">{f.msg ?? why}</div>}
      </div>
      <div className="cp-foot mk-foot">
        <button className="cp-btn" data-act="treaty-back" onClick={closeCmdPage}>
          返回
        </button>
        <button className="cp-btn primary" data-act="treaty-go" disabled={!!why || picking} onClick={go}>
          {f.step ? '加入' : '加入待推演'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 划中立地

export function ZonePage({ civ, world, id, year, from }: PageProps) {
  const f = useForm(civ, id, year, from);
  const { y, yv, key, ask, era } = f;
  const choices = useMemo(() => zoneChoices(civ, world, id, yv), [civ, world, id, yv]);
  const [at, setAt] = useState<number | null>(null);
  const other = useMemo(() => (at !== null && !choices.some((c) => c.region === at) ? zoneChoiceAt(civ, world, id, at, yv) : null), [civ, world, id, at, yv, choices]);
  const list = useMemo(() => (other ? [...choices, other] : choices), [choices, other]);
  const c = list.find((x) => x.region === at) ?? list[0] ?? null;
  // 共建的国家:碰到这州的几国,去掉的记着(换了一处就重来)
  const [drop, setDrop] = useState<{ r: number; ps: number[] }>({ r: -1, ps: [] });
  const dropped = c && drop.r === c.region ? drop.ps : [];
  const founders = c ? c.touch.filter((q) => !dropped.includes(q)) : [];
  const owner = c?.owner ?? -1;
  const [quiet, setQuiet] = useState(false);
  const [end, setEnd] = useState<'treaty' | 'lasting' | 'until'>('treaty');
  const ui = useYearInput(y + 50, y + 1, f.step ? END_YEAR_MAX : civ.endYear, f.clear);

  // 地图上推荐那几处的名牌(点名牌也能选)
  useEffect(() => {
    setZonePlates({
      list: list.map((x, i) => ({ region: x.region, n: i + 1, name: regionLabel(civ, x.region), note: zonePlateText(x), on: x.region === c?.region })),
      pick: (r) => setAt(r),
    });
  }, [civ, list, c?.region]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => setZonePlates(null), []);
  // 选中的那一处在地图上先画成中立地的样子(共建几国颜色的细横纹,一直亮着,换了一处、去掉一国跟着换;同天灾页的预览);离开这一页收起
  const chosen = c?.region ?? -1;
  const who = founders.join(',');
  useEffect(() => {
    if (chosen < 0) {
      if (getCivHighlight()?.steady) setCivHighlight(null);
      return;
    }
    const stripes = founders.map((q) => civ.polities[q]?.color).filter((x): x is [number, number, number] => !!x);
    setCivHighlight({ regions: [chosen], polities: [], year: yv, steady: true, stripes });
  }, [chosen, yv, who]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(
    () => () => {
      if (getCivHighlight()?.steady) setCivHighlight(null);
    },
    [],
  );

  const source = `neutral:${id}`;
  const pk = usePolityPick();
  const picking = pk?.source === source;
  useEffect(
    () => () => {
      if (getPolityPick()?.source === source) setPolityPick(null);
    },
    [source],
  );
  const pickOther = () => {
    f.clear();
    jumpTo(f.step ? Math.min(y, f.sw.now) : y);
    setPolityPick({
      prompt: '点要划成中立地的一州',
      sub: '只能点碰到两国以上（连同本国）的州',
      source,
      target: 'region',
      year: yv,
      accept: (r) => {
        if (!zoneChoiceAt(civ, world, id, r, yv)) return `${regionLabel(civ, r)}做不了中立地：要碰到两国以上（连同本国）、有人住、不是国都`;
        setAt(r);
        return null;
      },
    });
  };

  const shared = c && founders.length >= 2 ? sharedTreaty(civ, founders, yv) : null;
  const why = f.base ?? (!c ? '附近没有能做中立地的州' : founders.length < 2 ? '至少要两国共建' : founders.length - 1 > TREATY_OTHERS_MAX ? `最多 ${TREATY_OTHERS_MAX + 1} 国共建，去掉几国` : owner >= 0 && !founders.includes(owner) ? `这州属${nameAt(civ.polities[owner], y)}，它得在共建的国家里` : end === 'until' && !ui.valid ? `撤的年份要在${spaced(yearSpanAt(ui.lo, ui.hi, era))}之间` : null);
  const v: Intervention | null = c
    ? {
        kind: 'neutral',
        a: key,
        region: regionKey(civ, c.region),
        ps: founders.filter((q) => q !== id).map((q) => polityKey(civ, q)),
        from: y,
        ...(quiet ? { quiet: true as const } : {}),
        ...(end === 'lasting' ? { lasting: true as const } : end === 'until' ? { until: ui.y } : {}),
        ...(ask ? { ask: true as const } : {}),
      }
    : null;
  const go = () => {
    if (why || !v) return;
    const err = order(civ, id, f.shown, v);
    if (err) return f.setMsg(err);
    closeCmdPage();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || picking) return;
    e.stopPropagation();
    closeCmdPage();
  };
  const zoneName = c ? regionLabel(civ, c.region) : '';
  const note2 = c
    ? `碰到这州的几国都算上，可以去掉。${owner >= 0 ? `${zoneName}原属${nameAt(civ.polities[owner], y)}，由${nameAt(civ.polities[owner], y)}让出。` : `${zoneName}是无主之地，不用谁让地。`}${
        shared ? `几国同在${treatyTitle(civ, shared.id)}里，依这份约设。` : founders.length >= 2 ? `${nationsWord(founders.length)}之间还没有约，同时立一个互不侵犯之约（三十年）。` : ''
      }`
    : '';

  return (
    <div className="cr-page" onKeyDown={onKey}>
      <div className="cp-body cr-form tr-form" data-neutral="form">
        <NationLifeHead kinds={['neutral']} polity={id} />
        <EffectYear f={f} note="从这年起是中立地，之前的历史不变。" />
        <Group title="放在哪" em="按推演数据挑的，碰到的国家越多越靠前" act="where">
          <div className="cp-cmds tr-picks">
            {list.map((x, i) => {
              const on = x.region === c?.region;
              return (
                <button key={x.region} className={`cp-cmd${on ? ' tr-on' : ''}`} data-region={x.region} onClick={() => setAt(x.region)}>
                  <span className={`tr-num${on ? ' on' : ''}`}>{i + 1}</span>
                  <span className="cp-cmd-main">
                    <span className="cp-cmd-name">
                      {regionLabel(civ, x.region)}
                      {i === 0 && <em className="tr-rec">推荐</em>}
                    </span>
                    <span className="cp-cmd-desc">{zoneChoiceText(civ, x, y, i === 0)}</span>
                  </span>
                  {on && <span className="cr-check">✓</span>}
                </button>
              );
            })}
            <button className="cp-cmd tr-other" data-act="neutral-pick" onClick={() => (picking ? setPolityPick(null) : pickOther())}>
              <span className="cp-cmd-main">
                <span className="cp-cmd-name">在地图上点别处</span>
                <span className="cp-cmd-desc">只能点碰到两国以上的州</span>
              </span>
              <span className="cp-cmd-go">点地图 ›</span>
            </button>
          </div>
        </Group>
        {c && (
          <Group title="共建的国家" act="founders">
            <span className="pol-chips">
              {founders.map((q) => (
                <Chip key={q} civ={civ} q={q} y={y} self={q === id} onDrop={() => setDrop({ r: c.region, ps: [...dropped, q] })} />
              ))}
            </span>
            <span className={`cp-note${ask ? ' tr-role' : ''}`}>{ask ? `你在演${f.name}：别国肯不肯共建，照推演的规矩定；这州原属的国家不肯就划不成。` : note2}</span>
          </Group>
        )}
        <Group title="送人去" act="quiet">
          <Seg label="送人去" act="neutral-quiet" items={[['yes', '照推演'], ['no', '不送人去']] as const} on={quiet ? 'no' : 'yes'} set={(k) => setQuiet(k === 'no')} />
          <span className="cp-note">照推演：几国失势的宗室会被放逐到这里，亡国之君也会逃来。</span>
        </Group>
        <Group title="到什么时候" act="end">
          <Seg label="到什么时候" act="neutral-end" items={[['treaty', '跟着约'], ['lasting', '一直'], ['until', '到某一年']] as const} on={end} set={setEnd} />
          {end === 'until' && <YearRow yi={ui} label="撤的年份" wide />}
          <span className="cp-note">跟着约：约废了、约满不续，中立地就撤，州还给原来的国家。</span>
        </Group>
        {c && founders.length >= 2 && (
          <div className="tr-sum">
            <span>编年史</span>
            <span>{zonePreview(civ, founders, c.region, y)}</span>
          </div>
        )}
        {(f.msg || why) && <div className="cp-msg">{f.msg ?? why}</div>}
      </div>
      <div className="cp-foot mk-foot">
        <button className="cp-btn" data-act="neutral-back" onClick={closeCmdPage}>
          返回
        </button>
        <button className="cp-btn primary" data-act="neutral-go" disabled={!!why || picking} onClick={go}>
          {f.step ? '加入' : '加入待推演'}
        </button>
      </div>
    </div>
  );
}

/**
 * 地图上推荐的那几处中立地(划中立地那页开着时):州治所一个点,右边带序号的名牌(选中的那处主色),点名牌选那一处;
 * 每帧按"世界坐标 → 屏幕坐标"重新摆(TargetPlates.tsx 里摆,在地图上选东西时不显示)
 */
export function ZonePlates({ civ, world, toClient }: { civ: Civ | null; world: World; toClient: MutableRefObject<WorldToClient | null> }) {
  const zp = useZonePlates();
  const plateEls = useRef(new Map<number, HTMLElement>());
  const dotEls = useRef(new Map<number, HTMLElement>());
  useEffect(() => {
    if (!zp || !civ) return;
    let raf = 0;
    // 选中的那处先摆;名牌互相压着时换到左边 / 上面 / 下面
    const order = [...zp.list].sort((a, b) => Number(b.on) - Number(a.on));
    const tick = () => {
      const placed: [number, number, number, number][] = [];
      for (const p of order) {
        const s = civ.regions.seat[p.region];
        const at = s !== undefined ? (toClient.current?.(world.mesh.x[s], world.mesh.y[s]) ?? null) : null;
        const el = plateEls.current.get(p.region);
        const dot = dotEls.current.get(p.region);
        if (dot) {
          dot.style.visibility = at ? '' : 'hidden';
          if (at) dot.style.transform = `translate(${Math.round(at[0])}px, ${Math.round(at[1])}px)`;
        }
        if (!el) continue;
        el.style.visibility = at ? '' : 'hidden';
        if (!at) continue;
        const w = el.offsetWidth;
        const h = el.offsetHeight;
        const [x, y] = at;
        const spots: [number, number][] = [
          [x + 14, y - h / 2],
          [x - 14 - w, y - h / 2],
          [x + 14, y - h - 10],
          [x + 14, y + 10],
          [x - 14 - w, y - h - 10],
          [x - 14 - w, y + 10],
        ];
        const hits = (l: number, t: number) => placed.some((b) => l < b[2] && l + w > b[0] && t < b[3] && t + h > b[1]);
        const [l, t] = spots.find(([l0, t0]) => !hits(l0, t0)) ?? spots[0];
        placed.push([l, t, l + w, t + h]);
        el.style.transform = `translate(${Math.round(l)}px, ${Math.round(t)}px)`;
        el.style.zIndex = p.on ? '1' : '';
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [zp, civ, world, toClient]);
  if (!zp || !civ) return null;
  return (
    <div className="tp-layer tr-plates" onPointerDown={(e) => e.stopPropagation()}>
      {zp.list.map((p) => (
        <Fragment key={p.region}>
          <i
            ref={(el) => {
              if (el) dotEls.current.set(p.region, el);
              else dotEls.current.delete(p.region);
            }}
            className={`tr-dot${p.on ? ' on' : ''}`}
            style={{ visibility: 'hidden' }}
            aria-hidden="true"
          />
          <button
            ref={(el) => {
              if (el) plateEls.current.set(p.region, el);
              else plateEls.current.delete(p.region);
            }}
            className={`tp-plate${p.on ? ' on' : ''}`}
            data-kind="zone"
            data-id={p.region}
            style={{ visibility: 'hidden' }}
            onClick={() => zp.pick(p.region)}
          >
            <span className={`tr-num${p.on ? ' on' : ''}`}>{p.n}</span>
            <span className="tp-name">{p.name}</span>
            <span className="tp-note">{p.note}</span>
          </button>
        </Fragment>
      ))}
    </div>
  );
}
