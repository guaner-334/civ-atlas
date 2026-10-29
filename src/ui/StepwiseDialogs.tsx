/**
 * 逐年推演的几个窗口(状态在 stepwiseStore.ts 的 dialog):
 *
 *   开始之前   推演模式里点「从这里演绎」:你是(造物主 / 演一国,演一国挑哪国,见 roleStore.ts)、
 *              每一步多长、多久停一下(出大事也停)、倒计时,每组下面一句写清选了会怎样;
 *              导播一行(「改」原地展开导播设置);推演模式里这一年以后下过的干预,默认都勾着(到那一年照样发生),能逐条去掉。
 *              电脑上是浮在正中的窗口,手机上从底部升起、几乎占满屏(「开始演绎」贴底)
 *   推进设置   中途改(侧栏「这个故事」):你是 + 同样三组 + 导播,下一步起照新的走
 *   存回推演模式  存成一个普通世界:默认存成新世界、原来的不动,也能覆盖原来的;存好以后打开它(默认开)。
 *              另开过支的,最上面一行写明存的是在用的这一支,另外几支不跟着存
 *   从这里重新演绎  先问一句:世界回到那一年年初,从这里往下另开一支;原来那条(那以后演绎出来的历史、那以后加的干预)
 *              原样留在在用的这一支里,侧栏「支线」里随时切回去;新的一支的名字可以先起(不改 = "第 N 支")
 * AdvanceFields(三组推进设置)新建世界第 2 步也用。
 */
import { Fragment, useEffect, useMemo, useState } from 'react';
import type { Civ } from '../gen/civ/types';
import { ADVANCE_COUNTDOWNS, ADVANCE_EVERY_CHOICES, BRANCH_NAME_MAX, END_YEAR_MAX, YEAR_TICKS, advanceOf, cleanPlay, commandAt, momentAt as tickMoment, playAt, type Advance, type Intervention } from '../gen/edits';
import { branchList, laterInterventions, rewindStepwise } from '../gen/stepwise';
import { fullChronicle } from '../gen/civ/religionText';
import { eraText, spaced, yearAt, yearFull } from '../gen/era';
import { getEdits, setAdvance, useEdits, useEra, useMonths } from './editsStore';
import { getPending } from './pendingStore';
import { interventionText } from './Interventions';
import { DirectorSettings, followName } from './Director';
import { setStepDirectorOn, stepDirectorOn, useDirector, useDirectorFollow } from './directorStore';
import { getStepwise, nextAt, nextYear, openStepDialog, stepwiseActions, useStepwise } from './stepwiseStore';
import { branchLabel, branchSpan } from './StepBranches';
import { rewindBrief } from './stepwisePlan';
import { stepSeconds, useMonthText } from './Stepwise';
import { momentFull, momentStart, momentsText, spanText } from './stepTime';
import { STEP_PICKS, STEP_UNITS, advanceBrief, everyWhy, ownStep as ownStep_, stepPickOf, stepUnitMax, stepWhy, type Run, type StepPick } from './advanceText';
import { currentWorld, stepOrigin, useSavesVersion } from './saveStore';
import { Icon } from './icons';
import { polityKey } from '../gen/edits';
import { alivePolities } from './crownInfo';
import { nameAt } from './Interventions';
import { getCivTime, getSelection } from './civView';
import { FlagIcon } from './Flag';
import { flagOf, useFlags } from './flagStore';
import { rolePolity } from './policyInfo';
import { armRole, setRole, useRole } from './roleStore';
import { followRolePolity, roleOff } from './RoleBar';
import './stepwise.css';
import './policy.css';

const stop = (e: { stopPropagation(): void }) => e.stopPropagation();

// ---------------------------------------------------------------------------
// 三组推进设置

/** 分段按钮的一格 */
function Seg<T extends string | number>({ items, value, onPick, wide, act, unit }: { items: { v: T; label: string }[]; value: T | null; onPick: (v: T) => void; wide?: boolean; act: string; unit?: boolean }) {
  return (
    <span className={`sw-seg${wide ? ' wide' : ''}${unit ? ' sw-unit' : ''}`} role="radiogroup">
      {items.map((it) => (
        <button key={String(it.v)} role="radio" aria-checked={value === it.v} className={value === it.v ? 'on' : ''} data-act={`${act}-${it.v}`} onClick={() => onPick(it.v)}>
          {it.label}
        </button>
      ))}
    </span>
  );
}

/**
 * 自己填的那个数(失焦、回车时交;不合格的退回原来的;clamp = 超了夹回 lo–hi,不退回)。
 * unit = 数后面的字(默认"年";'' = 不写,单位另有一排按钮)
 */
