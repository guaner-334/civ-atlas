/**
 * 作者的人物进推演的几页(人物卡「进推演…」点开,卡片换成这几页,和即位那一页同一种做法,不弹对话框;下的令先进待推演的单子,pendingStore.ts;
 * 推演规则见 gen/edits.ts 的干预"任将 / 任臣""让他掌权"、gen/civ/appoint.ts;写到这个人物的"他 / 她"按人物卡上的性别):
 *
 *   选身份    让他进推演，当什么:当君主(进即位那一页,CrownPage.tsx)/ 当将领 / 当名臣 / 掌权,一行一种、右边「填写 ›」;
 *             他名下已有令(单子里的、推过的)多一块「他名下的」,一行一条
 *   当将领    当哪国的将领(默认人物卡上他的国家;「换一国」列出那年还在的国家、「在地图上点」)、什么时候任将(年份;逐年推演固定下一步年初)、
 *             到哪年卸任(到卒年 | 到某一年)、能力(寻常 | 良将 | 名将)、灰底「照现在的推演,他会领哪几仗」(appoint.ts 的 appointPreview;
 *             一仗都没有的写明原因:这些年本国没打仗 / 四周没有走得过去的邻国)、
 *             出征(勾「同时派他出征」:伐哪国(那年接壤、没在交战的)、出征年份(在他任上);加进单子的是两条:任将、宣战点他挂帅)
 *   当名臣    入哪国的朝(下面写那年在朝的推演名臣)、什么时候入朝、到哪年去职、黄底"只改编年史和人物卡"、灰底「他做什么」
 *             (经手、照现在这些年朝中有几件事、官:侍郎做起经手一件升一级,officials.ts 的 deedPosts)
 *   掌权      掌哪国的权(下面写那年谁在位)、从哪一年起、怎么掌权(大臣专权 | 大将专权:要他这时在当这国的将领)、几年后还政、
 *             灰底会怎样(和推演人物掌权那一页同一套句子,RegentIvPage.tsx)
 *   底部      返回 / 加入待推演(派他出征写"(2 条)";逐年推演写「加入」)
 * polity = 先选好的国家(国家干预页选人进来的;不给 = 人物卡上他的国家);from = 先填好的年份(经历进推演;不给 = 时间轴这一年);
 * life = 照「一生」里哪一段经历填的(经历旁「进推演…」进来的):页顶多一块「照这段经历填好了」(LifeHead.tsx);
 * 当将领那一页 send = 一打开就勾上「同时派他出征」(经历进推演选「出征」)
 */
import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { Civ, Person } from '../gen/civ/types';
import type { Raster } from '../gen/raster';
import type { World } from '../gen/world';
import { rulerAt, peopleIndex } from '../gen/civ/story/peopleInfo';
import { personName, rulerShort } from '../gen/civ/story/peopleText';
import { heOrShe } from '../gen/civ/story/gender';
import { postAt } from '../gen/civ/story/officialText';
import { authorMinisterLadder, courtDeeds } from '../gen/civ/officials';
import { regimeAt, royalAt } from '../gen/civ/regime';
import { appointEnd, appointPreview, type AuthorPost } from '../gen/civ/appoint';
import {
  APPOINT_SKILL_POWER,
  INTERVENTION_YEAR_MAX,
  REGENT_YEARS_MAX,
  polityKey,
  type AppointSkill,
  type Intervention,
} from '../gen/edits';
import { characterLeanings, type AuthorCharacter } from '../gen/characters';
import { spaced, yearAt, yearFull, yearSpanAt, type Era } from '../gen/era';
import { getEdits, useEra } from './editsStore';
import { getPending, queueIntervention, removePending, usePending } from './pendingStore';
import { nextAt, nextYear, useStepwise } from './stepwiseStore';
import { STEP_LOOK_WHY, StepEffectTime, useStepView } from './Stepwise';
import { useNarrow } from './device';
import { declareTargets, getPolityPick, interventionText, nameAt, neighborsAt, setPolityPick, usePolityPick } from './Interventions';
import { characterPolity } from './characterInfo';
import { Row, YearRow, jumpTo, rgb, useYearInput, type YearInput } from './panelParts';
import { alivePolities, characterCrowns, crownTail, type AlivePolity } from './crownInfo';
import { AUTHOR_HOW_NAMES, SKILL_NAMES, characterPosts, deedText, holdsPost, overlapWhy, postLine, postRole, type PostIv, type PostState } from './authorIvInfo';
import { LifeHead } from './LifeHead';
import type { LifeTag } from './lifeTag';
import './newIv.css';

/** 选身份那一页的几种 */
export type AuthorIvRole = 'crown' | 'general' | 'minister' | 'regent';

/** 当将领、名臣、掌权的人要到这么多岁(同推演:appoint.ts 的 APPOINT_AGE、掌权) */
const AUTHOR_IV_AGE = 16;

interface PageProps {
  civ: Civ;
  raster: Raster | null;
  world: World;
  year: number;
  c: AuthorCharacter;
  /** 先选好的国家(不给 = 人物卡上他的国家) */
  polity?: number;
  /** 先填好的年份(不给 = 时间轴这一年) */
  from?: number;
  /** 照「一生」里哪一段经历填的(页顶「照这段经历填好了」) */
  life?: LifeTag;
  onBack: () => void;
  /** 加进单子以后(不给 = 同返回) */
  onDone?: () => void;
}

/** Esc:先收起列表,再返回 */
function useEsc(onBack: () => void, inner: boolean, closeInner: () => void, picking: boolean) {
  return (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || picking) return;
    e.stopPropagation();
    if (inner) closeInner();
    else onBack();
  };
}

// ---------------------------------------------------------------------------
// 选身份

const ROLE_ROWS: { k: AuthorIvRole; name: string; desc: (he: string) => string }[] = [
  { k: 'crown', name: '当君主', desc: (he) => `即一国君位，推演照${he}的性格治国；改历史` },
  { k: 'general', name: '当将领', desc: () => '替一国领兵；推演原来派的那位写成副将，胜负照推演，选了良将、名将才会变' },
  { k: 'minister', name: '当名臣', desc: (he) => `入朝，这些年朝中的事${he}也经手；推演里的名臣一个不变，不改历史` },
  { k: 'regent', name: '掌权', desc: (he) => `名义上的君主照旧在位，开战、议和照${he}的性格；改历史` },
];

