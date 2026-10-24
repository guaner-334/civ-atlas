/**
 * 人物卡片(和国家卡片同一套样子,零件见 panelParts.tsx):点编年史、卡片、人物页、搜索里的人名打开。
 * 地图上亮出他的国家(civView.ts 的 MapSelection、flyTo.ts 的 mapTarget);点人名不挪时间轴,按"即位那年 / 出征那年"才跳。
 *
 *   顶部  头像(Portrait.tsx:眨眼、呼吸,按那一年的事换表情;去世以后成了画像)、称呼("圣宗柳玄""阿尔德里克三世""楚尧")、"大景皇帝，2485–2519 年在位" / "大景将领，2478–2509 年领兵"
 *         / "大景丞相，2501–2537 年在朝" / "大景宗室，2428–2467"(没即位的宗室:世系图里补上的父辈)
 *   按钮  即位那年 / 出征那年 / 入仕那年(主操作:时间轴跳过去;宗室换成「世系图」)、编年史(这国的编年史,滚到他在台上那段)、
 *         复制生平(纯文字,写设定用;带上「生平」那一段)、关注他(导播只讲他这一辈子,镜头跟着他;正跟着他时是「不关注」;宗室没有,
 *         见 Follow.tsx)、更多(加一个和他有关的作者人物:亲友里先填上他)。
 *         「更多」最上面:让他去世…(那年在位的君主、将领、名臣)、改他的倾向…(那年在位的君主),点了卡片换成那一页(PersonIvPage.tsx);
 *         演一国时别国的人这两项变灰,写"切回造物主才能改别国"
 *   概况  君主:事迹(名人才有)、国家、生卒、在位、前任、继任(后面的小字是亲属,和编年史的"其子 / 其侄"同一个算法:按世系;
 *         作者立的君主:名字前面是作者人物的圆头像,小字写「作者的人物」,点了开作者的人物卡;让位给他的,结局写"让位 给某某")、
 *         父亲、子嗣(世系图里有的人,没即位的写"未即位")、结局、亲征、将领(在位时本国领兵的)、名臣(在位时在朝的);
 *         右上「世系图」打开这国的世系图,停在他那一朝、圈出他。共和国写"在任""执政",没有父亲、子嗣、世系图
 *         将领:事迹、国家、字号、籍贯、生卒、官职、历任、领兵(伐谁 / 抗谁)、效力(那几年在位的君主)、对手(同一场仗对面的统帅)、结局
 *         名臣:事迹(经手的事)、国家、字号、籍贯、生卒、官职(做到最高的那个官和任期)、历任(之前的官和年份)、效力、结局
 *         宗室:国家、生卒、父亲、子嗣
 *         (字号:西幻、汗国这类名字没有姓的不起字号,这一行不出)
 *   倾向  君主、执政官才有:开拓、好战、发展、重商一项一行(名字、灰色细条、0–100 的数值),下面一句说明;
 *         那年在位的君主右上多一个「改」(同「更多」里的改他的倾向);改过倾向的右上写"1500 年起改过",点了看原来的
 *   生平  将领、名臣的一段生平(officialText.ts 的 personBio);写到的君主是蓝字
 *   作者的人物  亲友里有他、经历里勾了他的作者人物(characterInfo.ts 的 charactersOfPerson),没有就不显示
 *   在位时 / 领兵时 / 在朝时  他在台上那几年本国的事(将领 = 他经手的那几仗),新的在上;点一条跳到那一年
 */
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import type { Civ, Person, RulerLeanings } from '../gen/civ/types';
import { polityName } from '../gen/civ/growth';
import { buildChronicle, filterChronicle, reignEntries, type ChronicleEntry } from '../gen/civ/chronicle';
import { commandFoes, peopleIndex, personFame, personSpan, rulerNeighbors, type Foe } from '../gen/civ/peopleInfo';
import { LEANING_KEYS, LEANING_TEXT, ageAt, generalRole, isConsul, kinOf, leaningsText, ministerRole, personName, princeRole, rulerFateWord, rulerRole } from '../gen/civ/peopleText';
import { deedsShort, ministerFate, personArt, personBio } from '../gen/civ/officialText';
import { fatherOf, hasLineage, kidsOf } from '../gen/civ/lineageInfo';
import { personKey } from '../gen/characters';
import { personPortrait, portraitMood } from '../gen/portrait';
import { PortraitView } from './Portrait';
import { openLineage, openOverview } from './overviewStore';
import { getEdits, useEdits, useEra } from './editsStore';
import { eraText, spaced, yearAt, yearShort, yearShortAt, yearSpan, yearSpanAt, type Era } from '../gen/era';
import { newCharacterDraft } from './characterStore';
import { charactersOfPerson } from './characterInfo';
import { CharAvatar, CharacterRefs } from './CharacterPanel';
import type { AuthorCharacter } from '../gen/characters';
import { MenuItem } from './PopMenu';
import { Icon } from './icons';
import { NameEdit } from './NameEdit';
import { FollowAct } from './Follow';
import { Act, Acts, EntryText, EventList, Link, MoreAct, PanelHead, Row, Stats, SubLine, copyText, jumpTo, rgb, type DetailProps } from './panelParts';
import { leanRows, peaceRow, policyLabel, roleLock, rulerPolicy } from './policyInfo';
import { openPolicyPage } from './PolicyPage';
import { nameAt } from './Interventions';
import { useRole } from './roleStore';
import { setSelection } from './civView';
import { PersonIvPage, type PersonIvKind } from './PersonIvPage';
import { leaningsThen, moodSince, personIvRange, rulerOnThrone } from './newIvInfo';
import './policy.css';
import './newIv.css';

