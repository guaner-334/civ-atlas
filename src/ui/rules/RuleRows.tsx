/**
 * 调规则的页的零件:滑条、一项规则一行(电脑)/ 一块(手机)、一种地貌的叫法、改名的输入框、「···」菜单。
 *
 * 滑条:下面一排刻度,「官方」那一格有一道短竖线、下面写「官方」;
 * 改过的从官方那一格到现在的位置涂主色(一眼看出往哪边调、调了多远);区间两个把手,中间涂(没改的涂浅灰)。
 * 点、拖都吸到最近一格;键盘:左右(上下)挪一格,Home / End 到两头。手机上横着拖才算拖,竖着划照样滚动页面,点一下跳到那一格。
 * 只能看的(官方规则、别人分享的)滑条不能动。
 *
 * 改过的项左边一道细蓝条,旁边「改回」(↺)。
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../icons';
import { BIOMES, type Biome } from '../../gen/biomes';
import { BIOME_NAME_MAX, biomeKey } from '../../gen/civ/ruleSet';
import { officialValue, type TuningItem, type TuningValue } from '../../gen/civ/tuning';
import { tuningText, tuningValueText } from '../../gen/civ/tuningText';
import { edgeLabels, fillSpan, nearestSlot, officialLabelAt, officialSlots, pickThumb, slotFrac, slotsOf, stepThumb, thumbsOf, ticksOf, valueAt } from './sliderMath';

const pct = (f: number) => `${(f * 100).toFixed(3)}%`;
const same = (a: TuningValue, b: TuningValue) => (Array.isArray(a) && Array.isArray(b) ? a[0] === b[0] && a[1] === b[1] : a === b);

/** 手指横着挪多远才算开始拖(CSS 像素) */
const TOUCH_SLOP = 6;

