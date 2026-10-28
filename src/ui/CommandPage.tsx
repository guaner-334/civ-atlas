/**
 * 国家面板的干预页:生效年份(−100 −10 [年份] +10,默认 = 时间轴当前那一年)+ 持续到 + 方针 + 六条命令。
 *
 *   持续到  一直有效 | 到某一年(−100 −10 [年份] +10 +100,默认 = 生效年份 + 100);只管保护、保住王室、禁止扩张、结盟,到这一年止(不含)
 *
 *   加入待推演  保护(不会被灭亡)、禁止分裂、保住王室(不改朝换代、不被篡位;共和国变淡,"共和国没有王室")、禁止扩张
 *   选择对象  结盟(任意国家)、宣战(仅相邻国家)、迁都(本国城市)→ 在地图上选(地图压暗、可选的对象浮出名牌,见 TargetPlates.tsx)
 *
 * 不可用的命令变淡,说明换成原因。下的令先进待推演的单子(pendingStore.ts,单子在时间轴上面,PendingTray.tsx),已经在单子里的变淡、写"已在待推演里";
 * 单子里有令时底部多一个「全部推演(N 条)」。推演时面板先藏起,顶部提示条"正在重新推演 X–3000 年",推完"有鹰王朝禁止扩张,已从 X 年起重新推演"带撤销,
 * 面板回到信息页,从 X 年接着放(App.tsx、TargetPlates.tsx)。命令的数据和推演沿用 editsStore / gen/edits 的干预。
 *
 * 最上面一条「方针」(选方针 ›):卡片换成方针那一页(PolicyPage.tsx),生效年份带过去。
 * 它下面「推一把发展」(选力度 ›):卡片换成推一把那一页(BoostPage.tsx),生效年份带过去。
 *
 * 最后一条「立作者的人物为君主」(选人 ›):卡片换成选人那一页 —— 只列那一年在世的作者人物(头像、生卒、那年几岁、身份),不在世的放下面、变淡、
 * 写原因;点一位进让他即位那一页(CrownPage.tsx,和人物卡「即位…」同一页,国家先选好、年份是这里的生效年份);一个都没有时写明要什么样的人物、
 * 「新建人物」直接开新建(国家填好)。
 *
 * 「灭国」(选去向 ›):卡片换成灭国那一页(DestroyPage.tsx),生效年份带过去。
 * 「立约」(选几国 ›)、「划中立地」(选地方 ›):卡片换成立约 / 划中立地那一页(TreatyPage.tsx),生效年份带过去。
 * 「天灾」(选种类 ›):卡片换成天灾那一页(DisasterPage.tsx,州卡片「更多」里也能进),生效年份带过去。
 *
 * 逐年推演(Stepwise.tsx):只在"现在"干预 —— 生效年份换成"第 N 年年初(下一步)"一块,不能加减;按钮写「加入」,
 * 加的进「下一步生效的干预」(同一个单子),下一步开始时一起生效,没有「全部推演」;单子里有的写"已在下一步生效的干预里"。
 * 手机底部多一行"已加几条干预"(点开看每一条,能删)和「接着演绎」。往回看以前的一年时干预都变淡(从那一年改要先「从这里重新演绎」)。
 */
import { useMemo, useState } from 'react';
import type { Civ } from '../gen/civ/types';
import type { Raster } from '../gen/raster';
import type { World } from '../gen/world';
import { capitalAt, polityAlive, populationAt } from '../gen/civ/growth';
import { ownersAt, type Owners } from '../gen/civ/timeline';
import { END_YEAR_MAX, cleanPlay, playInterventions, polityKey, settlementKey, type Intervention, type InterventionKind } from '../gen/edits';
import { useNarrow } from './device';
import { nextAt, nextYear, useStepwise } from './stepwiseStore';
import { STEP_LOOK_WHY, STEP_QUEUED, StepCommandFoot, StepEffectTime, useStepView } from './Stepwise';
import { useEdits, useEra } from './editsStore';
import { cityStands, defaultYear, interventionText, nameAt, neighborsAt, polityOrders, setPolityPick, type PolityPick } from './Interventions';
import { openCmdPage, setPanelTab } from './panelStore';
import { pendingInterventions, pushPending, queueIntervention, usePending } from './pendingStore';
import { setCivTime } from './civView';
import { YearRow, YearStepper, useYearInput } from './panelParts';
import { spaced, yearAt, yearFull, yearSpanAt } from '../gen/era';
import { CrownPage } from './CrownPage';
import { CharAvatar } from './CharacterPanel';
import { newCharacterDraft } from './characterStore';
import type { AuthorCharacter } from '../gen/characters';
import { zoneChoices } from './treatyIv';