/** 演一国时别国的人:干预入口变灰,写这一句 */
const ROLE_LOCK_NOTE = '切回造物主才能改别国';

const F = Math.floor;

/** 一行概况:k 名目、node 显示的、text 复制生平时的纯文字 */
interface Line {
  k: string;
  node: ReactNode;
  text: string;
}

/** 一串人名(都能点);多于 max 个只列前面的,后面写"等 N 位" */
function peopleLine(civ: Civ, list: readonly Person[], max = 6): { node: ReactNode; text: string } {
  const shown = list.slice(0, max);
  const more = list.length - shown.length;
  return {
    node: (
      <>
        {shown.map((g, i) => (
          <Fragment key={g.id}>
            {i > 0 && '、'}
            <Link to={{ kind: 'person', id: g.id }}>{personName(civ, g)}</Link>
          </Fragment>
        ))}
        {more > 0 && <em className="cp-num-note">等 {list.length} 位</em>}
      </>
    ),
    text: shown.map((g) => personName(civ, g)).join('、') + (more > 0 ? ` 等 ${list.length} 位` : ''),
  };
}

/** 子嗣:人名都能点,没即位的后面小字"未即位";多于 max 个只列前面的 */
function kidsLine(civ: Civ, list: readonly Person[], max = 6): { node: ReactNode; text: string } {
  const shown = list.slice(0, max);
  const more = list.length - shown.length;
  const note = (k: Person) => (k.role === 'prince' ? '未即位' : '');
  return {
    node: (
      <>
        {shown.map((k, i) => (
          <Fragment key={k.id}>
            {i > 0 && '、'}
            <Link to={{ kind: 'person', id: k.id }}>{personName(civ, k)}</Link>
            {note(k) && <em className="cp-num-note">{note(k)}</em>}
          </Fragment>
        ))}
        {more > 0 && <em className="cp-num-note">等 {list.length} 位</em>}
      </>
    ),
    text: shown.map((k) => personName(civ, k) + (note(k) ? `(${note(k)})` : '')).join('、') + (more > 0 ? ` 等 ${list.length} 位` : ''),
  };
}

/** 伐 / 抗哪国(国名能点)+ 年份 */
export function foesLine(civ: Civ, foes: readonly Foe[], era: Era | undefined): { node: ReactNode; text: string } {
  return {
    node: foes.map((f, i) => (
      <Fragment key={i}>
        {i > 0 && '、'}
        {f.verb}
        <Link to={{ kind: 'polity', id: f.polity }}>{polityName(civ.polities[f.polity], f.from)}</Link>
        <em className="cp-num-note">{yearSpan(f.from, f.until, era)}</em>
      </Fragment>
    )),
    text: foes.map((f) => `${f.verb}${polityName(civ.polities[f.polity], f.from)}(${yearSpan(f.from, f.until, era)})`).join('、'),
  };
}

