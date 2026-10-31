/**
 * 作者的人物卡上「为将」「为臣」「掌权」三块(CharacterPanel.tsx;状态、说法见 authorIvInfo.ts;写到这个人物的"他 / 她"按人物卡上的性别):
 *   待推演 / 下一步生效  一行:"2421 年为大衍王朝将" + 标
 *   没生效              一行 + 标,下面一段写原因;右上「去掉这条」
 *   生效了(学维基百科人物信息框的一行一项;右上「编年史」)
 *     为将  在任、官至(右边灰字"校尉起，打赢一仗升一级")、能力、战绩("挂帅 2 仗：胜 1、无功 1")、卸任;下面挂帅的每一仗一行
 *           (年份、伐谁 + 胜 / 无功 / 兵败小标、"2421–2428 年，副将凌鸾翎"、得失);最后一句同时在打、照旧推演里的将领领兵的几仗
 *     为臣  在朝、官至、经手(最大的 5 件,其余折成"另经手 N 件",点了展开)、去职
 *     掌权  掌权、方式、结局、推演;下面「掌权时」那几年本国的事(同即位过的「在位时」)
 *   亡国出降 / 出奔、改朝换代去职比原定早的:那一行黄字,下面一段说清楚(同「君位」)
 */
import { useState, type ReactNode } from 'react';
import type { Civ, Person } from '../gen/civ/types';
import { capitalAt } from '../gen/civ/growth';
import { personName } from '../gen/civ/story/peopleText';
import { heOrShe } from '../gen/civ/story/gender';
import { peopleIndex, rulerAt } from '../gen/civ/story/peopleInfo';
import { APPOINT_SKILL_POWER, advanceOf, type Intervention } from '../gen/edits';
import type { AuthorCharacter } from '../gen/characters';
import { spaced, yearAt, yearShort, yearSpanAt, type Era } from '../gen/era';
import { removeIntervention, useEdits, useMonthNames, useMonths } from './editsStore';
import { nextAt, useStepwise } from './stepwiseStore';
import { momentStart, monthly } from './stepTime';
import { openOverview } from './overviewStore';
import { EventList, Link, Row, jumpTo } from './panelParts';
import { personEvents } from './PersonPanel';
import { newReignName } from './crownInfo';
import { polityShort } from '../gen/civ/story/regentInfo';
import {
  AUTHOR_HOW_NAMES,
  RESULT_WORD,
  SKILL_NAMES,
  deedPeer,
  deedText,
  deedsShown,
  ledWars,
  polityNameAt,
  postRole,
  voidTail,
  warLines,
  warTally,
  warTitle,
  type PostState,
} from './authorIvInfo';

const HEAD = { general: '为将', minister: '为臣', regent: '掌权' } as const;
const START = { general: '任将', minister: '入朝', regent: '掌权' } as const;

/** 一条任将任臣掌权在人物卡上的那一块 */
export function PostSec({ civ, c, st, era }: { civ: Civ; c: AuthorCharacter; st: PostState; era: Era | undefined }) {
  const sw = useStepwise();
  const months = useMonths();
  const names = useMonthNames();
  const always = monthly(advanceOf(useEdits()), months);
  const role = postRole(st.v);
  const what = (A: string) => (role === 'general' ? `为${A}将` : role === 'minister' ? `入${A}为臣` : `掌${A}国政`);
  if (st.kind === 'queued') {
    const when = st.step ? momentStart(nextAt(sw), months, era, names, always) : yearAt(st.v.from, era);
    return (
      <section className="cp-sec" data-post={role} data-post-state={st.step ? 'next' : 'pending'}>
        <div className="cp-sec-head">{HEAD[role]}</div>
        <div className="cp-grid cp-stats">
          <Row k={START[role]}>
            {when}
            {role === 'regent' ? '起' : ''}
            {what(st.A)}
            <em className="cr-pending">{st.step ? '下一步生效' : '待推演'}</em>
          </Row>
        </div>
      </section>
    );
  }
  if (st.kind === 'void')
    return (
      <section className="cp-sec" data-post={role} data-post-state="void">
        <div className="cp-sec-head cp-events-head">
          <span>{HEAD[role]}</span>
          {st.at >= 0 && (
            <button className="ins-link cp-more" data-act="post-remove" onClick={() => removeIntervention(st.at)}>
              去掉这条
            </button>
          )}
        </div>
        <div className="cp-grid cp-stats">
          <Row k={START[role]}>
            {yearAt(st.v.from, era)}起{what(st.A)}
            <em className="cr-fail">没生效</em>
          </Row>
          <div className="cr-note">
            {st.why}，{voidTail(st.v, c)}
          </div>
        </div>
      </section>
    );
  if (role === 'regent') return <RegentDone civ={civ} c={c} st={st} era={era} />;
  return <AppointDone civ={civ} c={c} st={st} era={era} />;
}

