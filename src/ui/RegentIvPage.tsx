/**
 * 人物卡「更多」里的另两张填写页(和让他去世、改他的倾向同一种做法,PersonIvPage.tsx;下的令先进待推演的单子,pendingStore.ts;
 * 推演规则见 gen/edits.ts 的干预"让他掌权""为他联姻"):
 *
 *   让他掌权  宗室(在位君主接着即位的太子、君主的兄弟叔伯)、在朝的名臣、领过兵的将领,那年在世、成年、没在位才有(newIvInfo.ts 的 regentChoice)。
 *             从哪一年起(−100 −10 [年份] +10;逐年推演固定"下一步年初")、下面一句他那年几岁、谁在位;
 *             灰底一块:怎么掌权(太子:引兵入朝 / 太子监国;叔伯:摄政;名臣、将领:专权,下面一句说这一种是怎样)、
 *             到什么时候(太子:到君主去世即位 / 几年后还政 / 篡位;叔伯:还政 / 篡位;名臣、将领:还政;选了还政、篡位多一行"过几年");
 *             灰底写会怎样:掌权、君主、推演(照谁的倾向,好战多少)、宗室(引兵入朝杀兄弟)、之后
 *   为他联姻  在位的君主、君主没即过位的儿子 / 兄弟叔伯,那年在世、成年才有(marryChoice)。
 *             哪一年结亲;和哪一国(下拉:这年有王室、没和本国打仗的,接壤的在前,小方块是那国的颜色,后面灰字"接壤，没在打仗");
 *             怎么结(娶对方宗室女 / 本国宗室女嫁过去 / 互嫁);灰底写会怎样:结亲、邦交、子女
 *   底部      返回 / 加入待推演(逐年推演写「加入」)
 */
import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { Civ, Person, RulerLeanings } from '../gen/civ/types';
import { kinOf, rulerShort } from '../gen/civ/peopleText';
import { heOrShe, heirWord, isFemale, mateWord, wedVerb, type Sexed } from '../gen/civ/gender';
import { rulerAt } from '../gen/civ/peopleInfo';
import { brideNameOf } from '../gen/civ/people';
import { drawLeanings } from '../gen/civ/rulers';
import { keyed4, subSeed } from '../gen/civ/rand';
import { polityShort } from '../gen/civ/regentInfo';
import { KIN_FADE } from '../gen/civ/marriages';
import { REGENT_YEARS_MAX, personKey, polityKey, type Intervention, type MarryHow, type RegentEnd, type RegentHow } from '../gen/edits';
import { eraText, spaced, yearAt, yearShortAt, yearSpanAt } from '../gen/era';
import { useEra } from './editsStore';
import { useNarrow } from './device';
import { queueIntervention } from './pendingStore';
import { nextAt, nextYear, useStepwise } from './stepwiseStore';
import { STEP_LOOK_WHY, StepEffectTime, useStepView } from './Stepwise';
import { interventionText, nameAt, regentEndWord, regentHowWord } from './Interventions';
import { YearRow, rgb, useYearInput, type YearInput } from './panelParts';
import { IV_ROYAL_AGE, marryChoice, marryPartners, regentChoice } from './newIvInfo';
import './newIv.css';

/** 在位的君主是掌权的人的什么人,说全:"父亲德宗""兄长德宗"(别的照 kinOf) */
const KIN_LONG: Readonly<Record<string, string>> = { 父: '父亲', 母: '母亲', 兄: '兄长', 姐: '姐姐' };

/** 这一种掌权下面那一句(N = 在位的君主;x = 掌权的人) */
const HOW_NOTE: Record<RegentHow, (N: string, x: Sexed) => string> = {
  march: (N, x) => `引兵入朝：带兵回朝、换掉宫中宿卫，杀兄长和战功比${heOrShe(x)}多的兄弟，不即位；${N}照旧在位。`,
  heir: (N, x) => `${heirWord(x)}监国：${N}照旧在位，政事交给${heirWord(x)}，不杀人。`,
  uncle: (N, x) => `摄政：${N}照旧在位，政出于${heOrShe(x)}。`,
  chancellor: (N, x) => `专权：${N}照旧在位，大权在${heOrShe(x)}手里。`,
  general: (N) => `专权：大将入朝秉政，${N}照旧在位。`,
};
/** 到什么时候的分段按钮上的字 */
const END_WORD = (end: RegentEnd, N: string) => (end === 'succeed' ? `到${N}去世，即位` : end === 'return' ? '几年后还政' : '篡位');

