/**
 * 并排试推(调规则大卡底下点开,盖在大卡上面):同一张地图、同一个文明种子,左边官方规则、右边这一套规则一起往下推。
 *
 *   顶上    ‹ 这套规则的名字(回大卡)/ 并排试推 + 一句说明 / 右上换地图(compareMaps.ts)、×(连大卡一起关)
 *   中间    两张地图(电脑左右摆、手机上下摆)同样大、对得严丝合缝(paneDraw.ts);左上角一个小牌子写哪套规则
 *   时间轴  一根,两边同一年:播放 / 暂停、第几年、1× / 4×;两条虚线标两边各推到哪年(推完的不画),推不下去的那边一道红线;
 *           还没推到的年份拖不过去,播放到那里停下等;一边推不下去,另一边照样能往后看
 *   底下    一张表比到这一年为止的大事(tally.ts;推不下去时比到停住的那年);电脑上多一列差多少,手机上只比两列数、不列最大的国
 * 推不下去(右边):那张图停在那一年、盖一层浅白,中间一张卡说可能是哪两项太极端(rules/suspects.ts);
 *   我的规则里的:「这两项改回官方」(改回、右边重推)「回去调规则」;别人分享的、世界里那一版只能看:只有「回去看规则」。
 * 历史在后台推(useCompareRun.ts):推到第 300、700、1300、2100、3000 年各交一份,地图上一段段长出来;一打开就从第 0 年按 1× 播放。
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Icon } from '../icons';
import { isNarrow } from '../device';
import { currentWorld, listWorlds } from '../saveStore';
import { getEdits } from '../editsStore';
import { getStage } from '../stageStore';
import { useMyRules, setRuleValue } from '../rulesStore';
import { closeRulesSheet } from '../rules/sheetStore';
import { suspectItems, type Suspect } from '../rules/suspects';
import { cleanTuning, type TuningValues } from '../../gen/civ/tuning';
import { latestTuning, rulesTuning } from '../../gen/civ/ruleSet';
import { GROW_MARKS } from '../../gen/civ/grow';
import { closeCompare, useCompare } from './compareStore';
import { mapChoices, worldHere, type MapChoice } from './compareMaps';
import { useCompareRun, type SideState } from './useCompareRun';
import { PaneDrawer } from './paneDraw';
import { TALLY_ROWS, diffText, tallyAt, tallyOf, tallyText, type TallyAt } from './tally';
import './compare.css';

/** 推到哪年为止(时间轴 0–3000) */
const END = GROW_MARKS[GROW_MARKS.length - 1];
/** 1× = 每秒 20 年(和世界里的时间轴一样),4× = 每秒 80 年 */
const RATE = 20;
const OFFICIAL = '官方规则';

/** 一段历史能看到哪年(推完了、推不下去的不拦着,还在推的到交来的那份为止) */
const reach = (s: SideState) => (s.status === 'run' ? (s.civ?.endYear ?? 0) : END);
/** 推不下去的那段停在哪年 */
const stopOf = (s: SideState) => (s.status === 'failed' ? (s.civ?.endYear ?? 0) : null);

/** 时间轴右边那句:"左边已推完；右边推到第 1480 年，边推边看" */
function statusText(sides: SideState[]): string {
  const one = (s: SideState) => (s.status === 'done' ? '已推完' : s.status === 'failed' ? `停在第 ${stopOf(s)} 年` : s.civ ? `推到第 ${s.civ.endYear} 年` : '正在推');
  if (sides.every((s) => s.status === 'done')) return '两边都推完了';
  return `左边${one(sides[0])}；右边${one(sides[1])}${sides.some((s) => s.status === 'run') ? '，边推边看' : ''}`;
}

