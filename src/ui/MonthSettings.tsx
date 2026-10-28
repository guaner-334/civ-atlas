/**
 * 世界设定页的「月份」一组(接在「纪年」下面):编年史、地图上的事件卡片、时间轴提示写到哪一月,随时能改,不用重新推演。
 *
 *   两项单选  写到月(编年史、地图上的事件写到哪一月)/ 只写年(和以前一样);右边灰字是换成那种写法后,
 *            现在这一年以前最近的一件大事怎么写
 *   写到月时  一年几个月 [12] 个月(MONTHS_MIN–MONTHS_MAX;不合格的标红、下面一句说原因,不存)
 *            月份叫法 [数字 | 自己起名]
 *   自己起名  一年几个月就几格(电脑一排四格,手机一排三格),格子左边是第几月;空着的格照旧写数字(灰字是空着时写成什么)。
 *            名字最多 MONTH_NAME_MAX 个字,去掉前后空格;超过的那一格标红、不存,下面一句换成出错原因
 *
 * 改了马上生效(editsStore 的 setMonths、setMonthNames;不记撤销步)。怎么算见 gen/era.ts 的 monthOf:按整年算的事(宗教、干预、地形大事)不写月。
 * 一年的月数改少了,多出来的名字留着(改回去还在);只写年、换回「数字」时名字也留着。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Civ } from '../gen/civ/types';
import { filterChronicle } from '../gen/civ/chronicle';
import { fullChronicle } from '../gen/civ/religionText';
import { MONTH_NAME_MAX, MONTHS_DEFAULT, MONTHS_MAX, MONTHS_MIN, cleanMonthName, monthOf, yearFull, yearMonthFull } from '../gen/era';
import { setMonthNames, setMonths, useEra, useMonthNameSet, useMonthNames, useMonths } from './editsStore';
import { useYear } from './WorldOverviewMarks';
import { baseRegions } from './eras';
import { Icon } from './icons';

/** 一年几个月那一格的数不合格的原因 */
function countWhy(raw: string): string | null {
  const n = Number(raw);
  return raw && Number.isInteger(n) && n >= MONTHS_MIN && n <= MONTHS_MAX ? null : `一年要填 ${MONTHS_MIN} 到 ${MONTHS_MAX} 个月`;
}

/** 第 m 月那一格的名字不合格的原因(空着不算) */
function nameWhy(raw: string, m: number): string | null {
  const s = raw.trim();
  if (!s || cleanMonthName(s)) return null;
  return `每个名字最多 ${MONTH_NAME_MAX} 个字（${m} 月填了 ${[...s].length} 个字，没存）`;
}