/** 人物键串成的随机数种子(摄政、专权的人的倾向:同一个人每次取的一样) */
function keyHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** 底部两个按钮、出错的那一句、Esc 返回 */
function IvShell({ kind, body, why, msg, step, onBack, onGo }: { kind: string; body: ReactNode; why: string | null; msg: string | null; step: boolean; onBack: () => void; onGo: () => void }) {
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    onBack();
  };
  return (
    <div className="cr-page" onKeyDown={onKey}>
      <div className="cp-body cr-form" data-iv-page={kind}>
        {body}
        {(msg || why) && <div className="cp-msg">{msg ?? why}</div>}
      </div>
      <div className="cp-foot mk-foot">
        <button className="cp-btn" data-act="person-iv-back" onClick={onBack}>
          返回
        </button>
        <button className="cp-btn primary" data-act="person-iv-go" disabled={!!why} onClick={onGo}>
          {step ? '加入' : '加入待推演'}
        </button>
      </div>
    </div>
  );
}

/** 年份那一块(逐年推演:固定"下一步年初") */
function YearBlock({ step, yi, label, note }: { step: boolean; yi: YearInput; label: string; note: string }) {
  const phone = useNarrow();
  if (step) return <StepEffectTime phone={phone} />;
  return (
    <div className="cp-from">
      <span className="cp-k">{label}</span>
      <YearRow yi={yi} label={label} />
      <span className="cp-note">{note}</span>
    </div>
  );
}

/** 一组分段按钮 */
function Seg<T extends string>({ options, value, word, onPick, act }: { options: readonly T[]; value: T; word: (v: T) => string; onPick: (v: T) => void; act: string }) {
  return (
    <div className="seg" role="group">
      {options.map((o) => (
        <button key={o} className={o === value ? 'on' : undefined} data-act={`${act}-${o}`} aria-pressed={o === value} onClick={() => onPick(o)}>
          {word(o)}
        </button>
      ))}
    </div>
  );
}

/** "过几年"那一行:−1 [N 年后还政] +1 */
function YearsRow({ n, end, onChange }: { n: number; end: RegentEnd; onChange: (n: number) => void }) {
  return (
    <div className="cp-from-row dx-years">
      <button className="cp-step" data-act="regent-years-less" onClick={() => onChange(n - 1)} disabled={n <= 1}>
        −1
      </button>
      <b>{regentEndWord(end, n)}</b>
      <button className="cp-step" data-act="regent-years-more" onClick={() => onChange(n + 1)} disabled={n >= REGENT_YEARS_MAX}>
        +1
      </button>
    </div>
  );
}