/** 本国的纪事(战争拆成一件一件)+ 历代继位,按先后。亡国、毁城既折进战争里、又单列一条,拆开后只留一条 */
function polityEntries(civ: Civ, polity: number): ChronicleEntry[] {
  const out: ChronicleEntry[] = [];
  const seen = new Set<string>();
  const add = (e: ChronicleEntry) => {
    const k = `${e.kind}:${e.id}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(e);
  };
  for (const e of filterChronicle(buildChronicle(civ), { polity })) {
    if (e.children?.length) e.children.forEach(add);
    else add(e);
  }
  filterChronicle(reignEntries(civ), { polity }).forEach(add);
  return out.sort((a, b) => a.year - b.year || a.id - b.id);
}

export function PersonPanel({ civ, id, year }: DetailProps) {
  const x = civ.people?.[id];
  const p = x ? civ.polities[x.polity] : undefined;
  const [copied, setCopied] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const { characters: chars, era, names } = useEdits();
  const lines = useMemo(() => (x && p ? personLines(civ, x, era) : []), [civ, x, p, era]);
  const events = useMemo(() => (x && p ? personEvents(civ, x) : []), [civ, x, p]);
  const bio = useMemo(() => (x && p ? personBio(civ, x, era) : ''), [civ, x, p, era]);
  const refs = useMemo(() => charactersOfPerson(civ, chars, id, era), [civ, chars, id, era]);
  // 头像按岁数变(年份取整),去世以后定在去世那年
  const age = x ? Math.floor((x.died !== undefined ? Math.min(year, x.died) : year) - x.born) : 0;
  const portrait = useMemo(() => (x ? personPortrait(civ, x.id, x.born + age) : null), [civ, x, age]);
  const mood = useMemo(() => (x ? portraitMood(civ, x, year) : undefined), [civ, x, year]);
  // 卡片换上的填写页(让他去世 / 改他的倾向);换了人就回到卡片
  const [ivPage, setIvPage] = useState<{ id: number; kind: PersonIvKind } | null>(null);
  const role = useRole();
  if (!x || !p) return null;
  const page = ivPage?.id === id ? ivPage.kind : null;
  // 演一国时别国的人:让他去世、改倾向变灰
  const locked = !!roleLock(civ, role, x.polity);
  // 让他去世:那年在位的君主(作者立的去人物卡改卒年)、还能下的将领名臣;改倾向:那年在位的君主
  const onThrone = rulerOnThrone(x, year);
  const range = personIvRange(civ, x);
  const canDie = x.killed === undefined && (x.role === 'ruler' ? onThrone : (x.role === 'general' || x.role === 'minister') && range.lo <= range.hi);
  const ruler = x.role === 'ruler';
  const prince = x.role === 'prince';
  const minister = x.role === 'minister';
  const consul = isConsul(civ, x);
  const span = personSpan(x);
  const end = span.until ?? civ.endYear;
  const sub = prince
    ? `${princeRole(civ, x)}，${yearShort(x.born, era)}–${x.died !== undefined ? yearShort(x.died, era) : ''}`
    : ruler
      ? span.until === null
        ? `${rulerRole(civ, x)}，${yearAt(span.from, era)}${consul ? '就任' : '即位'}`
        : `${rulerRole(civ, x)}，${yearSpanAt(span.from, span.until, era)}${consul ? '在任' : '在位'}`
      : minister
        ? span.until === null
          ? `${ministerRole(civ, x)}，${yearAt(span.from, era)}起在朝`
          : `${ministerRole(civ, x)}，${yearSpanAt(span.from, span.until, era)}在朝`
        : `${generalRole(civ, x)}，${yearSpanAt(span.from, end, era)}领兵`;
  const name = personName(civ, x);
  // 改名:只改本名;前面的庙号、谥号不动(国家没了、算不出键的人不能改)
  const nameKey = personKey(civ, id);
  const fallbackName = x.defaultName ?? x.name;
  const lead = name.endsWith(x.name) ? name.slice(0, name.length - x.name.length) : '';
  const nameHint = `${lead ? `只改名字，${/[宗祖]$/.test(lead) ? '庙号' : '称号'}「${lead}」不变；` : '只改名字；'}留空 = 换回「${fallbackName}」。`;
  const head = ruler ? (consul ? '在任时' : '在位时') : minister ? '在朝时' : '领兵时';
  const lineage = () => openLineage(x.polity, { dynasty: x.dynasty ?? 0, focus: x.id });

  const copy = async () => {
    const out = [name, sub, ...lines.map((l) => `${l.k}：${l.text}`)];
    if (ruler && x.leanings) out.push(`倾向：${leaningsText(x.leanings)}`);
    if (bio) out.push('', `生平：${bio}`);
    if (events.length) out.push('', `${head}：`, ...events.map((e) => `${yearShort(e.year, era)} ${eraText(e.text.replace(/^【(?:干预|照大纲)】/, ''), era)}`));
    const text = out.join('\n');
    (window as unknown as { __wfPersonText: string }).__wfPersonText = text;
    await copyText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const headEl = (
      <PanelHead
        color={rgb(p.color)}
        icon={
          portrait && (
            <PortraitView
              p={portrait}
              size="card"
              color={rgb(p.color)}
              dead={x.died !== undefined && year > x.died}
              dark={x.fate === 'murdered' || x.fate === 'fell' || x.fate === 'battle'}
              mood={mood}
            />
          )
        }
      >
        {nameKey ? (
          <NameEdit
            k={nameKey}
            kind="person"
            shown={name}
            current={x.name}
            fallback={x.defaultName ?? x.name}
            names={names}
            big
            editing={renaming}
            onEditing={setRenaming}
            hint={nameHint}
            preview={(v) => personName(civ, { ...x, name: v })}
          />
        ) : (
          <div className="ins-name-row big">
            <span className="ins-name pp-title">{name}</span>
          </div>
        )}
        <SubLine parts={[sub]} />
      </PanelHead>
  );
  if (page)
    return (
      <div className="cp pp" data-person={id} data-pp-page={page}>
        {headEl}
        <PersonIvPage key={`${id}-${page}`} civ={civ} x={x} year={year} kind={page} onBack={() => setIvPage(null)} />
      </div>
    );

  return (
    <div className="cp pp" data-person={id}>
      {headEl}
      <Acts>
        {prince ? (
          <Act icon="lineage" primary act="person-lineage" onClick={lineage} title="看这一朝的世系图">
            世系图
          </Act>
        ) : (
          <Act icon="history" primary act="person-year" onClick={() => jumpTo(span.from)} title={`时间轴跳到${spaced(yearAt(span.from, era))}`}>
            {ruler ? (consul ? '就任那年' : '即位那年') : minister ? '入仕那年' : '出征那年'}
          </Act>
        )}
        <Act icon="scroll" act="person-chronicle" onClick={() => openOverview('chronicle', { polity: x.polity, major: false, at: end })}>
          编年史
        </Act>
        <Act icon="copy" act="person-copy" onClick={() => void copy()}>
          {copied ? '已复制' : '复制生平'}
        </Act>
        {!prince && <FollowAct civ={civ} x={x} year={year} />}
        <MoreAct>
          {canDie && (
            <MenuItem icon={<Icon name="close" size={16} className="iv-blank" />} act="person-death" disabled={locked} note={locked ? ROLE_LOCK_NOTE : undefined} onClick={() => setIvPage({ id, kind: 'death' })}>
              让他去世…
            </MenuItem>
          )}
          {onThrone && (
            <MenuItem icon={<Icon name="close" size={16} className="iv-blank" />} act="person-temper" disabled={locked} note={locked ? ROLE_LOCK_NOTE : undefined} onClick={() => setIvPage({ id, kind: 'temper' })}>
              改他的倾向…
            </MenuItem>
          )}
          {nameKey && (
            <MenuItem icon={<Icon name="rename" size={16} />} act="person-rename" onClick={() => setRenaming(true)}>
              改名
            </MenuItem>
          )}
          <MenuItem icon={<Icon name="person" size={16} />} act="person-add-character" onClick={() => newCharacterDraft({ kin: [{ rel: '', person: personKey(civ, id) }], year })}>
            加一个和他有关的人物
          </MenuItem>
        </MoreAct>
      </Acts>
      <div className="cp-body">
        <Stats
          items={[]}
          more={
            ruler &&
            hasLineage(civ, x.polity) && (
              <button className="ins-link cp-more" data-act="person-lineage" onClick={lineage}>
                世系图
              </button>
            )
          }
        >
          {lines.map((l) => (
            <Row key={l.k} k={l.k}>
              {l.node}
            </Row>
          ))}
        </Stats>
        {ruler && x.leanings && <Leanings civ={civ} x={x} l={x.leanings} year={year} onEdit={onThrone ? () => setIvPage({ id, kind: 'temper' }) : undefined} locked={locked} />}
        {bio && (
          <section className="cp-sec">
            <div className="cp-sec-head">生平</div>
            <div className="oc-note" data-bio>
              <EntryText civ={civ} e={{ text: bio, people: bioPeople(civ, x), year: span.from }} self={id} />
            </div>
          </section>
        )}
        <CharacterRefs refs={refs} />
        {!prince && (
        <EventList
          civ={civ}
          self={id}
          title={head}
          upTo={events}
          limit={12}
          empty="这几年本国无事可记"
          more={
            <button className="ins-link cp-more" data-act="person-chronicle-more" onClick={() => openOverview('chronicle', { polity: x.polity, major: false, at: end })}>
              在编年史中查看
            </button>
          }
        />
        )}
      </div>
    </div>
  );
}

/**
 * 君主的倾向:一项一行(名字、细条、数值),下面一句说明。
 * 他在位时国家定了方针(时间轴那一年,夹在他在位的年份里):右上"大澜王朝方针：扩张"(点了进那国的方针页);
 * 方针管到的那几项细条后面接一截蓝色、数写成"53＋25＝78",说明后面接"；方针「扩张」让他往外占";拧了和谈底线的多一行"和谈"
 */
function Leanings({ civ, x, l, year, onEdit, locked }: { civ: Civ; x: Person; l: RulerLeanings; year: number; onEdit?: () => void; locked: boolean }) {
  const era = useEra();
  const v = rulerPolicy(civ, x, year);
  // 改过倾向的:照时间轴那一年的(在位以前看即位时的);点"某年起改过"看原来的
  const t = Math.min(Math.max(year, x.from ?? year), (x.until ?? civ.endYear) - 1 / 256);
  const since = moodSince(x, t);
  const [orig, setOrig] = useState(false);
  const shownL = since !== null && !orig ? (leaningsThen(x, t) ?? l) : l;
  const rows = leanRows(shownL, v);
  const peace = peaceRow(v);
  const P = civ.polities[x.polity];
  const pol = v && P && (
    <button className="ins-link cp-more" data-act="person-policy" onClick={() => (locked ? setSelection({ kind: 'polity', id: x.polity }) : openPolicyPage(civ, x.polity))}>
      {nameAt(P, t)}方针：{policyLabel(v)}
    </button>
  );
  const head =
    pol || since !== null || onEdit ? (
      <span className="iv-head-acts">
        {pol}
        {since !== null && (
          <button className="ins-link cp-more" data-act="person-mood" aria-pressed={orig} onClick={() => setOrig(!orig)} title={orig ? '看改过的' : '看原来的'}>
            {orig ? '原来的（点了看改过的）' : `${yearShortAt(since, era)}起改过`}
          </button>
        )}
        {onEdit && (
          <button className="ins-link cp-more" data-act="person-temper-edit" disabled={locked} title={locked ? ROLE_LOCK_NOTE : '改他的倾向'} onClick={onEdit}>
            改
          </button>
        )}
      </span>
    ) : null;
  return (
    <section className="cp-sec" data-sec="leanings">
      <div className={`cp-sec-head${head ? ' cp-events-head' : ''}`}>
        <span>倾向</span>
        {head}
      </div>
      <div className="cp-group">
        {rows.map((r) => (
          <div key={r.k} className="pp-lean" data-leaning={r.k} data-policy-add={r.add || undefined}>
            <div className="pp-lean-top">
              <span className="pp-lean-k">{LEANING_TEXT[r.k].name}</span>
              <span className={`pp-lean-bar${r.add ? ' pol-bar' : ''}`} aria-hidden="true">
                <i style={{ width: `${r.add < 0 ? r.actual : r.base}%` }} />
                {r.add > 0 && <i className="pol-add-bar" style={{ left: `${r.base}%`, width: `${r.actual - r.base}%` }} />}
                {r.add < 0 && <i className="pol-cut-bar" style={{ left: `${r.actual}%`, width: `${r.base - r.actual}%` }} />}
              </span>
              {r.add ? (
                <span className="pp-lean-num pol-wide">
                  <span className="pol-calc">
                    {r.base}
                    {r.add > 0 ? '＋' : '−'}
                    {Math.abs(r.add)}＝<b>{r.actual}</b>
                  </span>
                </span>
              ) : (
                <span className="pp-lean-num">{r.base}</span>
              )}
            </div>
            <div className="pp-lean-note">
              {LEANING_TEXT[r.k].note}
              {r.why}
            </div>
          </div>
        ))}
        {peace && (
          <div className="pp-lean" data-leaning="peace">
            <div className="pp-lean-top">
              <span className="pp-lean-k">和谈</span>
              <span className="pol-peace">{peace}</span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/** 概况的每一行 */
function personLines(civ: Civ, x: Person, era: Era | undefined): Line[] {
  const p = civ.polities[x.polity];
  const out: Line[] = [];
  const fame = personFame(civ, x);
  const deeds = x.role === 'minister' ? deedsShort(civ, x) : (fame?.deeds ?? '');
  if (deeds) out.push({ k: '事迹', node: deeds, text: deeds });
  const span = personSpan(x);
  // 宗室(可能生在立国之前):按卒年那会儿的国名
  const pn = polityName(p, x.role === 'prince' ? Math.max(p.founded, Math.min(x.died ?? x.born, p.ended ?? civ.endYear) - 1 / 512) : span.from);
  out.push({ k: '国家', node: <Link to={{ kind: 'polity', id: p.id }}>{pn}</Link>, text: pn });
  if (x.role === 'minister' || x.role === 'general') styleLines(civ, x, out);
  if (x.died !== undefined) {
    // 享年按实际活了多久算(和编年史的"时年"一样),不是两个年份相减
    const age = ageAt(x, x.died);
    out.push({
      k: '生卒',
      node: (
        <>
          {yearSpanAt(x.born, x.died, era)}
          <em className="cp-num-note">享年 {age} 岁</em>
        </>
      ),
      text: `${yearSpanAt(x.born, x.died, era)}，享年 ${age} 岁`,
    });
  } else out.push({ k: '生卒', node: `${yearAt(x.born, era)}生`, text: `${yearAt(x.born, era)}生` });
  if (x.role === 'prince') {
    kinLines(civ, x, out);
    return out;
  }
  if (x.role === 'minister') {
    postLines(x, x.until ?? null, out, era);
    ministerLines(civ, x, out, era);
    return out;
  }
  const foes = commandFoes(civ, x);
  if (x.role === 'ruler') rulerLines(civ, x, out, foes, era);
  else {
    const cs = x.commands ?? [];
    if (cs.length) postLines(x, cs[cs.length - 1].until, out, era);
    generalLines(civ, x, out, foes, era);
  }
  return out;
}

/** 字号、籍贯(名臣、将领;没有字号的语感不出「字号」这一行) */
function styleLines(civ: Civ, x: Person, out: Line[]) {
  const art = personArt(civ, x);
  const style = [x.courtesy ? `字${x.courtesy}` : '', art ? `号${art}` : ''].filter(Boolean).join('，');
  if (style) out.push({ k: '字号', node: style, text: style });
  const home = x.home !== undefined ? civ.settlements[x.home] : undefined;
  if (home?.name) out.push({ k: '籍贯', node: <Link to={{ kind: 'settlement', id: home.id }}>{home.name}</Link>, text: home.name });
}

/** 官职(做到最高的那个官 + 任期)、历任(之前的官 + 那年);until = 去职 / 最后一次卸任(还在任 = null) */
function postLines(x: Person, until: number | null, out: Line[], era: Era | undefined) {
  const ps = x.posts ?? [];
  const top = ps[ps.length - 1];
  if (!top) return;
  const years = until !== null ? yearSpanAt(top.from, until, era) : `${yearAt(top.from, era)}起`;
  out.push({
    k: '官职',
    node: (
      <>
        {top.title}
        <em className="cp-num-note">{years}</em>
      </>
    ),
    text: `${top.title}(${years})`,
  });
  const before = ps.slice(0, -1);
  if (before.length)
    out.push({
      k: '历任',
      node: before.map((post, i) => (
        <Fragment key={i}>
          {i > 0 && '、'}
          {post.title}
          <em className="cp-num-note">{yearShort(post.from, era)}</em>
        </Fragment>
      )),
      text: before.map((post) => `${post.title}(${yearShort(post.from, era)})`).join('、'),
    });
}

/** 名臣:效力(在朝那几年在位的本国君主)、结局 */
function ministerLines(civ: Civ, x: Person, out: Line[], era: Era | undefined) {
  const from = x.from ?? x.born;
  const until = x.until ?? civ.endYear;
  const served = peopleIndex(civ).rulers[x.polity].filter((r) => (r.from ?? Infinity) < until && (r.until ?? Infinity) > from);
  if (served.length) out.push({ k: '效力', ...peopleLine(civ, served) });
  const fate = x.killed !== undefined && x.died !== undefined ? `${yearAt(x.died, era)}卒（干预）` : ministerFate(civ, x, era);
  if (fate) out.push({ k: '结局', node: fate, text: fate });
}

/** 生平里写到的人:经手的事里的君主,迎立的那件还有遇弑的先君 */
function bioPeople(civ: Civ, x: Person): number[] {
  const out: number[] = [];
  for (const d of x.deeds ?? []) {
    const r = d.person !== undefined ? civ.people?.[d.person] : undefined;
    if (!r) continue;
    out.push(r.id);
    if (d.kind === 'enthrone') {
      const prev = rulerNeighbors(civ, r).prev;
      if (prev) out.push(prev.id);
    }
  }
  return [...new Set(out)];
}

/** 父亲、子嗣(世系图里有的人;没即位的小字"未即位") */
function kinLines(civ: Civ, x: Person, out: Line[]) {
  const f = fatherOf(civ, x);
  if (f) out.push(personRow('父亲', civ, f, f.role === 'prince' ? '未即位' : ''));
  const ks = kidsOf(civ, x);
  if (ks.length) out.push({ k: '子嗣', ...kidsLine(civ, ks) });
}

function rulerLines(civ: Civ, x: Person, out: Line[], foes: Foe[], era: Era | undefined) {
  const consul = isConsul(civ, x);
  const from = x.from ?? x.born;
  if (x.until !== undefined) {
    const n = F(x.until) - F(from);
    const len = n >= 1 ? `${n} 年` : '不足一年';
    out.push({
      k: consul ? '在任' : '在位',
      node: (
        <>
          {yearSpanAt(from, x.until, era)}
          <em className="cp-num-note">{len}</em>
        </>
      ),
      text: `${yearSpanAt(from, x.until, era)}，${len}`,
    });
  } else {
    const t = consul ? `${yearAt(from, era)}就任，在任至今` : `${yearAt(from, era)}即位，在位至今`;
    out.push({ k: consul ? '在任' : '在位', node: t, text: t });
  }
  const { prev, next } = rulerNeighbors(civ, x);
  // 亲属:同一朝、继位的才写(和编年史的"其子 / 其侄"一致,连不上的是"宗室");换了朝代写"前朝 / 新朝";作者立的君主写"作者的人物"
  const sameDyn = (a: Person, b: Person) => (a.dynasty ?? 0) === (b.dynasty ?? 0);
  if (prev) {
    const ac = authorOf(prev);
    const note = ac ? '作者的人物' : consul ? '' : !sameDyn(prev, x) ? '前朝' : x.rise === 'heir' ? kinOf(civ, x, prev) || '宗室' : '';
    out.push(personRow('前任', civ, prev, note, ac));
  }
  if (next) {
    const ac = authorOf(next);
    const note = ac ? '作者的人物' : consul ? '' : !sameDyn(x, next) ? '新朝' : next.rise === 'heir' ? kinOf(civ, x, next) || '宗室' : '';
    out.push(personRow('继任', civ, next, note, ac));
  }
  if (!consul) kinLines(civ, x, out);
  const fate = rulerFateWord(civ, x);
  if (x.killed !== undefined && x.died !== undefined) {
    const t = `${yearAt(x.died, era)}去世（干预）`;
    out.push({ k: '结局', node: t, text: t });
  } else if (fate && x.fate === 'yielded' && next) {
    // 让位给作者立的君主:后面写给谁
    const to = `给${personName(civ, next)}`;
    out.push({ k: '结局', node: <>{fate}<em className="cp-num-note">{to}</em></>, text: fate + to });
  } else if (fate) {
    // 失位以后又活了些年(被废、出奔……)的,写上卒年
    const later = x.died !== undefined && x.until !== undefined && x.died - x.until >= 1 ? `，${yearAt(x.died, era)}卒` : '';
    out.push({ k: '结局', node: fate + later, text: fate + later });
  }
  if (foes.length) out.push({ k: consul ? '领兵' : '亲征', ...foesLine(civ, foes, era) });
  // 在位时本国领兵的将领
  const until = x.until ?? civ.endYear;
  const gens = peopleIndex(civ).generals[x.polity].filter((g) => (g.commands ?? []).some((c) => c.until > from && c.from < until));
  if (gens.length) out.push({ k: '将领', ...peopleLine(civ, gens) });
  // 在位时在朝的名臣
  const mins = peopleIndex(civ).ministers[x.polity].filter((m) => m.from! < until && (m.until ?? Infinity) > from);
  if (mins.length) out.push({ k: '名臣', ...peopleLine(civ, mins) });
}

function generalLines(civ: Civ, x: Person, out: Line[], foes: Foe[], era: Era | undefined) {
  const cs = x.commands ?? [];
  if (foes.length) out.push({ k: '领兵', ...foesLine(civ, foes, era) });
  // 效力:他领兵那几年在位的本国君主
  const ix = peopleIndex(civ);
  const served = ix.rulers[x.polity].filter((r) => cs.some((c) => (r.from ?? Infinity) < c.until && (r.until ?? Infinity) > c.from));
  if (served.length) out.push({ k: '效力', ...peopleLine(civ, served) });
  // 对手:同一场仗、同一段时间对面的统帅(君主亲征的也算)
  const foesP: Person[] = [];
  for (const o of civ.people ?? []) {
    if (o.id === x.id || o.polity === x.polity || !o.commands) continue;
    if (o.commands.some((oc) => cs.some((c) => c.war === oc.war && oc.side !== c.side && oc.until > c.from && oc.from < c.until))) foesP.push(o);
  }
  if (foesP.length) out.push({ k: '对手', ...peopleLine(civ, foesP) });
  const last = cs.length ? cs[cs.length - 1].until : x.born;
  let fate = '';
  if (x.killed !== undefined && x.died !== undefined) fate = `${yearAt(x.died, era)}卒（干预）`;
  else if (x.fate === 'battle') fate = x.died !== undefined ? `战死，${yearAt(x.died, era)}` : '战死';
  else if (x.died !== undefined) fate = x.died - last >= 1 ? `卸甲，${yearAt(x.died, era)}卒` : `${yearAt(x.died, era)}卒于军中`;
  if (fate) out.push({ k: '结局', node: fate, text: fate });
}

/** 推演里作者立的君主:作者的人物卡(删掉了 = null) */
function authorOf(p: Person): AuthorCharacter | null {
  return p.author !== undefined ? (getEdits().characters?.find((c) => c.id === p.author) ?? null) : null;
}

/** 前任 / 继任:人名能点,后面小字写亲属;ac = 作者立的君主,名字前面放他的圆头像 */
function personRow(k: string, civ: Civ, y: Person, note: string, ac?: AuthorCharacter | null): Line {
  const n = personName(civ, y);
  return {
    k,
    node: (
      <>
        {ac && <CharAvatar c={ac} size={18} cls="cr-av" />}
        <Link to={{ kind: 'person', id: y.id }}>{n}</Link>
        {note && <em className="cp-num-note">{note}</em>}
      </>
    ),
    text: note ? `${n}(${note})` : n,
  };
}

/** 在位时 / 在朝时 / 领兵时的事(按先后) */
export function personEvents(civ: Civ, x: Person): ChronicleEntry[] {
  const all = polityEntries(civ, x.polity);
  const eps = 1e-6;
  if (x.role === 'ruler' || x.role === 'minister') {
    const from = x.from ?? x.born;
    const until = x.until ?? civ.endYear;
    return all.filter((e) => e.year >= from - eps && e.year <= until + eps);
  }
  // 将领:他经手的那几件(宣战、战役、攻占:史事下标在他任期的第一件到最后一件之间)
  const cs = x.commands ?? [];
  const mine = all.filter((e) => e.kind !== 'reign' && cs.some((c) => e.id >= c.first && e.id <= c.last && civ.annals[e.id]?.war === c.war));
  if (mine.length) return mine;
  return all.filter((e) => e.kind !== 'reign' && cs.some((c) => e.year >= c.from - eps && e.year <= c.until + eps));
}
