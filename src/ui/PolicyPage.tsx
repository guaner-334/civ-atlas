/**
 * 国家方针那一页:国家卡片概况「方针」一行、干预页最上面「方针」点开,卡片换成这一页(和让作者的人物即位那一页同一种做法,不弹窗;
 * 下的令先进待推演的单子,pendingStore.ts;推演规则见 gen/civ/policy.ts)。
 *
 *   生效年份  −100 −10 [年份] +10,默认时间轴这一年;"从这年起照方针走，直到换下一条"
 *             (逐年推演:固定"第 N 年年初(下一步)",不能加减)
 *   方针      一键选的五种,一种一行、一句后果:照君主性格(默认)/ 扩张 / 守成 / 商贸 / 和平发展;点了把下面的旋钮填好(亲、仇不动),
 *             选中的那行浅蓝底、打勾;拧过旋钮就哪一行都不勾(算自定)
 *   细调五项  点开:打仗胆量、往哪扩张(开拓、沿海 / 内陆)、跟谁亲跟谁仇(各最多 3 国,「＋ 在地图上点」:地图压暗、国家浮出名牌,
 *             点一个加上、再点去掉,Esc 回到这一页)、和谈底线、发展重点。旋钮从中间往两边拧(中间 = 照君主,不加不减),
 *             下面写现在在位那位的数和加上方针以后的数
 *   底部      返回 / 加入待推演(逐年推演写「加入」)
 * 单子里这国已经有一条方针:换成这一条(后下的换掉先下的)。和现在照的一样时「加入」按不下去。
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { Civ, RulerLeanings } from '../gen/civ/types';
import { polityAlive } from '../gen/civ/growth';
import { rulerAt } from '../gen/civ/peopleInfo';
import { POLICY_FOCI, POLICY_PICK_MAX, POLICY_PRESETS_KEYS, polityKey, type PolicyKnob, type PolicyPreset } from '../gen/edits';
import { POLICY_PRESET_NAMES } from '../gen/civ/policy';
import { spaced, yearAt, yearSpanAt } from '../gen/era';
import { useEra } from './editsStore';
import { useNarrow } from './device';
import { getPending, queueIntervention, removePending, usePending } from './pendingStore';
import { nextAt, nextYear, useStepwise } from './stepwiseStore';
import { STEP_LOOK_WHY, StepEffectTime, useStepView } from './Stepwise';
import { defaultYear, getPolityPick, nameAt, neighborsAt, polityIdOf, setPolityPick, usePolityPick, type PolityPick } from './Interventions';
import { YearRow, jumpTo, rgb, useYearInput } from './panelParts';
import { NationLifeHead } from './LifeHead';
import { closeCmdPage, openCmdPage, queueCmdPage, setSheet } from './panelStore';
import { getSelection, setSelection } from './civView';
import { alivePolities } from './crownInfo';
import {
  FOCUS_NAMES,
  draftIv,
  draftOf,
  knobNote,
  pendingPolicy,
  policyAt,
  policyQueueText,
  presetOn,
  samePolicy,
  togglePick,
  withKnob,
  withPreset,
  type PolicyDraft,
} from './policyInfo';
import './policy.css';

/** 一键选的五种(第一种 = 照君主性格)和各自的一句后果 */
const PRESET_ROWS: { k: PolicyPreset | 'none'; name: string; desc: string }[] = [
  { k: 'none', name: '照君主性格', desc: '不另定方针，打不打仗、往哪扩跟着君主走' },
  ...POLICY_PRESETS_KEYS.map((k) => ({
    k,
    name: POLICY_PRESET_NAMES[k],
    desc: {
      expand: '更敢开战，偏远贫瘠也去占；国土长得快，仗多',
      hold: '少开战、少外扩，早议和；守得住，难再变大',
      trade: '看重沿海、大河和港口，少开战；运输长得快一些',
      peace: '尽量不打仗，打了也早议和；生产长得快一些',
    }[k],
  })),
];

/**
 * 打开国家 id 的方针页(别处的入口:人物卡「某国方针」、演一国的「改方针」):已经选中它 = 直接换页;
 * 没选中 = 先选中它,面板换到它时直接打开这一页(返回回到它的信息页)
 */