function NumField({ value, lo, hi, onCommit, act, unit = '年', clamp }: { value: number; lo: number; hi: number; onCommit: (n: number) => void; act: string; unit?: string; clamp?: boolean }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = Math.round(Number(text));
    if (text !== '' && Number.isFinite(n) && clamp) {
      const c = Math.min(hi, Math.max(lo, n));
      setText(String(c));
      if (c !== value) onCommit(c);
    } else if (Number.isFinite(n) && n >= lo && n <= hi) onCommit(n);
    else setText(String(value));
  };
  return (
    <span className="sw-num-field">
      <input
        className={`sw-num-in${unit ? '' : ' short'}`}
        inputMode="numeric"
        data-act={act}
        value={text}
        onChange={(e) => setText(e.target.value.replace(/\D/g, '').slice(0, 5))}
        onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
        onBlur={commit}
      />
      {unit}
    </span>
  );
}

const STEP_SEG = STEP_PICKS.map((p) => ({ v: p.v, label: p.label }));
const UNIT_SEG = STEP_UNITS.map((u) => ({ v: u.v, label: u.label }));
const EVERY_SEG = [{ v: '0', label: '每一步' }, ...ADVANCE_EVERY_CHOICES.map((n) => ({ v: String(n), label: `${n} 年` })), { v: 'own', label: '自己填' }];
const COUNT_SEG = ADVANCE_COUNTDOWNS.map((n) => ({ v: String(n), label: n ? `${n} 秒` : '不倒计时' }));
const COUNT_WORDS: Record<number, string> = { 30: '半分钟', 60: '一分钟', 120: '两分钟' };

/** 几段字(加粗的用 <b>) */
function Runs({ runs }: { runs: readonly Run[] }) {
  return (
    <>
      {runs.map((r, i) => (r.b ? <b key={i}>{r.t}</b> : <Fragment key={i}>{r.t}</Fragment>))}
    </>
  );
}

