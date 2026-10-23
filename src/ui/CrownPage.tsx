/**
 * 让作者的人物即位那一页:人物卡「即位…」点开,卡片换成这一页(和州卡片「在这里立国」同一种做法,不弹对话框;
 * 下的令先进待推演的单子,pendingStore.ts;推演规则见 gen/edits.ts 的干预"即位")。
 *
 *   即位年份      −100 −10 [年份] +10,默认时间轴这一年;下面一句他那年几岁(逐年推演:固定"第 N 年年初(下一步)",不能加减)
 *   当哪国的君主  现成的国家 | 另立一国
 *     现成的国家  默认人物卡上他的国家,下面写那年谁在位、让位给他;「换一国」列出那年还在的国家(大的在前,州数、谁在位),
 *                 「在地图上点」和结盟选对象一样(地图压暗、国家浮出名牌,他的国家写"他的国家";手机上放在列表底部)
 *     另立一国    选一州(默认他的出生地)、国号(不填自动起);加进单子的是两条:在那里立国、他即新国君位
 *   到哪年下台    到卒年(N 年)| 到某一年(−10 [年份] +10,后面写"退位，在位 N 年");人物没写卒年时第一项照寻常君主算
 *   性格          四条滑条,和人物卡上的是同一份(松手就存进人物卡)
 *   底部          返回 / 加入待推演(另立一国写"(2 条)";逐年推演写「加入」)
 */
import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Civ, RulerLeanings } from '../gen/civ/types';
import type { Raster } from '../gen/raster';
import type { World } from '../gen/world';
import { BIOMES } from '../gen/biomes';
import { HABITABLE_SUIT, regionLabel } from '../gen/civ/display';
import { populationAt } from '../gen/civ/growth';
import { ownersAt } from '../gen/civ/timeline';
import { rulerAt } from '../gen/civ/peopleInfo';
import { LEANING_KEYS, LEANING_TEXT, personName } from '../gen/civ/peopleText';
import { INTERVENTION_YEAR_MAX, cleanName, foundedPolityKey, polityKey, regionKey, type Intervention } from '../gen/edits';
import { characterLeanings, type AuthorCharacter } from '../gen/characters';
import { spaced, yearAt, yearFull, yearSpanAt } from '../gen/era';
import { getEdits, updateCharacter, useEra } from './editsStore';
import { getPending, queueIntervention, removePending } from './pendingStore';
import { nextYear, useStepwise } from './stepwiseStore';
import { STEP_LOOK_WHY, StepEffectTime, useStepView } from './Stepwise';
import { useNarrow } from './device';
import { getPolityPick, interventionText, nameAt, setPolityPick, usePolityPick } from './Interventions';
import { characterPolity, placeOf } from './characterInfo';
import { YearRow, jumpTo, rgb, useYearInput } from './panelParts';
import { NEW_POLITY, alivePolities, crownLine } from './crownInfo';

/** 性格四条滑条(让他即位那一页、编辑人物共用);onCommit = 松手(存进人物卡) */
export function LeanSliders({ value, onChange, onCommit }: { value: RulerLeanings; onChange: (l: RulerLeanings) => void; onCommit?: () => void }) {
  return (
    <>
      {LEANING_KEYS.map((k) => (
        <Fragment key={k}>
          <div className="cr-lean" data-leaning={k}>
            <span className="cr-lean-k">{LEANING_TEXT[k].name}</span>
            <span className="cr-range">
              <input
                type="range"
                min={0}
                max={100}
                value={value[k]}
                aria-label={LEANING_TEXT[k].name}
                style={{ '--fill': `${value[k]}%` } as CSSProperties}
                onChange={(e) => onChange({ ...value, [k]: Number(e.target.value) })}
                onPointerUp={onCommit}
                onKeyUp={onCommit}
                onBlur={onCommit}
              />
            </span>
            <span className="cr-lean-num">{value[k]}</span>
          </div>
          {k === 'develop' && <div className="cr-lean-note">推演里暂不起作用</div>}
        </Fragment>
      ))}
    </>
  );
}

type Mode = 'have' | 'new';