export function openPolicyPage(civ: Civ, id: number) {
  const sel = getSelection().sel;
  if (sel?.kind === 'polity' && sel.id === id) {
    openCmdPage({ kind: 'policy', back: 'info' });
    setSheet('full');
    return;
  }
  queueCmdPage(polityKey(civ, id), { kind: 'policy', back: 'info' });
  setSelection({ kind: 'polity', id });
}

export function PolicyPage({ civ, id, year, from }: { civ: Civ; id: number; year: number; from?: number }) {
  const era = useEra();
  const phone = useNarrow();
  const sw = useStepwise();
  const step = sw.on;
  const look = useStepView().look;
  const pending = usePending();
  const p = civ.polities[id];
  const key = polityKey(civ, id);
  // 生效年份的范围:立国那年 … 亡国前一年(同干预页)
  const lo = Math.ceil(p.founded);
  const last = Math.ceil(civ.endYear) - 1;
  const hi = Math.max(lo, Math.min(last, p.ended !== undefined ? Math.ceil(p.ended) - 1 : last));
  const [msg, setMsg] = useState<string | null>(null);
  const clear = () => setMsg(null);
  const yi = useYearInput(from ?? defaultYear(p, year), lo, hi, clear);
  const y = step ? nextYear(sw) : yi.y;
  /** 看国土、谁在位用哪一年(逐年推演的下一步还没算出来:按"现在"看) */
  const yv = step ? Math.min(nextAt(sw), civ.endYear) : y;
  const name = nameAt(p, y);
  /** 面板标题上的名字(单子、提示条写它,和用户点的那个对得上) */
  const shown = nameAt(p, year);
  // 推过的历史里那一年照的、单子里还没推的
  const inForce = policyAt(civ, id, yv);
  const queued = pendingPolicy(pending, key);
  const [d, setD] = useState<PolicyDraft>(() => draftOf(queued ?? inForce));
  const dRef = useRef(d);
  dRef.current = d;
  const [open, setOpen] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  // 点开细调:滚到"细调"那一行
  const [scrollTo, setScrollTo] = useState(false);
  useEffect(() => {
    if (!scrollTo) return;
    setScrollTo(false);
    moreRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [scrollTo]);

  // 那时在位的君主(旋钮下面写他的数)
  const ruler = rulerAt(civ, id, yv);
  const lean: RulerLeanings | null = ruler?.leanings ?? null;

  // 亲、仇在地图上点:那一年还在的别国都能点
  const source = `policy:${id}`;
  const pk = usePolityPick();
  const picking = pk?.source === source;
  useEffect(
    () => () => {
      if (getPolityPick()?.source === source) setPolityPick(null);
    },
    [source],
  );
  const others = useMemo(() => new Set(alivePolities(civ, yv).map((x) => x.id).filter((q) => q !== id)), [civ, yv, id]);
  const near = useMemo(() => neighborsAt(civ, id, yv).near, [civ, id, yv]);
  const pickOn = (side: 'foes' | 'friends') => {
    clear();
    jumpTo(step ? Math.min(y, sw.now) : y);
    const word = side === 'foes' ? '仇' : '亲';
    const make = (dd: PolicyDraft): PolityPick => {
      const ids = (keys: readonly string[]) => keys.map((k) => polityIdOf(civ, k)).filter((q) => q >= 0);
      const marks = new Map<number, string>();
      for (const q of ids(dd.foes)) marks.set(q, side === 'foes' ? '仇 ✓' : '仇');
      for (const q of ids(dd.friends)) marks.set(q, side === 'friends' ? '亲 ✓' : '亲');
      return {
        prompt: phone ? `点${name}的${word}国（最多 ${POLICY_PICK_MAX} 国）` : `点${name}的${word}国（最多 ${POLICY_PICK_MAX} 国，已选 ${dd[side].length} 国）`,
        sub: phone ? '再点一次去掉；Esc 回到方针' : '点名牌加上，再点一次去掉；Esc 回到方针',
        source,
        self: id,
        near,
        eligible: others,
        year: yv,
        keep: true,
        on: new Set(ids(dd[side])),
        marks,
        accept: (q) => {
          if (!others.has(q)) return `${yearAt(y, era)}这个国家不在`;
          const r = togglePick(dRef.current, side, polityKey(civ, q));
          if (typeof r === 'string') return r;
          dRef.current = r;
          setD(r);
          setPolityPick(make(r));
          return null;
        },
      };
    };
    setPolityPick(make(dRef.current));
  };

  const v = draftIv(key, y, d);
  const on = presetOn(d);
  /** 加不了的原因(和现在一样的不写原因,只是按不下去) */
  const why = (() => {
    if (step && look !== null) return STEP_LOOK_WHY;
    if (!step && !yi.valid) return `生效年份要在${spaced(yearSpanAt(lo, hi, era))}之间`;
    if (!polityAlive(p, yv)) return yv < p.founded ? `${yearAt(y, era)}还没立国` : `${yearAt(y, era)}已亡`;
    return null;
  })();
  // 和单子里的 / 推过的历史里那一年照的一样:按不下去(不写原因,卡片上「方针」一行已经写着)
  const same = queued ? samePolicy(v, queued) && queued.from === y : samePolicy(v, inForce);

  const go = () => {
    if (why || same) return;
    // 单子里这国原来的方针换成这一条(新的加上了才拿掉旧的:加不了时单子不变);改回和推过的历史里一样的,只把单子里的拿掉
    const old = getPending().filter((x) => x.kind === 'iv' && x.v.kind === 'policy' && x.v.a === key);
    if (!(old.length && samePolicy(v, inForce))) {
      const err = queueIntervention(v, policyQueueText(civ, v, shown), { self: id, target: null, shown });
      if (err) return setMsg(err);
    }
    old.forEach((x) => removePending(x.id));
    closeCmdPage();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || picking) return;
    e.stopPropagation();
    closeCmdPage();
  };

  const knob = (k: PolicyKnob, o: { title?: string; label?: string; ends: [string, string]; sub?: boolean }) => {
    const n = d[k];
    const pos = 50 + n;
    const val = n === 0 ? <span className="pol-v zero">照性格</span> : <span className="pol-v">{n > 0 ? `+${n}` : `−${-n}`}</span>;
    const note = knobNote(k, n, lean, ruler?.name ?? '', ruler);
    return (
      <div className={`pol-knob${o.sub ? ' sub' : ''}`} data-knob={k}>
        <div className="pol-k">
          {o.title ? <span className="cp-form-title">{o.title}</span> : <span>{o.label}</span>}
          {val}
        </div>
        <span className="cr-range pol-range">
          <input
            type="range"
            min={-50}
            max={50}
            step={1}
            value={n}
            aria-label={o.title ?? o.label}
            style={{ '--l': `${Math.min(50, pos)}%`, '--r': `${Math.max(50, pos)}%` } as CSSProperties}
            onChange={(e) => (clear(), setD(withKnob(dRef.current, k, Number(e.target.value))))}
          />
        </span>
        <div className="pol-ends">
          <span>{o.ends[0]}</span>
          <span>{o.ends[1]}</span>
        </div>
        {note && <div className="pol-note">{note}</div>}
      </div>
    );
  };

  const chips = (side: 'foes' | 'friends') => (
    <div className="pol-who" data-side={side}>
      <span className="pol-who-k">{side === 'foes' ? '仇' : '亲'}</span>
      <span className="pol-chips">
        {d[side].map((k) => {
          const q = polityIdOf(civ, k);
          const P = q >= 0 ? civ.polities[q] : undefined;
          const n = P ? nameAt(P, y) : '(新历史里没有的国家)';
          return (
            <span key={k} className="pol-chip" data-polity={q}>
              {P && <i className="cr-dot" style={{ background: rgb(P.color) }} />}
              {n}
              <button aria-label={`去掉${n}`} title={`去掉${n}`} onClick={() => setD({ ...dRef.current, [side]: dRef.current[side].filter((x) => x !== k) })}>
                ✕
              </button>
            </span>
          );
        })}
        {d[side].length < POLICY_PICK_MAX && (
          <button className="cp-step pol-add" data-act={`policy-pick-${side}`} onClick={() => (picking ? setPolityPick(null) : pickOn(side))}>
            ＋ 在地图上点
          </button>
        )}
      </span>
    </div>
  );

  return (
    <div className="cr-page" onKeyDown={onKey}>
      <div className="cp-body cr-form pol-form" data-policy="form">
        <NationLifeHead kinds={['policy']} polity={id} />
        {step ? (
          <StepEffectTime phone={phone} />
        ) : (
          <div className="cp-from">
            <span className="cp-k">生效年份</span>
            <YearRow yi={yi} label="生效年份" />
            <span className="cp-note">{phone ? '从这年起照方针走，直到换下一条方针。' : '从这年起照方针走，直到换下一条。之前的历史不变。'}</span>
          </div>
        )}
        <div className="pol-h">
          方针<em>点一种，旁边一句是后果</em>
        </div>
        <div className="cp-cmds pol-presets" role="radiogroup" aria-label="方针">
          {PRESET_ROWS.map((r) => (
            <button
              key={r.k}
              role="radio"
              aria-checked={on === r.k}
              className={`cp-cmd${on === r.k ? ' on' : ''}`}
              data-preset={r.k}
              onClick={() => (clear(), setD(withPreset(dRef.current, r.k === 'none' ? null : r.k)))}
            >
              <span className="cp-cmd-main">
                <span className="cp-cmd-name">
                  {r.name}
                  {r.k === 'none' && <em className="pol-def">默认</em>}
                </span>
                <span className="cp-cmd-desc">{r.desc}</span>
              </span>
              {on === r.k && <span className="cr-check">✓</span>}
            </button>
          ))}
        </div>
        <span className="cp-note pol-now">方针加减在在位君主的倾向上，换一位照样管用。</span>
        {open ? (
          <>
            <button ref={moreRef} className="pol-more open" data-act="policy-fold" onClick={() => setOpen(false)}>
              细调<span>收起</span>
            </button>
            <div className="pol-knobs">
              <div className="cp-form pol-grp">{knob('war', { title: '打仗胆量', ends: ['少打', '多打'] })}</div>
              <div className="cp-form pol-grp">
                <span className="cp-form-title">往哪扩张</span>
                {knob('expand', { label: '开拓', ends: ['只要肥地', '偏远贫瘠也去'], sub: true })}
                {knob('coast', { label: '沿海 / 内陆', ends: ['偏内陆', '偏沿海、大河'], sub: true })}
              </div>
              <div className="cp-form pol-grp">
                <span className="cp-form-title">
                  跟谁亲，跟谁仇<em className="pol-ttl-em">各挑最多 {POLICY_PICK_MAX} 国</em>
                </span>
                {chips('foes')}
                {chips('friends')}
                <span className="cp-note">仇：先打它，不跟它结盟。亲：不主动打它，结盟先找它，它挨打时更肯出兵相救。</span>
              </div>
              <div className="cp-form pol-grp">{knob('peace', { title: '和谈底线', ends: ['早议和', '不轻易议和'] })}</div>
              <div className="cp-form pol-grp">
                <span className="cp-form-title">发展重点</span>
                <div className="cp-dur pol-seg" role="radiogroup" aria-label="发展重点">
                  {[null, ...POLICY_FOCI].map((f) => (
                    <button
                      key={f ?? 'none'}
                      role="radio"
                      aria-checked={(d.focus ?? null) === f}
                      className={(d.focus ?? null) === f ? 'on' : ''}
                      data-focus={f ?? 'none'}
                      onClick={() => {
                        const { focus: _f, ...rest } = dRef.current;
                        void _f;
                        setD(f ? { ...rest, focus: f } : rest);
                      }}
                    >
                      {f ? FOCUS_NAMES[f] : '不挑'}
                    </button>
                  ))}
                </div>
                <span className="cp-note">挑中的那样长得快一些，别的略慢。发展 20 年才长一步，几十年才看得出。</span>
              </div>
            </div>
          </>
        ) : (
          <button
            ref={moreRef}
            className="pol-more"
            data-act="policy-more"
            onClick={() => {
              setOpen(true);
              setScrollTo(true);
            }}
          >
            细调五项<span>打仗胆量、往哪扩张、亲和仇、和谈底线、发展重点 ›</span>
          </button>
        )}
        {(msg || why) && <div className="cp-msg">{msg ?? why}</div>}
      </div>
      <div className="cp-foot mk-foot">
        <button className="cp-btn" data-act="policy-back" onClick={closeCmdPage}>
          返回
        </button>
        <button className="cp-btn primary" data-act="policy-go" disabled={!!why || same || picking} onClick={go}>
          {step ? '加入' : '加入待推演'}
        </button>
      </div>
    </div>
  );
}