export function AdvanceFields({ adv, set, phone }: { adv: Advance; set: (a: Advance) => void; phone: boolean }) {
  const months = useMonths();
  const [ownStep, setOwnStep] = useState(stepPickOf(adv) === 'own');
  const [ownEvery, setOwnEvery] = useState(adv.every > 0 && !ADVANCE_EVERY_CHOICES.includes(adv.every));
  const stepV: StepPick = ownStep ? 'own' : stepPickOf(adv);
  const everyV = ownEvery ? 'own' : String(adv.every);
  // 这台设备上一步约几秒(开着窗口时不跟着变)
  const [perStep] = useState(() => stepSeconds(getStepwise().on ? getStepwise().now : getCivTime().year ?? 0));
  const stepSeg = (
    <Seg
      items={STEP_SEG}
      value={stepV}
      wide={phone}
      act="adv-step"
      onPick={(v) => {
        if (v === 'own') return setOwnStep(true);
        setOwnStep(false);
        const p = STEP_PICKS.find((x) => x.v === v)?.adv;
        if (p) set({ ...adv, ...p });
      }}
    />
  );
  const everySeg = (
    <Seg
      items={EVERY_SEG}
      value={everyV}
      wide={phone}
      act="adv-every"
      onPick={(v) => {
        if (v === 'own') return setOwnEvery(true);
        setOwnEvery(false);
        set({ ...adv, every: Number(v) });
      }}
    />
  );
  const countSeg = <Seg items={COUNT_SEG} value={String(adv.countdown)} wide={phone} act="adv-count" onPick={(v) => set({ ...adv, countdown: Number(v) })} />;
  const bigRow = (
    <div className="sw-r">
      <span className="sw-r-main">
        <span>出大事也停</span>
        <small>{phone ? '亡国、改朝换代、大战时也停' : '亡国、改朝换代、大战时也停下来'}</small>
      </span>
      <button className={`sw-sw${adv.big ? ' on' : ''}`} role="switch" aria-checked={adv.big} aria-label="出大事也停" data-act="adv-big" onClick={() => set({ ...adv, big: !adv.big })} />
    </div>
  );
  // 自己填:一个数 + 单位(年 / 个月 / 格);换单位数字不变,超了夹回范围
  const ownStepRow = ownStep && (
    <div className="sw-r sw-own">
      <span className="sw-r-main">
        <span>一步走多久</span>
        <small>最短 1 格，最长 5 年</small>
      </span>
      <NumField value={adv.step} lo={1} hi={stepUnitMax(adv.unit, months)} act="adv-step-n" unit="" clamp onCommit={(n) => set({ ...adv, ...ownStep_(n, adv.unit, months) })} />
      <Seg items={UNIT_SEG} value={adv.unit} act="adv-unit" unit onPick={(u) => set({ ...adv, ...ownStep_(adv.step, u, months) })} />
    </div>
  );
  const ownEveryRow = ownEvery && (
    <div className="sw-r sw-own">
      <span className="sw-r-main">每隔几年停一下</span>
      <NumField value={Math.max(1, adv.every)} lo={1} hi={END_YEAR_MAX} act="adv-every-n" onCommit={(n) => set({ ...adv, every: n })} />
    </div>
  );
  const cw = COUNT_WORDS[adv.countdown];
  const countWhy = adv.countdown ? (
    <>
      <b>{adv.countdown} 秒</b>：{phone ? '' : '停下'}
      {cw}后自己接着走，点「接着演绎」提前开。<b>不倒计时</b>：等你点了才走。
    </>
  ) : (
    <>
      <b>不倒计时</b>：等你点了才走。
    </>
  );
  const stepNote = <Runs runs={stepWhy(adv, months, perStep, phone)} />;
  const everyNote = <Runs runs={everyWhy(adv, months, phone)} />;
  if (phone)
    return (
      <>
        <div className="sw-sh">
          每一步<em>干预在下一步生效</em>
        </div>
        <div className="sw-pad">{stepSeg}</div>
        {ownStepRow && <div className="sw-grp white sw-gap">{ownStepRow}</div>}
        <div className="sw-why" data-why="step">
          {stepNote}
        </div>
        <div className="sw-sh">
          停一下<em>看看这一段的大事</em>
        </div>
        <div className="sw-pad">{everySeg}</div>
        <div className="sw-grp white sw-gap">
          {ownEveryRow}
          {bigRow}
        </div>
        <div className="sw-why" data-why="every">
          {everyNote}
        </div>
        <div className="sw-sh">
          倒计时<em>停下以后多久接着走</em>
        </div>
        <div className="sw-pad">{countSeg}</div>
        <div className="sw-why">{countWhy}</div>
      </>
    );
  return (
    <>
      <div className="sw-sec">
        <div className="sw-sec-head">
          每一步<em>干预在下一步生效</em>
        </div>
        <div className="sw-grp">
          <div className="sw-r">
            <span className="sw-r-main">一步走</span>
            {stepSeg}
          </div>
          {ownStepRow}
        </div>
        <div className="sw-why" data-why="step">
          {stepNote}
        </div>
      </div>
      <div className="sw-sec">
        <div className="sw-sec-head">
          停一下<em>看看这一段的大事，也可以干预</em>
        </div>
        <div className="sw-grp">
          <div className="sw-r">
            <span className="sw-r-main">每隔</span>
            {everySeg}
          </div>
          {ownEveryRow}
          {bigRow}
        </div>
        <div className="sw-why" data-why="every">
          {everyNote}
        </div>
      </div>
      <div className="sw-sec">
        <div className="sw-sec-head">
          倒计时<em>停下以后多久自己接着走</em>
        </div>
        <div className="sw-grp">
          <div className="sw-r">
            <span className="sw-r-main">停下以后</span>
            {countSeg}
          </div>
        </div>
        <div className="sw-why">{countWhy}</div>
      </div>
    </>
  );
}