const ROLE_KEY: Record<'general' | 'minister' | 'regent', string> = { general: '将领', minister: '名臣', regent: '掌权' };

export function RolePickPage({ civ, c, onPick, onBack }: { civ: Civ; c: AuthorCharacter; onPick: (r: AuthorIvRole) => void; onBack: () => void }) {
  const era = useEra();
  const pending = usePending();
  const step = useStepwise().on;
  const ivs = getEdits().interventions;
  const he = heOrShe(c);
  const crowns = useMemo(() => characterCrowns(civ, c.id, pending, ivs, step, era), [civ, c.id, pending, ivs, step, era]);
  const posts = useMemo(() => characterPosts(civ, c.id, pending, ivs, step, era), [civ, c.id, pending, ivs, step, era]);
  const tag = (s: { kind: string; step?: boolean }) =>
    s.kind === 'queued' ? <em className="cr-pending">{s.step ? '下一步生效' : '待推演'}</em> : s.kind === 'void' ? <em className="cr-fail">没生效</em> : null;
  const mine: { k: string; v: ReactNode; t: number }[] = [
    ...crowns.map((s) => ({
      k: '君主',
      t: s.v.from,
      v: (
        <>
          {s.kind === 'done' ? nameAt(civ.polities[s.x.polity], s.v.from) : s.A}
          {' '}
          {yearAt(s.v.from, era)}
          {s.kind === 'done' ? '即位' : `即位${crownTail(s.v, c.died, era)}`}
          {tag(s)}
        </>
      ),
    })),
    ...posts.map((s) => ({ k: ROLE_KEY[postRole(s.v)], t: s.v.from, v: <PostSpan s={s} era={era} tag={tag(s)} /> })),
  ].sort((a, b) => a.t - b.t);
  return (
    <div className="cr-page" onKeyDown={useEsc(onBack, false, () => {}, false)}>
      <div className="cp-body cr-form" data-author-iv="pick">
        <div className="cp-form">
          <span className="cp-form-title">让{c.name}进推演，当什么</span>
          <span className="cp-note">先后当几样都行（将 → 相 → 君），同一时刻只有一个身份；即位那年起卸任将相。</span>
        </div>
        <div className="cp-cmds">
          {ROLE_ROWS.map((r) => (
            <button key={r.k} className="cp-cmd" data-act={`author-iv-${r.k}`} onClick={() => onPick(r.k)}>
              <span className="cp-cmd-main">
                <span className="cp-cmd-name">{r.name}</span>
                <span className="cp-cmd-desc">{r.desc(he)}</span>
              </span>
              <span className="cp-cmd-go">填写 ›</span>
            </button>
          ))}
        </div>
        {mine.length > 0 && (
          <section className="cp-sec" data-author-iv="mine">
            <div className="cp-sec-head">{he}名下的</div>
            <div className="cp-grid cp-stats">
              {mine.map((m, i) => (
                <Row key={i} k={m.k}>
                  {m.v}
                </Row>
              ))}
            </div>
          </section>
        )}
        <div className="cp-note cr-pick-note">也能在「一生」里点一段经历旁的「进推演…」，年份、国家照那段经历先填好。</div>
      </div>
      <div className="cp-foot">
        <button className="cp-btn wide" data-act="author-iv-back" onClick={onBack}>
          返回
        </button>
      </div>
    </div>
  );
}

/** 「他名下的」一行:"大衍王朝 2421–2442 年" + 标 */
function PostSpan({ s, era, tag }: { s: PostState; era: Era | undefined; tag: ReactNode }) {
  const v = s.v;
  const until = s.kind === 'done' ? (s.g ? s.g.until : s.x.until) : v.kind === 'appoint' ? v.until : v.years !== undefined ? v.from + v.years : undefined;
  const from = s.kind === 'done' ? (s.g ? s.g.from : (s.x.from ?? v.from)) : v.from;
  return (
    <>
      {s.A}
      {' '}
      {until !== undefined ? yearSpanAt(from, until, era) : `${yearAt(from, era)}起`}
      {tag}
    </>
  );
}

// ---------------------------------------------------------------------------
// 几页共用:哪一国(现成的国家;换一国列出那年还在的、在地图上点)

interface PolityChoice {
  /** 选中的(没有 = null) */
  pid: number | null;
  alive: AlivePolity[];
  aliveIds: Set<number>;
  /** 正在列表里挑 */
  listing: boolean;
  setListing: (b: boolean) => void;
  picking: boolean;
  pickOnMap: () => void;
  choose: (id: number) => void;
}

/** 哪一国:默认 initial / 人物卡上他的国家(那年还在才算);prompt = 地图上点时顶上那一句 */
function usePolityChoice(civ: Civ, c: AuthorCharacter, home: number, yv: number, y: number, initial: number | undefined, prompt: string, sub: string, source: string, onChange: () => void): PolityChoice {
  const alive = useMemo(() => alivePolities(civ, yv), [civ, yv]);
  const aliveIds = useMemo(() => new Set(alive.map((x) => x.id)), [alive]);
  const [chosen, setChosen] = useState<number | null>(initial ?? null);
  const [listing, setListing] = useState(false);
  const pk = usePolityPick();
  const picking = pk?.source === source;
  useEffect(
    () => () => {
      if (getPolityPick()?.source === source) setPolityPick(null);
    },
    [source],
  );
  const era = useEra();
  const pid = chosen ?? (aliveIds.has(home) ? home : null);
  const choose = (id: number) => {
    setChosen(id);
    setListing(false);
    onChange();
  };
  const pickOnMap = () => {
    onChange();
    jumpTo(y);
    setPolityPick({
      prompt,
      sub,
      source,
      self: aliveIds.has(home) ? home : undefined,
      selfNote: `${heOrShe(c)}的国家`,
      selfPick: true,
      eligible: aliveIds,
      year: yv,
      accept: (q) => {
        if (!aliveIds.has(q)) return `${yearAt(y, era)}这个国家不在`;
        choose(q);
        return null;
      },
    });
  };
  return { pid, alive, aliveIds, listing, setListing, picking, pickOnMap, choose };
}

