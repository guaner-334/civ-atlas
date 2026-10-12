/**
 * 世界设定页的「纪年」一组(宽屏在右栏最上面,窄屏单独一节放在最上面):年份按"第几年"写还是按纪年写,随时能改,不用重新推演。
 *
 *   两项单选  第几年(从第 0 年数起)/ 纪年(像公元那样,自己定元年在哪一年);右边灰字是换成那种写法后现在这一年怎么写
 *   选了纪年  名字(默认「公元」,最多 ERA_NAME_MAX 个字,不能空)、元年怎么定(按年份 / 按一件事)、
 *            按年份:第 0 年是 [公元前 ⌄][2500] 年(前 / 后点一下换,数字 1–ERA_ZERO_MAX);
 *            按一件事:元年那件事(点了弹出编年史的大事 / 全部,能搜,移上去出现「定为元年」)、第 0 年是(只读)
 *            下面一句算给你看:这个世界从哪年开始,推到哪年为止
 *
 * 改了马上生效(editsStore 的 setEra;不记撤销步);名字空、太长,第 0 年填 0 或超范围时输入框标红、下面一句说原因,不存。
 * 写法见 gen/era.ts。
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Civ } from '../gen/civ/types';
import { MAJOR, type ChronicleEntry } from '../gen/civ/chronicle';
import { fullChronicle } from '../gen/civ/religionText';
import { ERA_DEFAULT, ERA_NAME_MAX, ERA_ZERO_MAX, cleanEraName, epochOfZero, eraText, eraZero, yearFull, yearShort, type Era } from '../gen/era';
import { setEra, useEra } from './editsStore';
import { evLabel, evText, evType } from './timelineLayout';
import { useYear } from './WorldOverviewMarks';
import { Icon } from './icons';
import { EntryText } from './panelParts';

/** 当元年的那件事现在的正文(改了名的跟着换):同一年、同一个标签的那一条;认不出来就用选的时候记下的 */
export function eraEventText(civ: Civ | null, era: Era): string {
  const ev = era.event;
  if (!ev) return '';
  if (!civ) return ev.text;
  const same = fullChronicle(civ).filter((e) => Math.floor(e.year) === era.epoch && e.tag === ev.tag);
  const exact = same.find((e) => evText(e) === ev.text);
  if (exact) return ev.text;
  return same.length === 1 ? evText(same[0]) : ev.text;
}

/** 名字输入框里的字不合格的原因(合格 = null) */
function nameWhy(raw: string): string | null {
  const s = raw.replace(/\s/g, '');
  if (!s) return '名字不能空';
  if ([...s].length > ERA_NAME_MAX) return `名字最多 ${ERA_NAME_MAX} 个字`;
  return cleanEraName(s) ? null : '名字里有认不出来的字';
}

/** 第 0 年那一格的数不合格的原因 */
function zeroWhy(raw: string): string | null {
  const n = Number(raw);
  return raw && Number.isInteger(n) && n >= 1 && n <= ERA_ZERO_MAX ? null : `第 0 年要填 1 到 ${ERA_ZERO_MAX} 之间的数`;
}