export function MonthSection({ civ }: { civ: Civ | null }) {
  const months = useMonths();
  const era = useEra();
  const year = useYear(civ);
  const set = useMonthNameSet();
  const names = useMonthNames();
  // 关着时再打开用的:这次打开设定页以后最后一次开着的月数(一开始 12)
  const [last, setLast] = useState(months || MONTHS_DEFAULT);
  useEffect(() => {
    if (months) setLast(months);
  }, [months]);
  const n = months || last;
  const [text, setText] = useState(String(n));
  useEffect(() => setText(String(n)), [n]);
  // 月份叫法:存着名字(没换回数字)就是「自己起名」;刚点了「自己起名」、一格还没填的也算
  const named = !!set && !set.off;
  const [picked, setPicked] = useState(named);
  useEffect(() => {
    if (named) setPicked(true);
  }, [named]);
  const naming = named || picked;
  // 名字格子里正在填、和存着的不一样的字(不合格的留着标红);正在用输入法拼的那一格先不查
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [composing, setComposing] = useState(-1);
  const composingNow = useRef(-1);
  const compose = (i: number) => {
    composingNow.current = i;
    setComposing(i);
  };
  // 换了世界(改名不算):上次的月数、没填完的字都按新世界重来
  const world = civ ? baseRegions(civ) : null;
  const seen = useRef(world);
  useEffect(() => {
    if (seen.current === world) return;
    seen.current = world;
    const fresh = months || MONTHS_DEFAULT;
    setLast(fresh);
    setText(String(fresh));
    setPicked(named);
    setDrafts({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world]);
  const on = months > 0;
  const bad = on ? countWhy(text) : null;

  /** 第 i 格(0 起)填了 raw:合格的马上存(空着 = 写数字),不合格的只留在格子里 */
  const onName = (i: number, raw: string, typing = composingNow.current === i) => {
    setDrafts((d) => ({ ...d, [i]: raw }));
    if (typing || nameWhy(raw, i + 1)) return;
    const list = (set?.names ?? []).slice();
    while (list.length <= i) list.push('');
    list[i] = cleanMonthName(raw);
    setMonthNames({ names: list });
  };
  const shown = (i: number) => drafts[i] ?? set?.names[i] ?? '';
  const cellWhy = (i: number) => (drafts[i] !== undefined && composing !== i ? nameWhy(drafts[i], i + 1) : null);
  let badName: string | null = null;
  if (on && naming) for (let i = 0; i < n && !badName; i++) badName = cellWhy(i);

  // 右边示范:现在这一年以前(含)最近一件写得出月份的大事(和侧栏「最近大事」对得上)
  const all = useMemo(() => (civ ? filterChronicle(fullChronicle(civ), { major: true }) : []), [civ]);
  let sample = year;
  for (let i = all.length - 1; i >= 0; i--) {
    const y = all[i].year;
    if (y < year + 1 && monthOf(y, n)) {
      sample = y;
      break;
    }
  }

  let note: string;
  if (bad) note = bad;
  else if (!on) note = '选「写到月」以后，编年史、地图上的事件卡片和时间轴的提示写到哪一月。';
  else if (!naming) note = '每件事在一年里什么时候发生，推演时本来就算好了，这里只是写出来。宗教的传播和你下的令按整年算，只写年。';
  else if (badName) note = badName;
  else {
    // 举个空着的月怎么写:第一个空着的月
    let empty = 0;
    for (let i = 0; i < n && !empty; i++) if (!names?.[i]) empty = i + 1;
    note = empty
      ? `空着的月份照旧写数字（${yearFull(sample, era)} ${empty} 月）。每个名字最多 ${MONTH_NAME_MAX} 个字。`
      : `空着的月份照旧写数字，每个名字最多 ${MONTH_NAME_MAX} 个字。`;
  }

  return (
    <section className="era-sec mo-sec" data-months={months} data-named={naming ? '1' : '0'}>
      <h3>
        月份<small>随时能改，不用重新推演</small>
      </h3>
      <div className="ov-kv era-kv" role="radiogroup" aria-label="年份写到哪">
        <button className="ov-kv-row era-opt" role="radio" aria-checked={on} data-act="months-on" onClick={() => !on && setMonths(last)}>
          {on ? <Icon name="check" size={18} className="era-ck" /> : <i className="era-ck" />}
          <span className="era-t">
            <i>写到月</i>
            <small>编年史、地图上的事件写到哪一月</small>
          </span>
          <b>{yearMonthFull(sample, n, era, names)}</b>
        </button>
        <button className="ov-kv-row era-opt" role="radio" aria-checked={!on} data-act="months-off" onClick={() => setMonths(0)}>
          {on ? <i className="era-ck" /> : <Icon name="check" size={18} className="era-ck" />}
          <span className="era-t">
            <i>只写年</i>
            <small>和以前一样</small>
          </span>
          <b>{yearFull(sample, era)}</b>
        </button>
      </div>
      {on && (
        <div className="ov-kv era-kv">
          <label className="ov-kv-row">
            <span>一年几个月</span>
            <span className="era-y">
              <input
                className={`era-in era-num${bad ? ' bad' : ''}`}
                data-act="months-count"
                value={text}
                inputMode="numeric"
                aria-label="一年几个月"
                aria-invalid={!!bad}
                onChange={(e) => {
                  const s = e.target.value.replace(/[^\d]/g, '').slice(0, 2);
                  setText(s);
                  if (!countWhy(s)) setMonths(Number(s));
                }}
                onBlur={() => !bad || setText(String(n))}
              />
              <span className="era-unit">个月</span>
            </span>
          </label>
          <div className="ov-kv-row mo-way">
            <span>月份叫法</span>
            <div className="seg mo-seg" role="group" aria-label="月份叫法">
              <button
                className={naming ? '' : 'on'}
                aria-pressed={!naming}
                data-act="months-numbers"
                onClick={() => {
                  setPicked(false);
                  if (named) setMonthNames({ names: set.names, off: true });
                }}
              >
                数字
              </button>
              <button
                className={naming ? 'on' : ''}
                aria-pressed={naming}
                data-act="months-names"
                onClick={() => {
                  setPicked(true);
                  if (set?.off) setMonthNames({ names: set.names });
                }}
              >
                自己起名
              </button>
            </div>
          </div>
        </div>
      )}
      {on && naming && (
        <div className="mo-names">
          {Array.from({ length: n }, (_, i) => {
            const why = cellWhy(i);
            return (
              <label key={i} className="mo-cell">
                <small>{i + 1}</small>
                <input
                  className={`era-in mo-in${why ? ' bad' : ''}`}
                  data-act="month-name"
                  data-m={i + 1}
                  value={shown(i)}
                  placeholder={`${i + 1} 月`}
                  aria-label={`${i + 1} 月的名字`}
                  aria-invalid={!!why}
                  onChange={(e) => onName(i, e.target.value)}
                  onCompositionStart={() => compose(i)}
                  onCompositionEnd={(e) => {
                    compose(-1);
                    onName(i, e.currentTarget.value, false);
                  }}
                  // 填好了(合格的):换回存着的样子(去掉前后空格);不合格的留着、标红
                  onBlur={() =>
                    drafts[i] !== undefined &&
                    !nameWhy(drafts[i], i + 1) &&
                    setDrafts((d) => {
                      const { [i]: _done, ...rest } = d;
                      void _done;
                      return rest;
                    })
                  }
                />
              </label>
            );
          })}
        </div>
      )}
      <p className={`ov-txt dim era-note${bad || badName ? ' bad' : ''}`}>{note}</p>
    </section>
  );
}