let owners: Owners | undefined;

type Cmd = 'policy' | 'boost' | 'protect' | 'unity' | 'keep' | 'halt' | 'ally' | 'treaty' | 'neutral' | 'declare' | 'move' | 'crown' | 'destroy' | 'disaster';

const CMDS: { k: Cmd; name: string; desc: string; pick: boolean; go?: string }[] = [
  { k: 'policy', name: '方针', desc: '这国从这年起照方针自己走，直到换下一条', pick: true, go: '选方针 ›' },
  { k: 'boost', name: '推一把发展', desc: '一段时间里发展快几倍，或直接进下一个时代', pick: true, go: '选力度 ›' },
  { k: 'protect', name: '保护', desc: '该国不会被灭亡', pick: false },
  { k: 'unity', name: '禁止分裂', desc: '该国不会分裂出新国家', pick: false },
  { k: 'keep', name: '保住王室', desc: '不改朝换代，君主不会被权臣所废', pick: false },
  { k: 'halt', name: '禁止扩张', desc: '不再主动扩张,被打时仍会夺回失地', pick: false },
  { k: 'ally', name: '结盟', desc: '选择一个国家,两国不再交战', pick: true },
  { k: 'treaty', name: '立约', desc: '和一国或几国约定若干年互不侵犯', pick: true, go: '选几国 ›' },
  { k: 'neutral', name: '划中立地', desc: '交界的一州不归任何一国，几国都不进兵', pick: true, go: '选地方 ›' },
  { k: 'declare', name: '宣战', desc: '选择一个相邻国家', pick: true },
  { k: 'move', name: '迁都', desc: '选择本国的一座城市', pick: true },
  { k: 'crown', name: '立作者的人物为君主', desc: '选一位那年在世的作者人物，从这年起当这国君主', pick: true, go: '选人 ›' },
  { k: 'destroy', name: '灭国', desc: '这年让它亡国，国土并入一国或散成无主', pick: true, go: '选去向 ›' },
  { k: 'disaster', name: '天灾', desc: '瘟疫、饥荒、地震水旱，人口锐减', pick: true, go: '选种类 ›' },
];