export function EraSection({ civ, end }: { civ: Civ | null; end: number }) {
  const era = useEra();
  const year = useYear(civ);
  // 关着时右边示范、再打开时用的那一套:这次打开设定页以后最后一次开着的样子(一开始是公元、第 0 年是公元前 2500 年)
  const [last, setLast] = useState<Era>(() => era ?? ERA_DEFAULT);
  useEffect(() => {
    if (era) setLast(era);
  }, [era]);
  const shown = era ?? last;
  // 两个输入框里的字(不合格的也留着,标红);纪年从别处变了(读档、撤销以外的改动)跟着换
  const [nameText, setNameText] = useState(shown.name);
  const zero = eraZero(shown);
  const [zeroText, setZeroText] = useState(String(zero.n));
  useEffect(() => setNameText(shown.name), [shown.name]);
  useEffect(() => setZeroText(String(eraZero(shown).n)), [shown.epoch]);
  const composing = useRef(false);
  const [picking, setPicking] = useState(false);
  const pickRef = useRef<HTMLButtonElement>(null);

  const on = !!era;
  const badName = on ? nameWhy(nameText) : null;
  const badZero = on && era.by !== 'event' ? zeroWhy(zeroText) : null;
  const put = (patch: Partial<Era>) => era && setEra({ ...era, ...patch });
  const onName = (s: string) => {
    setNameText(s);
    if (!composing.current && !nameWhy(s)) put({ name: s.replace(/\s/g, '') });
  };
  const onZero = (s: string, pre = zero.pre) => {
    setZeroText(s);
    if (!zeroWhy(s)) put({ epoch: epochOfZero(pre, Number(s)) });
  };
  const byEvent = on && era.by === 'event';

  let note: ReactNode;
  if (!on) note = '换成纪年以后，时间轴、编年史、国家和人物卡片、导出的图上的年份都按纪年写。';
  else if (badName || badZero) note = badName ?? badZero;
  else {
    const span = (
      <>
        这样算，这个世界从<b>{yearFull(0, era)}</b>开始，推到<b>{yearFull(end, era)}</b>为止。
      </>
    );
    note = !byEvent ? span : era.event ? <>这件事那一年算{era.name}元年。{span}</> : '选好以后，那件事那一年就是元年。';
  }

  return (
    <section className="era-sec" data-era={on ? (byEvent ? 'event' : 'year') : 'off'}>
      <h3>
        纪年<small>随时能改，不用重新推演</small>
      </h3>
      <div className="ov-kv era-kv" role="radiogroup" aria-label="年份怎么写">
        <button className="ov-kv-row era-opt" role="radio" aria-checked={!on} data-act="era-off" onClick={() => setEra(undefined)}>
          {on ? <i className="era-ck" /> : <Icon name="check" size={18} className="era-ck" />}
          <span className="era-t">
            <i>第几年</i>
            <small>从第 0 年数起</small>
          </span>
          <b>{yearFull(year)}</b>
        </button>
        <button className="ov-kv-row era-opt" role="radio" aria-checked={on} data-act="era-on" onClick={() => !on && setEra(last)}>
          {on ? <Icon name="check" size={18} className="era-ck" /> : <i className="era-ck" />}
          <span className="era-t">
            <i>纪年</i>
            <small>像公元那样，自己定元年在哪一年</small>
          </span>
          <b>{yearFull(year, shown)}</b>
        </button>
      </div>
      {on && (
        <div className="ov-kv era-kv">
          <label className="ov-kv-row">
            <span>名字</span>
            <input
              className={`era-in${badName ? ' bad' : ''}`}
              data-act="era-name"
              value={nameText}
              aria-invalid={!!badName}
              onChange={(e) => onName(e.target.value)}
              onCompositionStart={() => (composing.current = true)}
              onCompositionEnd={(e) => {
                composing.current = false;
                onName(e.currentTarget.value);
              }}
              onBlur={() => !badName && setNameText(era.name)}
            />
          </label>
          <div className="ov-kv-row">
            <span>元年怎么定</span>
            <div className="seg" role="group" aria-label="元年怎么定">
              <button className={byEvent ? '' : 'on'} aria-pressed={!byEvent} data-act="era-by-year" onClick={() => byEvent && setEra({ name: era.name, epoch: era.epoch })}>
                按年份
              </button>
              <button className={byEvent ? 'on' : ''} aria-pressed={byEvent} data-act="era-by-event" onClick={() => !byEvent && put({ by: 'event' })}>
                按一件事
              </button>
            </div>
          </div>
          {!byEvent ? (
            <div className="ov-kv-row">
              <span>第 0 年是</span>
              <span className="era-y">
                <button
                  className="era-sel"
                  data-act="era-pre"
                  aria-label={`第 0 年在${era.name}${zero.pre ? '元年以前' : '元年以后'},点一下换成${zero.pre ? era.name : `${era.name}前`}`}
                  onClick={() => onZero(String(zero.n), !zero.pre)}
                >
                  {era.name}
                  {zero.pre ? '前' : ''}
                  <Icon name="down" size={12} />
                </button>
                <input
                  className={`era-in era-num${badZero ? ' bad' : ''}`}
                  data-act="era-zero"
                  inputMode="numeric"
                  aria-label="第 0 年是多少年"
                  aria-invalid={!!badZero}
                  value={zeroText}
                  onChange={(e) => onZero(e.target.value.replace(/[^\d]/g, '').slice(0, 6))}
                  onBlur={() => !badZero && setZeroText(String(eraZero(era).n))}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                />
                <span className="era-unit">年</span>
              </span>
            </div>
          ) : (
            <>
              <button ref={pickRef} className="ov-kv-row era-ev" data-act="era-event" aria-expanded={picking} onClick={() => setPicking((x) => !x)}>
                <span className="era-t">
                  <small>元年那件事</small>
                  {era.event ? (
                    <i>
                      <em>{yearFull(era.epoch, era)}</em>
                      {eraText(eraEventText(civ, era), era)}
                    </i>
                  ) : (
                    <i className="era-pick-hint">选一件事…</i>
                  )}
                </span>
                <Icon name="chevron" size={14} />
              </button>
              <div className="ov-kv-row era-ro">
                <span>第 0 年是</span>
                <b>{yearFull(0, era)}</b>
              </div>
            </>
          )}
        </div>
      )}
      <p className={`ov-txt dim era-note${badName || badZero ? ' bad' : ''}`}>{note}</p>
      {picking && byEvent && <EraEventPicker civ={civ} era={era} anchor={pickRef} onClose={() => setPicking(false)} />}
    </section>
  );
}