/** 导播一行:"镜头跟着全世界的大事，事少快、事多慢";点了原地展开导播设置 */
function DirectorRow({ civ, phone, on, setOn }: { civ: Civ | null; phone: boolean; on: boolean; setOn: (on: boolean) => void }) {
  const d = useDirector();
  const follow = useDirectorFollow();
  const [open, setOpen] = useState(false);
  const who = civ ? followName(civ, follow) : null;
  const brief = !on ? '关着：照固定速度往下走，不放字幕' : `${phone ? '' : '镜头'}跟着${who ?? '全世界的大事'}，${d.pace === 'auto' ? '事少快、事多慢' : '照 1×、4× 走'}`;
  return (
    <>
      <div className={`sw-grp${phone ? ' white' : ''}`}>
        <button className="sw-r sw-r-btn" data-act="step-director" aria-expanded={open} onClick={() => setOpen(!open)}>
          <Icon name="camera" size={phone ? 21 : 18} className="sw-r-ic" />
          <span className="sw-r-main">{brief}</span>
          {!phone && <span className="sw-r-link">改</span>}
          <Icon name={open ? 'down' : 'chevron'} size={14} className="sw-r-chev" />
        </button>
      </div>
      {open && <DirectorSettings civ={civ} phone={false} inline sw={{ on, set: setOn }} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// 你是:造物主 / 演一国

const ROLE_SEG = [
  { v: 'god', label: '造物主' },
  { v: 'one', label: '演一国' },
] as const;

/** 「你是」这一组的选择:mode = 造物主 / 演一国,who = 演哪一国(这份历史里的编号) */
interface RoleChoice {
  mode: 'god' | 'one';
  who: number;
}

/** 开始演绎 / 推进设置里「你是」一组:身份(造物主 | 演一国)、演哪一国(「换一国 ›」列出那年还在的国家,大的在前) */
function RoleFields({ civ, year, value, set, phone }: { civ: Civ; year: number; value: RoleChoice; set: (c: RoleChoice) => void; phone: boolean }) {
  const flags = useFlags();
  const [list, setList] = useState(false);
  const alive = useMemo(() => alivePolities(civ, year), [civ, year]);
  const P = civ.polities[value.who];
  const name = P ? nameAt(P, year) : '';
  const flag = P ? flagOf(flags, P.id, year) : null;
  const seg = (
    <Seg
      items={[...ROLE_SEG]}
      value={value.mode}
      wide={phone}
      act="role"
      onPick={(v) => {
        set({ ...value, mode: v });
        if (v === 'god') setList(false);
      }}
    />
  );
  const whoRow = value.mode === 'one' && (
    <div className="sw-r" data-role-who={value.who}>
      <span className="sw-r-main">演哪一国</span>
      <span className="role-pick">
        {flag && (
          <span className="role-flag">
            <FlagIcon spec={flag.spec} w={24} />
          </span>
        )}
        {name}
        <button data-act="role-list" aria-expanded={list} onClick={() => setList(!list)}>
          {list ? '收起' : '换一国 ›'}
        </button>
      </span>
    </div>
  );
  const listRows = value.mode === 'one' && list && (
    <div className="role-list">
      {alive.map((x) => (
        <button
          key={x.id}
          className="sw-r"
          data-role-polity={x.id}
          onClick={() => {
            set({ ...value, who: x.id });
            setList(false);
          }}
        >
          <span className="sw-r-main">
            <i className="cr-dot" style={{ background: `rgb(${civ.polities[x.id].color.join(',')})` }} />
            {x.name}
            <small>{x.regions} 州</small>
          </span>
          {x.id === value.who && <Icon name="check" size={14} />}
        </button>
      ))}
    </div>
  );
  const why = (
    <div className="sw-why">
      <b>演一国</b>：只管{name || '你挑的那一国'} —— 它的方针、干预你来定，别国照推演自己走；导播默认跟着它。不记分、不设限，随时能切回造物主。<b>造物主</b>
      ：照现在这样，哪国都能改。
    </div>
  );
  if (phone)
    return (
      <>
        <div className="sw-sh">
          你是<em>随时能换</em>
        </div>
        <div className="sw-pad">{seg}</div>
        {whoRow && (
          <div className="sw-grp white sw-gap">
            {whoRow}
            {listRows}
          </div>
        )}
        {why}
      </>
    );
  return (
    <div className="sw-sec" data-sec="role">
      <div className="sw-sec-head">
        你是<em>随时能换</em>
      </div>
      <div className="sw-grp">
        <div className="sw-r">
          <span className="sw-r-main">身份</span>
          {seg}
        </div>
        {whoRow}
        {listRows}
      </div>
      {why}
    </div>
  );
}

/** 「你是」一开始选什么:推进设置 = 现在演的那国;开始演绎 = 造物主,演哪一国默认选中的国家(没选中 = 那年最大的) */
function initialRole(civ: Civ, year: number, role: string | null, start: boolean): RoleChoice {
  const now = rolePolity(civ, role);
  if (!start && now >= 0) return { mode: 'one', who: now };
  const sel = getSelection().sel;
  const alive = alivePolities(civ, year);
  const picked = sel?.kind === 'polity' && alive.some((x) => x.id === sel.id) ? sel.id : (alive[0]?.id ?? -1);
  return { mode: 'god', who: picked };
}

// ---------------------------------------------------------------------------
// 开始之前 / 推进设置

function useDialogKeys(close: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [close]);
}

export function StepStartDialog({ phone, civ }: { phone: boolean; civ: Civ | null }) {
  const s = useStepwise();
  const dlg = s.dialog;
  const kind = dlg?.kind === 'start' || dlg?.kind === 'settings' ? dlg.kind : null;
  if (!kind || !civ) return null;
  return <AdvanceDialog key={kind} phone={phone} civ={civ} start={dlg?.kind === 'start' ? dlg.year : null} />;
}

function AdvanceDialog({ phone, civ, start }: { phone: boolean; civ: Civ; start: number | null }) {
  const edits = useEdits();
  const era = useEra();
  const [adv, setAdv] = useState<Advance>(() => advanceOf(getEdits()));
  const [dirOn, setDirOn] = useState(stepDirectorOn);
  // 你是:造物主 / 演一国(开始演绎:看的是开始那年;中途改:看"现在")
  const role = useRole();
  const roleYear = start ?? Math.min(civ.endYear, getStepwise().now);
  const [as, setAs] = useState<RoleChoice>(() => initialRole(civ, roleYear, role, start !== null));
  const asOk = as.mode === 'one' && !!civ.polities[as.who];
  const later = useMemo(() => (start !== null ? laterInterventions(edits, start) : []), [edits, start]);
  const [drop, setDrop] = useState<ReadonlySet<number>>(new Set());
  const close = () => openStepDialog(null);
  useDialogKeys(close);
  const ok = () => {
    // 开始演绎:推进设置只写进另存出来的那个世界(原来的世界不动);演绎中改设置:写进这个世界
    if (start === null) setAdvance(adv);
    setStepDirectorOn(dirOn);
    close();
    // 演一国:开始演绎时先记下,新世界打开以后再认上去(RoleBar.tsx);中途改的直接换,导播跟着关注它
    const key = asOk ? polityKey(civ, as.who) : null;
    if (start !== null) armRole(key);
    else if (key) {
      if (key !== role) {
        setRole(key);
        followRolePolity(key);
      }
    } else if (role) roleOff(rolePolity(civ, role));
    if (start !== null) stepwiseActions()?.start(start, [...drop], adv);
  };
  const title = start !== null ? `从${yearFull(start, era)}开始演绎` : '推进设置';
  const lead =
    start !== null
      ? `世界从${spaced(yearAt(start, era))}起一步一步自己往下推，导播带你看发生了什么。以后的事还没发生，只能在「现在」干预，下一步生效。原来的世界不动，随时能存回推演模式。`
      : '下一步起照新的设置往下走；这一段还是从上一次停下的那一年数起。';
  const toggle = (i: number) => {
    const next = new Set(drop);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    setDrop(next);
  };
  const laterSec = later.length > 0 && start !== null && (
    <>
      {phone ? (
        <div className="sw-sh">
          {yearFull(start, era)}以后的干预<em>推演模式里下过 {later.length} 条</em>
        </div>
      ) : (
        <div className="sw-sec-head">
          {yearFull(start, era)}以后的干预<em>你在推演模式里下过 {later.length} 条</em>
        </div>
      )}
      <div className={`sw-grp${phone ? ' white sw-gap0' : ''}`}>
        {later.map(({ index, v }) => {
          const on = !drop.has(index);
          const text = eraText(interventionText(civ, v), era);
          return phone ? (
            <div key={index} className="sw-r" data-later={index}>
              <span className="sw-r-main">
                {yearAt(v.from, era)}　{text}
              </span>
              <button className={`sw-sw small${on ? ' on' : ''}`} role="switch" aria-checked={on} aria-label={text} onClick={() => toggle(index)} />
            </div>
          ) : (
            <button key={index} className="sw-r sw-r-btn" role="checkbox" aria-checked={on} data-later={index} onClick={() => toggle(index)}>
              <span className={`sw-ck${on ? ' on' : ''}`}>{on && <Icon name="check" size={14} />}</span>
              <span className="sw-yr">{yearAt(v.from, era)}</span>
              <span className="sw-r-main">{text}</span>
            </button>
          );
        })}
      </div>
      {!phone && <div className="sw-why">勾着的到那一年照样发生（导播会提一句）；到时候对象已经不在了的不生效，会说明原因。去掉勾就不带进故事。</div>}
    </>
  );
  const okLabel = start !== null ? '开始演绎' : '好了';
  if (phone)
    return (
      <>
        <div className="sw-scrim" onClick={close} />
        <section className="sw-psheet tall" role="dialog" aria-label={title} onPointerDown={stop} onClick={stop}>
          <div className="sw-grip" />
          <div className="sw-psheet-top">
            <b>{title}</b>
            <button className="sw-close" aria-label="关上" data-act="step-dialog-close" onClick={close}>
              <Icon name="close" size={17} />
            </button>
          </div>
          <div className="sw-lead">{lead}</div>
          <div className="sw-psheet-body">
            <RoleFields civ={civ} year={roleYear} value={as} set={setAs} phone />
            <AdvanceFields adv={adv} set={setAdv} phone />
            <div className="sw-sh">导播</div>
            <DirectorRow civ={civ} phone on={dirOn} setOn={setDirOn} />
            {laterSec}
          </div>
          <div className="sw-psheet-foot">
            <button className="sw-big pri" data-act="step-start" onClick={ok}>
              {okLabel}
            </button>
          </div>
        </section>
      </>
    );
  return (
    <>
      <div className="sw-scrim" onClick={close} />
      <div className="sw-dlg-wrap">
        <div className="sw-dlg sw-start" role="dialog" aria-label={title} onPointerDown={stop} onClick={stop}>
          <h2>{title}</h2>
          <p className="sw-lead">{lead}</p>
          <RoleFields civ={civ} year={roleYear} value={as} set={setAs} phone={false} />
          <AdvanceFields adv={adv} set={setAdv} phone={false} />
          <div className="sw-sec">
            <div className="sw-sec-head">导播</div>
            <DirectorRow civ={civ} phone={false} on={dirOn} setOn={setDirOn} />
          </div>
          {laterSec && <div className="sw-sec">{laterSec}</div>}
          <div className="sw-foot">
            {start !== null && <span className="sw-foot-note">随时能「存回推演模式」，存成一个普通世界。</span>}
            <span className="sw-sp" />
            <button className="sw-btn2" data-act="step-cancel" onClick={close}>
              取消
            </button>
            <button className="sw-btn2 pri" data-act="step-start" onClick={ok}>
              {okLabel}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// 存回推演模式

export function StepSaveDialog({ phone }: { phone: boolean }) {
  const s = useStepwise();
  if (s.dialog?.kind !== 'save') return null;
  return <SaveDialog phone={phone} />;
}

/** 存成新世界时的名字:"未命名世界（故事）" */
export const SAVE_SUFFIX = '（故事）';

function SaveDialog({ phone }: { phone: boolean }) {
  const edits = useEdits();
  const era = useEra();
  useSavesVersion();
  const cur = currentWorld();
  const title = cur?.title || '未命名世界';
  const from = getStepwise().start;
  const origin = cur ? stepOrigin(cur.id) : null;
  const [asNew, setAsNew] = useState(true);
  const [open, setOpen] = useState(true);
  const close = () => openStepDialog(null);
  useDialogKeys(close);
  const play = cleanPlay(edits.play);
  const now = play?.year ?? getStepwise().now;
  const n = (play?.commands.length ?? 0) + getPending().filter((x) => x.kind === 'iv').length;
  const lead = `把这个故事存成一个普通世界：${eraText(`第 0–${now} 年`, era)}的历史${n ? `，连同故事里加的 ${n} 条干预` : ''}。存好以后照样看编年史、写史书，回到任一年改了重推，导出地图、编年史和视频，以后还能接着往后推。`;
  // 另开过支:最上面一行写明存的是在用的这一支,另外几支不跟着存
  const branches = useMemo(() => branchList(edits), [edits]);
  const curBranch = branches.find((b) => b.current);
  const branchRow =
    branches.length > 1 && curBranch ? (
      <div className={`sw-grp${phone ? ' white' : ''}`} data-save-branch>
        <div className="sw-r top">
          <span className="br-save-ic">
            <Icon name="branch" size={18} />
          </span>
          <span className="sw-r-main">
            <span>存的是在用的这一支：{branchLabel(curBranch)}</span>
            <small>
              {branchSpan(curBranch, branches, era, true)}。另外 {branches.length - 1} 支不跟着存，还留在这个故事里；想存哪一支，先切过去再存。
            </small>
          </span>
        </div>
      </div>
    ) : null;
  const go = () => {
    close();
    stepwiseActions()?.saveBack(asNew || !origin, open);
  };
  const newName = `「${title}${SAVE_SUFFIX}」`;
  const oldName = origin ? `「${origin.title}」` : '';
  const radios = (
    <div className={`sw-grp${phone ? ' white' : ''}`} role="radiogroup">
      <button className="sw-r sw-r-btn top" role="radio" aria-checked={asNew || !origin} data-act="save-new" onClick={() => setAsNew(true)}>
        <span className={`sw-radio${asNew || !origin ? ' on' : ''}`} />
        <span className="sw-r-main">
          <span>{phone ? '存成新的世界' : `存成新的世界${newName}`}</span>
          <small>{phone ? `${newName}，原来的不动` : origin ? `原来的${oldName}不动` : '这个故事照样留着'}</small>
        </span>
      </button>
      {origin && (
        <button className="sw-r sw-r-btn top" role="radio" aria-checked={!asNew} data-act="save-over" onClick={() => setAsNew(false)}>
          <span className={`sw-radio${!asNew ? ' on' : ''}`} />
          <span className="sw-r-main">
            <span>{phone ? '覆盖原来的世界' : `覆盖原来的${oldName}`}</span>
            <small>原来{yearFull(from, era)}以后的历史换成这个故事</small>
          </span>
        </button>
      )}
    </div>
  );
  const openRow = (
    <div className={`sw-grp${phone ? ' white' : ''}`}>
      <div className="sw-r">
        <span className="sw-r-main">
          <span>存好以后打开它</span>
          <small>关掉就留在这里接着演绎</small>
        </span>
        <button className={`sw-sw${open ? ' on' : ''}`} role="switch" aria-checked={open} aria-label="存好以后打开它" data-act="save-open" onClick={() => setOpen(!open)} />
      </div>
    </div>
  );
  if (phone)
    return (
      <>
        <div className="sw-scrim" onClick={close} />
        <section className="sw-psheet" role="dialog" aria-label="存回推演模式" onPointerDown={stop} onClick={stop}>
          <div className="sw-grip" />
          <div className="sw-psheet-top">
            <b>存回推演模式</b>
          </div>
          <div className="sw-lead">{lead}</div>
          <div className="sw-psheet-body">
            {branchRow}
            {radios}
            {openRow}
          </div>
          <div className="sw-psheet-btns">
            <button className="sw-big" data-act="save-cancel" onClick={close}>
              取消
            </button>
            <button className="sw-big pri" data-act="save-go" onClick={go}>
              存回推演模式
            </button>
          </div>
        </section>
      </>
    );
  return (
    <>
      <div className="sw-scrim" onClick={close} />
      <div className="sw-dlg-wrap">
        <div className={`sw-dlg sw-save-dlg${branchRow ? ' br-has-branch' : ''}`} role="dialog" aria-label="存回推演模式" onPointerDown={stop} onClick={stop}>
          <h2>存回推演模式</h2>
          <p className="sw-lead">{lead}</p>
          {branchRow && <div className="sw-sec first">{branchRow}</div>}
          <div className={`sw-sec${branchRow ? '' : ' first'}`}>{radios}</div>
          <div className="sw-sec">
            {openRow}
            <div className="sw-why">故事本身照样留在「我的世界」里，随时回来接着演绎。</div>
          </div>
          <div className="sw-foot save">
            <span className="sw-sp" />
            <button className="sw-btn2" data-act="save-cancel" onClick={close}>
              取消
            </button>
            <button className="sw-btn2 pri" data-act="save-go" onClick={go}>
              存回推演模式
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// 从这里重新演绎:先问一句

export function StepRewindDialog({ phone, civ }: { phone: boolean; civ: Civ | null }) {
  const s = useStepwise();
  if (s.dialog?.kind !== 'rewind' || !civ) return null;
  return <RewindDialog phone={phone} civ={civ} year={s.dialog.year} />;
}

/** 不要了的干预最多写出几条(再多写"等 N 条") */
const REWIND_LIST_MAX = 4;

function RewindDialog({ phone, civ, year }: { phone: boolean; civ: Civ; year: number }) {
  const edits = useEdits();
  const era = useEra();
  const s = useStepwise();
  // 原来那条留在哪一支(在用的这支)、新的一支默认叫什么(编号 = 最大的加一,没改 = 不起名)
  const branches = useMemo(() => branchList(edits), [edits]);
  const keepIn = branchLabel(branches.find((b) => b.current) ?? { id: 1 });
  const newLabel = `第 ${branches.reduce((m, b) => Math.max(m, b.id), 0) + 1} 支`;
  const [name, setName] = useState(newLabel);
  const close = () => openStepDialog(null);
  useDialogKeys(close);
  const mt = useMonthText();
  const play = cleanPlay(edits.play);
  const now = play ? playAt(play) / YEAR_TICKS : s.now;
  // 回到哪一刻(停在年中、一步短于一年的,回到那一格;一步一年以上的回到那一年年初)
  const T = Math.min(now, Math.max(0, Math.floor(year * YEAR_TICKS + 1e-6) / YEAR_TICKS));
  const r = useMemo(() => rewindStepwise(edits, tickMoment(Math.round(T * YEAR_TICKS))), [edits, T]);
  // 不要了的干预:那一刻和以后下过的、正在算的那一步带着的、单子里还没交出去的(都在那一刻以后生效);ats = 各在哪一刻生效
  const { dropped, ats } = useMemo(() => {
    const done = [...(r?.dropped ?? []), ...(s.busy?.commands ?? [])];
    const queued = getPending().flatMap((x) => (x.kind === 'iv' ? [{ ...x.v, from: nextYear(s) } as Intervention] : []));
    return { dropped: [...done, ...queued], ats: [...done.map((v) => commandAt(v) / YEAR_TICKS), ...(queued.length ? [nextAt(s)] : [])] };
  }, [r, s]);
  const brief = useMemo(() => rewindBrief(civ, T, now, fullChronicle(civ)), [civ, T, now]);
  const adv = advanceOf(edits);
  const go = () => {
    close();
    const v = name.trim();
    stepwiseActions()?.rewind(T, v === newLabel ? '' : v);
  };
  const ivTexts = dropped.map((v) => eraText(interventionText(civ, v), era));
  const ivSmall = ivTexts.length > REWIND_LIST_MAX ? `${ivTexts.slice(0, REWIND_LIST_MAX).join('；')}……等 ${ivTexts.length} 条` : ivTexts.join('；');
  const ivWhen = momentsText(ats, mt.months, era, mt.names, mt.always);
  const span = spanText(T, now, mt.months, era, mt.names, false);
  const back = momentStart(T, mt.months, era, mt.names, mt.always);
  const Tfull = momentFull(T, mt.months, era, mt.names, mt.always);
  const histSmall = phone
    ? `${brief.length ? `${brief.slice(0, 2).join('、')}……` : ''}留在「${keepIn}」里`
    : `${brief.length ? `${brief.join('、')}……` : ''}都留在「${keepIn}」里`;
  const lead = phone
    ? `世界回到${back}，从这里往下另开一支。原来那条原样留着，随时切回去：`
    : `世界回到${back}，从这里往下另开一支。原来那条原样留着，在侧栏「支线」里随时切回去：`;
  const rows = (
    <div className={`sw-grp sw-drop${phone ? ' white' : ''}`}>
      <div className="sw-r top" data-rewind="history">
        <span className="sw-r-main">
          <span>{phone ? `${span}的历史` : `${span}演绎出来的历史`}</span>
          <small>{histSmall}</small>
        </span>
        <span className="sw-r-side br-keep">留着</span>
      </div>
      {dropped.length > 0 && (
        <div className="sw-r top" data-rewind="interventions">
          <span className="sw-r-main">
            <span>{ivWhen}加的干预</span>
            <small>{ivSmall}</small>
          </span>
          <span className="sw-r-side">{dropped.length} 条</span>
        </div>
      )}
    </div>
  );
  const why = phone ? `${Tfull}以前的照旧，推进设置也不变。` : `${Tfull}以前的照旧，推进设置也不变（${advanceBrief(adv)}）。`;
  const nameField = (
    <input
      className="br-name-in"
      value={name}
      maxLength={BRANCH_NAME_MAX}
      aria-label="新的一支的名字"
      data-act="rewind-name"
      onChange={(e) => setName(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') go();
      }}
    />
  );
  const nameRow = (
    <div className={`sw-grp${phone ? ' white' : ''}`}>
      <div className="sw-r">
        <span className="sw-r-main">
          <span>{phone ? '新的一支叫' : '名字'}</span>
          <small>{phone ? '以后在「支线」里也能改' : '可以不改，以后在「支线」里也能改'}</small>
        </span>
        {nameField}
      </div>
    </div>
  );
  const head = `从${Tfull}重新演绎？`;
  if (phone)
    return (
      <>
        <div className="sw-scrim" onClick={close} />
        <section className="sw-psheet sw-rewind" role="dialog" aria-label={head} onPointerDown={stop} onClick={stop}>
          <div className="sw-grip" />
          <div className="sw-psheet-top">
            <b>{head}</b>
          </div>
          <div className="sw-lead">{lead}</div>
          <div className="sw-psheet-body">
            {rows}
            <div className="sw-why">{why}</div>
            {nameRow}
          </div>
          <div className="sw-psheet-btns">
            <button className="sw-big" data-act="rewind-cancel" onClick={close}>
              取消
            </button>
            <button className="sw-big pri" data-act="rewind-go" onClick={go}>
              重新演绎
            </button>
          </div>
        </section>
      </>
    );
  return (
    <>
      <div className="sw-scrim" onClick={close} />
      <div className="sw-dlg-wrap">
        <div className="sw-dlg sw-rewind-dlg" role="dialog" aria-label={head} onPointerDown={stop} onClick={stop}>
          <h2>{head}</h2>
          <p className="sw-lead">{lead}</p>
          <div className="sw-sec first">
            {rows}
            <div className="sw-why">{why}</div>
          </div>
          <div className="sw-sec">
            <div className="sw-sec-head">新的一支</div>
            {nameRow}
          </div>
          <div className="sw-foot save">
            <span className="sw-foot-note br-foot-note">要存成单独的世界：「支线」里那一支的「存回推演模式」</span>
            <button className="sw-btn2" data-act="rewind-cancel" onClick={close}>
              取消
            </button>
            <button className="sw-btn2 pri" data-act="rewind-go" onClick={go}>
              从{Tfull}重新演绎
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
