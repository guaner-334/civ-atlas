/**
 * 关注一个人的界面(找回、接着跟谁在 followInfo.ts;跟着谁记在这个世界的修改里,见 directorStore.ts 的 useDirectorFollow):
 *
 *   FollowPlate   字幕条正上方的名牌(和字幕条左边对齐,没有字幕时在字幕条的位置):头像、"跟着燕鸾澈"、身份、岁数、
 *                 哪年起在位 / 领兵 / 在朝、一条生平线(逐年推演只画到"现在",后面虚线;推演模式生到卒画全)、换人、×。
 *                 手机上是短名牌:头像、名字、身份、岁数、生平线、×。
 *                 他不在了(导播接着跟下一位):"燕溟死于兵乱 → 接着看江寒星"留几秒,不停;将领、名臣回到他的国家以后名牌收起
 *   FollowPick    导播设置「镜头跟着 · 一个人」下面他那一行 +「换一个 ›」
 *   FollowPicker  选人列表:搜人名、按身份分(全部 / 君主 / 将领 / 名臣 / 作者的人物)、按国家分组(大国在前),
 *                 只列这一年在位、领兵、在朝的人;点一行跟他、回到设置
 *   FollowAct     人物卡按钮一排里的「关注他 / 不关注」(宗室没有)
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import type { Civ, Person } from '../gen/civ/types';
import { personKey } from '../gen/edits';
import { polityName } from '../gen/civ/growth';
import { personSpan } from '../gen/civ/peopleInfo';
import { personName } from '../gen/civ/peopleText';
import { personPortrait } from '../gen/portrait';
import { yearFull, yearShort, yearSpan, type Era } from '../gen/era';
import { getCivTime, setCivTime, subscribeCivTime } from './civView';
import { getDirector, setDirectorFollow, setDirectorOn, setDirectorPanel, setDirectorPicking, useDirectorFollow, useDirectorOn } from './directorStore';
import { followAt, followChoices, followRefOf, followRole, followSub, goneWord, personEnd, resolveFollow, type FollowLeg, type FollowTarget } from './followInfo';
import { useEra } from './editsStore';
import { useStepwise } from './stepwiseStore';
import { polityHistory } from './WorldOverviewCountries';
import { PortraitView } from './Portrait';
import { Act } from './panelParts';
import { Icon } from './icons';

/** 他不在了、接着跟下一位时,"某某去世 → 接着看某某"留几毫秒 */
export const HANDOFF_MS = 6000;

const F = Math.floor;
const rgb = (c: readonly number[]) => `rgb(${c.join(',')})`;
const stop = (e: { stopPropagation(): void }) => e.stopPropagation();

/** 时间轴这一刻的年份(没有 = 历史的最后一年) */
const yearOf = (civ: Civ) => Math.min(civ.endYear, Math.max(0, getCivTime().year ?? civ.endYear));

/** 一段跟的是谁,写成能跨重推比较的字符串(人物、国家的稳定键;全世界的大事 = 'world') */
function legKey(civ: Civ, leg: FollowLeg): string {
  return leg.target ? (followRefOf(civ, leg.target)?.key ?? '') : 'world';
}

// ---------------------------------------------------------------------------
// 头像

/** 圆头像:那一年的岁数(不早于上台、不晚于去世);dead = 画像的样子 */
function Face({ civ, x, year, dead }: { civ: Civ; x: Person; year: number; dead?: boolean }) {
  const from = personSpan(x).from;
  const age = F(Math.min(Math.max(year, Math.min(from, x.born + 20)), x.died ?? Infinity) - x.born);
  const p = useMemo(() => personPortrait(civ, x.id, x.born + age), [civ, x, age]);
  const pol = civ.polities[x.polity];
  return <span className="fp-face">{p && pol ? <PortraitView p={p} size="mini" color={rgb(pol.color)} dead={dead} dark={dead && (x.fate === 'murdered' || x.fate === 'fell' || x.fate === 'battle')} /> : null}</span>;
}

/** 国家当头像:一块国色 */
function PolityFace({ civ, id }: { civ: Civ; id: number }) {
  const p = civ.polities[id];
  return <span className="fp-face fp-pol" style={{ '--c': p ? rgb(p.color) : 'var(--line)' } as CSSProperties} />;
}

// ---------------------------------------------------------------------------
// 名牌