/** 选中的那一国一行:色点、国名、几州;「换一国」「在地图上点」(手机上「在地图上点」放在列表底部) */
function PolityRow({ civ, ch, y, act }: { civ: Civ; ch: PolityChoice; y: number; act: string }) {
  const phone = useNarrow();
  const P = ch.pid !== null ? civ.polities[ch.pid] : undefined;
  const row = ch.alive.find((x) => x.id === ch.pid);
  if (ch.picking)
    return (
      <div className="oc-pick picking" data-author-iv={`${act}-pick`}>
        <span className="oc-pick-empty">在地图上点一国…</span>
        <span className="oc-pick-acts">
          <button className="cp-step" onClick={() => setPolityPick(null)}>
            取消
          </button>
        </span>
      </div>
    );
  return (
    <div className="oc-pick cr-pick" data-author-iv={act}>
      {P ? (
        <span className="oc-pick-name">
          <i className="cr-dot" style={{ background: rgb(P.color) }} />
          {nameAt(P, y)}
          {row && <em>{row.regions} 州</em>}
        </span>
      ) : (
        <span className="oc-pick-empty">还没选</span>
      )}
      <span className="oc-pick-acts">
        <button className="cp-step" data-act={`${act}-list`} onClick={() => ch.setListing(true)}>
          换一国
        </button>
        {!phone && (
          <button className="cp-step" data-act={`${act}-map`} onClick={ch.pickOnMap}>
            在地图上点
          </button>
        )}
      </span>
    </div>
  );
}

/** 换一国:那年还在的国家(大的在前),一行一国;底部返回 / 在地图上点 */
function PolityList({ civ, ch, home, he, title, y, ids, onKey }: { civ: Civ; ch: PolityChoice; home: number; he: string; title: string; y: number; ids?: readonly AlivePolity[]; onKey: (e: KeyboardEvent) => void }) {
  const era = useEra();
  const list = ids ?? ch.alive;
  return (
    <div className="cr-page" onKeyDown={onKey}>
      <div className="cp-body">
        <section className="cp-sec" data-author-iv="list">
          <div className="cp-sec-head cp-events-head">
            <span>{title}</span>
            <span className="cp-num-note">
              {yearFull(y, era)}
              {ids ? '接壤、没在打仗的' : '还在的'} {list.length} 国
            </span>
          </div>
          <div className="oc-rows oc-people">
            {list.map((x) => (
              <button key={x.id} className="oc-person cr-polity" data-polity={x.id} onClick={() => ch.choose(x.id)}>
                <i className="cr-dot lg" style={{ background: rgb(civ.polities[x.id].color) }} />
                <span className="oc-txt">
                  <b>
                    {x.name}
                    {x.id === home && <em className="cp-num-note">{he}的国家</em>}
                  </b>
                  <span>
                    {x.regions} 州{x.ruler && `，${x.ruler}${x.republic ? '执政' : '在位'}`}
                  </span>
                </span>
                {x.id === ch.pid && <span className="cr-check">✓</span>}
              </button>
            ))}
          </div>
        </section>
      </div>
      <div className="cp-foot mk-foot">
        <button className="cp-btn" data-act="author-iv-list-back" onClick={() => ch.setListing(false)}>
          返回
        </button>
        <button className="cp-btn" data-act="author-iv-list-map" onClick={ch.pickOnMap}>
          在地图上点
        </button>
      </div>
    </div>
  );
}

/** 年份那一块:年份输入 + 下面一句(逐年推演:固定"下一步年初") */
function WhenBlock({ step, yi, label, note }: { step: boolean; yi: YearInput; label: string; note: string }) {
  const phone = useNarrow();
  if (step) return <StepEffectTime phone={phone} />;
  return (
    <div className="cp-from iv-inner">
      <span className="cp-k">{label}</span>
      <YearRow yi={yi} label={label} />
      <span className="cp-note">{note}</span>
    </div>
  );
}

/** 底部两个按钮 */
function Foot({ go, disabled, onBack, onGo, act }: { go: string; disabled: boolean; onBack: () => void; onGo: () => void; act: string }) {
  return (
    <div className="cp-foot mk-foot">
      <button className="cp-btn" data-act={`${act}-back`} onClick={onBack}>
        返回
      </button>
      <button className="cp-btn primary" data-act={`${act}-go`} disabled={disabled} onClick={onGo}>
        {go}
      </button>
    </div>
  );
}

/** 他 / 她能任职的年份:16 岁起,到卒年前一年(历史推到哪年为止) */
function yearSpan(civ: Civ, c: AuthorCharacter): { lo: number; hi: number; last: number } {
  const last = Math.ceil(civ.endYear) - 1;
  const lo = Math.max(0, Math.ceil(c.born + AUTHOR_IV_AGE));
  const hi = Math.min(last, c.died !== undefined ? c.died - 1 : last);
  return { lo, hi, last };
}

/** 年份不对时的那一句(共用):还没到 16 岁、已去世、超出范围 */
function yearWhy(civ: Civ, c: AuthorCharacter, step: boolean, y: number, yi: YearInput, what: string, era: Era | undefined): string | null {
  const he = heOrShe(c);
  const { lo, hi } = yearSpan(civ, c);
  if (step) {
    if (y < c.born) return `${he}${yearAt(c.born, era)}才出生`;
    if (y - c.born < AUTHOR_IV_AGE) return `${he}那一年不满 ${AUTHOR_IV_AGE} 岁`;
    if (c.died !== undefined && y >= c.died) return `${he}${yearAt(c.died, era)}已经去世`;
    return null;
  }
  if (lo > hi) return c.born + AUTHOR_IV_AGE > civ.endYear ? `${he}${yearAt(c.born + AUTHOR_IV_AGE, era)}才满 ${AUTHOR_IV_AGE} 岁，历史只推到${spaced(yearAt(Math.floor(civ.endYear), era))}` : `${he}满 ${AUTHOR_IV_AGE} 岁以后就去世了`;
  if (!yi.valid) return `${what}要在${spaced(yearSpanAt(lo, hi, era))}之间`;
  return null;
}