/** 右上「编年史」:这国、他上任那年 */
function ChronicleMore({ polity, at }: { polity: number; at: number }) {
  return (
    <button className="ins-link cp-more" data-act="post-chronicle" onClick={() => openOverview('chronicle', { polity, major: false, at })}>
      编年史
    </button>
  );
}

/** 在任 / 在朝 / 掌权那一行:"大衍王朝 2421–2442 年  21 年" / "2421 年起，至今" */
function SpanRow({ k, pid, A, from, until, era, still }: { k: string; pid: number; A: string; from: number; until: number | undefined; era: Era | undefined; still: string }) {
  const n = until !== undefined ? Math.floor(until) - Math.floor(from) : 0;
  return (
    <Row k={k}>
      <Link to={{ kind: 'polity', id: pid }}>{A}</Link>
      {' '}
      {until !== undefined ? (
        <>
          {yearSpanAt(from, until, era)}
          <em className="cp-num-note">{n >= 1 ? `${n} 年` : '不足一年'}</em>
        </>
      ) : (
        `${yearAt(from, era)}起，${still}`
      )}
    </Row>
  );
}

/**
 * 卸任 / 去职那一行和比原定早时下面那一段:到期(照你定的 / 到岁数)、卒于任上、又任了别的 / 即了位(同年入朝……)、
 * 亡国出降 / 出奔 / 随国归附、改朝换代去职(名臣;写"出奔")
 */
function endOf(civ: Civ, c: AuthorCharacter, st: Extract<PostState, { kind: 'done' }>, next: string, era: Era | undefined): { row: ReactNode; warn: string } | null {
  const x = st.x;
  const v = st.v as Extract<Intervention, { kind: 'appoint' }>;
  const u = x.until;
  if (u === undefined) return null;
  const general = v.role === 'general';
  const at = yearAt(Math.floor(u), era);
  const he = heOrShe(c);
  const P = civ.polities[x.polity];
  // 亡国那一句用简称:"大衍亡"
  const old = polityShort(civ, x.polity, u - 1 / 512);
  let word = '';
  let note = '';
  let early = '';
  switch (x.fate) {
    case 'retired':
      word = at;
      note = v.until !== undefined && Math.floor(u) === v.until ? `照你定的${next}` : `${Math.floor(u - c.born)} 岁${general ? '卸甲' : '致仕'}${next}`;
      break;
    case 'died':
      word = at;
      note = general ? '卒于军中' : '卒于任上';
      break;
    case 'yielded':
      word = at;
      note = next ? next.slice(1) : '改任';
      break;
    case 'surrendered':
    case 'fled':
    case 'merged':
      word = x.fate === 'surrendered' ? '出降' : x.fate === 'fled' ? '出奔' : '随国归附';
      note = `${at}，${old}亡`;
      early = `${old}亡，${he}${word}`;
      break;
    case 'deposed': {
      // 名臣:改朝换代去职(推演里新朝入主;写"出奔")
      word = '出奔';
      note = `${at}，${old}亡`;
      const nr = rulerAt(civ, x.polity, u);
      const reign = nr ? newReignName(P, nr.dynasty ?? 0) : { name: '', eastern: true };
      const cap = civ.settlements[capitalAt(P, u)]?.name ?? '';
      early = nr && reign.name ? `${nr.name}入主${cap}、${reign.eastern ? `改国号${reign.name}` : `${reign.name}兴`}，${he}出奔` : `改朝换代，${he}出奔`;
      break;
    }
    default:
      return null;
  }
  // 比原定早:原定卸任年 / 卒年
  const planned = v.until ?? c.died;
  const gap = planned !== undefined ? planned - Math.floor(u) : 0;
  const warn =
    early && gap >= 1
      ? `${v.until !== undefined ? `原定到${spaced(yearAt(planned!, era))}${general ? '卸任' : '去职'}` : `原定到卒年${spaced(yearAt(planned!, era))}`}；推演里${spaced(at)}${early}，比原定早 ${gap} 年。${
          c.died !== undefined ? `卒年照你写的${spaced(yearAt(c.died, era))}不变。` : ''
        }`
      : '';
  return {
    row: (
      <Row k={general ? '卸任' : '去职'} className={early ? 'cr-warn' : undefined}>
        {word}
        {note && <em className="cp-num-note">{note}</em>}
      </Row>
    ),
    warn,
  };
}