/** 生平线:生 → 卒(逐年推演里还在世的:生 → "现在"再往后一截虚线);在台上那几年一截浅蓝,现在一个点 */
function LifeLine({ x, year, live, end, era, phone }: { x: Person; year: number; live: boolean; end: number; era: Era | null | undefined; phone: boolean }) {
  const born = x.born;
  const now = Math.max(born, Math.min(year, x.died ?? Infinity));
  const last = x.died ?? (live ? now + Math.max(1, (now - born) * 0.25) : Math.max(now, end));
  const span = Math.max(1e-6, last - born);
  const at = (y: number) => `${(Math.min(1, Math.max(0, (y - born) / span)) * 100).toFixed(1)}%`;
  const s = personSpan(x);
  const rgTo = s.until ?? (live ? now : last);
  const right = x.died !== undefined ? `${yearShort(x.died, era)} 卒` : `演到 ${yearShort(live ? year : end, era)}`;
  return (
    <span className="fp-life" aria-hidden="true">
      <i className="ln" style={live && x.died === undefined ? { right: `calc(100% - ${at(now)})` } : undefined} />
      {s.from < rgTo && <i className="rg" style={{ left: at(s.from), width: `calc(${at(rgTo)} - ${at(s.from)})` }} />}
      <i className="past" style={{ width: at(now) }} />
      {live && x.died === undefined && <i className="fut" style={{ left: at(now) }} />}
      <i className="now" style={{ left: at(now) }} />
      {!phone && (
        <>
          <span className="lb">{yearShort(born, era)} 生</span>
          <span className="lb r">{right}</span>
        </>
      )}
    </span>
  );
}

function PlateButtons({ phone }: { phone: boolean }) {
  return (
    <>
      {!phone && (
        <button
          className="fp-btn"
          data-act="follow-change"
          onClick={() => {
            setDirectorPanel('settings');
            setDirectorPicking(true);
          }}
        >
          换人
        </button>
      )}
      <button className="fp-btn only" data-act="follow-off" aria-label="不跟了" title="不跟了" onClick={() => setDirectorFollow(null)}>
        <Icon name="close" size={14} />
      </button>
    </>
  );
}

/** 字幕条上面的名牌(导播开着、跟着一个人时;字幕条里调,放在字幕条前面) */
export function FollowPlate({ civ, phone }: { civ: Civ; phone: boolean }) {
  const follow = useDirectorFollow();
  const era = useEra();
  const st = useStepwise();
  const start = useMemo(() => (follow?.kind === 'person' ? resolveFollow(civ, follow) : null), [civ, follow]);
  // 年份每帧都变:只在整年、跟的人换了的时候重画
  const snap = useCallback(() => {
    const y = yearOf(civ);
    return `${F(y)}|${legKey(civ, followAt(civ, start, y))}`;
  }, [civ, start]);
  const key = useSyncExternalStore(subscribeCivTime, snap, snap);
  const year = yearOf(civ);
  const leg = useMemo(() => followAt(civ, start, year), [civ, start, key]); // eslint-disable-line react-hooks/exhaustive-deps
  const lk = key.slice(key.indexOf('|') + 1);
  // 往前走到他不在了(接着跟的这一段是上一段那个人不在了以后的):"某某去世 → 接着看某某"留几秒
  const last = useRef<{ follow: string; leg: string } | null>(null);
  const [hand, setHand] = useState<string | null>(null);
  const fk = follow ? `${follow.kind}:${follow.key}` : '';
  useEffect(() => {
    const l = last.current;
    last.current = { follow: fk, leg: lk };
    if (!l || l.follow !== fk || l.leg === lk) return;
    const prev = leg.prev ? personKey(civ, leg.prev.id) : '';
    if (!prev || prev !== l.leg) {
      setHand(null);
      return;
    }
    setHand(lk);
    const t = setTimeout(() => setHand(null), HANDOFF_MS);
    return () => clearTimeout(t);
  }, [fk, lk]); // eslint-disable-line react-hooks/exhaustive-deps
  if (follow?.kind !== 'person' || !start) return null;
  const t = leg.target;
  const x = t?.kind === 'person' ? civ.people?.[t.id] : undefined;
  if (hand === lk && leg.prev) return <HandPlate civ={civ} prev={leg.prev} next={t} year={year} era={era} phone={phone} />;
  if (!x) return null;
  const live = st.on && x.died === undefined;
  const name = personName(civ, x);
  const role = followRole(civ, x);
  const age = year < x.born ? '未出生' : `${F(Math.min(year, x.died ?? year) - x.born)} 岁`;
  const sub = followSub(civ, x, year, era);
  const pol = civ.polities[x.polity];
  return (
    <div className={`fp${phone ? ' phone' : ''}`} data-follow={x.id} onPointerDown={stop} onClick={stop} onDoubleClick={stop}>
      <Face civ={civ} x={x} year={year} />
      <span className="fp-name">
        <b>{phone ? name : `跟着${name}`}</b>
        <small style={pol ? ({ '--c': rgb(pol.color) } as CSSProperties) : undefined}>{role}</small>
      </span>
      {!phone && <span className="fp-sep" />}
      <span className="fp-age">
        {age}
        <small>{sub}</small>
      </span>
      <LifeLine x={x} year={year} live={live} end={civ.endYear} era={era} phone={phone} />
      <PlateButtons phone={phone} />
    </div>
  );
}

