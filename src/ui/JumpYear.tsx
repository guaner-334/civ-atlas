/**
 * 跳到某一年:不用拖时间轴、不用翻编年史,打年份直接过去。三个入口做的事一样 —— 时间轴拨到那一年的开头、停止播放,
 * 地图、侧栏、图层跟着变(和拖时间轴到那一年一样):
 *
 * - TimelineYear:时间轴左边的"第 1650 年"。鼠标移上去数字下面出虚线、提示"点一下输入年份,跳到那一年"(快捷键 G);
 *   点了(或按 G)数字变成输入框(原来的数整个选中,直接打字就替换),回车跳,Esc / 点别处取消。
 *   窄屏(手机)点了在屏幕上半部弹一张小卡片(键盘在下半屏,挡不住):数字键盘打年份,点「跳过去」,点卡片外面收起。
 * - JumpField:编年史上面一排的"跳到第 [ ] 年"。回车后概览不关,时间轴到那一年,列表滚到那一年("现在"线在四成高处);
 *   框里的数留着,方便接着改。
 *
 * 填的数只收数字;设了纪年时前面是「公元前 ⌄ / 公元 ⌄」小按钮(和干预页一样),按纪年算回第几年。
 * 超出这个世界(第 0 年–结束年份):标红、提示一句,回车停在最后一年 / 第 0 年;纪年填 0:提示"公元没有 0 年",不跳。
 * 怎么算见 gen/era.ts 的 parseJump。导出回放视频时时间轴锁着,年份不能点。
 */
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { Civ } from '../gen/civ/types';
import { eraYear, parseJump, yearFull, type Era } from '../gen/era';
import { getCivTime, setCivTime, useCivTime } from './civView';
import { useEra } from './editsStore';
import { EraPre } from './panelParts';

/** 跳过去:时间轴停在第 y 年的开头,不播放 */
export function jumpToYear(y: number) {
  setCivTime({ year: Math.max(0, Math.floor(y)), playing: false, scrubbing: false, story: false });
}

// 快捷键 G:时间轴上的年份变成输入框(App 的快捷键调 openJump)
const openers = new Set<() => boolean>();
/** 打开时间轴上的年份输入框;时间轴不在、锁着 = false */
export function openJump(): boolean {
  for (const f of openers) if (f()) return true;
  return false;
}

/**
 * 年份那几个字当按钮用(不用 <button>:时间轴里的按钮样式会把年份的大字盖掉):点一下、Tab 选中后按回车 / 空格都打开;锁着时点不了
 */
function pressable(locked: boolean, open: () => boolean) {
  return {
    role: 'button',
    tabIndex: locked ? -1 : 0,
    'aria-disabled': locked || undefined,
    onClick: () => open(),
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      e.stopPropagation();
      open();
    },
  } as const;
}

const digits = (s: string) => s.replace(/[^\d]/g, '').slice(0, 6);

/** 输入框里的字和"前"不"前":一开始照第 y 年写 */
function startOf(y: number, era: Era | undefined): { text: string; pre: boolean } {
  const v = Math.max(0, Math.floor(y));
  if (!era) return { text: String(v), pre: false };
  const { pre, n } = eraYear(v, era);
  return { text: String(n), pre };
}

/** "第 1650 年"拆成三段(中间那段是数字,下面画虚线):纪年 "公元前 | 850 | 年"、"公元 | 元年 |" */
function yearParts(y: number, era: Era | undefined): [string, string, string] {
  if (!era) return ['第 ', String(y), ' 年'];
  const { pre, n } = eraYear(y, era);
  if (pre) return [`${era.name}前 `, String(n), ' 年'];
  return n === 1 ? [era.name, '元年', ''] : [`${era.name} `, String(n), ' 年'];
}

/** 输入框上面(时间轴在顶上时是下面)的提示:平常写回车跳、这个世界从哪年到哪年;填得不对标红 */
function JumpTip({ why, hint, end, era, below }: { why: string | null; hint: string | null; end: number; era: Era | undefined; below?: boolean }) {
  return (
    <span className={`jy-tip${why ? ' bad' : ''}${below ? ' below' : ''}`} role="status">
      {why ?? '回车跳到这一年，Esc 取消'}
      <small>{why ? hint : `这个世界从${yearFull(0, era)}推到${yearFull(end, era)}`}</small>
    </span>
  );
}

