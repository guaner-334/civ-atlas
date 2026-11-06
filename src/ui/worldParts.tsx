/**
 * 几处共用的小零件:世界名的输入框(改名)、"最近打开"的时间说法。
 * 用在我的世界(MyWorlds.tsx)、世界概览头部的"改名"、新建世界的名字。
 */
import { useEffect, useRef, useState } from 'react';
import { YEAR_TICKS, cleanPlay, playAt, type WorldEdits } from '../gen/edits';
import { monthNamesInUse, monthTail, monthsOf, yearFull } from '../gen/era';
import { TITLE_MAX } from '../gen/savefile';

/** 逐年推演的世界:"演绎到第 2675 年",停在一年中间的写到月;不是逐年推演的 = null */
export function playedTo(e: WorldEdits): string | null {
  const play = cleanPlay(e.play);
  if (!play) return null;
  return `演绎到${yearFull(play.year, e.era)}${play.tick ? monthTail(playAt(play) / YEAR_TICKS, monthsOf(e.months), monthNamesInUse(e.monthNames)) : ''}`;
}

/** 最后修改时间:刚刚 / 5 分钟前 / 3 小时前 / 今天 14:05 / 昨天 14:05 / 9月27日 */
export function when(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return '刚刚';
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  const d = new Date(t);
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  if (t >= today.getTime()) return s < 6 * 3600 ? `${Math.floor(s / 3600)} 小时前` : `今天 ${hm}`;
  if (t >= today.getTime() - 86400e3) return `昨天 ${hm}`;
  const y = d.getFullYear() === today.getFullYear() ? '' : `${d.getFullYear()}年`;
  return `${y}${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 世界名的输入框:回车 / 点别处确定,Esc 取消(null) */
export function TitleInput({ initial, onDone, className = 'save-title-input' }: { initial: string; onDone: (v: string | null) => void; className?: string }) {
  const [text, setText] = useState(initial);
  const done = useRef(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (v: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(v);
  };
  return (
    <input
      ref={ref}
      className={className}
      value={text}
      maxLength={TITLE_MAX}
      placeholder="给这个世界起个名字"
      spellCheck={false}
      aria-label="世界名"
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(text);
        else if (e.key === 'Escape') {
          e.stopPropagation();
          finish(null);
        }
      }}
      onBlur={() => finish(text)}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    />
  );
}