/**
 * 选一件事当元年:贴在「元年那件事」下面的弹层,列出编年史(大事 / 全部,新的在上,年份照现在的纪年写),能搜;
 * 移上去(键盘移过去)出现「定为元年」,点了那件事那一年就是元年。Esc、点外面收起;概览滚动时收起(位置跟不上)
 */
function EraEventPicker({ civ, era, anchor, onClose }: { civ: Civ | null; era: Era; anchor: React.RefObject<HTMLElement>; onClose: () => void }) {
  const [major, setMajor] = useState(true);
  const [q, setQ] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);
  const all = useMemo(() => (civ ? fullChronicle(civ) : []), [civ]);
  const rows = useMemo(() => {
    const k = q.trim();
    const list = all.filter((e) => (!major || e.importance >= MAJOR) && (!k || evText(e).includes(k) || evLabel(e).includes(k)));
    return list.reverse();
  }, [all, major, q]);

  // 放在概览浮层里,贴着「元年那件事」那一行的下沿;下面放不下就往上挪
  useLayoutEffect(() => {
    const a = anchor.current;
    const ov = a?.closest<HTMLElement>('.ov');
    if (!a || !ov) return;
    const place = () => {
      const o = ov.getBoundingClientRect();
      const r = a.getBoundingClientRect();
      const width = Math.min(560, o.width - 24);
      const left = Math.max(12, Math.min(o.width - width - 12, r.left - o.left));
      const below = Math.min(window.innerHeight - 28, o.bottom - 6) - r.bottom - 6;
      const maxHeight = Math.max(240, Math.min(470, below));
      const top = below >= 240 ? r.bottom - o.top + 6 : Math.max(12, o.height - 28 - maxHeight);
      // 绝对定位从边框里面算起:减掉概览的边框,和那一行左边对齐
      setPos({ left: left - ov.clientLeft, top: top - ov.clientTop, width, maxHeight });
    };
    place();
    setHost(ov);
    const body = ov.querySelector('.ov-body');
    body?.addEventListener('scroll', onClose);
    window.addEventListener('resize', place);
    return () => {
      body?.removeEventListener('scroll', onClose);
      window.removeEventListener('resize', place);
    };
  }, [anchor, onClose]);

  // Esc、点弹层和那一行以外的地方:收起
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (boxRef.current?.contains(t) || anchor.current?.contains(t)) return;
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onDown, true);
    };
  }, [anchor, onClose]);

  const choose = (e: ChronicleEntry) => {
    setEra({ name: era.name, epoch: Math.floor(e.year), by: 'event', event: { tag: e.tag, text: evText(e) } });
    onClose();
  };

  if (!host || !pos) return null;
  return createPortal(
    <div ref={boxRef} className="era-pick" role="dialog" aria-label="选一件事当元年" style={pos}>
      <div className="era-pick-head">
        <b>选一件事当元年</b>
        <div className="era-pick-tools">
          <label className="era-search">
            <Icon name="search" size={15} />
            <input autoFocus value={q} placeholder="搜事件、国家、人物" aria-label="搜事件、国家、人物" onChange={(e) => setQ(e.target.value)} />
          </label>
          <div className="seg">
            <button className={major ? 'on' : ''} aria-pressed={major} onClick={() => setMajor(true)}>
              大事
            </button>
            <button className={major ? '' : 'on'} aria-pressed={!major} onClick={() => setMajor(false)}>
              全部
            </button>
          </div>
        </div>
      </div>
      <div className="era-pick-list chronicle" role="listbox" aria-label="编年史">
        {rows.map((e) => {
          const a = Math.floor(e.year);
          const b = Math.floor(e.end);
          return (
            <button key={`${e.kind}:${e.id}`} className={`chron-row imp${e.importance}`} role="option" aria-selected={false} data-ev={evType(e)} onClick={() => choose(e)}>
              <span className="chron-year">
                {yearShort(a, era)}
                {e.children && b > a && <em>–{yearShort(b, era)}</em>}
              </span>
              <b className="tb-ev chron-type">{evLabel(e)}</b>
              <span className="chron-text">
                <EntryText civ={civ ?? undefined} e={e} still />
              </span>
              <span className="era-pick-go">定为元年</span>
            </button>
          );
        })}
        {!rows.length && <div className="ov-empty">{all.length ? '没有找到' : '还没有史事'}</div>}
      </div>
    </div>,
    host,
  );
}
