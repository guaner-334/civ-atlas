/**
 * 世界设定页的「月份」一组(接在「纪年」下面):编年史、地图上的事件卡片、时间轴提示写到哪一月,随时能改,不用重新推演。
 *
 *   两项单选  写到月(编年史、地图上的事件写到哪一月)/ 只写年(和以前一样);右边灰字是换成那种写法后,
 *            现在这一年以前最近的一件大事怎么写
 *   写到月时  一年几个月 [12] 个月(MONTHS_MIN–MONTHS_MAX;不合格的标红、下面一句说原因,不存)
 *
 * 改了马上生效(editsStore 的 setMonths;不记撤销步)。怎么算见 gen/era.ts 的 monthOf:按整年算的事(宗教、干预、地形大事)不写月。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Civ } from '../gen/civ/types';
import { filterChronicle } from '../gen/civ/chronicle';
import { fullChronicle } from '../gen/civ/religionText';
import { MONTHS_DEFAULT, MONTHS_MAX, MONTHS_MIN, monthOf, yearFull, yearMonthFull } from '../gen/era';
import { setMonths, useEra, useMonths } from './editsStore';
import { useYear } from './WorldOverviewMarks';
import { baseRegions } from './eras';
import { Icon } from './icons';

/** 一年几个月那一格的数不合格的原因 */
function countWhy(raw: string): string | null {
  const n = Number(raw);
  return raw && Number.isInteger(n) && n >= MONTHS_MIN && n <= MONTHS_MAX ? null : `一年要填 ${MONTHS_MIN} 到 ${MONTHS_MAX} 个月`;
}

export function MonthSection({ civ }: { civ: Civ | null }) {
  const months = useMonths();
  const era = useEra();
  const year = useYear(civ);
  // 关着时再打开用的:这次打开设定页以后最后一次开着的月数(一开始 12)
  const [last, setLast] = useState(months || MONTHS_DEFAULT);
  useEffect(() => {
    if (months) setLast(months);
  }, [months]);
  const n = months || last;
  const [text, setText] = useState(String(n));
  useEffect(() => setText(String(n)), [n]);
  // 换了世界(改名不算):上次的月数、没填完的字都按新世界重来
  const world = civ ? baseRegions(civ) : null;
  const seen = useRef(world);
  useEffect(() => {
    if (seen.current === world) return;
    seen.current = world;
    const fresh = months || MONTHS_DEFAULT;
    setLast(fresh);
    setText(String(fresh));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world]);
  const on = months > 0;
  const bad = on ? countWhy(text) : null;

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

  return (
    <section className="era-sec mo-sec" data-months={months}>
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
          <b>{yearMonthFull(sample, n, era)}</b>
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
        </div>
      )}
      <p className={`ov-txt dim era-note${bad ? ' bad' : ''}`}>
        {bad ?? (on ? '每件事在一年里什么时候发生，推演时本来就算好了，这里只是写出来。宗教的传播和你下的令按整年算，只写年。' : '选「写到月」以后，编年史、地图上的事件卡片和时间轴的提示写到哪一月。')}
      </p>
    </section>
  );
}
