/**
 * 推演模式「再推 N 年」的界面(状态在 extendStore.ts,接后台线程在 App.tsx):
 *
 *   ExtendButton  时间轴轨道尽头、1× / 4× 前面:电脑「＋ 再推」,手机一个小圆钮「＋」(像剪辑软件主轨道尽头的加号)。
 *                 推的时候原地变成进度圈:电脑圈 +「停下」,手机圈里一个方块(点了就停)。推到第 60000 年变灰。
 *   ExtendPop     电脑:点「再推」在按钮上面弹出的小卡片 —— 100 / 500 / 1000 年 / 自己填,底下写推到第几年、
 *                 这台电脑大约多久、时间轴会怎么变;「取消」「再推 N 年」。Esc、点别处 = 取消,回车 = 再推
 *   ExtendSheet   手机:从底下拉起的卡片,内容同上,底部两个大按钮
 *   ExtendDock    手机推的时候:时间轴胶囊上面一张小卡片「再推 500 年 / 正在推,到第 3240 年」+「停下」
 *
 * 推完以后的提示条(「从第 N 年接着看」「撤销」)、时间轴上刚推的那段由 App / CivTimeline 画。
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { END_YEAR_MAX } from '../gen/edits';
import { yearFull, type Era } from '../gen/era';
import { getEdits, useEra, useMonthNames, useMonths } from './editsStore';
import { momentFull } from './stepTime';
import {
  EXTEND_PRESETS,
  busyParts,
  durationText,
  extendMs,
  extendPlan,
  extendRoom,
  extendStart,
  extendStop,
  pickYears,
  setExtendOpen,
  setExtendPick,
  stopTip,
  useExtend,
  type ExtendBusy,
  type ExtendPick,
} from './extendStore';
import { Icon } from './icons';
import './extend.css';

const stop = (e: { stopPropagation(): void }) => e.stopPropagation();

/** 推到的那一刻怎么写:推到一年中间的写到月("第 1549 年 9 月",起了名字的写名字),正好在年初的只写年 */
function useMoment(): (y: number) => string {
  const era = useEra();
  const months = useMonths();
  const names = useMonthNames();
  return (y) => momentFull(y, months, era, names, false);
}

/** 推的时候说到哪了:"正在推,到第 3240 年""正在推,到第 1549 年 9 月" / 推演推完、还在收尾 / 有地形大事从第 0 年重推 / 还没回报(字见 extendStore 的 busyParts) */
export function busyNote(b: ExtendBusy, era: Era | undefined, months: number, names: readonly string[] | undefined, phone = false): ReactNode {
  const [a, n, c] = busyParts(b, era, months, names, phone);
  if (!n) return a;
  // 数字标成主色(纪年时整个年份一起)
  return (
    <>
      {a}
      <b>{n}</b>
      {c}
    </>
  );
}

/** 进度圈:灰圈底 + 主色弧(跟着百分比转);没有分段进度、收尾的时候一直转 */
function Ring({ b }: { b: ExtendBusy }) {
  const spin = b.slow || b.year === null || b.year >= b.to;
  return <i className={`xt-ring${spin ? ' spin' : ''}`} style={{ ['--p' as string]: spin ? Math.max(0.25, b.pct) : b.pct }} aria-hidden="true" />;
}

// ---------------------------------------------------------------------------
// 按钮

/** 时间轴尽头的「再推」:end = 现在推到第几年 */
export function ExtendButton({ end, phone }: { end: number; phone: boolean }) {
  const x = useExtend();
  const era = useEra();
  const months = useMonths();
  const names = useMonthNames();
  const b = x.busy;
  if (b) {
    return phone ? (
      <button className="xt-btn phone busy" data-act="extend-stop" aria-label={stopTip(b, era, months, names)} onClick={extendStop}>
        <Ring b={b} />
        <i className="xt-sq" aria-hidden="true" />
      </button>
    ) : (
      <button className="xt-btn busy" data-act="extend-stop" data-tip={stopTip(b, era, months, names)} data-tip-side="above" onClick={extendStop}>
        <Ring b={b} />
        停下
      </button>
    );
  }
  const max = end >= END_YEAR_MAX;
  const tip = max ? `已经推到${yearFull(END_YEAR_MAX)}，最多就到这` : undefined;
  return (
    <button
      className={`xt-btn${phone ? ' phone' : ''}${x.open ? ' open' : ''}${max ? ' max' : ''}`}
      data-act="extend"
      aria-disabled={max}
      aria-expanded={x.open}
      aria-label={phone ? (tip ?? '再推几年') : tip}
      data-tip={phone ? undefined : tip}
      data-tip-side="above"
      onClick={() => !max && setExtendOpen(!x.open)}
    >
      <Icon name="plus" size={phone ? 16 : 14} />
      {!phone && '再推'}
    </button>
  );
}

// ---------------------------------------------------------------------------
// 选几年(电脑的弹层、手机的底部卡片共用)