export interface TimelineYearProps {
  year: number;
  end: number;
  era: Era | undefined;
  /** 手机:点了弹顶部小卡片 */
  narrow: boolean;
  /** 导出回放视频时锁着,不能点 */
  locked: boolean;
  /** 时间轴在顶上:提示出在下面 */
  below: boolean;
  /** 纪年时按最长的年份留宽(播放时滑条不跟着伸缩) */
  ghost?: string;
}

/** 时间轴左边的年份:平常是字,点了变输入框(手机弹小卡片) */
export function TimelineYear({ year, end, era, narrow, locked, below, ghost }: TimelineYearProps) {
  const [edit, setEdit] = useState<{ text: string; pre: boolean } | null>(null);
  const boxRef = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const open = () => {
    if (locked) return false;
    setCivTime({ playing: false });
    setEdit(startOf(getCivTime().year ?? end, era));
    return true;
  };
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    const f = () => openRef.current();
    openers.add(f);
    return () => {
      openers.delete(f);
    };
  }, []);
  // 打开时把原来的数整个选中(手机的卡片自己管)
  useEffect(() => {
    if (!edit || narrow) return;
    inputRef.current?.focus();
    inputRef.current?.select();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!edit, narrow]);
  // 锁上了(开始导出视频)、换了世界:收起
  useEffect(() => {
    if (locked) setEdit(null);
  }, [locked]);

  const parsed = edit ? parseJump(edit.text, edit.pre, era, end) : null;
  const go = () => {
    if (!edit || !parsed) return;
    if (parsed.year === null) {
      if (!parsed.why) setEdit(null);
      return;
    }
    jumpToYear(parsed.year);
    setEdit(null);
  };

  const [a, num, b] = yearParts(year, era);
  const label = (
    <>
      {a}
      <span className="jy-num">{num}</span>
      {b}
    </>
  );

  if (narrow) {
    return (
      <>
        <span className={`tb-year jy${edit ? ' on' : ''}`} {...pressable(locked, open)} aria-label={`${yearFull(year, era)}，点一下输入年份跳过去`}>
          {label}
        </span>
        {edit &&
          createPortal(
            <JumpCard
              text={edit.text}
              pre={edit.pre}
              era={era}
              end={end}
              onText={(text) => setEdit({ ...edit, text })}
              onFlip={() => setEdit({ ...edit, pre: !edit.pre })}
              onGo={go}
              onClose={() => setEdit(null)}
            />,
            document.body,
          )}
      </>
    );
  }

  if (!edit) {
    return (
      <span
        className={`tb-year jy${ghost ? ' tb-year-era' : ''}`}
        {...pressable(locked, open)}
        data-tip="点一下输入年份，跳到那一年"
        data-tip-key="jump"
        data-tip-side="above"
        aria-label={`${yearFull(year, era)}，点一下输入年份跳过去`}
      >
        {ghost ? (
          <>
            <span>{label}</span>
            <span className="tb-year-ghost" aria-hidden="true">
              {ghost}
            </span>
          </>
        ) : (
          label
        )}
      </span>
    );
  }

  return (
    <span
      ref={boxRef}
      className={`tb-year jy jy-edit${parsed?.why ? ' bad' : ''}`}
      onBlur={(e) => {
        // 点「公元前 ⌄」不算离开
        if (!boxRef.current?.contains(e.relatedTarget as Node | null)) setEdit(null);
      }}
    >
      {era ? <EraPre era={era} pre={edit.pre} onFlip={() => setEdit({ ...edit, pre: !edit.pre })} /> : '第 '}
      <input
        ref={inputRef}
        className="jy-in"
        value={edit.text}
        inputMode="numeric"
        enterKeyHint="go"
        aria-label="跳到哪一年"
        aria-invalid={!!parsed?.why}
        onChange={(e) => setEdit({ ...edit, text: digits(e.target.value) })}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') go();
          else if (e.key === 'Escape') setEdit(null);
        }}
        style={{ width: `${Math.max(2, edit.text.length) + 0.4}ch` }}
      />
      {' 年'}
      <JumpTip why={parsed?.why ?? null} hint={parsed?.hint ?? null} end={end} era={era} below={below} />
    </span>
  );
}

