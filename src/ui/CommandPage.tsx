/**
 * 国家面板的干预页:生效年份(−100 −10 [年份] +10,默认 = 时间轴当前那一年)+ 持续到 + 六条命令。
 *
 *   持续到  一直有效 | 到某一年(−100 −10 [年份] +10 +100,默认 = 生效年份 + 100);只管保护、禁止扩张、结盟,到这一年止(不含)
 *
 *   加入待推演  保护(不会被灭亡)、禁止分裂、禁止扩张
 *   选择对象  结盟(任意国家)、宣战(仅相邻国家)、迁都(本国城市)→ 在地图上选(地图压暗、可选的对象浮出名牌,见 TargetPlates.tsx)
 *
 * 不可用的命令变淡,说明换成原因。下的令先进待推演的单子(pendingStore.ts,单子在时间轴上面,PendingTray.tsx),已经在单子里的变淡、写"已在待推演里";
 * 单子里有令时底部多一个「全部推演(N 条)」。推演时面板先藏起,顶部提示条"正在重新推演 X–3000 年",推完"有鹰王朝禁止扩张,已从 X 年起重新推演"带撤销,
 * 面板回到信息页,从 X 年接着放(App.tsx、TargetPlates.tsx)。命令的数据和推演沿用 editsStore / gen/edits 的干预。
 *
 * 逐年推演(Stepwise.tsx):只在"现在"干预 —— 生效年份换成"第 N 年年初(下一步)"一块,不能加减;按钮写「加入」,
 * 加的进「下一步生效的干预」(同一个单子),下一步开始时一起生效,没有「全部推演」;单子里有的写"已在下一步生效的干预里"。
 * 手机底部多一行"已加几条干预"(点开看每一条,能删)和「接着演绎」。
 */
import { useMemo, useState } from 'react';
import type { Civ } from '../gen/civ/types';
import { capitalAt, polityAlive, populationAt } from '../gen/civ/growth';
import { ownersAt, type Owners } from '../gen/civ/timeline';
import { END_YEAR_MAX, cleanPlay, playInterventions, polityKey, settlementKey, type Intervention, type InterventionKind } from '../gen/edits';
import { useNarrow } from './device';
import { nextYear, useStepwise } from './stepwiseStore';
import { STEP_QUEUED, StepCommandFoot, StepEffectTime } from './Stepwise';
import { useEdits } from './editsStore';
import { cityStands, defaultYear, interventionText, nameAt, neighborsAt, polityOrders, setPolityPick, type PolityPick } from './Interventions';
import { setPanelTab } from './panelStore';
import { pendingInterventions, pushPending, queueIntervention, usePending } from './pendingStore';
import { setCivTime } from './civView';
import { YearRow, YearStepper, useYearInput } from './panelParts';
import { spaced, yearAt, yearSpanAt } from '../gen/era';

let owners: Owners | undefined;

type Cmd = 'protect' | 'unity' | 'halt' | 'ally' | 'declare' | 'move';

const CMDS: { k: Cmd; name: string; desc: string; pick: boolean }[] = [
  { k: 'protect', name: '保护', desc: '该国不会被灭亡', pick: false },
  { k: 'unity', name: '禁止分裂', desc: '该国不会分裂出新国家', pick: false },
  { k: 'halt', name: '禁止扩张', desc: '不再主动扩张,被打时仍会夺回失地', pick: false },
  { k: 'ally', name: '结盟', desc: '选择一个国家,两国不再交战', pick: true },
  { k: 'declare', name: '宣战', desc: '选择一个相邻国家', pick: true },
  { k: 'move', name: '迁都', desc: '选择本国的一座城市', pick: true },
];