/** 他不在了:"燕溟死于兵乱(1477–1529,享年 51)→ 接着看江寒星(继位的,大辰皇帝,38 岁)" */
function HandPlate({ civ, prev, next, year, era, phone }: { civ: Civ; prev: Person; next: FollowTarget | null; year: number; era: Era | null | undefined; phone: boolean }) {
  const end = personEnd(prev);
  const pName = personName(civ, prev);
  const life = prev.died !== undefined ? `${yearSpan(prev.born, prev.died, era)}，享年 ${F(prev.died - prev.born)}` : `${yearSpan(personSpan(prev).from, end, era)}${prev.role === 'ruler' ? '在位' : prev.role === 'minister' ? '在朝' : '领兵'}`;
  const x = next?.kind === 'person' ? civ.people?.[next.id] : undefined;
  const P = next?.kind === 'polity' ? civ.polities[next.id] : undefined;
  const pp = civ.polities[prev.polity];
  let face = null;
  let head: string;
  let small: string;
  if (x) {
    face = <Face civ={civ} x={x} year={year} />;
    head = `接着看${personName(civ, x)}`;
    small = `${prev.role === 'ruler' ? '继位的，' : ''}${followRole(civ, x)}，${F(year - x.born)} 岁`;
  } else if (P) {
    face = <PolityFace civ={civ} id={P.id} />;
    head = `接着看${polityName(P, Math.min(year, P.ended !== undefined ? P.ended - 1 / 256 : year))}`;
    small = '回到他的国家';
  } else {
    head = '接着看全世界的大事';
    small = pp ? `${polityName(pp, Math.max(pp.founded, Math.min(end, pp.ended ?? end) - 1 / 256))}已经不在了` : '';
  }
  return (
    <div className={`fp hand${phone ? ' phone' : ''}`} data-follow-gone={prev.id} onPointerDown={stop} onClick={stop} onDoubleClick={stop}>
      <Face civ={civ} x={prev} year={end} dead />
      <span className="fp-name gone">
        <b>
          {pName}
          {goneWord(civ, prev)}
        </b>
        {!phone && <small>{life}</small>}
      </span>
      <span className="fp-arrow" aria-hidden="true">
        →
      </span>
      {face}
      <span className="fp-name">
        <b>{head}</b>
        {!phone && small && <small>{small}</small>}
      </span>
      <PlateButtons phone={phone} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 导播设置里的一行、选人列表

/** 「一个人」下面他那一行(跟着的是谁按时间轴这一年算:他不在了就是接着跟的那位) */
export function FollowPick({ civ, year }: { civ: Civ; year: number }) {
  const follow = useDirectorFollow();
  const era = useEra();
  const start = useMemo(() => resolveFollow(civ, follow), [civ, follow]);
  const leg = followAt(civ, start, year);
  const t = leg.target;
  const x = t?.kind === 'person' ? civ.people?.[t.id] : undefined;
  const P = t?.kind === 'polity' ? civ.polities[t.id] : undefined;
  const gone = leg.prev ? `${personName(civ, leg.prev)}${goneWord(civ, leg.prev)}以后` : '';
  return (
    <div className="fp-pick" data-follow={x?.id}>
      {x ? <Face civ={civ} x={x} year={year} /> : P ? <PolityFace civ={civ} id={P.id} /> : <span className="fp-face fp-pol" />}
      <span className="fp-name">
        <b>{x ? personName(civ, x) : P ? polityName(P, Math.min(year, P.ended !== undefined ? P.ended - 1 / 256 : year)) : '全世界的大事'}</b>
        <small>{x ? `${followRole(civ, x)}，${F(year - x.born)} 岁，${followSub(civ, x, year, era)}` : P ? `${gone}，跟着他的国家` : gone}</small>
      </span>
      <button className="fp-link" data-act="follow-pick" onClick={() => setDirectorPicking(true)}>
        换一个 ›
      </button>
    </div>
  );
}

type Tab = 'all' | 'ruler' | 'general' | 'minister' | 'author';
const TABS: readonly [Tab, string][] = [
  ['all', '全部'],
  ['ruler', '君主'],
  ['general', '将领'],
  ['minister', '名臣'],
  ['author', '作者的人物'],
];

/** 选人列表(导播设置里换成它;点一行跟他、回到设置) */
export function FollowPicker({ civ, year }: { civ: Civ; year: number }) {
  const follow = useDirectorFollow();
  const era = useEra();
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<Tab>('all');
  const start = useMemo(() => resolveFollow(civ, follow), [civ, follow]);
  const curT = follow?.kind === 'person' ? followAt(civ, start, year).target : null;
  const cur = curT?.kind === 'person' ? curT.id : null;
  const groups = useMemo(() => {
    const peak = polityHistory(civ).peak;
    return followChoices(civ, year, (p) => -(peak[p] ?? 0), cur);
  }, [civ, year, cur]);
  const word = q.trim();
  const shown = groups
    .map((g) => ({
      ...g,
      people: g.people.filter((x) => (tab === 'all' || (tab === 'author' ? x.author !== undefined : x.role === tab)) && (!word || personName(civ, x).includes(word))),
    }))
    .filter((g) => g.people.length);
  const pick = (x: Person) => {
    const ref = followRefOf(civ, { kind: 'person', id: x.id });
    if (ref) setDirectorFollow(ref);
    setDirectorPicking(false);
  };
  return (
    <div className="fp-list" data-follow-picker="">
      <button className="fp-back" data-act="follow-back" onClick={() => setDirectorPicking(false)}>
        <Icon name="back" size={16} />
        导播设置
      </button>
      <label className="fp-search">
        <Icon name="search" size={15} />
        <input value={q} placeholder="搜人名" aria-label="搜人名" data-act="follow-search" onChange={(e) => setQ(e.target.value)} />
      </label>
      <div className="fp-tabs" role="tablist">
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} data-act={`follow-tab-${k}`} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      {shown.map((g) => {
        const P = civ.polities[g.polity];
        return (
          <div key={g.polity} className="fp-grp" data-polity={g.polity}>
            <div className="fp-grp-h">
              <i style={{ background: rgb(P.color) }} />
              {polityName(P, Math.min(year, P.ended !== undefined ? P.ended - 1 / 256 : year))}
            </div>
            <div className="fp-rows">
              {g.people.map((x) => (
                <button key={x.id} className={`fp-row${x.id === cur ? ' on' : ''}`} data-person={x.id} aria-pressed={x.id === cur} onClick={() => pick(x)}>
                  <Face civ={civ} x={x} year={year} />
                  <span className="fp-name">
                    <b>{personName(civ, x)}</b>
                    <small>
                      {followRole(civ, x)}，{F(year - x.born)} 岁
                    </small>
                  </span>
                  {x.id === cur && <span className="ck">✓</span>}
                </button>
              ))}
            </div>
          </div>
        );
      })}
      {!shown.length && <div className="fp-empty">{word ? `没有叫「${word}」的人` : '这一年没有这样的人'}</div>}
      <div className="fp-list-why">{yearFull(year + 1 / 128, era)}在位、领兵、在朝的人，大国在前；你立过的作者人物在「作者的人物」里。宗室不列（世系图里补出来的，没有自己的事）。</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 人物卡上的按钮

/** 关注他:导播跟着他(导播关着就打开);他已经不在了(或还没出生)= 时间轴跳回他上台那年放起来 */
export function followPerson(civ: Civ, x: Person, year: number) {
  const ref = followRefOf(civ, { kind: 'person', id: x.id });
  if (!ref) return;
  setDirectorFollow(ref);
  if (!getDirector().on) setDirectorOn(true);
  if (year < x.born || year >= personEnd(x)) setCivTime({ year: Math.min(civ.endYear, Math.max(0, personSpan(x).from)), playing: true, story: false, scrubbing: false });
}

/** 这一年导播跟着的是不是他(他不在了、接着跟了别人的不算) */
export function useFollowing(civ: Civ, id: number, year: number): boolean {
  const follow = useDirectorFollow();
  const on = useDirectorOn();
  if (!on || follow?.kind !== 'person') return false;
  const t = followAt(civ, resolveFollow(civ, follow), year).target;
  return t?.kind === 'person' && t.id === id;
}

/** 人物卡按钮一排里的「关注他 / 不关注」 */
export function FollowAct({ civ, x, year }: { civ: Civ; x: Person; year: number }) {
  const on = useFollowing(civ, x.id, year);
  return (
    <Act icon="camera" act="person-follow" pressed={on} onClick={() => (on ? setDirectorFollow(null) : followPerson(civ, x, year))} title={on ? '导播不再跟着他' : '导播只讲他这一辈子，镜头跟着他'}>
      {on ? '不关注' : '关注他'}
    </Act>
  );
}