export function CrownPage({ civ, raster, world, year, c, onBack }: { civ: Civ; raster: Raster | null; world: World; year: number; c: AuthorCharacter; onBack: () => void }) {
  const era = useEra();
  const phone = useNarrow();
  const sw = useStepwise();
  const step = sw.on;
  const look = useStepView().look;
  const [view, setView] = useState<'form' | 'list'>('form');
  const [msg, setMsg] = useState<string | null>(null);
  const clear = () => setMsg(null);
  // 即位年份:他出生那年 … 卒年前一年(历史推到哪年为止)
  const last = Math.ceil(civ.endYear) - 1;
  const lo = Math.max(0, Math.ceil(c.born));
  const hi = Math.min(last, c.died !== undefined ? c.died - 1 : last);
  const yi = useYearInput(year, lo, Math.max(lo, hi), clear);
  const y = step ? nextYear(sw) : yi.y;
  /** 看国土、谁在位用哪一年(逐年推演的下一步还没算出来:按"现在"看) */
  const yv = step ? Math.min(y, civ.endYear) : y;
  const [mode, setMode] = useState<Mode>('have');
  // 他的国家(人物卡上的;没填 = 出生地那年归属的)
  const home = useMemo(() => characterPolity(civ, world, raster, c), [civ, world, raster, c]);
  const alive = useMemo(() => alivePolities(civ, yv), [civ, yv]);
  const aliveIds = useMemo(() => new Set(alive.map((x) => x.id)), [alive]);
  const [chosen, setChosen] = useState<number | null>(null);
  const pid = chosen ?? (aliveIds.has(home) ? home : null);
  const P = pid !== null ? civ.polities[pid] : undefined;
  const pAlive = !!P && aliveIds.has(P.id);
  // 另立一国:哪一州(默认他的出生地)、国号
  const [reg, setReg] = useState<number | null>(() => {
    if (!c.birthplace) return null;
    const r = placeOf(civ, world, raster, c.birthplace, c.born).region;
    return r !== undefined && r >= 0 ? r : null;
  });
  const [polName, setPolName] = useState('');
  // 到哪年下台:到卒年 / 到某一年(人物没写卒年:照寻常君主算)
  const [byYear, setByYear] = useState(false);
  const ui = useYearInput(Math.min(c.died ?? Infinity, y + 30), y + 1, c.died ?? INTERVENTION_YEAR_MAX, clear);
  // 性格:和人物卡上的同一份,松手就存进人物卡
  const [lean, setLean] = useState<RulerLeanings>(() => characterLeanings(c));
  const leanRef = useRef(lean);
  leanRef.current = lean;
  const saveLean = () => {
    const now = getEdits().characters?.find((x) => x.id === c.id);
    const l = leanRef.current;
    if (now && JSON.stringify(characterLeanings(now)) !== JSON.stringify(l)) updateCharacter({ ...now, leanings: { ...l } });
  };

  // 在地图上点:选国家 / 选州(地图压暗、顶上一条提示,Esc 取消);离开这一页时收起
  const source = `character:${c.id}`;
  const pk = usePolityPick();
  const picking = pk?.source === source ? (pk.target === 'region' ? 'region' : 'polity') : null;
  useEffect(
    () => () => {
      if (getPolityPick()?.source === source) setPolityPick(null);
    },
    [source],
  );
  const toYear = () => jumpTo(step ? Math.min(y, sw.now) : y);
  const pickPolity = () => {
    clear();
    toYear();
    setPolityPick({
      prompt: `选${c.name}当哪国的君主`,
      sub: `${yearAt(y, era)}即位，那年还在的国家都能选`,
      source,
      self: aliveIds.has(home) ? home : undefined,
      selfNote: '他的国家',
      selfPick: true,
      eligible: aliveIds,
      year: yv,
      accept: (q) => {
        if (!aliveIds.has(q)) return `${yearAt(y, era)}这个国家不在`;
        setChosen(q);
        setView('form');
        return null;
      },
    });
  };

  // 那一州能不能立国:没人住、也住不了人的不行
  const owners = useMemo(() => ownersAt(civ, yv), [civ, yv]);
  const regionWhy = (r: number): string | null =>
    owners.culture[r] < 0 && civ.habitat.suitability[civ.regions.seat[r]] < HABITABLE_SUIT ? `这里是${BIOMES[civ.regions.biome[r]]?.name ?? '荒地'}，住不了人，立不了国` : null;
  const pickRegion = () => {
    clear();
    toYear();
    setPolityPick({
      prompt: `选${c.name}在哪一州立国`,
      sub: `${yearAt(y, era)}立国，他是开国之君`,
      source,
      target: 'region',
      year: yv,
      accept: (r) => {
        const w = regionWhy(r);
        if (w) return w;
        setReg(r);
        return null;
      },
    });
  };

  // 下台年份
  const until = byYear ? ui.y : c.died;
  const why = (() => {
    if (step && look !== null) return STEP_LOOK_WHY;
    if (lo > hi && !step) return c.born > last ? `他${yearAt(c.born, era)}才出生，历史只推到${spaced(yearAt(Math.floor(civ.endYear), era))}` : '他在位不到一年，即不了位';
    if (!step && !yi.valid) return `即位年份要在${spaced(yearSpanAt(lo, hi, era))}之间`;
    if (step && y < c.born) return `他${yearAt(c.born, era)}才出生`;
    if (step && c.died !== undefined && y >= c.died) return `他${yearAt(c.died, era)}已经去世`;
    if (mode === 'have') {
      if (!P) return '选一个国家';
      if (!pAlive) return y < P.founded ? `${yearAt(y, era)}${nameAt(P, y)}还没立国` : `${yearAt(y, era)}${nameAt(P, y)}已亡`;
    } else {
      if (reg === null) return '选一州立国';
      const w = regionWhy(reg);
      if (w) return w;
    }
    if (byYear && !ui.valid) return `退位年份要在${spaced(yearSpanAt(ui.lo, ui.hi, era))}之间`;
    return null;
  })();

  const go = () => {
    if (why) return;
    saveLean();
    const base = { kind: 'crown' as const, char: c.id, from: y, born: c.born, leanings: { ...lean }, ...(until !== undefined && until > y ? { until } : {}) };
    const tail = until !== undefined && until > y ? until : undefined;
    if (mode === 'have') {
      const v: Intervention = { ...base, a: polityKey(civ, P!.id) };
      const err = queueIntervention(v, crownLine(c.name, nameAt(P!, y), tail, c.died, era), { self: P!.id, target: null, shown: nameAt(P!, y) });
      if (err) return setMsg(err);
    } else {
      const rk = regionKey(civ, reg!);
      const n = cleanName('polity', polName);
      const f: Intervention = n ? { kind: 'found', region: rk, from: y, name: n } : { kind: 'found', region: rk, from: y };
      const a = foundedPolityKey(civ, rk, y);
      if (!a) return setMsg('这一州立不了国');
      const e1 = queueIntervention(f, interventionText(civ, f));
      if (e1) return setMsg(e1);
      const e2 = queueIntervention({ ...base, a }, crownLine(c.name, n || NEW_POLITY, tail, c.died, era));
      if (e2) {
        // 即位那条加不上:立国那条也拿掉
        const lastOne = getPending().at(-1);
        if (lastOne?.kind === 'iv' && lastOne.v.kind === 'found') removePending(lastOne.id);
        return setMsg(e2);
      }
    }
    onBack();
  };

  // 另立一国那一州里最大的城(写"某城一带")
  const town = useMemo(() => {
    if (reg === null) return null;
    let best = null as { name: string; pop: number } | null;
    for (const s of civ.settlements) {
      if (s.region !== reg || s.founded > yv || (s.ended !== undefined && s.ended <= yv) || !s.name) continue;
      const pop = populationAt(s, yv);
      if (!best || pop > best.pop) best = { name: s.name, pop };
    }
    return best?.name ?? null;
  }, [civ, reg, yv]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'Escape' || picking) return;
    e.stopPropagation();
    if (view === 'list') setView('form');
    else onBack();
  };

  if (view === 'list') {
    return (
      <div className="cr-page" onKeyDown={onKey}>
        <div className="cp-body">
          <section className="cp-sec" data-crown="list">
            <div className="cp-sec-head cp-events-head">
              <span>当哪国的君主</span>
              <span className="cp-num-note">
                {yearFull(y, era)}还在的 {alive.length} 国
              </span>
            </div>
            <div className="oc-rows oc-people">
              {alive.map((x) => (
                <button
                  key={x.id}
                  className="oc-person cr-polity"
                  data-polity={x.id}
                  onClick={() => {
                    setChosen(x.id);
                    setView('form');
                  }}
                >
                  <i className="cr-dot lg" style={{ background: rgb(civ.polities[x.id].color) }} />
                  <span className="oc-txt">
                    <b>
                      {x.name}
                      {x.id === home && <em className="cp-num-note">他的国家</em>}
                    </b>
                    <span>
                      {x.regions} 州{x.ruler && `，${x.ruler}${x.republic ? '执政' : '在位'}`}
                    </span>
                  </span>
                  {x.id === pid && <span className="cr-check">✓</span>}
                </button>
              ))}
            </div>
          </section>
        </div>
        <div className="cp-foot mk-foot">
          <button className="cp-btn" data-act="crown-list-back" onClick={() => setView('form')}>
            返回
          </button>
          <button className="cp-btn" data-act="crown-map" onClick={pickPolity}>
            在地图上点
          </button>
        </div>
      </div>
    );
  }

  // 那年谁在位(他让位给作者的人物)
  const before = P && pAlive ? rulerAt(civ, P.id, yv) : null;
  const pRow = alive.find((x) => x.id === pid);
  const age = y - c.born;
  // 另立一国:这州那年归谁、最大的城
  const O = reg !== null && owners.polity[reg] >= 0 ? civ.polities[owners.polity[reg]] : undefined;
  const oSize = O ? (alive.find((x) => x.id === O.id)?.regions ?? 0) : 0;
  const regName = reg !== null ? regionLabel(civ, reg) : null;
  const go2 = step ? '加入' : mode === 'new' ? '加入待推演（2 条）' : '加入待推演';

  return (
    <div className="cr-page" onKeyDown={onKey}>
      <div className="cp-body cr-form" data-crown="form">
        {step ? (
          <StepEffectTime phone={phone} />
        ) : (
          <div className="cp-from">
            <span className="cp-k">即位年份</span>
            <YearRow yi={yi} label="即位年份" />
            <span className="cp-note">他那年 {age} 岁。这年之前的历史不变，之后重新推演。</span>
          </div>
        )}
        <div className="cp-form">
          <span className="cp-form-title">当哪国的君主</span>
          <div className="cp-dur" role="radiogroup" aria-label="当哪国的君主">
            <button role="radio" aria-checked={mode === 'have'} className={mode === 'have' ? 'on' : ''} data-act="crown-have" onClick={() => (setMode('have'), clear())}>
              现成的国家
            </button>
            <button role="radio" aria-checked={mode === 'new'} className={mode === 'new' ? 'on' : ''} data-act="crown-new" onClick={() => (setMode('new'), clear())}>
              另立一国
            </button>
          </div>
          {mode === 'have' ? (
            picking === 'polity' ? (
              <>
                <div className="oc-pick picking" data-crown="pick">
                  <span className="oc-pick-empty">在地图上点一国…</span>
                  <span className="oc-pick-acts">
                    <button className="cp-step" onClick={() => setPolityPick(null)}>
                      取消
                    </button>
                  </span>
                </div>
                <span className="cp-note">那年还在的 {alive.length} 国都浮出了名牌，点名牌或国土都行。</span>
              </>
            ) : (
              <>
                <div className="oc-pick cr-pick" data-crown="polity">
                  {P ? (
                    <span className="oc-pick-name">
                      <i className="cr-dot" style={{ background: rgb(P.color) }} />
                      {nameAt(P, y)}
                      {pRow && <em>{pRow.regions} 州</em>}
                    </span>
                  ) : (
                    <span className="oc-pick-empty">还没选</span>
                  )}
                  <span className="oc-pick-acts">
                    <button className="cp-step" data-act="crown-list" onClick={() => (setView('list'), clear())}>
                      换一国
                    </button>
                    {!phone && (
                      <button className="cp-step" data-act="crown-map" onClick={pickPolity}>
                        在地图上点
                      </button>
                    )}
                  </span>
                </div>
                <span className="cp-note">
                  {before && P ? `那年${P.lineage === 'republic' ? '执政' : '在位'}的是${personName(civ, before)}，他让位给${c.name}。` : ''}
                  {!P && home >= 0 ? `人物卡上他的国家${yearAt(y, era)}不在了，点「换一国」选一个。` : ''}
                  {`${yearFull(y, era)}还在的 ${alive.length} 国都能选，默认是人物卡上他的国家。`}
                </span>
              </>
            )
          ) : (
            <>
              <div className={`oc-pick${picking === 'region' ? ' picking' : ''}`} data-crown="region">
                {picking === 'region' ? (
                  <span className="oc-pick-empty">在地图上点一州…</span>
                ) : regName ? (
                  <span className="oc-pick-name">
                    {regName}
                    {town && !regName.includes(town) && <em>{town}一带</em>}
                  </span>
                ) : (
                  <span className="oc-pick-empty">还没选</span>
                )}
                <span className="oc-pick-acts">
                  <button className="cp-step" data-act="crown-region" onClick={picking === 'region' ? () => setPolityPick(null) : pickRegion}>
                    {picking === 'region' ? '取消' : '选一处'}
                  </button>
                </span>
              </div>
              <label className="cp-field">
                <span className="cp-k">国号</span>
                <input value={polName} placeholder="不填自动起" maxLength={16} data-crown="name" onChange={(e) => setPolName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()} />
              </label>
              {reg !== null && (
                <span className="cp-note">
                  {O
                    ? `这州${yearFull(y, era)}属${nameAt(O, y)}，立国后从它分出来，${c.name}是开国之君。${oSize > 1 ? '新国一开始只有这一州，几十年后常被母国收回；想让它留下来，再给新国下「保护」。' : `${nameAt(O, y)}只有这一州，会就此亡国。`}`
                    : `这州${yearFull(y, era)}无主${owners.culture[reg] < 0 ? '、还没人住，立国时会有一支新的民族在这里落脚' : ''}，${c.name}是开国之君。`}
                </span>
              )}
            </>
          )}
        </div>
        <div className="cp-form">
          <span className="cp-form-title">到哪年下台</span>
          <div className="cp-dur" role="radiogroup" aria-label="到哪年下台">
            <button role="radio" aria-checked={!byYear} className={byYear ? '' : 'on'} data-act="crown-until-death" onClick={() => (setByYear(false), clear())}>
              {c.died !== undefined ? `到卒年（${yearAt(c.died, era)}）` : '照寻常君主'}
            </button>
            <button
              role="radio"
              aria-checked={byYear}
              className={byYear ? 'on' : ''}
              data-act="crown-until-year"
              onClick={() => {
                if (byYear) return;
                ui.nudge(Math.min(c.died ?? Infinity, y + 30) - ui.y);
                setByYear(true);
              }}
            >
              到某一年
            </button>
          </div>
          {byYear && <YearRow yi={ui} label="退位年份" short after={<span className="cr-after">退位，在位 {Math.max(0, ui.y - y)} 年</span>} />}
          <span className="cp-note">
            {c.died === undefined && !byYear ? '人物卡上没写卒年：在位多久照寻常君主算，最多活到 88 岁。' : ''}
            之后照常有人继位。推演里亡国、改朝换代会让他提前下台（写出降、出奔或被废），卒年照人物卡不变。
          </span>
        </div>
        <div className="cp-form" data-sec="crown-leanings">
          <span className="cp-form-title cr-ttl">
            性格<em>和人物卡上的是同一份，这里改了人物卡跟着改</em>
          </span>
          <div className="cr-leans">
            <LeanSliders value={lean} onChange={setLean} onCommit={saveLean} />
          </div>
        </div>
        {(msg || why) && <div className="cp-msg">{msg ?? why}</div>}
      </div>
      <div className="cp-foot mk-foot">
        <button className="cp-btn" data-act="crown-back" onClick={() => (saveLean(), onBack())}>
          返回
        </button>
        <button className="cp-btn primary" data-act="crown-go" disabled={!!why || picking !== null} onClick={go}>
          {go2}
        </button>
      </div>
    </div>
  );
}
