/**
 * 国家面板的干预页:生效年份(−100 −10 [年份] +10,默认 = 时间轴当前那一年)+ 持续到 + 方针 + 六条命令。
 *
 *   持续到  一直有效 | 到某一年(−100 −10 [年份] +10 +100,默认 = 生效年份 + 100);只管保护、保住王室、禁止扩张、结盟,到这一年止(不含)
 *
 *   加入待推演  保护(不会被灭亡)、禁止分裂、保住王室(不改朝换代、不被篡位;那年是共和国 / 军政府的变淡,"共和国没有王室",按那一年的政体、复辟以后照君主国)、禁止扩张
 *   选择对象  结盟(任意国家)、宣战(仅相邻、那年没在交战的国家)、迁都(本国城市)→ 在地图上选(地图压暗、可选的对象浮出名牌,见 TargetPlates.tsx)
 *
 * 不可用的命令变淡,说明换成原因。下的令先进待推演的单子(pendingStore.ts,单子在时间轴上面,PendingTray.tsx),已经在单子里的变淡、写"已在待推演里";
 * 单子里有令时底部多一个「全部推演(N 条)」。推演时面板先藏起,顶部提示条"正在重新推演 X–3000 年",推完"有鹰王朝禁止扩张,已从 X 年起重新推演"带撤销,
 * 面板回到信息页,从 X 年接着放(App.tsx、TargetPlates.tsx)。命令的数据和推演沿用 editsStore / gen/edits 的干预。
 *
 * 最上面一条「方针」(选方针 ›):卡片换成方针那一页(PolicyPage.tsx),生效年份带过去。
 * 它下面「推一把发展」(选力度 ›):卡片换成推一把那一页(BoostPage.tsx),生效年份带过去。
 *
 * 最后一条「立作者的人物为君主」(选人 ›):卡片换成选人那一页 —— 只列那一年在世的作者人物(头像、生卒、那年几岁、身份),不在世的放下面、变淡、
 * 写原因;点一位进让他即位那一页(CrownPage.tsx,和人物卡「进推演…」里当君主同一页,国家先选好、年份是这里的生效年份);一个都没有时写明要什么样的人物、
 * 「新建人物」直接开新建(国家填好)。
 *
 * 它下面「任作者的人物为将」「任作者的人物为臣」「让作者的人物掌权」(选人 ›):同一张选人页,点一位进当将领 / 当名臣 / 掌权那一页
 * (AuthorIvPages.tsx,和人物卡「进推演…」里是同一页),国家先选好、年份是这里的生效年份;那年是共和国 / 军政府的「让作者的人物掌权」变淡("没有君主可架空")。
 *
 * 「宣战」(选择对象 ›):地图上点好对象以后,那年有在世(满 16 岁)的作者人物才多一页「谁挂帅」—— 宣战(对象一行、「换一国」)、
 * 谁挂帅(照推演派 | 一位一行:头像、名字、那年几岁、身份、是不是这国的将领;默认照推演派)、一句说明,底部 返回 / 加入待推演。
 * 选了作者的人物:宣战带 lead = 他;他那年还不是这国将领的,同时任他为将(到卒年、能力寻常),单子里多一条(先任将、再宣战)。
 * 一个作者人物都没有时和以前一样,点好对象直接加进单子。
 *
 * 人物卡「一生」一段经历进推演选了结盟、迁都(lifeIv.ts):打开这一页就在地图上选对象,页顶「照这段经历填好了」,这时候下的那一条记在他名下。
 *
 * 「灭国」(选去向 ›):卡片换成灭国那一页(DestroyPage.tsx),生效年份带过去。
 * 「立约」(选几国 ›)、「划中立地」(选地方 ›):卡片换成立约 / 划中立地那一页(TreatyPage.tsx),生效年份带过去。
 * 「天灾」(选种类 ›):卡片换成天灾那一页(DisasterPage.tsx,州卡片「更多」里也能进),生效年份带过去。
 * 「大迁徙」(选民族 ›):卡片换成大迁徙那一页(TrekPage.tsx,州卡片「更多」里也能进;默认这国的主体民族),生效年份带过去。
 *
 * 逐年推演(Stepwise.tsx):只在"现在"干预 —— 生效年份换成"第 N 年年初(下一步)"一块,不能加减;按钮写「加入」,
 * 加的进「下一步生效的干预」(同一个单子),下一步开始时一起生效,没有「全部推演」;单子里有的写"已在下一步生效的干预里"。
 * 手机底部多一行"已加几条干预"(点开看每一条,能删)和「接着演绎」。往回看以前的一年时干预都变淡(从那一年改要先「从这里重新演绎」)。
 */