export function CommandPage({ civ, id, year }: { civ: Civ; id: number; year: number }) {
  const edits = useEdits();
  const pending = usePending();
  const phone = useNarrow();
  // 逐年推演:只在"现在"干预,生效年份固定是下一步开始的那一年(不能加减),下的令进「下一步生效的干预」
  const sw = useStepwise();
  const step = sw.on;
  const p = civ.polities[id];
  const key = polityKey(civ, id);
  // 生效年份的范围:立国那年 … 亡国前一年(至多结束年份前一年;逐年推演的历史停在某一年年初之前,结束年份不是整数,按整年算)
  const lo = Math.ceil(p.founded);
  const last = Math.ceil(civ.endYear) - 1;
  const hi = Math.max(lo, Math.min(last, p.ended !== undefined ? Math.ceil(p.ended) - 1 : last));
  const [msg, setMsg] = useState<string | null>(null);
  const yi = useYearInput(defaultYear(p, year), lo, hi, () => setMsg(null));
  const { era } = yi;
  const y = step ? nextYear(sw) : yi.y;
  const valid = step || yi.valid;
  /** 看国土、邻国、城用哪一年(逐年推演的下一步还没算出来:按"现在"看) */
  const yv = step ? Math.min(y, civ.endYear) : y;
  // 持续到:一直有效 / 到某一年(截止那年不含,所以至少是生效年份的下一年;逐年推演里没有上限)
  const [limited, setLimited] = useState(false);
  const ui = useYearInput(y + 100, step ? y + 1 : Math.min(y + 1, civ.endYear), step ? END_YEAR_MAX : civ.endYear, () => setMsg(null));
  const timed = (k: Cmd) => k === 'protect' || k === 'halt' || k === 'ally';
  const until = limited ? { until: ui.y } : {};

  const alive = polityAlive(p, y);
  const { size, near } = useMemo(() => neighborsAt(civ, id, yv), [civ, id, yv]);
  const others = useMemo(() => civ.polities.filter((q) => q.id !== id && polityAlive(q, y) && (size.get(q.id) ?? 0) > 0).map((q) => q.id), [civ, id, y, size]);
  // 迁都的候选:那一年本国国土里还在的、不是国都的城
  const cities = useMemo(() => {
    if (!alive) return [];
    owners = ownersAt(civ, yv, owners);
    const own = owners.polity;
    const cap = capitalAt(p, yv);
    return civ.settlements.filter((s) => s.id !== cap && own[s.region] === id && cityStands(civ, s.id, yv) && populationAt(s, yv) > 0).map((s) => s.id);
  }, [civ, id, p, yv, alive]);
  // 逐年推演里一路下过的干预也算(和作者的干预接在一起推,civ.interventions 也是这样排的)
  const orders = polityOrders(civ, id, step ? playInterventions(edits.interventions, cleanPlay(edits.play)) : edits.interventions);
  // 下过同一种命令(有截止年份的,到期以后可以再下)
  const has = (kind: InterventionKind) =>
    orders.some(({ v }) => v.kind === kind && v.kind !== 'found' && v.a === key && !('until' in v && v.until !== undefined && y >= v.until));
  // 待推演的单子里有本国同一种命令
  const queued = (kind: InterventionKind) => pendingInterventions(pending).some((v) => v.kind === kind && v.kind !== 'found' && v.a === key);
  const name = nameAt(p, y);
  /** 面板标题上的名字(时间轴当前那一年的) */
  const shown = nameAt(p, year);

  /** 这一条命令为什么用不了(能用 = null) */
  const why = (k: Cmd): string | null => {
    if (!valid) return `生效年份要在${spaced(yearSpanAt(lo, hi, era))}之间`;
    if (!alive) return y < p.founded ? `${yearAt(y, era)}还没立国` : `${yearAt(y, era)}已亡`;
    if (timed(k) && limited && !ui.valid) return `持续到的年份要在${spaced(yearSpanAt(ui.lo, ui.hi, era))}之间`;
    if ((k === 'protect' || k === 'unity' || k === 'halt') && has(k)) return '已经下过这条命令';
    if ((k === 'protect' || k === 'unity' || k === 'halt') && queued(k)) return step ? STEP_QUEUED : '已在待推演里';
    if (k === 'ally' && !others.length) return '该年没有别的国家';
    if (k === 'declare' && !near.size) return '该年没有相邻的国家';
    if (k === 'move' && !cities.length) return '该年本国没有别的城市';
    return null;
  };

  /** 下令:先进待推演的单子;加不了 = 原因 */
  const order = (v: Intervention, target: { kind: 'polity' | 'settlement'; id: number } | null): string | null => {
    const err = queueIntervention(v, interventionText(civ, v, -1, shown), { self: id, target, shown });
    if (!err) setMsg(null);
    return err;
  };

  const run = (k: Cmd) => {
    setMsg(null);
    if (k === 'protect' || k === 'halt') {
      setMsg(order({ kind: k, a: key, from: y, ...until }, null));
      return;
    }
    if (k === 'unity') {
      setMsg(order({ kind: k, a: key, from: y }, null));
      return;
    }
    const base = { sub: `${yearAt(y, era)}起生效`, source: `polity:${id}`, self: id, near, year: y };
    let pk: PolityPick;
    if (k === 'move') {
      const ok = new Set(cities);
      pk = {
        ...base,
        prompt: `选择${name}的新国都`,
        target: 'settlement',
        eligible: ok,
        accept: (sid) => {
          const s = civ.settlements[sid];
          if (!s) return '这里没有城,点一座城';
          if (capitalAt(p, y) === sid) return `${s.name}本来就是国都`;
          if (!ok.has(sid)) return `${yearAt(y, era)}${s.name}不在${name}的国土里`;
          return order({ kind: 'move', a: key, city: settlementKey(civ, sid), from: y }, { kind: 'settlement', id: sid });
        },
      };
    } else {
      const ok = new Set(k === 'ally' ? others : [...near]);
      pk = {
        ...base,
        prompt: k === 'ally' ? `选择与${name}结盟的国家` : `选择${name}要宣战的国家`,
        eligible: ok,
        accept: (q) => {
          if (q === id) return '要选另一个国家';
          const Q = civ.polities[q];
          if (!Q || !polityAlive(Q, y) || !(size.get(q)! > 0)) return `${yearAt(y, era)}${Q ? nameAt(Q, y) : '这个国家'}不在`;
          if (k === 'declare' && !near.has(q)) return '两国不接壤,无法宣战';
          const b = polityKey(civ, q);
          return order(k === 'ally' ? { kind: k, a: key, b, from: y, ...until } : { kind: k, a: key, b, from: y }, { kind: 'polity', id: q });
        },
      };
    }
    // 地图停在生效那一年:看到的国界、可选的对象和命令用的是同一年(逐年推演:停在"现在")
    setCivTime({ year: step ? Math.min(y, sw.now) : y, playing: false, scrubbing: false, story: false });
    setPolityPick(pk);
  };

  return (
    <>
      <div className="cp-body">
        {step ? <StepEffectTime phone={phone} /> : <YearStepper yi={yi} then={valid && alive && name !== shown ? `${yearAt(y, era)}时它叫${name}。` : undefined} />}
        <div className="cp-from cp-until">
          <div className="cp-until-head">
            <span className="cp-k">持续到</span>
            <div className="cp-dur" role="radiogroup" aria-label="持续到">
              <button role="radio" aria-checked={!limited} className={limited ? '' : 'on'} data-act="until-off" onClick={() => setLimited(false)}>
                一直有效
              </button>
              <button
                role="radio"
                aria-checked={limited}
                className={limited ? 'on' : ''}
                data-act="until-on"
                onClick={() => {
                  if (limited) return;
                  // 每次打开都从生效年份 + 100 起
                  ui.nudge(y + 100 - ui.y);
                  setLimited(true);
                }}
              >
                到某一年
              </button>
            </div>
          </div>
          {limited && (
            <>
              <YearRow yi={ui} label="持续到的年份" wide />
              <span className="cp-note">只对保护、禁止扩张、结盟有效。</span>
            </>
          )}
        </div>
        <div className="cp-cmds">
          {CMDS.map((c) => {
            const off = why(c.k);
            return (
              <button key={c.k} className={`cp-cmd${off ? ' off' : ''}`} data-cmd={c.k} disabled={!!off} onClick={() => run(c.k)}>
                <span className="cp-cmd-main">
                  <span className="cp-cmd-name">{c.name}</span>
                  <span className="cp-cmd-desc">{off ?? c.desc}</span>
                </span>
                {!off && <span className="cp-cmd-go">{c.pick ? '选择对象 ›' : step ? '加入' : '加入待推演'}</span>}
              </button>
            );
          })}
        </div>
        {msg && <div className="cp-msg">{msg}</div>}
      </div>
      {step ? (
        // 逐年推演:没有「全部推演」,单子里的到下一步自己生效。手机底部写已加几条,能「接着演绎」
        phone ? (
          <StepCommandFoot onBack={() => setPanelTab('info')} />
        ) : (
          <div className="cp-foot">
            <button className="cp-btn wide" data-act="back" onClick={() => setPanelTab('info')}>
              返回
            </button>
          </div>
        )
      ) : (
      <div className={`cp-foot${pending.length ? ' cp-grid2' : ''}`}>
        <button className={`cp-btn${pending.length ? '' : ' wide'}`} data-act="back" onClick={() => setPanelTab('info')}>
          返回
        </button>
        {pending.length > 0 && (
          <button className="cp-btn primary" data-act="iv-push" onClick={pushPending}>
            全部推演({pending.length} 条)
          </button>
        )}
      </div>
      )}
    </>
  );
}