/** 卸任那年接着当了什么:",同年入朝" / ",同年即位" / "" */
function nextPost(civ: Civ, c: AuthorCharacter, x: Person): string {
  const u = x.until;
  if (u === undefined) return '';
  for (const y of civ.people ?? []) {
    if (y === x || y.author !== c.id || y.from === undefined || Math.floor(y.from) !== Math.floor(u)) continue;
    return y.role === 'ruler' ? '，同年即位' : y.role === 'minister' ? '，同年入朝' : '，同年改任';
  }
  return '';
}

function AppointDone({ civ, c, st, era }: { civ: Civ; c: AuthorCharacter; st: Extract<PostState, { kind: 'done' }>; era: Era | undefined }) {
  const x = st.x;
  const v = st.v as Extract<Intervention, { kind: 'appoint' }>;
  const general = v.role === 'general';
  const he = heOrShe(c);
  const from = x.from ?? v.from;
  const posts = x.posts ?? [];
  const top = posts[posts.length - 1];
  const end = endOf(civ, c, st, nextPost(civ, c, x), era);
  const A = polityNameAt(civ.polities[x.polity], from);
  return (
    <section className="cp-sec" data-post={v.role} data-post-state="done">
      <div className="cp-sec-head cp-events-head">
        <span>{general ? '为将' : '为臣'}</span>
        <ChronicleMore polity={x.polity} at={from} />
      </div>
      <div className="cp-grid cp-stats">
        <SpanRow k={general ? '在任' : '在朝'} pid={x.polity} A={A} from={from} until={x.until} era={era} still={general ? '在任至今' : '在朝至今'} />
        {top && (
          <Row k="官至">
            {top.title}
            <em className="cp-num-note">{general ? `${posts[0].title}起，打赢一仗升一级` : `${posts[0].title} ${yearShort(posts[0].from, era)} 起`}</em>
          </Row>
        )}
        {general ? <GeneralRows civ={civ} x={x} v={v} /> : <DeedRows civ={civ} x={x} era={era} />}
        {end?.row}
        {end?.warn && <div className="cr-note">{end.warn}</div>}
      </div>
      {general && <WarRows civ={civ} x={x} he={he} era={era} />}
    </section>
  );
}

/** 将领:能力、战绩 */
function GeneralRows({ civ, x, v }: { civ: Civ; x: Person; v: Extract<Intervention, { kind: 'appoint' }> }) {
  const tally = warTally(ledWars(civ, x));
  return (
    <>
      <Row k="能力">
        {SKILL_NAMES[v.skill ?? 'plain']}
        <em className="cp-num-note">{v.skill ? `挂帅的仗本方兵力 ×${APPOINT_SKILL_POWER[v.skill]}` : '胜负照推演'}</em>
      </Row>
      <Row k="战绩">{tally || '还没挂帅打过仗'}</Row>
    </>
  );
}