import { useEffect, useMemo, useState } from 'react';
import type { Civ } from '../gen/civ/types';
import type { Raster } from '../gen/raster';
import type { World } from '../gen/world';
import { capitalAt, polityAlive, populationAt } from '../gen/civ/growth';
import { ownersAt, type Owners } from '../gen/civ/timeline';
import { regimeAt, royalAt } from '../gen/civ/regime';
import { END_YEAR_MAX, cleanPlay, playInterventions, polityKey, settlementKey, type Intervention, type InterventionKind } from '../gen/edits';
import { useNarrow } from './device';
import { nextAt, nextYear, useStepwise } from './stepwiseStore';
import { STEP_LOOK_WHY, STEP_QUEUED, StepCommandFoot, StepEffectTime, useStepView } from './Stepwise';
import { useEdits, useEra } from './editsStore';
import { cityStands, declareTargets, defaultYear, interventionText, nameAt, neighborsAt, polityOrders, setPolityPick, type PolityPick } from './Interventions';
import { openCmdPage, setPanelTab } from './panelStore';
import { getPending, pendingInterventions, pushPending, queueIntervention, removePending, usePending } from './pendingStore';
import { setCivTime } from './civView';
import { YearRow, YearStepper, useYearInput } from './panelParts';
import { spaced, yearAt, yearFull, yearSpanAt } from '../gen/era';
import { CrownPage } from './CrownPage';
import { AuthorRegentPage, GeneralPage, MinisterPage, type AuthorIvRole } from './AuthorIvPages';
import { characterPosts, holdsPost, leadOrders, overlapWhy, postLine } from './authorIvInfo';
import { keepWhy } from './keepInfo';
import { heOrShe } from '../gen/civ/gender';
import { NationLifeHead } from './LifeHead';
import { getLifeTag, lifeTagFor } from './lifeTag';
import { CharAvatar } from './CharacterPanel';
import { newCharacterDraft } from './characterStore';
import type { AuthorCharacter } from '../gen/characters';
import { zoneChoices } from './treatyIv';

let owners: Owners | undefined;