export function ComparePage() {
  const open = useCompare()!;
  const mine = useMyRules();
  const rules = (open.kind === 'mine' && mine.find((e) => e.rules.id === open.mineId)?.rules) || open.rules;
  const values = useMemo(() => cleanTuning(rules.values).values, [rules.values]);
  // 一个世界用的那一版照这个世界记的换算版本推(推出来和这个世界一样);本机的、别人分享的照最新的一版
  const inWorld = open.kind === 'world';
  const tuning = useMemo(() => rulesTuning(rules, inWorld), [rules, inWorld]);
  const changed = Object.keys(values).length;

  const [phone] = useState(isNarrow);
  const choices = useMemo(() => mapChoices(worldHere(getStage().stage === 'world', currentWorld(), getEdits()), listWorlds()), []);
  const [choiceKey, setChoiceKey] = useState(choices[0].key);
  const choice: MapChoice = choices.find((c) => c.key === choiceKey) ?? choices[0];
  // 网址带 compareFail=1820:右边推到那年故意出错(冒烟检查、截图看推不下去时的样子)
  const [failAt] = useState(() => {
    const v = Number(new URLSearchParams(location.search).get('compareFail'));
    return Number.isInteger(v) && v > 0 ? v : undefined;
  });
  const { map, mapError, sides, restartRight, restartSide } = useCompareRun(choice, tuning, phone ? 1 : 2, failAt);

  // ---- 时间轴 ----
  const [year, setYear] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<1 | 4>(1);
  /** 动过时间轴(播放、拖、点)以后就不再自动播放 */
  const touched = useRef(false);
  const limit = Math.min(...sides.map(reach));
  const limitRef = useRef(limit);
  limitRef.current = limit;
  const speedRef = useRef(speed);
  speedRef.current = speed;
  useEffect(() => {
    touched.current = false;
    setYear(0);
    setPlaying(false);
  }, [choice.key]);
  // 两边都交来第一份就从第 0 年按 1× 自动播放
  useEffect(() => {
    if (!touched.current && !playing && limit > 0 && year < limit) setPlaying(true);
    // 只在能看到的年份变了时看一眼
  }, [limit]);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let t0 = performance.now();
    const tick = (t: number) => {
      const dt = Math.min(0.25, (t - t0) / 1000);
      t0 = t;
      // 推到的年份赶不上播放就停在那里等(右边改了规则从头推的时候,已经过了的年份不往回退)
      setYear((y) => (y >= limitRef.current ? y : Math.min(limitRef.current, y + dt * RATE * speedRef.current)));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
  // 放到最后一年停下
  useEffect(() => {
    if (playing && year >= END) setPlaying(false);
  }, [playing, year]);
  const shown = Math.floor(year);

  // ---- 两张地图 ----
  const drawer = useMemo(() => new PaneDrawer(), []);
  useEffect(() => () => drawer.dispose(), [drawer]);
  useEffect(() => drawer.setMap(map), [drawer, map]);
  useEffect(() => drawer.setPlaying(playing), [drawer, playing]);
  // 冒烟检查看两张图画出来了没有
  useEffect(() => {
    (window as unknown as { __wfCompare?: unknown }).__wfCompare = {
      drawer,
      sides: () => sidesRef.current,
      year: () => yearRef.current,
      seek: (y: number) => {
        touched.current = true;
        setPlaying(false);
        setYear(y);
      },
    };
    return () => void delete (window as unknown as { __wfCompare?: unknown }).__wfCompare;
  }, [drawer]);
  const sidesRef = useRef(sides);
  sidesRef.current = sides;
  const yearRef = useRef(year);
  yearRef.current = year;

  // ---- 推不下去 ----
  const back = closeCompare;
  const revert = (list: Suspect[]) => {
    if (open.kind !== 'mine' || !open.mineId) return;
    for (const s of list) setRuleValue(open.mineId, s.id, undefined);
    const next = Object.fromEntries(Object.entries(values).filter(([k]) => !list.some((s) => s.id === k)));
    // 只有本机「我的规则」里的能改回:照最新的换算推
    restartRight(latestTuning({ values: next }));
  };

  // Esc:回到大卡
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('.cmp-root .pm-menu')) return;
      e.stopPropagation();
      closeCompare();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const name = rules.name;
  const failed = sides.map(stopOf);
  const tableYear = Math.min(shown, ...failed.filter((x): x is number => x !== null));
  // 还没推到这一年的那边先空着(改了规则从头推的时候)
  const tallies = sides.map((s) => (s.civ && (s.status !== 'run' || s.civ.endYear >= tableYear) ? tallyAt(tallyOf(s.civ), Math.min(tableYear, s.civ.endYear)) : null));

  const panes = sides.map((s, k) => (
    <Pane
      key={k}
      k={k}
      phone={phone}
      drawer={drawer}
      side={s}
      year={shown}
      chip={k === 0 ? <b>{OFFICIAL}</b> : <ChipName name={name} changed={changed} />}
      fail={
        s.status === 'failed' && shown >= (stopOf(s) ?? 0) ? (
          <FailCard side={s} k={k} kind={open.kind} values={values} phone={phone} onBack={back} onRevert={revert} onRetry={() => (k === 1 ? restartRight(tuning) : restartSide(0, undefined))} />
        ) : null
      }
    />
  ));
  const timeline = (
    <Timeline
      phone={phone}
      year={year}
      limit={limit}
      sides={sides}
      playing={playing}
      speed={speed}
      onPlay={() => {
        touched.current = true;
        if (playing) return setPlaying(false);
        if (year >= END || (year >= limit && sides.every((s) => s.status !== 'run'))) setYear(0);
        setPlaying(true);
      }}
      onSpeed={() => setSpeed((v) => (v === 1 ? 4 : 1))}
      onSeek={(y) => {
        touched.current = true;
        setPlaying(false);
        setYear(Math.max(0, Math.min(limitRef.current, y)));
      }}
    />
  );
  const table = <Table phone={phone} year={tableYear} name={name} tallies={tallies} />;
  const menu = <MapMenu choices={choices} current={choice.key} phone={phone} onPick={setChoiceKey} />;
  const close = (
    <button
      className="cmp-x"
      data-act="compare-close"
      aria-label="关闭"
      title="关闭(Esc 回到规则)"
      onClick={() => {
        closeCompare();
        closeRulesSheet();
      }}
    >
      <Icon name="close" size={15} />
    </button>
  );
  const backBtn = (
    <button className="cmp-back" data-act="compare-back" onClick={back}>
      <Icon name="back" size={phone ? 18 : 16} />
      <span>{name}</span>
    </button>
  );

  return (
    <div className={`cmp-root${phone ? ' phone' : ''}`} role="dialog" aria-modal="true" aria-label="并排试推" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      <div className="cmp-page">
        {phone ? (
          <div className="cmp-ph-top">
            {backBtn}
            {close}
            <h1>并排试推</h1>
            <div className="cmp-ph-sub">{menu}，同一个文明种子</div>
          </div>
        ) : (
          <div className="cmp-top">
            <div className="cmp-top-l">{backBtn}</div>
            <div className="cmp-title">
              <b>并排试推</b>
              <small>
                同一张地图、同一个文明种子：左边{OFFICIAL}，右边「{name}」
              </small>
            </div>
            <div className="cmp-top-r">
              {menu}
              {close}
            </div>
          </div>
        )}
        {mapError && <p className="cmp-map-err">这张地图生成不出来。换一张地图再试。</p>}
        <div className="cmp-panes">{panes}</div>
        {timeline}
        {phone && <p className="cmp-ph-st">{statusText(sides)}</p>}
        {table}
      </div>
    </div>
  );
}