/** 将领:挂帅的每一仗、同时在打的别的仗 */
function WarRows({ civ, x, he, era }: { civ: Civ; x: Person; he: string; era: Era | undefined }) {
  const ws = ledWars(civ, x);
  const ongoing = (w: { until: number }) => x.until === undefined && w.until >= civ.endYear - 1e-6;
  // 同时在打、照旧推演里的将领领兵的几仗
  const from = x.from ?? x.born;
  const stop = x.until ?? civ.endYear;
  const ix = peopleIndex(civ);
  const others: string[] = [];
  const leaders = new Set<string>();
  const seen = new Set(ws.map((w) => w.war));
  for (const [war, e] of ix.wars) {
    if (seen.has(war) || (e.a !== x.polity && e.b !== x.polity) || e.year >= stop) continue;
    const side = e.a === x.polity ? 0 : 1;
    const gs = (ix.generals[x.polity] ?? []).filter((g) => g.author === undefined && g.commands?.some((m) => m.war === war && m.side === side && !m.rear && m.until > from && m.from < stop));
    if (!gs.length) continue;
    const F = civ.polities[side === 0 ? e.b : e.a];
    others.push(`${yearAt(e.year, era)}${side === 0 ? '伐' : '御'}${F ? polityNameAt(F, e.year) : '敌国'}`);
    for (const g of gs) leaders.add(personName(civ, g));
  }
  if (!ws.length && !others.length) return null;
  return (
    <>
      {ws.length > 0 && (
        <div className="cp-group" data-post="wars">
          {ws.map((w) => {
            const [a, b] = warLines(civ, w, x, he, ongoing(w), era);
            return (
              <button key={w.war} className="cp-ev" data-st="past" data-war={w.war} onClick={() => jumpTo(Math.floor(w.from))}>
                <span className={`cp-ev-year${era ? ' era' : ''}`}>{yearShort(w.from, era)}</span>
                <span className="cp-ev-text">
                  {warTitle(civ, w)}
                  {!ongoing(w) && <em className={`as-res as-${w.result}`}>{RESULT_WORD[w.result]}</em>}
                  <span className="oc-sub">{a}</span>
                  {b && <span className="oc-sub">{b}</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {others.length > 0 && (
        <div className="cr-note as-others">
          同时在打的{spaced(others.join('、'))}，照旧是推演里的{[...leaders].join('、')}领兵。
        </div>
      )}
    </>
  );
}

/** 名臣经手的事:最大的 5 件,其余折起来(点「另经手 N 件」展开) */
function DeedRows({ civ, x, era }: { civ: Civ; x: Person; era: Era | undefined }) {
  const [open, setOpen] = useState(false);
  const ds = x.deeds ?? [];
  if (!ds.length) {
    const n = Math.floor(x.until ?? civ.endYear) - Math.floor(x.from ?? x.born);
    return (
      <Row k="经手">
        无大事
        {n >= 1 && <em className="cp-num-note">在朝 {n} 年</em>}
      </Row>
    );
  }
  const { shown, folded } = deedsShown(ds);
  const list = open ? ds : shown;
  return (
    <>
      {list.map((d, i) => {
        const peer = deedPeer(civ, x, d);
        return (
          <Row key={i} k={i === 0 ? '经手' : ''}>
            {yearAt(d.year, era)}
            {deedText(civ, x, d)}
            {peer && <em className="cp-num-note">同{peer}</em>}
          </Row>
        );
      })}
      {folded.length > 0 && (
        <Row k="">
          <button className="ins-link" data-act="post-deeds-more" onClick={() => setOpen(!open)}>
            {open ? '收起' : `另经手 ${folded.length} 件`}
          </button>
        </Row>
      )}
    </>
  );
}

/** 掌权的结局:还政 / 卒于位 / 伏诛 / 篡位 / 名义君主下台随之了结 / 亡国、改朝换代 */
const REGENT_END: Record<NonNullable<Extract<PostState, { kind: 'done' }>['g']>['end'] & string, string> = {
  return: '还政',
  died: '卒于位',
  purged: '伏诛',
  usurp: '篡位',
  ruler: '随君主下台了结',
  fallen: '国亡了结',
  succeed: '即位',
};

function RegentDone({ civ, c, st, era }: { civ: Civ; c: AuthorCharacter; st: Extract<PostState, { kind: 'done' }>; era: Era | undefined }) {
  const g = st.g!;
  const x = st.x;
  const v = st.v as Extract<Intervention, { kind: 'regent' }>;
  const he = heOrShe(c);
  const pid = x.polity;
  const A = polityNameAt(civ.polities[pid], g.from);
  const N = civ.people?.[g.ruler];
  const u = g.until;
  const planned = v.years !== undefined ? v.from + v.years : undefined;
  const early = g.end === 'ruler' || g.end === 'fallen' || g.end === 'purged';
  // 掌权那几年本国的事(同在位时)
  const span: Person = { ...x, role: 'minister', from: g.from, ...(u !== undefined ? { until: u } : {}) };
  if (u === undefined) delete span.until;
  return (
    <>
      <section className="cp-sec" data-post="regent" data-post-state="done">
        <div className="cp-sec-head cp-events-head">
          <span>掌权</span>
          <ChronicleMore polity={pid} at={g.from} />
        </div>
        <div className="cp-grid cp-stats">
          <SpanRow k="掌权" pid={pid} A={A} from={g.from} until={u} era={era} still="掌权至今" />
          <Row k="方式">
            {AUTHOR_HOW_NAMES[g.kind === 'general' ? 'general' : 'chancellor']}
            {N && <em className="cp-num-note">{personName(civ, N)}照旧在位</em>}
          </Row>
          {u !== undefined && g.end && (
            <Row k="结局" className={early ? 'cr-warn' : undefined}>
              {REGENT_END[g.end]}
              <em className="cp-num-note">
                {yearAt(Math.floor(u), era)}
                {g.end === 'return' && planned !== undefined && Math.floor(u) === planned ? '，照你定的' : ''}
              </em>
            </Row>
          )}
          <Row k="推演">
            这几年开战、议和照{he}的性格
            {v.leanings && <em className="cp-num-note">好战 {v.leanings.war}</em>}
          </Row>
        </div>
      </section>
      <EventList
        civ={civ}
        self={x.id}
        title="掌权时"
        upTo={personEvents(civ, span)}
        limit={12}
        empty="这几年本国无事可记"
        more={
          <button className="ins-link cp-more" data-act="post-regent-chronicle" onClick={() => openOverview('chronicle', { polity: pid, major: false, at: u ?? civ.endYear })}>
            在编年史中查看
          </button>
        }
      />
    </>
  );
}