type Cmd = 'policy' | 'boost' | 'protect' | 'unity' | 'keep' | 'halt' | 'ally' | 'treaty' | 'neutral' | 'declare' | 'move' | AuthorIvRole | 'destroy' | 'disaster' | 'trek';

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
  { k: 'declare', name: '宣战', desc: '选择一个相邻国家，可派作者的人物挂帅', pick: true },
  { k: 'move', name: '迁都', desc: '选择本国的一座城市', pick: true },
  { k: 'crown', name: '立作者的人物为君主', desc: '选一位那年在世的作者人物，从这年起当这国君主', pick: true, go: '选人 ›' },
  { k: 'general', name: '任作者的人物为将', desc: '选一位那年在世的作者人物，从这年起当这国将领', pick: true, go: '选人 ›' },
  { k: 'minister', name: '任作者的人物为臣', desc: '选一位，入朝当名臣，朝中的事他也经手', pick: true, go: '选人 ›' },
  { k: 'regent', name: '让作者的人物掌权', desc: '选一位，名义上的君主照旧在位，政出于他', pick: true, go: '选人 ›' },
  { k: 'destroy', name: '灭国', desc: '这年让它亡国，国土并入一国或散成无主', pick: true, go: '选去向 ›' },
  { k: 'disaster', name: '天灾', desc: '瘟疫、饥荒、地震水旱，人口锐减', pick: true, go: '选种类 ›' },
  { k: 'trek', name: '大迁徙', desc: '让国内一族分出一支远走、到别处立国，或不许它迁', pick: true, go: '选民族 ›' },
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
  // 立作者的人物为君主、任为将 / 臣、让他掌权:选人那一页(id = null)/ 选好了谁(人物编号:那一页)
  const [who, setWho] = useState<{ role: AuthorIvRole; id: number | null } | null>(null);
  // 宣战:地图上点好的对象(那年有在世的作者人物时多一页「谁挂帅」)
  const [lead, setLead] = useState<number | null>(null);
  // 人物卡一段经历进推演选了结盟、迁都:开着这一页就在地图上选(年份照那段经历)
  const [life] = useState(() => lifeTagFor(getLifeTag(), ['ally', 'move'], { polity: id }));
  const yi = useYearInput(life ? Math.min(hi, Math.max(lo, life.year)) : defaultYear(p, year), lo, hi, () => setMsg(null));
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

  const alive = polityAlive(p, yv);
  const noKeep = keepWhy(p, yv);
  const { size, near } = useMemo(() => neighborsAt(civ, id, yv), [civ, id, yv]);
  // 宣战打得成的:接壤、那年没和本国在交战的(已在交战的推演里那条宣战跳过)
  const { open: canDeclare, foes } = useMemo(() => declareTargets(civ, id, yv, near), [civ, id, yv, near]);
  const others = useMemo(() => civ.polities.filter((q) => q.id !== id && polityAlive(q, yv) && (size.get(q.id) ?? 0) > 0).map((q) => q.id), [civ, id, yv, size]);
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
    orders.some(({ v }) => v.kind === kind && 'a' in v && v.a === key && !('until' in v && v.until !== undefined && y >= v.until));
  // 待推演的单子里有本国同一种命令
  const queued = (kind: InterventionKind) => pendingInterventions(pending).some((v) => v.kind === kind && 'a' in v && v.a === key);
  const name = nameAt(p, y);
  // 宣战选谁挂帅:那年在世、满 16 岁的作者人物
  const leaders = useMemo(() => (edits.characters ?? []).filter((c) => c.born + 16 <= y && (c.died === undefined || y < c.died)), [edits.characters, y]);
  /** 面板标题上的名字(时间轴当前那一年的) */
  const shown = nameAt(p, year);

  /** 这一条命令为什么用不了(能用 = null) */
  const why = (k: Cmd): string | null => {
    if (step && look !== null) return STEP_LOOK_WHY;
    if (!valid) return `生效年份要在${spaced(yearSpanAt(lo, hi, era))}之间`;
    // 那年是共和国 / 军政府的没有王室(推演里本来就不改朝换代);复辟以后照君主国
    if (k === 'keep' && noKeep) return noKeep;
    if (k === 'regent' && !royalAt(p, yv)) return `${regimeAt(p, yv) === 'junta' ? '军政府' : '共和国'}没有君主可架空`;
    if (!alive) return yv < p.founded ? `${yearAt(y, era)}还没立国` : `${yearAt(y, era)}已亡`;
    if (timed(k) && limited && !ui.valid) return `持续到的年份要在${spaced(yearSpanAt(ui.lo, ui.hi, era))}之间`;
    if ((k === 'protect' || k === 'unity' || k === 'keep' || k === 'halt') && has(k)) return '已经下过这条命令';
    if ((k === 'protect' || k === 'unity' || k === 'keep' || k === 'halt' || k === 'destroy') && queued(k)) return step ? STEP_QUEUED : '已在待推演里';
    if (k === 'ally' && !others.length) return '该年没有别的国家';
    if (k === 'treaty' && !others.length) return '该年没有别的国家';
    if (k === 'neutral' && !zoneOk) return '该年没有碰到两国以上、做得了中立地的州';
    if (k === 'declare' && !near.size) return '该年没有相邻的国家';
    if (k === 'declare' && !canDeclare.size) return '该年相邻的国家都已在交战';
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
    if (k === 'crown' || k === 'general' || k === 'minister' || k === 'regent') {
      setWho({ role: k, id: null });
      return;
    }
    // 方针、推一把发展、灭国、天灾、大迁徙、立约、划中立地:卡片换成那一页(生效年份带过去,返回回到这里)
    if (k === 'policy' || k === 'boost' || k === 'destroy' || k === 'disaster' || k === 'trek' || k === 'treaty' || k === 'neutral') {
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
      const ok = new Set(k === 'ally' ? others : canDeclare);
      pk = {
        ...base,
        prompt: k === 'ally' ? `选择与${name}结盟的国家` : `选择${name}要宣战的国家`,
        eligible: ok,
        accept: (q) => {
          if (q === id) return '要选另一个国家';
          const Q = civ.polities[q];
          if (!Q || !polityAlive(Q, yv) || !(size.get(q)! > 0)) return `${yearAt(y, era)}${Q ? nameAt(Q, y) : '这个国家'}不在`;
          if (k === 'declare' && !near.has(q)) return '两国不接壤,无法宣战';
          if (k === 'declare' && foes.has(q)) return '两国已在交战,无法宣战';
          // 那年有在世的作者人物:先选谁挂帅
          if (k === 'declare' && leaders.length) {
            setLead(q);
            return null;
          }
          const b = polityKey(civ, q);
          return order(k === 'ally' ? { kind: k, a: key, b, from: y, ...until } : { kind: k, a: key, b, from: y }, { kind: 'polity', id: q });
        },
      };
    }
    // 地图停在生效那一年:看到的国界、可选的对象和命令用的是同一年(逐年推演:停在"现在")
    setCivTime({ year: step ? Math.min(y, sw.now) : y, playing: false, scrubbing: false, story: false });
    setPolityPick(pk);
  };

  // 一段经历进推演选了结盟、迁都:打开就在地图上选(用不了的照旧写原因)
  useEffect(() => {
    if ((life?.kind === 'ally' || life?.kind === 'move') && !why(life.kind)) run(life.kind);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [life]);

  const picked = who?.id != null ? edits.characters?.find((c) => c.id === who.id) : undefined;
  if (who && picked) {
    const props = { civ, raster, world, year: y, c: picked, polity: id, from: y, onBack: () => setWho({ role: who.role, id: null }), onDone: () => setWho(null) };
    return who.role === 'crown' ? (
      <CrownPage {...props} />
    ) : who.role === 'general' ? (
      <GeneralPage {...props} />
    ) : who.role === 'minister' ? (
      <MinisterPage {...props} />
    ) : (
      <AuthorRegentPage {...props} />
    );
  }
  if (who)
    return (
      <AuthorPick
        civ={civ}
        id={id}
        y={y}
        role={who.role}
        step={step}
        phone={phone}
        chars={edits.characters ?? []}
        onPick={(c) => setWho({ role: who.role, id: c })}
        onBack={() => setWho(null)}
      />
    );
  if (lead !== null)
    return (
      <LeadPage
        civ={civ}
        id={id}
        y={y}
        yv={yv}
        target={lead}
        regions={size.get(lead) ?? 0}
        chars={leaders}
        step={step}
        onRetarget={() => (setLead(null), run('declare'))}
        onBack={() => setLead(null)}
        onDone={() => setLead(null)}
      />
    );

  return (
    <>
      <div className="cp-body">
        <NationLifeHead kinds={['ally', 'move']} polity={id} />
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

/** 选人页上几种的说法:标题、点一位以后填什么、新建人物以后能做什么 */
const PICK_TEXT: Record<AuthorIvRole, { head: (A: string) => string; next: string; can: string }> = {
  crown: { head: (A) => `立谁为${A}君主`, next: '点一位，接着填到哪年下台和性格（和人物卡上「进推演…」里当君主是同一页）。', can: '就能让他即位' },
  general: { head: (A) => `任谁为${A}将领`, next: '点一位，接着填到哪年卸任、能力（和人物卡上「进推演…」里当将领是同一页）。', can: '就能任他为将' },
  minister: { head: (A) => `任谁为${A}名臣`, next: '点一位，接着填到哪年去职（和人物卡上「进推演…」里当名臣是同一页）。', can: '就能让他入朝' },
  regent: { head: (A) => `让谁掌${A}国政`, next: '点一位，接着填怎么掌权、几年后还政（和人物卡上「进推演…」里掌权是同一页）。', can: '就能让他掌权' },
};

/**
 * 立作者的人物为君主、任为将 / 臣、让他掌权:选人。只列 y 那一年在世的作者人物(头像、生卒、那年几岁、身份;点了 onPick),不在世的放下面、变淡、写原因;
 * 一个都没有:写明要什么样的人物,「新建人物」直接开新建(国家填好,生年先填 y 之前 30 年)
 */
function AuthorPick({
  civ,
  id,
  y,
  role,
  step,
  phone,
  chars,
  onPick,
  onBack,
}: {
  civ: Civ;
  id: number;
  y: number;
  role: AuthorIvRole;
  step: boolean;
  phone: boolean;
  chars: readonly AuthorCharacter[];
  onPick: (id: number) => void;
  onBack: () => void;
}) {
  const era = useEra();
  const name = nameAt(civ.polities[id], y);
  const T = PICK_TEXT[role];
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
      <div className="cp-body" data-crown="pick" data-author-pick={role} onKeyDown={onKey}>
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
            <span>{T.head(name)}</span>
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
              新建一个人物，生年早于{spaced(yearAt(y, era))}、卒年晚于{spaced(yearAt(y, era))}（或不填），{T.can}。
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
        {alive.length > 0 && <div className="cp-note cr-pick-note">{T.next}</div>}
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

/**
 * 宣战选谁挂帅(地图上点好对象以后;那年有在世、满 16 岁的作者人物才有这一页):宣战(对象一行、「换一国」、一句"2421 年，大衍王朝向后东定国宣战。")、
 * 谁挂帅(照推演派 | 作者的人物一位一行;默认照推演派)、一句说明;底部 返回 / 加入待推演。
 * 选了作者的人物:他那年还不是这国将领的,先任他为将(到卒年、能力寻常),再宣战点他挂帅(单子里两条)
 */
function LeadPage({
  civ,
  id,
  y,
  yv,
  target,
  regions,
  chars,
  step,
  onRetarget,
  onBack,
  onDone,
}: {
  civ: Civ;
  id: number;
  y: number;
  yv: number;
  target: number;
  regions: number;
  chars: readonly AuthorCharacter[];
  step: boolean;
  onRetarget: () => void;
  onBack: () => void;
  onDone: () => void;
}) {
  const era = useEra();
  const pending = usePending();
  const ivs = useEdits().interventions;
  const [pick, setPick] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const P = civ.polities[id];
  const Q = civ.polities[target];
  const A = nameAt(P, y);
  // 那年已是这国将领的(推过生效了的、单子里更早下的)
  const general = useMemo(() => {
    const out = new Set<number>();
    for (const c of chars) if (holdsPost(civ, characterPosts(civ, c.id, pending, ivs, step, era), 'general', id, y, yv)) out.add(c.id);
    return out;
  }, [civ, chars, pending, ivs, step, era, id, y, yv]);
  const key = polityKey(civ, id);
  const go = () => {
    const run = { self: id, target: { kind: 'polity' as const, id: target }, shown: A };
    const c = pick !== null ? (chars.find((x) => x.id === pick) ?? null) : null;
    const { appoint, declare: d } = leadOrders(key, polityKey(civ, target), y, c, !!c && general.has(c.id));
    let appointed = false;
    if (c && appoint) {
      // 同一时刻只有一个身份:那年他掌着别国的权就拦下
      const ov = overlapWhy(civ, characterPosts(civ, c.id, pending, ivs, step, era), 'general', id, y, yv, heOrShe(c), era);
      if (ov) return setMsg(ov);
      const err = queueIntervention(appoint, postLine(c.name, A, appoint, era), { self: id, target: null, shown: A });
      if (err) return setMsg(err);
      appointed = true;
    }
    const err = queueIntervention(d, interventionText(civ, d, -1, A), run);
    if (err) {
      // 宣战那条加不上:任将那条也拿掉
      const last = getPending().at(-1);
      if (appointed && last?.kind === 'iv' && last.v.kind === 'appoint') removePending(last.id);
      return setMsg(err);
    }
    onDone();
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    onBack();
  };
  const radio = (on: boolean) => <i className={`as-radio${on ? ' on' : ''}`} />;
  return (
    <>
      <div className="cp-body cr-form" data-lead="page" onKeyDown={onKey}>
        <div className="cp-form">
          <span className="cp-form-title">宣战</span>
          <div className="oc-pick cr-pick" data-lead="target">
            <span className="oc-pick-name">
              <i className="cr-dot" style={{ background: `rgb(${Q.color.join(',')})` }} />
              {nameAt(Q, y)}
              {regions > 0 && <em>{regions} 州</em>}
            </span>
            <span className="oc-pick-acts">
              <button className="cp-step" data-act="lead-retarget" onClick={onRetarget}>
                换一国
              </button>
            </span>
          </div>
          <span className="cp-note">
            {yearAt(y, era)}，{A}向{nameAt(Q, y)}宣战。
          </span>
        </div>
        <section className="cp-sec" data-lead="who">
          <div className="cp-sec-head cp-events-head">
            <span>谁挂帅</span>
            <span className="cp-num-note">作者的人物只列那年在世的</span>
          </div>
          <div className="oc-rows oc-people">
            <button className="oc-person cr-polity" role="radio" aria-checked={pick === null} data-lead-pick="sim" onClick={() => (setPick(null), setMsg(null))}>
              {radio(pick === null)}
              <span className="oc-txt">
                <span>照推演派</span>
                <span>推演里的将领（看谁闲着；好战的君主有时亲征）</span>
              </span>
            </button>
            {chars.map((c) => (
              <button key={c.id} className="oc-person cr-polity" role="radio" aria-checked={pick === c.id} data-lead-pick={c.id} onClick={() => (setPick(c.id), setMsg(null))}>
                {radio(pick === c.id)}
                <CharAvatar c={c} size={34} />
                <span className="oc-txt">
                  <span>{c.name}</span>
                  <span>
                    {Math.floor(y - c.born)} 岁{c.role ? `，${c.role}` : ''}；{general.has(c.id) ? '已是将领' : '还不是将领'}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </section>
        <div className="cp-note cr-pick-note">选了作者的人物：这一仗他挂帅，推演原来派的将领写成副将。他还不是这国将领的，同时任他为将（到卒年，能力寻常），单子里多一条。</div>
        {msg && <div className="cp-msg">{msg}</div>}
      </div>
      <div className="cp-foot mk-foot">
        <button className="cp-btn" data-act="lead-back" onClick={onBack}>
          返回
        </button>
        <button className="cp-btn primary" data-act="lead-go" onClick={go}>
          {step ? '加入' : pick !== null && !general.has(pick) ? '加入待推演（2 条）' : '加入待推演'}
        </button>
      </div>
    </>
  );
}