export function RegentIvPage({ civ, x, year, onBack }: { civ: Civ; x: Person; year: number; onBack: () => void }) {
  const era = useEra();
  const sw = useStepwise();
  const step = sw.on;
  const look = useStepView().look;
  const [msg, setMsg] = useState<string | null>(null);
  const clear = () => setMsg(null);
  // 能怎么掌、能下的年份按卡片那一年定(那几年君主是同一位)
  const open = regentChoice(civ, x, step ? nextAt(sw) : year);
  const span = open?.span ?? { lo: 1, hi: 0 };
  const yi = useYearInput(Math.min(Math.max(year, span.lo), Math.max(span.lo, span.hi)), span.lo, Math.max(span.lo, span.hi), clear);
  const y = step ? nextYear(sw) : yi.y;
  const [how, setHow] = useState<RegentHow>(open?.hows[0] ?? 'march');
  const [end, setEnd] = useState<RegentEnd>(open?.ends[0] ?? 'return');
  const [years, setYears] = useState(5);
  const P = civ.polities[x.polity];
  const pkey = personKey(civ, x.id);
  const N = open?.ruler;
  const Nname = N ? rulerShort(civ, N) : '君主';
  // 掌权的人的倾向:太子照他日后即位时的;别的照人物键取一份(和推演里一样存进干预)
  const leanings = useMemo<RulerLeanings | null>(() => {
    if (!open || how === 'march' || how === 'heir') return x.leanings ?? null;
    const base = subSeed(civ.seed, 'iv-regent');
    const h = keyHash(pkey);
    return drawLeanings((use) => keyed4(base, h, 0, use, 0), P?.lineage, P?.kind ?? 'farm', how === 'general' ? { war: 15 } : undefined);
  }, [open, how, x, civ.seed, pkey, P]);

  const why = (() => {
    if (step && look !== null) return STEP_LOOK_WHY;
    if (!pkey) return '推演里认不出这个人，下不了';
    // 逐年推演:下在下一步开头(已经推过的历史后面),只看他那时是不是那样的人,不按历史推到哪年卡
    if (!open || (!step && span.lo > span.hi)) return `那一年${heOrShe(x)}不是太子、君主的兄弟叔伯、在朝的名臣或领兵的将领，或者已不在世、不满 16 岁`;
    if (!step && !yi.valid) return `掌权的年份要在${spaced(yearSpanAt(span.lo, span.hi, era))}之间`;
    return null;
  })();

  const go = () => {
    if (why || !open) return;
    const a = polityKey(civ, x.polity);
    const v: Intervention = {
      kind: 'regent',
      a,
      person: pkey,
      from: y,
      how,
      end,
      ...(end !== 'succeed' ? { years } : {}),
      ...(how !== 'march' && how !== 'heir' && leanings ? { leanings: { ...leanings } } : {}),
    };
    const err = queueIntervention(v, interventionText(civ, v), { self: x.polity, target: null, shown: nameAt(P, y) });
    if (err) return setMsg(err);
    onBack();
  };

  const name = x.name;
  const age = Math.max(0, Math.floor(y - x.born));
  // 在位的是谁:"父亲德宗""兄长德宗";名臣、将领只写称呼
  const kin = N ? kinOf(civ, x, N) : '';
  const who = `${KIN_LONG[kin] ?? kin}${Nname}`;
  const at = yearAt(y, era);
  const endAt = y + years;
  const after =
    end === 'succeed'
      ? `${Nname}去世由${heOrShe(x)}即位；这年以前的一个不变`
      : end === 'return'
        ? `${spaced(yearAt(endAt, era))}还政于${Nname}；这年以前的一个不变`
        : `${spaced(yearAt(endAt, era))}废${Nname}自立，接着在位；这年以前的一个不变`;
  const body = (
    <>
      <YearBlock step={step} yi={yi} label="从哪一年起" note={`那年${heOrShe(x)} ${age} 岁、在世，${who}在位。`} />
      {open && (
        <div className="cp-from" data-iv="regent-how">
          <div className="dx-row">
            <span className="cp-k">怎么掌权</span>
            <Seg options={open.hows} value={how} word={(h) => regentHowWord(h, x)} onPick={(h) => (clear(), setHow(h))} act="regent-how" />
            <span className="cp-note">{HOW_NOTE[how](Nname, x)}</span>
          </div>
          <div className="dx-row">
            <span className="cp-k">到什么时候</span>
            <Seg options={open.ends} value={end} word={(e) => END_WORD(e, Nname)} onPick={(e) => (clear(), setEnd(e))} act="regent-end" />
            {end !== 'succeed' && <YearsRow n={years} end={end} onChange={(n) => setYears(Math.min(REGENT_YEARS_MAX, Math.max(1, n)))} />}
          </div>
        </div>
      )}
      {open && (
        <div className="iv-sum" data-iv="regent-sum">
          <span>掌权</span>
          <span>
            {name}，{at}起；政出于{heOrShe(x)}
          </span>
          <span>君主</span>
          <span>{N ? `${Nname}照旧在位${end === 'succeed' && N.until !== undefined ? `，到原定的 ${yearShortAt(N.until, era)}` : ''}` : '照旧在位'}</span>
          <span>推演</span>
          <span>
            这几年开战、议和照{name}的倾向{leanings ? `（好战 ${leanings.war}）` : ''}，国家方针照样加减
          </span>
          {how === 'march' && (
            <>
              <span>宗室</span>
              <span>引兵还朝时杀兄长和战功比{heOrShe(x)}多的兄弟</span>
            </>
          )}
          <span>之后</span>
          <span>{eraText(after, era)}</span>
        </div>
      )}
    </>
  );
  return <IvShell kind="regent" body={body} why={why} msg={msg} step={step} onBack={onBack} onGo={go} />;
}

/** 怎么结亲的分段按钮(take:这个人那一边娶 / 嫁过去) */
const marryWord = (h: 'take' | MarryHow, x: Sexed) => (h === 'take' ? `${wedVerb(x)}对方${mateWord(x)}` : h === 'give' ? '本国宗室女嫁过去' : '互嫁');