/** 右边那张图左上角:规则的名字 + 改了几项 */
function ChipName({ name, changed }: { name: string; changed: number }) {
  return (
    <>
      <b>{name}</b>
      <small>{changed ? `改了 ${changed} 项` : '没改'}</small>
    </>
  );
}

/** 一张地图(画布 + 左上角的牌子;推不下去时盖浅白、中间一张卡) */
function Pane({ k, phone, drawer, side, year, chip, fail }: { k: number; phone: boolean; drawer: PaneDrawer; side: SideState; year: number; chip: React.ReactNode; fail: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = box.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  useEffect(() => {
    if (size) drawer.set(k, cv.current, size.w, size.h, dpr, side.civ, year);
  }, [drawer, k, size, dpr, side.civ, year]);
  return (
    <div className={`cmp-pane${fail ? ' failed' : ''}`} ref={box} data-side={k}>
      <canvas ref={cv} />
      <span className={`cmp-chip${phone ? ' ph' : ''}`}>{chip}</span>
      {fail && (
        <>
          <div className="cmp-dim" />
          {fail}
        </>
      )}
    </div>
  );
}

/** 推不下去时那张卡 */
function FailCard({
  side,
  k,
  kind,
  values,
  phone,
  onBack,
  onRevert,
  onRetry,
}: {
  side: SideState;
  k: number;
  kind: 'mine' | 'shared' | 'world';
  values: TuningValues;
  phone: boolean;
  onBack: () => void;
  onRevert: (list: Suspect[]) => void;
  onRetry: () => void;
}) {
  const stop = stopOf(side) ?? 0;
  const list = k === 1 && !side.crashed ? suspectItems(values, 2) : [];
  const canEdit = kind === 'mine';
  const backText = canEdit ? '回去调规则' : '回去看规则';
  const both = list.length > 1;
  let text: string;
  if (side.crashed) text = '后台算不动了，可能是这台设备的内存不够。前面的历史照样能看。';
  else if (!list.length) text = '这一年算不下去了。前面的历史照样能看。';
  else {
    const who = both ? `「${list[0].text}」和「${list[1].text}」放在一起` : `「${list[0].text}」`;
    text = `可能是${who}太极端，这一年算不下去了。前面的历史照样能看${canEdit ? `；把这${both ? '两' : '一'}项往回调一点，再试一次。` : '。'}`;
  }
  return (
    <div className={`cmp-err${phone ? ' ph' : ''}`} role="alert" data-act="compare-failed">
      <h4>
        <Icon name="warn" size={phone ? 18 : 20} />
        推到第 {stop} 年推不下去了
      </h4>
      <p>{text}</p>
      <div className="cmp-err-bs">
        {side.crashed ? (
          <button className="cmp-btn" data-act="compare-retry" onClick={onRetry}>
            再推一次
          </button>
        ) : (
          canEdit &&
          list.length > 0 && (
            <button className="cmp-btn" data-act="compare-revert" onClick={() => onRevert(list)}>
              这{both ? '两' : '一'}项改回官方
            </button>
          )
        )}
        <button className="cmp-btn pri" data-act="compare-back-rules" onClick={onBack}>
          {backText}
        </button>
      </div>
    </div>
  );
}

/** 时间轴 */
function Timeline({
  phone,
  year,
  limit,
  sides,
  playing,
  speed,
  onPlay,
  onSpeed,
  onSeek,
}: {
  phone: boolean;
  year: number;
  limit: number;
  sides: SideState[];
  playing: boolean;
  speed: 1 | 4;
  onPlay: () => void;
  onSpeed: () => void;
  onSeek: (y: number) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const frac = (y: number) => `${((100 * Math.max(0, Math.min(END, y))) / END).toFixed(2)}%`;
  const seekAt = (e: ReactPointerEvent) => {
    const r = track.current!.getBoundingClientRect();
    onSeek(((e.clientX - r.left) / Math.max(1, r.width)) * END);
  };
  /** 还在推、推不下去的那几边各一条虚线(推完的不画):推到哪年 */
  const lines = sides.flatMap((s, k) => (s.status === 'done' ? [] : [{ k, to: s.civ?.endYear ?? 0 }]));
  const stops = sides.flatMap((s, k) => (s.status === 'failed' ? [{ k, at: stopOf(s)! }] : []));
  const n = Math.floor(year);
  return (
    <div className={`cmp-tl${phone ? ' ph' : ''}`}>
      <button className={`cmp-play${playing ? ' on' : ''}`} data-act="compare-play" aria-label={playing ? '暂停' : '播放'} title={playing ? '暂停' : '播放'} onClick={onPlay}>
        <i aria-hidden="true" />
      </button>
      <span className="cmp-yr">第 {n} 年</span>
      <div
        className="cmp-track"
        ref={track}
        role="slider"
        aria-label="年份"
        aria-valuemin={0}
        aria-valuemax={END}
        aria-valuenow={n}
        tabIndex={0}
        data-limit={limit}
        onPointerDown={(e) => {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          seekAt(e);
        }}
        onPointerMove={(e) => {
          if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) seekAt(e);
        }}
        onKeyDown={(e) => {
          const d = e.key === 'ArrowRight' ? 10 : e.key === 'ArrowLeft' ? -10 : 0;
          if (!d) return;
          e.preventDefault();
          onSeek(n + d);
        }}
      >
        <i className="cmp-bar" />
        <i className="cmp-done" style={{ width: frac(year) }} />
        {lines.map((l, i) => (
          <i key={l.k} className={`cmp-calc${lines.length > 1 ? ` two l${i}` : ''}`} style={{ width: frac(l.to) }} />
        ))}
        {stops.map((s) => (
          <i key={s.k} className="cmp-stop" style={{ left: frac(s.at) }} />
        ))}
        <i className="cmp-knob" style={{ left: frac(year) }} />
        {!phone && (
          <>
            <span className="cmp-ax a0">0</span>
            <span className="cmp-ax" style={{ left: frac(1000) }}>
              1000
            </span>
            <span className="cmp-ax" style={{ left: frac(2000) }}>
              2000
            </span>
            <span className="cmp-ax a1">{END}</span>
          </>
        )}
      </div>
      {!phone && <span className="cmp-st">{statusText(sides)}</span>}
      <button className="cmp-btn cmp-speed" data-act="compare-speed" aria-label={`播放速度 ${speed}×,点一下换成 ${speed === 1 ? 4 : 1}×`} onClick={onSpeed}>
        {speed}×
      </button>
    </div>
  );
}

/** 底下那张表 */
function Table({ phone, year, name, tallies }: { phone: boolean; year: number; name: string; tallies: (TallyAt | null)[] }) {
  const rows = phone ? TALLY_ROWS.filter((r) => r.key !== 'biggest') : TALLY_ROWS;
  const cell = (t: TallyAt | null, key: keyof TallyAt) => (t ? tallyText(key, t[key]) : '');
  return (
    <div className={`cmp-tb${phone ? ' ph' : ''}`}>
      <div className="cmp-row h">
        <b>到第 {year} 年为止</b>
        <span>{phone ? '官方' : OFFICIAL}</span>
        {!phone && <i />}
        <span>{name}</span>
        {!phone && <span className="d">差多少</span>}
      </div>
      {rows.map((r) => {
        const [a, b] = tallies;
        return (
          <div className="cmp-row" key={r.key} data-row={r.key}>
            {r.name}
            <span>{cell(a, r.key)}</span>
            {!phone && <i />}
            <span className="m">{cell(b, r.key)}</span>
            {!phone && <span className="d">{a && b ? diffText(r.key, a[r.key], b[r.key]) : ''}</span>}
          </div>
        );
      })}
    </div>
  );
}

/** 右上角换地图(手机上是标题下那句话里的地图名) */
function MapMenu({ choices, current, phone, onPick }: { choices: MapChoice[]; current: string; phone: boolean; onPick: (key: string) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);
  const cur = choices.find((c) => c.key === current) ?? choices[0];
  return (
    <span className={`cmp-map${phone ? ' ph' : ''}`} ref={root}>
      <button className={phone ? 'cmp-map-link' : 'cmp-btn'} data-act="compare-map" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(!open)}>
        {cur.label}
        <Icon name="down" size={phone ? 13 : 15} />
      </button>
      {open && (
        <div className="pm-menu cmp-menu" role="menu">
          {choices.map((c) => (
            <button
              key={c.key}
              className="pm-item"
              role="menuitemradio"
              aria-checked={c.key === current}
              data-act="compare-map-pick"
              onClick={() => {
                setOpen(false);
                if (c.key !== current) onPick(c.key);
              }}
            >
              {c.key === current && <Icon name="check" size={16} />}
              <span className="pm-text">{c.label}</span>
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