export function CommandPage({ civ, raster, world, id, year }: { civ: Civ; raster: Raster | null; world: World; id: number; year: number }) {
  const edits = useEdits();
  const pending = usePending();
  const phone = useNarrow();
  // 逐年推演:只在"现在"干预,生效年份固定是下一步开始的那一年(不能加减),下的令进「下一步生效的干预」
  const sw = useStepwise();
  const step = sw.on;
  // 往回看以前的一年:只能在"现在"干预,干预都变淡
  const look = useStepView().look;
  const p = civ.polities[id];
  const key = polityKey(civ, id);
  // 生效年份的范围:立国那年 … 亡国前一年(至多结束年份前一年;逐年推演的历史停在某一年年初之前,结束年份不是整数,按整年算)
  const lo = Math.ceil(p.founded);
  const last = Math.ceil(civ.endYear) - 1;
  const hi = Math.max(lo, Math.min(last, p.ended !== undefined ? Math.ceil(p.ended) - 1 : last));
  const [msg, setMsg] = useState<string | null>(null);
  // 立作者的人物为君主:选人那一页('pick')/ 选好了谁(人物编号:让他即位那一页)
  const [crown, setCrown] = useState<'pick' | number | null>(null);
  const yi = useYearInput(defaultYear(p, year), lo, hi, () => setMsg(null));
  const { era } = yi;
  const y = step ? nextYear(sw) : yi.y;
  const valid = step || yi.valid;
  /** 看国土、邻国、城用哪一年(逐年推演的下一步还没算出来:按"现在"看) */
  const yv = step ? Math.min(nextAt(sw), civ.endYear) : y;
  // 持续到:一直有效 / 到某一年(截止那年不含,所以至少是生效年份的下一年;逐年推演里没有上限)
  const [limited, setLimited] = useState(false);
  const ui = useYearInput(y + 100, step ? y + 1 : Math.min(y + 1, civ.endYear), step ? END_YEAR_MAX : civ.endYear, () => setMsg(null));
  const timed = (k: Cmd) => k === 'protect' || k === 'keep' || k === 'halt' || k === 'ally';
  const until = limited ? { until: ui.y } : {};

  const alive = polityAlive(p, y);
  const { size, near } = useMemo(() => neighborsAt(civ, id, yv), [civ, id, yv]);
  const others = useMemo(() => civ.polities.filter((q) => q.id !== id && polityAlive(q, y) && (size.get(q.id) ?? 0) > 0).map((q) => q.id), [civ, id, y, size]);
  // 划中立地:这一年有没有碰到两国以上、做得了中立地的州(按国家、年份记着,回放时不每帧重算)
  const zoneOk = useMemo(() => zoneChoices(civ, world, id, yv, 1).length > 0, [civ, world, id, yv]);
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
    if (step && look !== null) return STEP_LOOK_WHY;
    if (!valid) return `生效年份要在${spaced(yearSpanAt(lo, hi, era))}之间`;
    // 共和国没有王室(推演里本来就不改朝换代)
    if (k === 'keep' && p.lineage === 'republic') return '共和国没有王室，用不上';
    if (!alive) return y < p.founded ? `${yearAt(y, era)}还没立国` : `${yearAt(y, era)}已亡`;
    if (timed(k) && limited && !ui.valid) return `持续到的年份要在${spaced(yearSpanAt(ui.lo, ui.hi, era))}之间`;
    if ((k === 'protect' || k === 'unity' || k === 'keep' || k === 'halt') && has(k)) return '已经下过这条命令';
    if ((k === 'protect' || k === 'unity' || k === 'keep' || k === 'halt' || k === 'destroy') && queued(k)) return step ? STEP_QUEUED : '已在待推演里';
    if (k === 'ally' && !others.length) return '该年没有别的国家';
    if (k === 'treaty' && !others.length) return '该年没有别的国家';
    if (k === 'neutral' && !zoneOk) return '该年没有碰到两国以上、做得了中立地的州';
    if (k === 'declare' && !near.size) return '该年没有相邻的国家';
    if (k === 'move' && !cities.length) return '该年本国没有别的城市';
    return null;
  };

  /** 下令:先进待推演的单子;加不了 = 原因 */
  const order = (v: Intervention, target: { kind: 'polity' | 'settlement'; id: number } | null, text?: string): string | null => {
    const err = queueIntervention(v, text ?? interventionText(civ, v, -1, shown), { self: id, target, shown });
    if (!err) setMsg(null);
    return err;
  };

  const run = (k: Cmd) => {
    setMsg(null);
    if (k === 'crown') {
      setCrown('pick');
      return;
    }
    // 方针、推一把发展、灭国、天灾、立约、划中立地:卡片换成那一页(生效年份带过去,返回回到这里)
    if (k === 'policy' || k === 'boost' || k === 'destroy' || k === 'disaster' || k === 'treaty' || k === 'neutral') {
      openCmdPage({ kind: k, back: 'cmd', year: y });
      return;
    }
    if (k === 'protect' || k === 'keep' || k === 'halt') {
      // 保住王室到某一年的,单子上写起止:"大澜王朝保住王室，1525–1560 年"
      setMsg(order({ kind: k, a: key, from: y, ...until }, null, k === 'keep' && limited ? `${shown}保住王室，${yearSpanAt(y, ui.y, era)}` : undefined));
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

  const who = typeof crown === 'number' ? edits.characters?.find((c) => c.id === crown) : undefined;
  if (who)
    return <CrownPage civ={civ} raster={raster} world={world} year={y} c={who} polity={id} onBack={() => setCrown('pick')} onDone={() => setCrown(null)} />;
  if (crown !== null) return <CrownPick civ={civ} id={id} y={y} step={step} phone={phone} chars={edits.characters ?? []} onPick={setCrown} onBack={() => setCrown(null)} />;

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
              <span className="cp-note">只对保护、保住王室、禁止扩张、结盟有效。</span>
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
                {!off && <span className="cp-cmd-go">{c.go ?? (c.pick ? '选择对象 ›' : step ? '加入' : '加入待推演')}</span>}
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

/**
 * 立作者的人物为君主:选人。只列 y 那一年在世的作者人物(头像、生卒、那年几岁、身份;点了 onPick),不在世的放下面、变淡、写原因;
 * 一个都没有:写明要什么样的人物,「新建人物」直接开新建(国家填好,生年先填 y 之前 30 年)
 */
function CrownPick({
  civ,
  id,
  y,
  step,
  phone,
  chars,
  onPick,
  onBack,
}: {
  civ: Civ;
  id: number;
  y: number;
  step: boolean;
  phone: boolean;
  chars: readonly AuthorCharacter[];
  onPick: (id: number) => void;
  onBack: () => void;
}) {
  const era = useEra();
  const name = nameAt(civ.polities[id], y);
  const live = (c: AuthorCharacter) => c.born <= y && (c.died === undefined || y < c.died);
  const alive = chars.filter(live);
  const gone = chars.filter((c) => !live(c));
  const life = (c: AuthorCharacter) => (c.died !== undefined ? yearSpanAt(c.born, c.died, era) : `${yearAt(c.born, era)}生`);
  const add = () => newCharacterDraft({ polity: polityKey(civ, id), year: Math.max(0, y - 30) });
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    onBack();
  };
  return (
    <>
      <div className="cp-body" data-crown="pick" onKeyDown={onKey}>
        {step ? (
          <StepEffectTime phone={phone} />
        ) : (
          <div className="cp-from">
            <span className="cp-k">生效年份</span>
            <div className="cp-from-row">
              <span className="cp-year cr-year">{yearAt(y, era)}</span>
            </div>
          </div>
        )}
        <section className="cp-sec">
          <div className="cp-sec-head cp-events-head">
            <span>立谁为{name}君主</span>
            {alive.length > 0 && <span className="cp-num-note">只列那年在世的</span>}
          </div>
          {alive.length > 0 ? (
            <div className="oc-rows oc-people">
              {alive.map((c) => (
                <button key={c.id} className="oc-person cr-polity" data-character={c.id} onClick={() => onPick(c.id)}>
                  <CharAvatar c={c} size={26} />
                  <span className="oc-txt">
                    <b>{c.name}</b>
                    <span>
                      {life(c)}，那年 {Math.floor(y - c.born)} 岁{c.role ? `，${c.role}` : ''}
                    </span>
                  </span>
                  <span className="cr-check">›</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="cr-empty" data-crown="empty">
              <b>{yearFull(y, era)}没有在世的作者人物</b>
              新建一个人物，生年早于{spaced(yearAt(y, era))}、卒年晚于{spaced(yearAt(y, era))}（或不填），就能让他即位。
              <br />
              <button className="cp-btn primary" data-act="crown-new-character" onClick={add}>
                新建人物
              </button>
            </div>
          )}
        </section>
        {gone.length > 0 && (
          <section className="cp-sec">
            <div className="cp-sec-head">那年不在世</div>
            <div className="oc-rows oc-people cr-off">
              {gone.map((c) => (
                <div key={c.id} className="oc-person cr-polity" data-character={c.id}>
                  <CharAvatar c={c} size={26} />
                  <span className="oc-txt">
                    <b>{c.name}</b>
                    <span>
                      {life(c)}，{y < c.born ? '那年还没出生' : '那年已去世'}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
        {alive.length > 0 && <div className="cp-note cr-pick-note">点一位，接着填到哪年下台和性格（和人物卡上「即位…」是同一页）。</div>}
      </div>
      <div className={`cp-foot${alive.length ? ' mk-foot' : ''}`}>
        <button className={`cp-btn${alive.length ? '' : ' wide'}`} data-act="crown-pick-back" onClick={onBack}>
          返回
        </button>
        {alive.length > 0 && (
          <button className="cp-btn" data-act="crown-new-character" onClick={add}>
            新建人物
          </button>
        )}
      </div>
    </>
  );
}