/** "到哪年卸任 / 去职"那一块:到卒年 | 到某一年(人物没写卒年:第一项写"到 65 岁卸甲") */
function UntilBlock({
  c,
  role,
  byYear,
  setByYear,
  ui,
  from,
  note,
}: {
  c: AuthorCharacter;
  role: 'general' | 'minister';
  byYear: boolean;
  setByYear: (b: boolean) => void;
  ui: YearInput;
  from: number;
  note: string;
}) {
  const era = useEra();
  const general = role === 'general';
  const he = heOrShe(c);
  return (
    <div className="cp-form" data-author-iv="until">
      <span className="cp-form-title">{general ? '到哪年卸任' : '到哪年去职'}</span>
      <div className="cp-dur" role="radiogroup" aria-label={general ? '到哪年卸任' : '到哪年去职'}>
        <button role="radio" aria-checked={!byYear} className={byYear ? '' : 'on'} data-act="author-iv-until-death" onClick={() => setByYear(false)}>
          {c.died !== undefined ? `到卒年（${yearAt(c.died, era)}）` : general ? '到 65 岁卸甲' : '到 70 岁致仕'}
        </button>
        <button
          role="radio"
          aria-checked={byYear}
          className={byYear ? 'on' : ''}
          data-act="author-iv-until-year"
          onClick={() => {
            if (byYear) return;
            ui.nudge(Math.min(c.died ?? Infinity, from + 20) - ui.y);
            setByYear(true);
          }}
        >
          到某一年
        </button>
      </div>
      {byYear && (
        <div className="cp-from iv-inner">
          <span className="cp-k">{general ? '卸任年份' : '去职年份'}</span>
          <YearRow yi={ui} label={general ? '卸任年份' : '去职年份'} short />
          <span className="cp-note">
            {general ? '任' : '在朝'} {Math.max(0, ui.y - from)} 年。之后{general ? '入朝、即位' : '为将、即位'}都行。
          </span>
        </div>
      )}
      <span className="cp-note">
        {note}
        {c.died === undefined && !byYear ? `人物卡上没写卒年：${he}${general ? '到 65 岁卸甲' : '到 70 岁致仕'}。` : ''}
      </span>
    </div>
  );
}

/** 一仗的说法:"2421 年伐后东定国";打到一半他才接手的 "2424 年伐新特利亚国（2428 年接手）"(from = 他接手那一刻) */
function warPhrase(civ: Civ, pid: number, war: number, from: number, era: Era | undefined): string {
  const e = peopleIndex(civ).wars.get(war);
  const start = e?.year ?? from;
  const atk = e ? e.a === pid : true;
  const foe = e ? (atk ? e.b : e.a) : -1;
  const F = foe >= 0 ? civ.polities[foe] : undefined;
  return `${yearAt(start, era)}${atk ? '伐' : '御'}${F ? nameAt(F, start) : '敌国'}${Math.floor(from) > Math.floor(start) ? `（${yearAt(from, era)}接手）` : ''}`;
}