export function MarryIvPage({ civ, x, year, onBack }: { civ: Civ; x: Person; year: number; onBack: () => void }) {
  const era = useEra();
  const sw = useStepwise();
  const step = sw.on;
  const look = useStepView().look;
  const [msg, setMsg] = useState<string | null>(null);
  const clear = () => setMsg(null);
  // 能下的年份:他成年以后、去世(做君主的下台)以前
  const lo = Math.ceil(x.born + IV_ROYAL_AGE);
  const hi = Math.min(Math.ceil(civ.endYear) - 1, x.died !== undefined ? Math.ceil(x.died) - 1 : Infinity, x.role === 'ruler' && x.until !== undefined ? Math.ceil(x.until) - 1 : Infinity);
  const yi = useYearInput(Math.min(Math.max(year, lo), Math.max(lo, hi)), lo, Math.max(lo, hi), clear);
  const y = step ? nextYear(sw) : yi.y;
  const ok = marryChoice(civ, x, y);
  const partners = useMemo(() => (ok ? marryPartners(civ, x.polity, y) : []), [ok, civ, x.polity, y]);
  const [pick, setPick] = useState<number>(-1);
  const q = partners.some((p) => p.id === pick) ? pick : (partners[0]?.id ?? -1);
  const [how, setHow] = useState<'take' | MarryHow>('take');
  const P = civ.polities[x.polity];
  const Q = q >= 0 ? civ.polities[q] : undefined;
  const pkey = personKey(civ, x.id);

  const why = (() => {
    if (step && look !== null) return STEP_LOOK_WHY;
    if (!pkey) return '推演里认不出这个人，下不了';
    if (!step && !yi.valid) return `结亲的年份要在${spaced(yearSpanAt(lo, Math.max(lo, hi), era))}之间`;
    if (!ok) return `那一年${heOrShe(x)}不是在位的君主或在世、成年的宗室，或者本国是共和国、在位的是作者立的君主`;
    if (!Q) return '那一年没有能结亲的国家（有王室、没和本国打仗）';
    return null;
  })();

  const go = () => {
    if (why || !Q) return;
    const v: Intervention = { kind: 'marry', a: polityKey(civ, x.polity), person: pkey, b: polityKey(civ, Q.id), from: y, ...(how !== 'take' ? { how } : {}) };
    const err = queueIntervention(v, interventionText(civ, v), { self: x.polity, target: { kind: 'polity', id: Q.id }, shown: nameAt(P, y) });
    if (err) return setMsg(err);
    onBack();
  };

  const Bshort = Q ? polityShort(civ, Q.id, y) : '';
  const Ashort = polityShort(civ, x.polity, y);
  const at = yearAt(y, era);
  const age = Math.max(0, Math.floor(y - x.born));
  // 娶来的是对方那年在位君主的女儿:"大澜宗室女风氏（德宗之女）"
  const F = Q ? rulerAt(civ, Q.id, y) : null;
  // (这个人是女的:嫁过去,对方是那位君主的儿子)
  const bride = isFemale(x)
    ? `${Bshort}${mateWord(x)}${F ? `（${rulerShort(civ, F)}之子）` : ''}`
    : `${Bshort}宗室女${Q ? brideNameOf(civ, Q.id, F ?? undefined) : ''}${F ? `（${rulerShort(civ, F)}之女）` : ''}`;
  const wed =
    how === 'take'
      ? `${x.name}${wedVerb(x)}${bride}，${at}`
      : how === 'give'
        ? `${Ashort}宗室女嫁${Bshort}太子或宗室（推演里挑），${at}`
        : `${x.name}${wedVerb(x)}${bride}，${Ashort}宗室女也嫁过去，${at}`;
  const body = (
    <>
      <YearBlock step={step} yi={yi} label="哪一年结亲" note={`那年${heOrShe(x)} ${age} 岁；国君、宗室都行。`} />
      <div className="cp-from" data-iv="marry-how">
        <div className="dx-row">
          <span className="cp-k">和哪一国</span>
          <label className="dx-sel">
            <i style={Q ? { background: rgb(Q.color) } : undefined} />
            <b>{Q ? nameAt(Q, y) : '没有能结亲的国家'}</b>
            {Q && <span>{partners.find((p) => p.id === q)?.near ? '接壤，没在打仗' : '不接壤，没在打仗'}</span>}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
              <path d="M6 9l6 6 6-6" />
            </svg>
            <select aria-label="和哪一国" data-act="marry-partner" value={q} onChange={(e) => (clear(), setPick(Number(e.target.value)))} disabled={!partners.length}>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {nameAt(civ.polities[p.id], y)}
                  {p.near ? '（接壤）' : ''}
                </option>
              ))}
            </select>
          </label>
          <span className="cp-note">只列这年有王室、没和本国打仗的国家；共和国不行。</span>
        </div>
        <div className="dx-row">
          <span className="cp-k">怎么结</span>
          <Seg options={['take', 'give', 'mutual'] as const} value={how} word={(h) => marryWord(h, x)} onPick={(h) => (clear(), setHow(h))} act="marry-how" />
        </div>
      </div>
      {Q && (
        <div className="iv-sum" data-iv="marry-sum">
          <span>结亲</span>
          <span>{wed}</span>
          <span>邦交</span>
          <span>两国 {KIN_FADE} 年里少开战、更容易结盟，越往后越淡</span>
          {how !== 'give' && (
            <>
              <span>子女</span>
              <span>
                之后生的子女算{nameAt(P, y)}的人，卡片上写母亲出自{Bshort}
              </span>
            </>
          )}
        </div>
      )}
    </>
  );
  return <IvShell kind="marry" body={body} why={why} msg={msg} step={step} onBack={onBack} onGo={go} />;
}