/** 手机:屏幕上半部的小卡片(键盘挡不住),点外面收起 */
function JumpCard(p: {
  text: string;
  pre: boolean;
  era: Era | undefined;
  end: number;
  onText: (s: string) => void;
  onFlip: () => void;
  onGo: () => void;
  onClose: () => void;
}) {
  const parsed = parseJump(p.text, p.pre, p.era, p.end);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <div className="jp-bg" onPointerDown={(e) => e.target === e.currentTarget && p.onClose()}>
      <div className="jp-card" role="dialog" aria-label="跳到哪一年">
        <b>跳到哪一年</b>
        <form
          className={`jp-row${parsed.why ? ' bad' : ''}`}
          onSubmit={(e) => {
            e.preventDefault();
            p.onGo();
          }}
        >
          {p.era ? <EraPre era={p.era} pre={p.pre} onFlip={p.onFlip} /> : '第'}
          <input
            ref={ref}
            className="jp-in"
            value={p.text}
            inputMode="numeric"
            enterKeyHint="go"
            aria-label="跳到哪一年"
            aria-invalid={!!parsed.why}
            onChange={(e) => p.onText(digits(e.target.value))}
            onKeyDown={(e) => e.key === 'Escape' && p.onClose()}
          />
          年
          <button className="jp-go" type="submit" disabled={parsed.year === null}>
            跳过去
          </button>
        </form>
        <small className={parsed.why ? 'bad' : ''}>
          {parsed.why ? `${parsed.why}，${parsed.hint ?? ''}`.replace(/，$/, '') : `这个世界从${yearFull(0, p.era)}推到${yearFull(p.end, p.era)}`}
        </small>
      </div>
    </div>
  );
}

/** 编年史上面一排的"跳到第 [ ] 年":回车后时间轴到那一年,列表滚过去("现在"线在四成高处) */
export function JumpField({ civ, listRef, nowRef }: { civ: Civ | null; listRef: RefObject<HTMLDivElement>; nowRef: RefObject<HTMLDivElement> }) {
  const era = useEra();
  const t = useCivTime();
  const end = civ?.endYear ?? 0;
  const cur = Math.min(end, Math.max(0, Math.floor(t.year ?? end)));
  const [st, setSt] = useState<{ text: string; pre: boolean } | null>(null);
  // 还没填:"前"不"前"跟着现在这一年
  const shown = st ?? { text: '', pre: startOf(cur, era).pre };
  const parsed = parseJump(shown.text, shown.pre, era, end);
  if (!civ) return null;
  const go = () => {
    if (parsed.year === null) return;
    jumpToYear(parsed.year);
    // 时间轴一变,"现在"线马上挪了(useNowLine 订阅着);把它滚到四成高处。都已发生 = 最上面,都还没发生 = 最下面
    requestAnimationFrame(() => {
      const box = listRef.current;
      const line = nowRef.current;
      if (!box) return;
      if (line && line.style.display !== 'none') box.scrollTop = Math.max(0, line.offsetTop - box.clientHeight * 0.4);
      else box.scrollTop = parsed.year! >= end ? 0 : box.scrollHeight;
    });
  };
  const input: ReactNode = (
    <input
      className="cj-in"
      value={shown.text}
      placeholder={startOf(cur, era).text}
      inputMode="numeric"
      enterKeyHint="go"
      aria-label="跳到哪一年"
      aria-invalid={!!parsed.why}
      data-act="chron-jump"
      onChange={(e) => setSt({ ...shown, text: digits(e.target.value) })}
      onKeyDown={(e) => e.key === 'Enter' && go()}
    />
  );
  return (
    <label className={`cj${parsed.why ? ' bad' : ''}`} title={parsed.why ? `${parsed.why}${parsed.hint ? `，${parsed.hint}` : ''}` : undefined}>
      {era ? (
        <>
          跳到
          <EraPre era={era} pre={shown.pre} onFlip={() => setSt({ ...shown, pre: !shown.pre })} />
          {input}年
        </>
      ) : (
        <>跳到第{input}年</>
      )}
      {parsed.why && (
        <span className="cj-tip" role="status">
          {parsed.why}
          {parsed.hint && <small>{parsed.hint}</small>}
        </span>
      )}
    </label>
  );
}