/** 这国在 from–until 之间打的仗(开打、没议和):[战争编号, 开打那年] */
function warsDuring(civ: Civ, pid: number, from: number, until: number): { war: number; year: number }[] {
  const out: { war: number; year: number }[] = [];
  const ends = new Map<number, number>();
  for (const e of civ.annals) if (e.kind === 'peace' && e.war >= 0 && !ends.has(e.war)) ends.set(e.war, e.year);
  const seen = new Set<number>();
  for (const e of civ.annals) {
    if (e.kind !== 'war' || e.war < 0 || seen.has(e.war) || (e.a !== pid && e.b !== pid)) continue;
    seen.add(e.war);
    if (e.year < until && (ends.get(e.war) ?? Infinity) > from) out.push({ war: e.war, year: e.year });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 当将领

export function GeneralPage({ civ, raster, world, year, c, polity, from: preset, life, send: send0, onBack, onDone }: PageProps & { send?: boolean }) {
  const era = useEra();
  const sw = useStepwise();
  const step = sw.on;
  const look = useStepView().look;
  const [msg, setMsg] = useState<string | null>(null);
  const clear = () => setMsg(null);
  const he = heOrShe(c);
  const { lo, hi } = yearSpan(civ, c);
  const yi = useYearInput(preset ?? year, lo, Math.max(lo, hi), clear);
  const y = step ? nextYear(sw) : yi.y;
  const yv = step ? Math.min(nextAt(sw), civ.endYear) : y;
  const home = useMemo(() => characterPolity(civ, world, raster, c), [civ, world, raster, c]);
  const source = `character:${c.id}`;
  const ch = usePolityChoice(civ, c, home, yv, y, polity, `选${c.name}当哪国的将领`, `${yearAt(y, era)}任将，那年还在的国家都能选`, source, clear);
  const P = ch.pid !== null ? civ.polities[ch.pid] : undefined;
  const pAlive = !!P && ch.aliveIds.has(P.id);
  // 他名下已有的(同一时刻只有一个身份:那年掌着别国的权就拦下)
  const pending = usePending();
  const ivs = getEdits().interventions;
  const posts = useMemo(() => characterPosts(civ, c.id, pending, ivs, step, era), [civ, c.id, pending, ivs, step, era]);
  // 到哪年卸任
  const [byYear, setByYear] = useState(false);
  const untilHi = c.died !== undefined ? c.died - 1 : INTERVENTION_YEAR_MAX;
  const ui = useYearInput(Math.min(untilHi, y + 20), y + 1, Math.max(y + 1, untilHi), clear);
  const until = byYear ? ui.y : undefined;
  const [skill, setSkill] = useState<'plain' | AppointSkill>('plain');
  const v: Intervention | null = P
    ? {
        kind: 'appoint',
        a: polityKey(civ, P.id),
        char: c.id,
        role: 'general',
        born: c.born,
        ...(c.died !== undefined ? { died: c.died } : {}),
        from: y,
        ...(until !== undefined ? { until } : {}),
        ...(skill !== 'plain' ? { skill } : {}),
      }
    : null;
  // 照现在的推演,他会领哪几仗(任将不改历史)
  const pre = useMemo<AuthorPost | null>(() => (v && v.kind === 'appoint' && pAlive && !step ? appointPreview(civ, v, P!.id) : null), [civ, JSON.stringify(v), pAlive, step]); // eslint-disable-line react-hooks/exhaustive-deps
  // 同时派他出征:伐哪国(那年接壤、没在交战的)、哪年(在他任上:照现在排出来的任期,排不出的按卸任年 / 卒年 / 卸甲的岁数)
  const [send, setSend] = useState(!!send0);
  const stopT = pre ? (pre.until ?? civ.endYear) : v && v.kind === 'appoint' ? appointEnd(v, y).stop : y + 1;
  const tenureEnd = Math.ceil(Math.min(stopT, civ.endYear)) - 1;
  const si = useYearInput(y, y, Math.max(y, tenureEnd), clear);
  const sy = step ? y : si.y;
  const syv = step ? yv : sy;
  const [target, setTarget] = useState<number | null>(null);
  const [tList, setTList] = useState(false);
  const near = useMemo(() => (P && pAlive ? neighborsAt(civ, P.id, syv).near : new Set<number>()), [civ, P, pAlive, syv]);
  // 伐得了的:接壤、那年没和这国在交战的(已在交战的推演里那条宣战跳过,他也就挂不了这一仗的帅)
  const { open, foes } = useMemo(() => (P && pAlive ? declareTargets(civ, P.id, syv, near) : { open: near, foes: new Set<number>() }), [civ, P, pAlive, syv, near]);
  const nearHere = useMemo(() => (P && pAlive ? neighborsAt(civ, P.id, yv).near : new Set<number>()), [civ, P, pAlive, yv]);
  const tgt = target !== null && open.has(target) ? target : null;
  const T = tgt !== null ? civ.polities[tgt] : undefined;
  const nearRows = useMemo(() => alivePolities(civ, syv).filter((x) => open.has(x.id)), [civ, syv, open]);
  const pk = usePolityPick();
  const tPicking = pk?.source === `${source}:send`;
  // 离开这一页时收起"伐哪一国"的地图挑选(选哪国的那个由 usePolityChoice 收)
  useEffect(
    () => () => {
      if (getPolityPick()?.source === `${source}:send`) setPolityPick(null);
    },
    [source],
  );

  const why = (() => {
    if (step && look !== null) return STEP_LOOK_WHY;
    const w = yearWhy(civ, c, step, y, yi, '任将年份', era);
    if (w) return w;
    if (!P) return '选一个国家';
    if (!pAlive) return yv < P.founded ? `${yearAt(y, era)}${nameAt(P, y)}还没立国` : `${yearAt(y, era)}${nameAt(P, y)}已亡`;
    const ov = overlapWhy(civ, posts, 'general', P.id, y, yv, he, era);
    if (ov) return ov;
    if (byYear && !ui.valid) return `卸任年份要在${spaced(yearSpanAt(ui.lo, ui.hi, era))}之间`;
    if (send) {
      if (!step && !si.valid) return `出征年份要在${spaced(yearSpanAt(si.lo, si.hi, era))}之间，在${he}任上`;
      if (!near.size) return `${yearAt(sy, era)}${nameAt(P, sy)}四周没有走得过去的邻国，派不了`;
      if (!open.size) return `${yearAt(sy, era)}${nameAt(P, sy)}和接壤的国家都已在交战，派不了`;
      if (!T) return '选伐哪一国';
    }
    return null;
  })();

  const go = () => {
    if (why || !v || !P) return;
    const A = nameAt(P, y);
    const err = queueIntervention(v, postLine(c.name, A, v as PostIv, era), { self: P.id, target: null, shown: A });
    if (err) return setMsg(err);
    if (send && T) {
      const d: Intervention = { kind: 'declare', a: polityKey(civ, P.id), b: polityKey(civ, T.id), from: sy, lead: c.id };
      const e2 = queueIntervention(d, interventionText(civ, d), { self: P.id, target: { kind: 'polity', id: T.id }, shown: A });
      if (e2) {
        // 宣战那条加不上:任将那条也拿掉
        const last = getPending().at(-1);
        if (last?.kind === 'iv' && last.v.kind === 'appoint') removePending(last.id);
        return setMsg(e2);
      }
    }
    (onDone ?? onBack)();
  };

  const pickTarget = () => {
    clear();
    jumpTo(step ? Math.min(sy, sw.now) : sy);
    setPolityPick({
      prompt: `选${c.name}伐哪一国`,
      sub: `${yearAt(sy, era)}宣战，${c.name}挂帅`,
      source: `${source}:send`,
      self: P?.id,
      eligible: open,
      near,
      year: syv,
      accept: (q) => {
        if (!near.has(q)) return '两国不接壤，无法宣战';
        if (foes.has(q)) return '两国已在交战，无法宣战';
        setTarget(q);
        setTList(false);
        return null;
      },
    });
  };
  const onKey = useEsc(onBack, ch.listing || tList, () => (ch.setListing(false), setTList(false)), ch.picking || tPicking);

  if (ch.listing) return <PolityList civ={civ} ch={ch} home={home} he={he} title="当哪国的将领" y={y} onKey={onKey} />;
  if (tList)
    return (
      <PolityList
        civ={civ}
        ch={{ ...ch, pid: tgt, choose: (id) => (setTarget(id), setTList(false)), setListing: setTList, pickOnMap: pickTarget }}
        home={-1}
        he={he}
        title="伐哪一国"
        y={sy}
        ids={nearRows}
        onKey={onKey}
      />
    );

  // 照现在的推演:他挂帅的几仗、同时在打的别的仗
  const A = P ? nameAt(P, y) : '';
  const led = pre ? [...new Map(pre.wars.map((w) => [w.war, w])).values()] : [];
  const stop = pre?.until ?? civ.endYear;
  const others = P && pre ? warsDuring(civ, P.id, y, stop).filter((w) => !led.some((l) => l.war === w.war)) : [];
  const tenure = pre ? (pre.until !== undefined ? yearSpanAt(y, pre.until, era).replace(/ 年$/, '') : `${y}–`) : '';
  const age = y - c.born;
  const body = (
    <>
      {life && <LifeHead t={life} />}
      <div className="cp-form" data-author-iv="polity">
        <span className="cp-form-title">当哪国的将领</span>
        <PolityRow civ={civ} ch={ch} y={y} act="general-polity" />
        <span className="cp-note">
          {!P && home >= 0 ? `人物卡上${he}的国家${yearAt(y, era)}不在了，点「换一国」选一个。` : ''}
          {polity !== undefined ? '' : `默认是人物卡上${he}的国家；`}
          {`${yearFull(y, era)}还在的 ${ch.alive.length} 国都能选。${he}挂帅的仗，推演原来派的将领写成副将，推演里的人一个不变。`}
        </span>
      </div>
      <div className="cp-form" data-author-iv="when">
        <span className="cp-form-title">什么时候任将</span>
        <WhenBlock step={step} yi={yi} label="任将年份" note={`${he}那年 ${age} 岁。这年之前的历史不变。`} />
      </div>
      <UntilBlock c={c} role="general" byYear={byYear} setByYear={(b) => (setByYear(b), clear())} ui={ui} from={y} note={`推演里亡国会让${he}提前卸任（写出降或出奔），卒年照人物卡不变。`} />
      <div className="cp-form" data-author-iv="skill">
        <span className="cp-form-title">能力</span>
        <div className="cp-dur" role="radiogroup" aria-label="能力">
          {(['plain', 'good', 'great'] as const).map((k) => (
            <button key={k} role="radio" aria-checked={skill === k} className={skill === k ? 'on' : ''} data-act={`general-skill-${k}`} onClick={() => setSkill(k)}>
              {SKILL_NAMES[k]}
            </button>
          ))}
        </div>
        <span className="cp-note">寻常：胜负照推演，只改编年史、人物卡上谁挂帅。良将、名将：{he}挂帅的仗本方更能打（名将更多），胜负可能变，之后的历史跟着变。</span>
      </div>
      {P && pAlive && !step && (
        <div className="iv-sum" data-author-iv="wars">
          <span>照现在</span>
          <span>
            {led.length
              ? `${he}挂帅 ${led.length} 仗：${led.map((w) => warPhrase(civ, P.id, w.war, w.from, era)).join('、')}`
              : `${he}在任这些年（${tenure}）${A}一场仗都没打${nearHere.size ? '' : '：四周没有走得过去的邻国'}，${he}没有仗可领`}
          </span>
          {led.length > 0 && others.length > 0 && (
            <>
              <span>同时在打</span>
              <span>{others.map((w) => warPhrase(civ, P.id, w.war, w.year, era)).join('、')}，照旧派推演里的将领</span>
            </>
          )}
          {led.length > 0 ? (
            <>
              <span>胜负</span>
              <span>{skill === 'plain' ? '照推演（能力「寻常」）' : `${he}挂帅的仗本方兵力 ×${APPOINT_SKILL_POWER[skill]}（${SKILL_NAMES[skill]}），胜负可能变`}</span>
            </>
          ) : (
            <>
              <span>要{he}领兵</span>
              <span>{nearHere.size ? `勾下面「同时派${he}出征」` : `派${he}出征也打不成（宣战只能伐走得过去的邻国）`}</span>
            </>
          )}
        </div>
      )}
      <div className="cp-form" data-author-iv="send">
        <span className="cp-form-title">出征</span>
        <label className="cp-check">
          <input type="checkbox" checked={send} data-act="general-send" onChange={(e) => (setSend(e.target.checked), clear())} />
          <span>同时派{he}出征</span>
          <span className="cp-note">这国向一国宣战，由{he}挂帅</span>
        </label>
        {send && (
          <>
            {tPicking ? (
              <div className="oc-pick picking" data-author-iv="send-pick">
                <span className="oc-pick-empty">在地图上点一国…</span>
                <span className="oc-pick-acts">
                  <button className="cp-step" onClick={() => setPolityPick(null)}>
                    取消
                  </button>
                </span>
              </div>
            ) : (
              <SendRow civ={civ} T={T} y={sy} regions={nearRows.find((x) => x.id === tgt)?.regions} onList={() => (setTList(true), clear())} onMap={pickTarget} />
            )}
            <div className="cp-from iv-inner">
              {!step && (
                <>
                  <span className="cp-k">出征年份</span>
                  <YearRow yi={si} label="出征年份" short />
                </>
              )}
              <span className="cp-note">
                和宣战一样只能伐那年接壤、没在打仗的国家；{step ? '下一步开始时宣战' : `年份默认是任将那年，只能在${he}任上`}。宣战改历史：从{spaced(yearAt(sy, era))}起重新推演。
              </span>
            </div>
          </>
        )}
      </div>
      {(msg || why) && <div className="cp-msg">{msg ?? why}</div>}
    </>
  );
  return (
    <div className="cr-page" onKeyDown={onKey}>
      <div className="cp-body cr-form" data-author-iv="general">
        {body}
      </div>
      <Foot go={step ? '加入' : send ? '加入待推演（2 条）' : '加入待推演'} disabled={!!why || ch.picking || tPicking} onBack={onBack} onGo={go} act="general" />
    </div>
  );
}

/** 出征伐哪国那一行 */
function SendRow({ civ, T, y, regions, onList, onMap }: { civ: Civ; T: Civ['polities'][number] | undefined; y: number; regions?: number; onList: () => void; onMap: () => void }) {
  const phone = useNarrow();
  return (
    <div className="oc-pick cr-pick" data-author-iv="send-target">
      {T ? (
        <span className="oc-pick-name">
          <i className="cr-dot" style={{ background: rgb(T.color) }} />
          {nameAt(T, y)}
          {regions !== undefined && <em>{regions} 州</em>}
        </span>
      ) : (
        <span className="oc-pick-empty">还没选伐哪一国</span>
      )}
      <span className="oc-pick-acts">
        <button className="cp-step" data-act="general-send-list" onClick={onList}>
          换一国
        </button>
        {!phone && (
          <button className="cp-step" data-act="general-send-map" onClick={onMap}>
            在地图上点
          </button>
        )}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 当名臣

export function MinisterPage({ civ, raster, world, year, c, polity, from: preset, life, onBack, onDone }: PageProps) {
  const era = useEra();
  const sw = useStepwise();
  const step = sw.on;
  const look = useStepView().look;
  const [msg, setMsg] = useState<string | null>(null);
  const clear = () => setMsg(null);
  const he = heOrShe(c);
  const { lo, hi } = yearSpan(civ, c);
  const yi = useYearInput(preset ?? year, lo, Math.max(lo, hi), clear);
  const y = step ? nextYear(sw) : yi.y;
  const yv = step ? Math.min(nextAt(sw), civ.endYear) : y;
  const home = useMemo(() => characterPolity(civ, world, raster, c), [civ, world, raster, c]);
  const ch = usePolityChoice(civ, c, home, yv, y, polity, `选${c.name}入哪国的朝`, `${yearAt(y, era)}入朝，那年还在的国家都能选`, `character:${c.id}`, clear);
  const P = ch.pid !== null ? civ.polities[ch.pid] : undefined;
  const pAlive = !!P && ch.aliveIds.has(P.id);
  const pending = usePending();
  const ivs = getEdits().interventions;
  const posts = useMemo(() => characterPosts(civ, c.id, pending, ivs, step, era), [civ, c.id, pending, ivs, step, era]);
  const [byYear, setByYear] = useState(false);
  const untilHi = c.died !== undefined ? c.died - 1 : INTERVENTION_YEAR_MAX;
  const ui = useYearInput(Math.min(untilHi, y + 20), y + 1, Math.max(y + 1, untilHi), clear);
  const until = byYear ? ui.y : undefined;
  const v: Intervention | null = P
    ? { kind: 'appoint', a: polityKey(civ, P.id), char: c.id, role: 'minister', born: c.born, ...(c.died !== undefined ? { died: c.died } : {}), from: y, ...(until !== undefined ? { until } : {}) }
    : null;
  const pre = useMemo(() => (v && v.kind === 'appoint' && pAlive && !step ? appointPreview(civ, v, P!.id) : null), [civ, JSON.stringify(v), pAlive, step]); // eslint-disable-line react-hooks/exhaustive-deps
  // 照现在:这些年朝中的事(他在朝那几年,同推演里名臣经手的那几样)
  const deeds = useMemo(() => {
    if (!pre || !P) return [];
    const rs = peopleIndex(civ).rulers[P.id] ?? [];
    return courtDeeds({ annals: civ.annals, polities: civ.polities, upheavals: civ.upheavals }, P, pre.dynasty, pre.from, pre.until ?? civ.endYear, rs).map((d) => d.deed);
  }, [civ, pre, P]);
  // 那年在朝的推演名臣
  const court = useMemo(
    () =>
      P && pAlive
        ? (civ.people ?? []).filter((m) => m.role === 'minister' && m.author === undefined && m.polity === P.id && (m.from ?? Infinity) <= yv && (m.until === undefined || m.until > yv))
        : [],
    [civ, P, pAlive, yv],
  );

  const why = (() => {
    if (step && look !== null) return STEP_LOOK_WHY;
    const w = yearWhy(civ, c, step, y, yi, '入朝年份', era);
    if (w) return w;
    if (!P) return '选一个国家';
    if (!pAlive) return yv < P.founded ? `${yearAt(y, era)}${nameAt(P, y)}还没立国` : `${yearAt(y, era)}${nameAt(P, y)}已亡`;
    const ov = overlapWhy(civ, posts, 'minister', P.id, y, yv, he, era);
    if (ov) return ov;
    if (byYear && !ui.valid) return `去职年份要在${spaced(yearSpanAt(ui.lo, ui.hi, era))}之间`;
    return null;
  })();
  const go = () => {
    if (why || !v || !P) return;
    const err = queueIntervention(v, postLine(c.name, nameAt(P, y), v as PostIv, era), { self: P.id, target: null, shown: nameAt(P, y) });
    if (err) return setMsg(err);
    (onDone ?? onBack)();
  };
  const onKey = useEsc(onBack, ch.listing, () => ch.setListing(false), ch.picking);
  if (ch.listing) return <PolityList civ={civ} ch={ch} home={home} he={he} title="入哪国的朝" y={y} onKey={onKey} />;

  const A = P ? nameAt(P, y) : '';
  const lad = P ? authorMinisterLadder(P, y) : null;
  const ref = (m: Person) => `${postAt(m, yv)?.title ?? ''}${m.name}`;
  const shown = deeds.slice(0, 3);
  return (
    <div className="cr-page" onKeyDown={onKey}>
      <div className="cp-body cr-form" data-author-iv="minister">
        {life && <LifeHead t={life} />}
        <div className="cp-form" data-author-iv="polity">
          <span className="cp-form-title">入哪国的朝</span>
          <PolityRow civ={civ} ch={ch} y={y} act="minister-polity" />
          <span className="cp-note">
            {!P && home >= 0 ? `人物卡上${he}的国家${yearAt(y, era)}不在了，点「换一国」选一个。` : ''}
            {P && pAlive ? (court.length ? `那年${A}在朝的有${court.map(ref).join('、')}。` : `那年${A}朝中没有推演里的名臣。`) : ''}
            推演里的名臣一个不变，{he}是多出来的一位。
          </span>
        </div>
        <div className="cp-form" data-author-iv="when">
          <span className="cp-form-title">什么时候入朝</span>
          <WhenBlock step={step} yi={yi} label="入朝年份" note={`${he}那年 ${y - c.born} 岁。`} />
        </div>
        <UntilBlock c={c} role="minister" byYear={byYear} setByYear={(b) => (setByYear(b), clear())} ui={ui} from={y} note={`推演里亡国、改朝换代会让${he}提前去职（写出降或出奔），卒年照人物卡不变。`} />
        <div className="iv-warn" data-author-iv="keep">
          只改编年史和人物卡：朝中的事照推演发生，{he}跟着经手；国界、战争、君主一个不变。
        </div>
        <div className="iv-sum" data-author-iv="deeds">
          <span>经手</span>
          <span>这些年朝中的事（议和、迁都、赈灾、劝进、拥立……）{he}也经手，和推演里的名臣写在一起</span>
          {P && pAlive && !step && (
            <>
              <span>照现在</span>
              <span>
                {deeds.length
                  ? `${he}在朝这些年${A}有 ${deeds.length} 件：${shown.map((d) => `${yearAt(d.year, era)}${pre ? deedText(civ, { polity: P.id } as Person, d) : ''}`).join('、')}${deeds.length > shown.length ? '等' : ''}`
                  : `${he}在朝这些年${A}朝中无大事`}
              </span>
            </>
          )}
          {lad && lad.start && (
            <>
              <span>官</span>
              <span>
                从{lad.start}做起，经手一件升一级；做到{lad.top}时，原来那位在人物卡上写次一级
              </span>
            </>
          )}
        </div>
        {(msg || why) && <div className="cp-msg">{msg ?? why}</div>}
      </div>
      <Foot go={step ? '加入' : '加入待推演'} disabled={!!why || ch.picking} onBack={onBack} onGo={go} act="minister" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 掌权

export function AuthorRegentPage({ civ, raster, world, year, c, polity, from: preset, life, onBack, onDone }: PageProps) {
  const era = useEra();
  const sw = useStepwise();
  const step = sw.on;
  const look = useStepView().look;
  const pending = usePending();
  const [msg, setMsg] = useState<string | null>(null);
  const clear = () => setMsg(null);
  const he = heOrShe(c);
  const { lo, hi } = yearSpan(civ, c);
  const yi = useYearInput(preset ?? year, lo, Math.max(lo, hi), clear);
  const y = step ? nextYear(sw) : yi.y;
  const yv = step ? Math.min(nextAt(sw), civ.endYear) : y;
  const home = useMemo(() => characterPolity(civ, world, raster, c), [civ, world, raster, c]);
  const ch = usePolityChoice(civ, c, home, yv, y, polity, `选${c.name}掌哪国的权`, `${yearAt(y, era)}起掌权，那年还在的国家都能选`, `character:${c.id}`, clear);
  const P = ch.pid !== null ? civ.polities[ch.pid] : undefined;
  const pAlive = !!P && ch.aliveIds.has(P.id);
  const [how, setHow] = useState<'chancellor' | 'general'>('chancellor');
  const [years, setYears] = useState(5);
  const N = P && pAlive ? rulerAt(civ, P.id, yv) : null;
  const Nname = N ? rulerShort(civ, N) : '君主';
  const lean = characterLeanings(c);
  // 大将专权:他这时在当这国的将领(推过的生效了的、单子里更早下的)
  const ivs = getEdits().interventions;
  const posts = useMemo(() => characterPosts(civ, c.id, pending, ivs, step, era), [civ, c.id, pending, ivs, step, era]);
  const general = !!P && holdsPost(civ, posts, 'general', P.id, y, yv);

  const why = (() => {
    if (step && look !== null) return STEP_LOOK_WHY;
    const w = yearWhy(civ, c, step, y, yi, '掌权年份', era);
    if (w) return w;
    if (!P) return '选一个国家';
    if (!pAlive) return yv < P.founded ? `${yearAt(y, era)}${nameAt(P, y)}还没立国` : `${yearAt(y, era)}${nameAt(P, y)}已亡`;
    if (!royalAt(P, yv)) return `${yearAt(y, era)}${nameAt(P, y)}是${regimeAt(P, yv) === 'junta' ? '军政府' : '共和国'}，没有君主可架空`;
    if (!N) return `${yearAt(y, era)}${nameAt(P, y)}没有在位的君主`;
    if (N.author !== undefined) return `那年在位的是作者立的君主${personName(civ, N)}，掌不了权`;
    const ov = overlapWhy(civ, posts, 'regent', P.id, y, yv, he, era);
    if (ov) return ov;
    if (how === 'general' && !general) return `大将专权要${he}这时在当${nameAt(P, y)}的将领：先「当将领」，或选大臣专权`;
    return null;
  })();
  const go = () => {
    if (why || !P) return;
    const v: Intervention = {
      kind: 'regent',
      a: polityKey(civ, P.id),
      char: c.id,
      born: c.born,
      ...(c.died !== undefined ? { died: c.died } : {}),
      from: y,
      how,
      end: 'return',
      years,
      leanings: { ...lean },
    };
    const err = queueIntervention(v, postLine(c.name, nameAt(P, y), v as PostIv, era), { self: P.id, target: null, shown: nameAt(P, y) });
    if (err) return setMsg(err);
    (onDone ?? onBack)();
  };
  const onKey = useEsc(onBack, ch.listing, () => ch.setListing(false), ch.picking);
  if (ch.listing) return <PolityList civ={civ} ch={ch} home={home} he={he} title="掌哪国的权" y={y} onKey={onKey} />;
  const A = P ? nameAt(P, y) : '';
  const back = y + years;
  return (
    <div className="cr-page" onKeyDown={onKey}>
      <div className="cp-body cr-form" data-author-iv="regent">
        {life && <LifeHead t={life} />}
        <div className="cp-form" data-author-iv="polity">
          <span className="cp-form-title">掌哪国的权</span>
          <PolityRow civ={civ} ch={ch} y={y} act="regent-polity" />
          <span className="cp-note">
            {!P && home >= 0 ? `人物卡上${he}的国家${yearAt(y, era)}不在了，点「换一国」选一个。` : ''}
            {N ? `那年在位的是${personName(civ, N)}，名义上照旧是${heOrShe(N)}。` : ''}
          </span>
        </div>
        <div className="cp-form" data-author-iv="when">
          <span className="cp-form-title">从哪一年起</span>
          <WhenBlock step={step} yi={yi} label="掌权年份" note={`${he}那年 ${y - c.born} 岁、在世${N ? `，${Nname}在位` : ''}。`} />
        </div>
        <div className="cp-form" data-author-iv="how">
          <span className="cp-form-title">怎么掌权</span>
          <div className="cp-dur" role="radiogroup" aria-label="怎么掌权">
            {(['chancellor', 'general'] as const).map((k) => (
              <button key={k} role="radio" aria-checked={how === k} className={how === k ? 'on' : ''} data-act={`author-regent-${k}`} onClick={() => (setHow(k), clear())}>
                {AUTHOR_HOW_NAMES[k]}
              </button>
            ))}
          </div>
          <span className="cp-note">
            {how === 'chancellor' ? `大臣专权：${Nname}照旧在位，大权在${he}手里。` : `大将专权：${he}以将领的身份入朝秉政，${Nname}照旧在位。`}
            {`大将专权要${he}这时在当这国的将领。`}
          </span>
          <div className="cp-from iv-inner">
            <span className="cp-k">到什么时候</span>
            <div className="cp-from-row dx-years">
              <button className="cp-step" data-act="regent-years-less" onClick={() => setYears(Math.max(1, years - 1))} disabled={years <= 1}>
                −1
              </button>
              <b>{years} 年后还政</b>
              <button className="cp-step" data-act="regent-years-more" onClick={() => setYears(Math.min(REGENT_YEARS_MAX, years + 1))} disabled={years >= REGENT_YEARS_MAX}>
                +1
              </button>
            </div>
            <span className="cp-note">还政之前去世的，卒于位。掌权以后篡位，以后再做。</span>
          </div>
        </div>
        {P && (
          <div className="iv-sum" data-author-iv="regent-sum">
            <span>掌权</span>
            <span>
              {c.name}，{yearAt(y, era)}起；政出于{he}
            </span>
            <span>君主</span>
            <span>{Nname}照旧在位</span>
            <span>推演</span>
            <span>
              这几年开战、议和照{c.name}的性格（好战 {lean.war}），国家方针照样加减；邻国也更想趁机来打
            </span>
            <span>之后</span>
            <span>
              {spaced(yearAt(back, era))}还政于{Nname}；这年以前的一个不变
            </span>
          </div>
        )}
        {(msg || why) && <div className="cp-msg">{msg ?? why}</div>}
      </div>
      <Foot go={step ? '加入' : '加入待推演'} disabled={!!why || ch.picking} onBack={onBack} onGo={go} act="author-regent" />
    </div>
  );
}