function useForm(end: number) {
  const x = useExtend();
  const [text, setText] = useState(x.own ? String(x.own) : '');
  const own = text === '' ? null : Number(text);
  const years = pickYears(x.pick, own);
  const plan = years ? extendPlan(end, years) : null;
  const go = () => {
    if (!years || !plan) return;
    extendStart(plan.to - end);
  };
  const pick = (p: ExtendPick) => setExtendPick(p, p === 'own' ? own : undefined);
  const type = (v: string) => {
    const t = v.replace(/[^\d]/g, '').replace(/^0+(?=\d)/, '').slice(0, 6);
    setText(t);
    setExtendPick('own', t === '' ? null : Number(t));
  };
  return { x, text, years, plan, go, pick, type };
}

/** 主按钮上的字:"再推 500 年";填多了 "推到第 60000 年";没填 "再推" */
function goLabel(years: number | null, over: boolean): string {
  if (over) return `推到${yearFull(END_YEAR_MAX)}`;
  return years ? `再推 ${years} 年` : '再推';
}

/** Esc = 取消,回车 = 再推(按在按钮上的回车照按钮自己的) */
function useKeys(on: boolean, go: () => void) {
  const goRef = useRef(go);
  goRef.current = go;
  useEffect(() => {
    if (!on) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setExtendOpen(false);
      } else if (e.key === 'Enter' && !(e.target as Element)?.closest?.('button')) {
        e.preventDefault();
        goRef.current();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [on]);
}

/** 点在弹层、卡片、「再推」按钮以外的地方:收起 */
function useOutside(on: boolean, sel: string) {
  useEffect(() => {
    if (!on) return;
    const onDown = (e: PointerEvent) => {
      const el = e.target as Element;
      if (el.closest?.(`${sel}, .xt-btn`)) return;
      setExtendOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [on, sel]);
}

function Seg({ pick, onPick, phone }: { pick: ExtendPick; onPick: (p: ExtendPick) => void; phone?: boolean }) {
  return (
    <div className={`xt-seg${phone ? ' phone' : ''}`} role="radiogroup" aria-label="再推几年">
      {EXTEND_PRESETS.map((p) => (
        <button key={p} role="radio" aria-checked={pick === p} className={pick === p ? 'on' : ''} data-act={`extend-${p}`} onClick={() => onPick(p)}>
          {p} 年
        </button>
      ))}
      <button role="radio" aria-checked={pick === 'own'} className={pick === 'own' ? 'on' : ''} data-act="extend-own" onClick={() => onPick('own')}>
        自己填
      </button>
    </div>
  );
}

/** 自己填:「再推 [ ] 年」,右边写还能再推几年(填多了变红) */
function OwnRow({ end, text, over, onType, phone }: { end: number; text: string; over: boolean; onType: (v: string) => void; phone?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => ref.current?.focus(), []);
  // 年中停下存回的世界推到的那一刻带小数:还能再推几年只写整年
  const room = Math.floor(extendRoom(end));
  return (
    <div className={`xt-own${over ? ' over' : ''}${phone ? ' phone' : ''}`}>
      <span>再推</span>
      <input ref={ref} className="xt-in" inputMode="numeric" enterKeyHint="go" aria-label="再推几年" data-act="extend-years" value={text} onChange={(e) => onType(e.target.value)} />
      <span>年</span>
      <span className="xt-sp" />
      <span className="xt-room">{over ? `最多还能再推 ${room} 年` : `还能再推 ${room} 年`}</span>
    </div>
  );
}

/** 底下那一格:推到第几年、大约多久、推的时候怎样、时间轴怎么变 */
function Result({ end, years, plan, phone }: { end: number; years: number | null; plan: ReturnType<typeof extendPlan> | null; phone?: boolean }) {
  const moment = useMoment();
  const slow = !!getEdits().upheavals?.length;
  const ms = !phone && plan ? extendMs(end, plan.to - end, slow) : null;
  return (
    <div className="xt-res">
      <div className="xt-res-top">
        {plan ? <b>推到{moment(plan.to)}</b> : <b className="dim">填上要再推几年</b>}
        <span className="xt-sp" />
        {ms !== null && years && <em>这台电脑{durationText(ms)}</em>}
      </div>
      <div className="xt-why">
        推的时候地图照样能看、能拖，随时能停下。
        {plan && (
          <>
            <br />
            时间轴变长：原来的 {Math.floor(end)} 年挤到左边 {plan.squeeze}%。
          </>
        )}
      </div>
    </div>
  );
}

/** 电脑:「再推」按钮上面的弹层(放在底部那一行里,按按钮的位置摆;小三角对着按钮) */
export function ExtendPop({ end, hidden }: { end: number; hidden?: boolean }) {
  const x = useExtend();
  const open = x.open && !hidden && !x.busy;
  return open ? <PopBody end={end} /> : null;
}

/** 弹层右边比按钮中线多出去多少(像素);小三角在按钮正上方 */
const POP_RIGHT = 55;
/** 弹层离时间轴上沿多远(像素) */
const POP_GAP = 10;

function PopBody({ end }: { end: number }) {
  const moment = useMoment();
  const f = useForm(end);
  const ref = useRef<HTMLDivElement>(null);
  useKeys(true, f.go);
  useOutside(true, '.xt-pop');
  // 按「再推」按钮的位置摆(导播开着时 1× / 4× 前面多一个「自动」,按钮的位置跟着变)
  useLayoutEffect(() => {
    const el = ref.current;
    const row = el?.offsetParent;
    const place = () => {
      const btn = document.querySelector('.civ-timeline .xt-btn');
      const bar = btn?.closest('.timebar');
      if (!el || !row || !btn || !bar) return;
      const r = row.getBoundingClientRect();
      const b = btn.getBoundingClientRect();
      el.style.right = `${Math.round(r.right - (b.left + b.width / 2 + POP_RIGHT))}px`;
      el.style.bottom = `${Math.round(r.bottom - bar.getBoundingClientRect().top + POP_GAP)}px`;
      el.style.visibility = 'visible';
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, []);
  // 打开时按钮先落在主按钮上(回车 = 再推);选自己填时输入框自己拿焦点
  const goBtn = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (f.x.pick !== 'own') goBtn.current?.focus({ preventScroll: true });
  }, []);
  const over = !!f.plan?.over;
  return (
    <div ref={ref} className="xt-pop" role="dialog" aria-label="再推几年" style={{ visibility: 'hidden' }} onPointerDown={stop} onClick={stop} onDoubleClick={stop} onWheel={stop}>
      <div className="xt-head">
        <h3>再推几年</h3>
        <span className="xt-sp" />
        <em>现在推到{moment(end)}</em>
      </div>
      <div className="xt-lead">从{moment(end)}接着往后推：前面的历史一点不变，只往后长。</div>
      <Seg pick={f.x.pick} onPick={f.pick} />
      {f.x.pick === 'own' && <OwnRow end={end} text={f.text} over={over} onType={f.type} />}
      <Result end={end} years={f.years} plan={f.plan} />
      <div className="xt-foot">
        <span className="xt-sp" />
        <button className="xt-b" data-act="extend-cancel" onClick={() => setExtendOpen(false)}>
          取消
        </button>
        <button ref={goBtn} className="xt-b pri" data-act="extend-go" disabled={!f.years} onClick={f.go}>
          {goLabel(f.years, over)}
        </button>
      </div>
      <i className="xt-caret" aria-hidden="true" />
    </div>
  );
}

/** 手机:从底下拉起的卡片(和导播设置的手机卡片一个样子) */
export function ExtendSheet({ end, hidden }: { end: number; hidden?: boolean }) {
  const x = useExtend();
  const open = x.open && !hidden && !x.busy;
  return open ? <SheetBody end={end} /> : null;
}

function SheetBody({ end }: { end: number }) {
  const moment = useMoment();
  const f = useForm(end);
  useKeys(true, f.go);
  useOutside(true, '.xt-sheet');
  // 弹出数字键盘时卡片跟着往上(键盘盖住的那一截让出来)
  const [lift, setLift] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const on = () => setLift(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    on();
    vv.addEventListener('resize', on);
    vv.addEventListener('scroll', on);
    return () => {
      vv.removeEventListener('resize', on);
      vv.removeEventListener('scroll', on);
    };
  }, []);
  const over = !!f.plan?.over;
  return (
    <div className="xt-sheet" role="dialog" aria-label="再推几年" style={lift ? { bottom: lift } : undefined} onPointerDown={stop} onClick={stop} onDoubleClick={stop}>
      <div className="xt-grip" />
      <div className="xt-sheet-head">
        <div className="xt-head">
          <h3>再推几年</h3>
          <span className="xt-sp" />
          <em>现在推到{moment(end)}</em>
        </div>
        <div className="xt-lead">接着往后推：前面的历史一点不变，只往后长。</div>
      </div>
      <Seg pick={f.x.pick} onPick={f.pick} phone />
      {f.x.pick === 'own' && <OwnRow end={end} text={f.text} over={over} onType={f.type} phone />}
      <Result end={end} years={f.years} plan={f.plan} phone />
      <div className="xt-foot phone">
        <button className="xt-b big" data-act="extend-cancel" onClick={() => setExtendOpen(false)}>
          取消
        </button>
        <button className="xt-b big pri" data-act="extend-go" disabled={!f.years} onClick={f.go}>
          {goLabel(f.years, over)}
        </button>
      </div>
    </div>
  );
}

/** 手机推的时候:时间轴胶囊上面一张小卡片 */
export function ExtendDock({ hidden }: { hidden?: boolean }) {
  const x = useExtend();
  const era = useEra();
  const months = useMonths();
  const names = useMonthNames();
  const b = x.busy;
  if (!b || hidden) return null;
  return (
    <div className="xt-dock" role="status" onPointerDown={stop} onClick={stop} onDoubleClick={stop}>
      <div className="xt-dock-text">
        <b>再推 {b.to - b.from} 年</b>
        <span>{busyNote(b, era, months, names, true)}</span>
      </div>
      <button className="xt-b dock" data-act="extend-stop-card" onClick={extendStop}>
        停下
      </button>
    </div>
  );
}