/** 滑条 */
export function RuleSlider({ x, value, ro, onChange }: { x: TuningItem; value: TuningValue; ro: boolean; onChange: (v: TuningValue) => void }) {
  const slots = useMemo(() => slotsOf(x), [x]);
  const thumbs = thumbsOf(x, value, slots);
  const official = officialSlots(x, slots);
  const mod = !same(value, officialValue(x));
  const fill = fillSpan(x, thumbs, slots);
  const [left, right] = edgeLabels(x);
  const track = useRef<HTMLDivElement>(null);
  /** 最新的各格(拖的时候按它算,不用等重画) */
  const now = useRef(thumbs);
  now.current = thumbs;
  /** 正在拖哪个把手;手指按下还没认定是横着拖的时候记着起点 */
  const drag = useRef<{ k: number; pid: number; touch?: { x: number; y: number; moved: boolean } } | null>(null);

  const slotAt = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    return nearestSlot(slots, r.width ? (clientX - r.left) / r.width : 0);
  };
  const move = (k: number, i: number) => {
    const next = now.current.slice();
    next[k] = i;
    // 区间:不让两个把手交叉(拖过头的停在另一个上)
    if (next.length > 1) next[k] = k === 0 ? Math.min(i, next[1]) : Math.max(i, next[0]);
    if (next[k] === now.current[k]) return;
    now.current = next;
    onChange(valueAt(x, next, slots));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (ro || e.button !== 0) return;
    const i = slotAt(e.clientX);
    const k = pickThumb(now.current, i);
    drag.current = { k, pid: e.pointerId, ...(e.pointerType === 'touch' ? { touch: { x: e.clientX, y: e.clientY, moved: false } } : {}) };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    // 鼠标、笔:按下就跳到那一格;手指等认定是横着拖或者是点一下再动
    if (e.pointerType !== 'touch') {
      e.preventDefault();
      (e.currentTarget.querySelectorAll<HTMLElement>('[role=slider]')[k] ?? null)?.focus({ preventScroll: true });
      move(k, i);
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.pid !== e.pointerId) return;
    if (d.touch && !d.touch.moved) {
      const dx = Math.abs(e.clientX - d.touch.x);
      const dy = Math.abs(e.clientY - d.touch.y);
      if (dx < TOUCH_SLOP || dx < dy) return;
      d.touch.moved = true;
    }
    move(d.k, slotAt(e.clientX));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.pid !== e.pointerId) return;
    drag.current = null;
    // 手指点一下(没拖):跳到点的那一格
    if (d.touch && !d.touch.moved) move(d.k, slotAt(e.clientX));
  };
  const onPointerCancel = () => {
    drag.current = null;
  };
  const onKey = (k: number) => (e: React.KeyboardEvent) => {
    if (ro) return;
    const dir = e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : 0;
    let next: number[] | null = null;
    if (dir) next = stepThumb(now.current, k, dir, slots.length);
    else if (e.key === 'Home') next = stepThumb(now.current, k, -slots.length, slots.length);
    else if (e.key === 'End') next = stepThumb(now.current, k, slots.length, slots.length);
    if (!next) return;
    e.preventDefault();
    e.stopPropagation();
    move(k, next[k]);
  };

  return (
    <div
      className={`rs-sl${ro ? ' ro' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <div className="rs-track" ref={track}>
        {fill && <div className={`rs-fill${x.kind === 'range' && !mod ? ' dim' : ''}`} style={{ left: pct(fill[0]), width: pct(fill[1] - fill[0]) }} />}
        {ticksOf(slots).map((t, i) => (
          <i key={i} className="rs-tk" style={{ left: pct(t) }} />
        ))}
        {official.map((o, i) => (
          <i key={`o${i}`} className="rs-ok" style={{ left: pct(slotFrac(slots, o)) }} />
        ))}
        {thumbs.map((t, k) => (
          <b
            key={k}
            className="rs-th"
            style={{ left: pct(slotFrac(slots, t)) }}
            role="slider"
            tabIndex={ro ? -1 : 0}
            aria-label={thumbs.length > 1 ? `${x.name}（${k ? '多' : '少'}的一头）` : x.name}
            aria-valuemin={0}
            aria-valuemax={slots.length - 1}
            aria-valuenow={t}
            aria-valuetext={tuningValueText(x, valueAt(x, thumbs.length > 1 ? [t, t] : [t], slots))}
            aria-readonly={ro || undefined}
            onKeyDown={onKey(k)}
          />
        ))}
      </div>
      <div className="rs-lab" aria-hidden="true">
        <span className="l0">{left}</span>
        <span className="o" style={{ left: pct(officialLabelAt(x, slots)) }}>
          官方
        </span>
        <span className="l1">{right}</span>
      </div>
    </div>
  );
}

/** 一项的值、改没改、值的字是不是「不发生 / 关」那样黑的 */
function itemState(x: TuningItem, values: { readonly [id: string]: TuningValue }) {
  const has = Object.prototype.hasOwnProperty.call(values, x.id);
  const value = has ? values[x.id] : officialValue(x);
  return { value, mod: has, off: has && (value === 0 || value === 'off') };
}

interface RowProps {
  x: TuningItem;
  values: { readonly [id: string]: TuningValue };
  ro: boolean;
  /** 改了(undefined = 改回官方) */
  onSet: (id: string, v: TuningValue | undefined) => void;
}

/** 改回官方的小按钮(没改过、只能看的占着位置不显示) */
function ResetBtn({ show, onClick, label }: { show: boolean; onClick: () => void; label: string }) {
  if (!show) return <span className="rs-rst" aria-hidden="true" />;
  return (
    <button className="rs-rst" data-act="rule-reset" title="改回官方" aria-label={`${label}改回官方`} onClick={onClick}>
      <Icon name="again" size={15} />
    </button>
  );
}

/** 电脑上的一行:名字和一句说明、滑条、值、改回 */
export function RuleRow({ x, values, ro, onSet }: RowProps) {
  const { value, mod, off } = itemState(x, values);
  return (
    <div className={`rs-kn${mod ? ' mod' : ''}${ro ? ' ro' : ''}`} data-item={x.id}>
      <div className="rs-kn-t">
        <b>{x.name}</b>
        <small>{tuningText(x).desc}</small>
      </div>
      <RuleSlider x={x} value={value} ro={ro} onChange={(v) => onSet(x.id, v)} />
      <div className={`rs-val${off ? ' offv' : ''}`}>{tuningValueText(x, value)}</div>
      <ResetBtn show={mod && !ro} label={x.name} onClick={() => onSet(x.id, undefined)} />
    </div>
  );
}

/** 手机上的一块:名字和值一行(改回在值旁边)、说明、占满一行的滑条 */
export function RuleBlock({ x, values, ro, onSet }: RowProps) {
  const { value, mod, off } = itemState(x, values);
  return (
    <div className={`rs-pk${mod ? ' mod' : ''}${ro ? ' ro' : ''}`} data-item={x.id}>
      <div className="rs-pk-h">
        <b>{x.name}</b>
        <span className={`rs-val${off ? ' offv' : ''}`}>{tuningValueText(x, value)}</span>
        {mod && !ro && <ResetBtn show label={x.name} onClick={() => onSet(x.id, undefined)} />}
      </div>
      <small>{tuningText(x).desc}</small>
      <RuleSlider x={x} value={value} ro={ro} onChange={(v) => onSet(x.id, v)} />
    </div>
  );
}

/**
 * 一种地貌的叫法:色块、官方的叫法、输入框(空着 = 官方的叫法,官方的叫法当占位字)、改回。
 * 打字时边打边存(存的时候去掉首尾空白;框里照打的样子留着,打完一个空格接着打不会被吃掉),离开框再和存下的对齐
 */
export function BiomeRow({ b, name, ro, phone, onSet }: { b: Biome; name: string | undefined; ro: boolean; phone?: boolean; onSet: (key: string, name: string) => void }) {
  const info = BIOMES[b];
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? name ?? '';
  const mod = !!name;
  return (
    <div className={`rs-bm${mod ? ' mod' : ''}${ro ? ' ro' : ''}`} data-biome={biomeKey(b)}>
      <i style={{ background: `rgb(${info.paint.join(',')})` }} />
      {!phone && <span className="rs-bo">{info.name}</span>}
      <input
        className="rs-in"
        value={shown}
        placeholder={info.name}
        maxLength={BIOME_NAME_MAX}
        readOnly={ro}
        spellCheck={false}
        aria-label={`${info.name}叫什么`}
        onFocus={() => !ro && setDraft(name ?? '')}
        onChange={(e) => {
          if (ro) return;
          setDraft(e.target.value);
          onSet(biomeKey(b), e.target.value);
        }}
        onBlur={() => setDraft(null)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) (e.target as HTMLInputElement).blur();
        }}
      />
      <ResetBtn
        show={mod && !ro}
        label={info.name}
        onClick={() => {
          setDraft(null);
          onSet(biomeKey(b), '');
        }}
      />
    </div>
  );
}

/** 改名的输入框:回车 / 点别处确定,Esc 不改 */
export function NameInput({ initial, max, onDone, className }: { initial: string; max: number; onDone: (v: string | null) => void; className: string }) {
  const [text, setText] = useState(initial);
  const done = useRef(false);
  const ref = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
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
      maxLength={max}
      placeholder="给这套规则起个名字"
      spellCheck={false}
      aria-label="规则的名字"
      data-act="rules-name-input"
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        // 输入法正在拼字时的回车、Esc 归输入法(确认、取消候选字),不算改完
        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
        if (e.key === 'Enter') finish(text);
        else if (e.key === 'Escape') {
          e.stopPropagation();
          finish(null);
        }
      }}
      onBlur={() => finish(text)}
    />
  );
}

/** 菜单里的一项 */
export interface MenuItem {
  act: string;
  icon: 'copy' | 'save' | 'trash' | 'share' | 'pen';
  text: string;
  red?: boolean;
  /** 点两下才算(删除:第一下换成「再点一下删除」) */
  confirm?: string;
  onClick: () => void;
}

/** 「···」按钮和它的菜单(点外面、Esc 收起) */
export function MoreMenu({ items, className = '', btnClass, label = '更多' }: { items: (MenuItem | 'sep')[]; className?: string; btnClass: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const [arm, setArm] = useState<string | null>(null);
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
  useEffect(() => {
    if (!open) setArm(null);
  }, [open]);
  return (
    <span className={`rs-more-wrap ${className}`} ref={root} onClick={(e) => e.stopPropagation()}>
      <button className={`${btnClass}${open ? ' on' : ''}`} data-act="rules-menu" aria-label={label} title={label} aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="more" size={18} />
      </button>
      {open && (
        <div className="pm-menu rs-menu" role="menu">
          {items.map((it, i) =>
            it === 'sep' ? (
              <hr key={i} className="pm-sep" />
            ) : (
              <button
                key={it.act}
                className={`pm-item${it.red ? ' red' : ''}`}
                role="menuitem"
                data-act={it.act}
                onClick={() => {
                  if (it.confirm && arm !== it.act) return setArm(it.act);
                  setOpen(false);
                  it.onClick();
                }}
              >
                <Icon name={it.icon} size={16} />
                <span className="pm-text">{arm === it.act && it.confirm ? it.confirm : it.text}</span>
              </button>
            ),
          )}
        </div>
      )}
    </span>
  );
}
