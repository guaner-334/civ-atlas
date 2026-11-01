/**
 * 调规则的大卡:一套规则的 70 项和地貌的叫法。和世界概览同一种大卡(四周留 24px、浅灰底、白色分组行;手机铺满整屏)。
 * 开着哪一套见 sheetStore.ts。
 *
 * 电脑(像常见的设置页):
 *   顶上    名字、改名;基于谁、第几版、用它建过几个世界、「改了以后，已经建好的世界不变」;分享(复制链接)、「···」(复制一份、存成文件、删除)、关闭
 *   左边    搜规则、只看改过的(改了几项)、七组(组名后面改了几项)、地貌的名字
 *   右边    一组:常用的直接列,其余收在「更多 N 项」里(点开 / 收起);一项一行(名字、一句说明、滑条、值、改回)
 *           只看改过的:按组列,逐项改回、「全部改回官方」(只改回规则项,地貌的名字不动;能撤销);一项都没改时说一句
 *           地貌的名字:十六种各一个输入框,官方的叫法当占位字
 *           搜规则:名字、说明里有这几个字的项按组列,地貌的名字里有的也列上;搜不到说一句
 *   底下    改了几项、存成文件
 * 手机(学手机的设置):先是分组列表(右边改了几项),点进一组是一项一块;顶上「‹」回到上一层,最上一层回到「我的世界」。
 *
 * 四种:
 *   我的规则里的    能改,改了就存(没有保存按钮;被世界用过的那一版再改就是新的一版,见 rulesStore.ts)
 *   官方规则        只能看,底下「复制一份改」
 *   别人分享的      链接、规则文件打开的:只能看,顶上一条说谁分享的、改了几项,「加进我的规则」以后才能改(出处一直写着);
 *                   「用它新建世界」= 加进我的规则,同时进新建世界、规则选好这一套
 *   一个世界用的    世界设定里点开的:只能看世界里存的那一版(自包含,和本机「我的规则」里的那一套怎么改都无关);
 *                   本机「我的规则」里同一套已是更新的一版时,顶上一条说已是第几版,能「用第 N 版另存一份重推」(原来的世界不动)
 *
 * 关闭:右上角的关闭 / Esc / 点大卡外面(手机上点左上的返回)。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../icons';
import { useNarrow } from '../device';
import { notify } from '../saveStore';
import { decodeRulesHash, parseRulesFile } from '../../gen/civ/ruleShare';
import { BIOMES, type Biome } from '../../gen/biomes';
import { RULES_NAME_MAX, biomeKey, ruleNotesLine, type RuleSet } from '../../gen/civ/ruleSet';
import { OFFICIAL_RULES_NAME, basedOnText } from '../../gen/civ/ruleSetEdit';
import { TUNING_GROUPS } from '../../gen/civ/tuningText';
import type { TuningGroup, TuningItem, TuningValue } from '../../gen/civ/tuning';
import { deleteRules, editRules, myRulesFor, renameRules, setBiomeName, setRuleValue, useMyRules, type MyRules } from '../rulesStore';
import { closeRulesSheet, getRulesSheet, openRulesSheet, useRulesSheet } from './sheetStore';
import { BiomeRow, MoreMenu, NameInput, RuleBlock, RuleRow, type MenuItem } from './RuleRows';
import { cnCount, groupItems, keepModified, modifiedCount, modifiedSections, renamedBiomes, resetToOfficial, searchRules, type ItemSection, type RulesPage } from './rulesView';
import { adoptRules, downloadRules, duplicateRules, newWorldFromShared, redoWithNewer, shareRules } from './rulesActions';
import { getCompare, openCompare } from '../compare/compareStore';

/** 官方规则(一项没改) */
const OFFICIAL: RuleSet = { name: OFFICIAL_RULES_NAME, version: 1, values: {} };

/** 大卡上看的这一套 */
interface Shown {
  rules: RuleSet;
  kind: 'mine' | 'official' | 'shared' | 'world';
  /** 本机的一套(能改) */
  mine?: MyRules;
  /** 别人分享的:从链接还是从文件来的 */
  from?: 'link' | 'file';
  fileName?: string;
  /** 一个世界用的:那个世界的编号;本机「我的规则」里同一套已是更新的一版时,那一套(用它另存一份重推) */
  worldId?: string;
  newer?: MyRules;
}

/** 大卡上能做的事(只能看的没有改的那几样) */
interface Acts {
  setValue: (id: string, v: TuningValue | undefined) => void;
  setBiome: (key: string, name: string) => void;
  /** 全部改回官方(只改回规则项,地貌的名字不动;提示条上能撤销) */
  resetAll: () => void;
}

const BIOME_LIST: readonly Biome[] = BIOMES.map((b) => b.id);
const BIOMES_DESC = '图例、悬停、导出的图例里这么叫。只是换个叫法：颜色不变，历史也不变。空着就是官方的叫法。';

/** 读链接、文件时的提示:几处以内原样列,多了并成一句 */
const notesMore = (notes: readonly string[]) => (notes.length <= 3 ? [...notes] : [ruleNotesLine(notes)!]);

export function RulesSheet() {
  const s = useRulesSheet();
  const list = useMyRules();
  const narrow = useNarrow();

  // 链接、文件:解开;读不了的说一声、不打开;个别项不对的照样打开,说一声(和读预设链接一样)
  useEffect(() => {
    // 已经换成别的了(解开过、关掉了):不再解一遍
    if (getRulesSheet() !== s) return;
    if (s?.kind === 'link') {
      const r = decodeRulesHash(s.hash);
      if (!r.ok) {
        closeRulesSheet();
        notify({ kind: 'error', text: '打不开这个规则链接', more: [r.error] });
        return;
      }
      openRulesSheet({ kind: 'shared', rules: r.rules, from: 'link' });
      if (r.warnings.length) notify({ kind: 'warn', text: `已打开朋友分享的规则「${r.rules.name}」`, more: notesMore(r.warnings) });
    } else if (s?.kind === 'file') {
      const r = parseRulesFile(s.text);
      if (!r.ok) {
        closeRulesSheet();
        notify({ kind: 'error', text: s.fileName ? `打不开 ${s.fileName}` : '打不开这个规则文件', more: [r.error] });
        return;
      }
      openRulesSheet({ kind: 'shared', rules: r.rules, from: 'file', ...(s.fileName ? { fileName: s.fileName } : {}) });
      if (r.warnings.length) notify({ kind: 'warn', text: `已打开规则文件「${r.rules.name}」`, more: notesMore(r.warnings) });
    }
  }, [s]);

  let shown: Shown | null = null;
  if (s?.kind === 'mine') {
    const e = list.find((x) => x.rules.id === s.id);
    if (e) shown = { rules: e.rules, kind: 'mine', mine: e };
  } else if (s?.kind === 'official') shown = { rules: OFFICIAL, kind: 'official' };
  else if (s?.kind === 'shared') shown = { rules: s.rules, kind: 'shared', from: s.from, fileName: s.fileName };
  else if (s?.kind === 'world') {
    // 本机「我的规则」里同一套(本机编号对得上)已是更新的一版
    const m = myRulesFor(s.rules);
    shown = { rules: s.rules, kind: 'world', worldId: s.worldId, ...(m?.newer ? { newer: m.mine } : {}) };
  }
  // 别的页面里删掉了
  const gone = s?.kind === 'mine' && !shown;
  useEffect(() => {
    if (gone) closeRulesSheet();
  }, [gone]);

  // Esc 关掉(输入框里打字时、菜单开着时不管)
  const on = !!shown;
  useEffect(() => {
    if (!on) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (document.querySelector('.rs-root .pm-menu')) return;
      // 并排试推盖在上面:Esc 归它(回到这张大卡)
      if (getCompare()) return;
      e.stopPropagation();
      closeRulesSheet();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [on]);

  if (!shown) return null;
  const id = shown.mine?.rules.id;
  const acts: Acts | null = id
    ? {
        setValue: (item, v) => void setRuleValue(id, item, v),
        setBiome: (key, name) => void setBiomeName(id, key, name),
        resetAll: () => {
          const { change, undo } = resetToOfficial(shown!.rules);
          if (!editRules(id, change)) return;
          notify({
            kind: 'ok',
            text: '已把规则全部改回官方',
            more: Object.keys(shown!.rules.biomes ?? {}).length ? ['地貌的名字照旧'] : undefined,
            action: { label: '撤销', act: 'rules-undo-reset', onClick: () => void (editRules(id, undo) && notify(null)) },
          });
        },
      }
    : null;
  // 换了一套(复制、加进来以后打开新的):页面上的状态(看哪一组、搜什么、展开了哪些)重来
  const key = s?.kind === 'mine' ? `m:${s.id}` : (s?.kind ?? '');
  const name = s?.kind === 'mine' && !!s.name;
  return narrow ? <PhoneSheet key={key} shown={shown} acts={acts} naming={name} /> : <DeskSheet key={key} shown={shown} acts={acts} naming={name} />;
}

// ---------------------------------------------------------------------------
// 两边共用的字

/** 顶上名字下面那句 */
function subLine(sh: Shown): string {
  if (sh.kind === 'official') return '网站自带的那一套。不能改，想调就复制一份。';
  const from = basedOnText(sh.rules);
  if (sh.kind === 'world') return `这个世界用的是第 ${sh.rules.version} 版，${from}。建好以后不能换。`;
  if (sh.kind === 'shared') {
    const who = sh.rules.by ? `${sh.rules.by} 分享的规则` : sh.from === 'file' ? '从文件打开的规则' : '别人分享的规则';
    return `${who}，${from}。`;
  }
  const m = sh.mine!;
  const used = m.worlds ? `用它建过 ${m.worlds} 个世界` : '还没用它建过世界';
  return `${from}。第 ${sh.rules.version} 版，${used}；改了以后，已经建好的世界不变。`;
}

/** 别人分享的顶上那一条的第一句 */
function bannerLine(sh: Shown, n: number): string {
  const what = n ? `改了 ${n} 项` : '和官方规则一样';
  if (sh.from === 'file') return `这套规则是从文件${sh.fileName ? `「${sh.fileName}」` : ''}打开的，${what}。`;
  return `这是${sh.rules.by ? `「${sh.rules.by}」` : '别人'}分享给你的一套规则，${what}。`;
}

/** 世界用的那一套在「我的规则」里有了新版:那一句 */
function newerLine(sh: Shown): string {
  return `我的规则里「${sh.newer!.rules.name}」已是第 ${sh.newer!.rules.version} 版。`;
}

/** 「···」菜单里的几项(我的规则里的一套) */
export function mineMenu(m: MyRules, after?: () => void): (MenuItem | 'sep')[] {
  return [
    { act: 'rules-copy', icon: 'copy', text: '复制一份', onClick: () => duplicateRules(m.rules.id) },
    { act: 'rules-file', icon: 'save', text: '存成文件', onClick: () => downloadRules(m.rules) },
    'sep',
    {
      act: 'rules-delete',
      icon: 'trash',
      text: '删除',
      confirm: '再点一下删除',
      red: true,
      onClick: () => {
        deleteRules(m.rules.id);
        after?.();
        notify({ kind: 'ok', text: `已删除「${m.rules.name}」`, more: m.worlds ? ['用它建好的世界不受影响：世界里存着整套规则'] : undefined });
      },
    },
  ];
}

/** 只看改过的那一页的说明(sec、biomes 是改过的;改回了还接着列的不算) */
function modifiedNote(sh: Shown, sec: ItemSection[], biomes: number): string {
  const n = sec.reduce((a, s) => a + s.items.length, 0) + biomes;
  if (!n) return sh.kind === 'official' ? '官方规则没有改过的项。左边点一组，能看各项官方的数。' : '还没改过哪一项。改过的项不管在哪一组，都会列在这里。';
  const groups = sec.length + (biomes ? 1 : 0);
  const where = groups === 1 ? `都在「${sec[0]?.name ?? '地貌的名字'}」` : `分在${cnCount(groups)}组`;
  const hasOff = sec.some((s) => s.items.some((x) => sh.rules.values[x.id] === 0 || sh.rules.values[x.id] === 'off'));
  const tail =
    sh.kind !== 'mine' ? '左边点别的组，能看其余没改的项（都是官方的数）。' : hasOff ? '拖到「不发生」的那项，用这套规则的世界里就没有这种事。' : '每项右边都能单独改回官方。';
  return `${n} 项，${where}。${tail}`;
}

/** 搜不到时说的 */
const notFound = (q: string) => `没有和「${q.trim()}」有关的规则。换个说法试试，比如「战争」「瘟疫」「王朝」。`;

/**
 * 「并排试推」:同一张地图上和官方规则一起往下推(compare/ComparePage.tsx,盖在大卡上面)。
 * 我的规则里的、别人分享的(没加进来也能)、世界里那一版都有;官方规则自己和自己比没有意思,不放
 */
function CompareButton({ sh, className = 'rs-btn pri' }: { sh: Shown; className?: string }) {
  const kind = sh.kind;
  if (kind === 'official') return null;
  return (
    <button className={className} data-act="rules-compare" onClick={() => openCompare({ rules: sh.rules, kind, ...(sh.mine ? { mineId: sh.mine.rules.id } : {}) })}>
      并排试推
    </button>
  );
}

// ---------------------------------------------------------------------------
// 电脑

function DeskSheet({ shown: sh, acts, naming: name0 }: { shown: Shown; acts: Acts | null; naming: boolean }) {
  const r = sh.rules;
  const compareBtn = <CompareButton sh={sh} />;
  const ro = !acts;
  const n = modifiedCount(r);
  const counts = useMemo(() => countByGroup(r.values), [r.values]);
  const [page, setPage] = useState<RulesPage>(() => ((sh.kind === 'shared' || sh.kind === 'world') && n.total ? 'modified' : 'realm'));
  const [q, setQ] = useState('');
  const [more, setMore] = useState<ReadonlySet<TuningGroup>>(() => new Set());
  const [naming, setNaming] = useState(name0);
  const searching = q.trim() !== '';
  /** 「只看改过的」上列过的(改回了也接着列,离开这一页再清) */
  const kept = useRef(new Set<string>());
  const go = (p: RulesPage) => {
    setQ('');
    setPage(p);
    kept.current.clear();
  };
  const resetAll = () => {
    kept.current.clear();
    acts?.resetAll();
  };
  const setValue = (item: string, v: TuningValue | undefined) => acts?.setValue(item, v);
  const row = (x: TuningItem) => <RuleRow key={x.id} x={x} values={r.values} ro={ro} onSet={setValue} />;

  let body: JSX.Element;
  if (searching) body = <SearchPage q={q} r={r} row={row} ro={ro} acts={acts} />;
  else if (page === 'modified') {
    const keep = keepModified(kept.current, r);
    const sec = modifiedSections(r.values, keep);
    const bs = renamedBiomes(r, keep);
    body = (
      <>
        <div className="rs-grp-h">
          <h2>只看改过的</h2>
          {acts && n.items > 0 && (
            <button className="rs-btn ghost" data-act="rules-reset-all" onClick={resetAll}>
              全部改回官方
            </button>
          )}
        </div>
        <p className="rs-grp-d">{modifiedNote(sh, modifiedSections(r.values), n.biomes)}</p>
        {sec.map((s) => (
          <section key={s.group}>
            {/* 都在一组(说明里已经写了是哪一组):不再写组名 */}
            {(sec.length > 1 || bs.length > 0) && (
              <div className="rs-cap">
                <span>{s.name}</span>
              </div>
            )}
            <div className="rs-card">{s.items.map(row)}</div>
          </section>
        ))}
        {bs.length > 0 && (
          <section>
            <div className="rs-cap">
              <span>地貌的名字</span>
            </div>
            <div className="rs-card">
              {bs.map((b) => (
                <BiomeRow key={b} b={b} name={r.biomes?.[biomeKey(b)]} ro={ro} onSet={(k, v) => acts?.setBiome(k, v)} />
              ))}
            </div>
          </section>
        )}
      </>
    );
  } else if (page === 'biomes') {
    const half = Math.ceil(BIOME_LIST.length / 2);
    const col = (bs: readonly Biome[]) => (
      <div>
        {bs.map((b) => (
          <BiomeRow key={b} b={b} name={r.biomes?.[biomeKey(b)]} ro={ro} onSet={(k, v) => acts?.setBiome(k, v)} />
        ))}
      </div>
    );
    body = (
      <>
        <div className="rs-grp-h">
          <h2>地貌的名字</h2>
        </div>
        <p className="rs-grp-d">{BIOMES_DESC}</p>
        <div className="rs-card">
          <div className="rs-bgrid">
            {col(BIOME_LIST.slice(0, half))}
            {col(BIOME_LIST.slice(half))}
          </div>
        </div>
      </>
    );
  } else {
    const g = TUNING_GROUPS.find((x) => x.id === page)!;
    const items = groupItems(g.id);
    const open = more.has(g.id);
    const modMore = items.more.filter((x) => x.id in r.values).length;
    const toggle = () => setMore((s) => (s.has(g.id) ? new Set([...s].filter((x) => x !== g.id)) : new Set([...s, g.id])));
    body = (
      <>
        <div className="rs-grp-h">
          <h2>{g.name}</h2>
        </div>
        <p className="rs-grp-d">
          {g.desc}
          {g.note}
        </p>
        <div className="rs-card">{items.common.map(row)}</div>
        {items.more.length > 0 &&
          (open ? (
            <>
              <div className="rs-cap">
                <span>
                  更多 {items.more.length} 项{modMore ? `（改了 ${modMore} 项）` : ''}
                </span>
                <button className="rs-cap-act" data-act="rules-more" aria-expanded="true" onClick={toggle}>
                  收起
                </button>
              </div>
              <div className="rs-card">{items.more.map(row)}</div>
            </>
          ) : (
            <button className="rs-card rs-more" data-act="rules-more" aria-expanded="false" onClick={toggle}>
              <Icon name="down" size={15} />
              更多 {items.more.length} 项{modMore > 0 && <em>改了 {modMore} 项</em>}
            </button>
          ))}
      </>
    );
  }

  const navItem = (p: RulesPage, label: string, count: number, cls = '') => (
    <button key={p} className={`rs-nav-i${cls}${!searching && page === p ? ' on' : ''}`} data-page={p} aria-current={!searching && page === p ? 'page' : undefined} onClick={() => go(p)}>
      {label}
      {count > 0 && <em>{count}</em>}
    </button>
  );

  return (
    <div className="rs-root">
      <div className="ov-scrim" onClick={closeRulesSheet} />
      <div className="ov rs" role="dialog" aria-modal="true" aria-label={`规则：${r.name}`} onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
        <header className="rs-head">
          <div className="rs-title">
            <h1>
              {naming && sh.mine ? (
                <NameInput
                  className="rs-name-input"
                  initial={r.name}
                  max={RULES_NAME_MAX}
                  onDone={(v) => {
                    setNaming(false);
                    if (v !== null && v.trim()) renameRules(sh.mine!.rules.id, v);
                  }}
                />
              ) : (
                <span className="rs-name">{r.name}</span>
              )}
              {sh.mine && !naming && (
                <button className="rs-rename" data-act="rules-rename" onClick={() => setNaming(true)}>
                  <Icon name="pen" size={13} />
                  改名
                </button>
              )}
            </h1>
            <p>{subLine(sh)}</p>
          </div>
          <div className="rs-acts">
            {sh.mine && (
              <>
                <button className="rs-btn" data-act="rules-share" onClick={() => void shareRules(r)}>
                  <Icon name="share" size={15} />
                  分享
                </button>
                <MoreMenu btnClass="rs-btn sq" items={mineMenu(sh.mine, closeRulesSheet)} />
              </>
            )}
            <button className="ov-x" data-act="rules-close" onClick={closeRulesSheet} title="关闭(Esc)" aria-label="关闭">
              <Icon name="close" size={14} />
            </button>
          </div>
        </header>
        <div className="rs-body">
          <nav className="rs-nav" aria-label="规则的分组">
            <label className="rs-search">
              <Icon name="search" size={15} />
              <input value={q} placeholder="搜规则" spellCheck={false} aria-label="搜规则" data-act="rules-search" onChange={(e) => setQ(e.target.value)} />
            </label>
            {navItem('modified', '只看改过的', n.total, ' flt')}
            <i className="rs-nav-sep" />
            {TUNING_GROUPS.map((g) => navItem(g.id, g.name, counts[g.id]))}
            <i className="rs-nav-sep" />
            {navItem('biomes', '地貌的名字', n.biomes)}
          </nav>
          <div className="rs-main">
            <div className="rs-scroll">
              {sh.kind === 'shared' && (
                <div className="rs-banner">
                  <p>
                    <b>{bannerLine(sh, n.total)}</b>
                    <br />
                    先看看改了什么；喜欢就加进我的规则，以后新建世界时能选它。
                  </p>
                  <button className="rs-btn" data-act="rules-new-world" onClick={() => newWorldFromShared(r)}>
                    用它新建世界
                  </button>
                  <button className="rs-btn pri" data-act="rules-adopt" onClick={() => adoptRules(r)}>
                    加进我的规则
                  </button>
                </div>
              )}
              {sh.newer && (
                <div className="rs-banner">
                  <p>
                    <b>{newerLine(sh)}</b>
                    <br />
                    这个世界照第 {r.version} 版推。{sh.worldId && `想看第 ${sh.newer.rules.version} 版推出来的历史，就另存一份重推，这个世界不变。`}
                  </p>
                  {sh.worldId && (
                    <button className="rs-btn pri" data-act="rules-redo" onClick={() => redoWithNewer(sh.worldId!, sh.newer!)}>
                      用第 {sh.newer.rules.version} 版另存一份重推
                    </button>
                  )}
                </div>
              )}
              {body}
            </div>
            <footer className="rs-foot">
              {sh.kind === 'mine' ? (
                <>
                  <p>
                    {n.biomes ? (
                      <>
                        <b>改了 {n.total} 项</b>（规则 {n.items} 项，地貌的名字 {n.biomes} 项）。
                      </>
                    ) : n.total ? (
                      <>
                        <b>改了 {n.total} 项。</b>同一张地图、同一个种子，用这套规则推出来的历史每次都一样。
                      </>
                    ) : (
                      <>
                        <b>还没改。</b>拖一下滑条就改了，改了自动存。
                      </>
                    )}
                  </p>
                  <button className="rs-btn" data-act="rules-file" onClick={() => downloadRules(r)}>
                    存成文件
                  </button>
                  {compareBtn}
                </>
              ) : sh.kind === 'official' ? (
                <>
                  <p>
                    <b>官方规则不能改。</b>复制一份以后就能调。
                  </p>
                  <button className="rs-btn pri" data-act="rules-copy-official" onClick={() => duplicateRules(null)}>
                    复制一份改
                  </button>
                </>
              ) : sh.kind === 'world' ? (
                <>
                  <p>
                    <b>只能看。</b>这一版存在世界里：「我的规则」里改了、删了，这个世界都不变。
                  </p>
                  {compareBtn}
                </>
              ) : (
                <>
                  <p>加进我的规则以后才能改。出处会一直写着「{basedOnText({ basedOn: [{ name: r.name, ...(r.by ? { by: r.by } : {}), version: r.version }] })}」。</p>
                  {compareBtn}
                </>
              )}
            </footer>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 每组改了几项 */
function countByGroup(values: RuleSet['values']): Record<TuningGroup, number> {
  const out = Object.fromEntries(TUNING_GROUPS.map((g) => [g.id, 0])) as Record<TuningGroup, number>;
  for (const s of modifiedSections(values)) out[s.group] = s.items.length;
  return out;
}

/** 搜规则的结果(电脑、手机一样,一项的样子由 row 给) */
function SearchPage({ q, r, row, ro, acts, phone }: { q: string; r: RuleSet; row: (x: TuningItem) => JSX.Element; ro: boolean; acts: Acts | null; phone?: boolean }) {
  // 这次搜的结果里列过的地貌:改它的叫法时不会因为不再含搜的字一下子没了(换了搜的字才重来)
  const shownBiomes = useRef<{ q: string; set: Set<Biome> }>({ q, set: new Set() });
  if (shownBiomes.current.q !== q) shownBiomes.current = { q, set: new Set() };
  const res = searchRules(q, r, shownBiomes.current.set);
  for (const b of res.biomes) shownBiomes.current.set.add(b);
  const n = res.sections.reduce((a, s) => a + s.items.length, 0) + res.biomes.length;
  return (
    <>
      {!phone && (
        <div className="rs-grp-h">
          <h2>搜「{q.trim()}」</h2>
        </div>
      )}
      <p className="rs-grp-d" data-testid="rules-search-note">
        {n ? `${n} 项。` : notFound(q)}
      </p>
      {res.sections.map((s) => (
        <section key={s.group}>
          <div className="rs-cap">
            <span>{s.name}</span>
          </div>
          <div className="rs-card">{s.items.map(row)}</div>
        </section>
      ))}
      {res.biomes.length > 0 && (
        <section>
          <div className="rs-cap">
            <span>地貌的名字</span>
          </div>
          <div className="rs-card">
            {res.biomes.map((b) => (
              <BiomeRow key={b} b={b} name={r.biomes?.[biomeKey(b)]} ro={ro} phone={phone} onSet={(k, v) => acts?.setBiome(k, v)} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// 手机

/** 手机上看的那一层:分组列表 / 一组 / 只看改过的 / 地貌的名字 */
type PhonePage = 'root' | RulesPage;

function PhoneSheet({ shown: sh, acts, naming: name0 }: { shown: Shown; acts: Acts | null; naming: boolean }) {
  const r = sh.rules;
  const ro = !acts;
  const n = modifiedCount(r);
  const counts = useMemo(() => countByGroup(r.values), [r.values]);
  const [page, setPage] = useState<PhonePage>('root');
  const [q, setQ] = useState('');
  const [more, setMore] = useState<ReadonlySet<TuningGroup>>(() => new Set());
  const [naming, setNaming] = useState(name0);
  const setValue = (item: string, v: TuningValue | undefined) => acts?.setValue(item, v);
  const block = (x: TuningItem) => <RuleBlock key={x.id} x={x} values={r.values} ro={ro} onSet={setValue} />;
  const searching = page === 'root' && q.trim() !== '';
  /** 「只看改过的」上列过的(同电脑) */
  const kept = useRef(new Set<string>());
  const go = (p: PhonePage) => {
    setPage(p);
    kept.current.clear();
    document.querySelector('.rs-ph-body')?.scrollTo(0, 0);
  };

  let title: React.ReactNode = r.name;
  let sub: string | null =
    sh.kind === 'shared' ? `${subLine(sh).replace(/。$/, '')}，${n.total ? `改了 ${n.total} 项` : '和官方规则一样'}。` : sh.newer ? `${subLine(sh)}${newerLine(sh)}` : subLine(sh);
  let body: JSX.Element;
  if (page === 'root') {
    if (naming && sh.mine)
      title = (
        <NameInput
          className="rs-name-input"
          initial={r.name}
          max={RULES_NAME_MAX}
          onDone={(v) => {
            setNaming(false);
            if (v !== null && v.trim()) renameRules(sh.mine!.rules.id, v);
          }}
        />
      );
    const li = (p: RulesPage, label: string, count: number, act?: string) => (
      <button key={p} className="rs-li" data-page={p} data-act={act} onClick={() => go(p)}>
        {label}
        <span className={count ? 'a' : ''}>{count ? (p === 'modified' ? count : `改了 ${count} 项`) : ''}</span>
        <Icon name="chevron" size={14} className="rs-chev" />
      </button>
    );
    body = (
      <>
        <label className="rs-search">
          <Icon name="search" size={16} />
          <input value={q} placeholder="搜规则" spellCheck={false} aria-label="搜规则" data-act="rules-search" onChange={(e) => setQ(e.target.value)} />
        </label>
        {searching ? (
          <SearchPage q={q} r={r} row={block} ro={ro} acts={acts} phone />
        ) : (
          <>
            <div className="rs-card">{li('modified', '只看改过的', n.total)}</div>
            <div className="rs-card rs-gap">{TUNING_GROUPS.map((g) => li(g.id, g.name, counts[g.id]))}</div>
            <div className="rs-card rs-gap-s">{li('biomes', '地貌的名字', n.biomes)}</div>
            {/* 别人分享的、世界里那一版:底下那一条已经有别的按钮,并排试推放在这一页最下面 */}
            {(sh.kind === 'shared' || sh.kind === 'world') && <CompareButton sh={sh} className="rs-btn wide" />}
          </>
        )}
      </>
    );
  } else if (page === 'modified') {
    const keep = keepModified(kept.current, r);
    const sec = modifiedSections(r.values, keep);
    const bs = renamedBiomes(r, keep);
    title = '只看改过的';
    sub = modifiedNote(sh, modifiedSections(r.values), n.biomes);
    body = (
      <>
        {sec.map((s) => (
          <section key={s.group}>
            <div className="rs-cap">
              <span>{s.name}</span>
            </div>
            <div className="rs-card">{s.items.map(block)}</div>
          </section>
        ))}
        {bs.length > 0 && (
          <section>
            <div className="rs-cap">
              <span>地貌的名字</span>
            </div>
            <div className="rs-card">
              {bs.map((b) => (
                <BiomeRow key={b} b={b} name={r.biomes?.[biomeKey(b)]} ro={ro} phone onSet={(k, v) => acts?.setBiome(k, v)} />
              ))}
            </div>
          </section>
        )}
        {acts && n.items > 0 && (
          <button
            className="rs-btn wide"
            data-act="rules-reset-all"
            onClick={() => {
              kept.current.clear();
              acts.resetAll();
            }}
          >
            全部改回官方
          </button>
        )}
      </>
    );
  } else if (page === 'biomes') {
    title = '地貌的名字';
    sub = BIOMES_DESC;
    body = (
      <div className="rs-card">
        {BIOME_LIST.map((b) => (
          <BiomeRow key={b} b={b} name={r.biomes?.[biomeKey(b)]} ro={ro} phone onSet={(k, v) => acts?.setBiome(k, v)} />
        ))}
      </div>
    );
  } else {
    const g = TUNING_GROUPS.find((x) => x.id === page)!;
    const items = groupItems(g.id);
    const open = more.has(g.id);
    const modMore = items.more.filter((x) => x.id in r.values).length;
    title = g.name;
    sub = g.desc;
    body = (
      <>
        <div className="rs-card">{items.common.map(block)}</div>
        {items.more.length > 0 && (
          <div className="rs-card rs-gap-s">
            <button
              className={`rs-li${open ? ' open' : ''}`}
              data-act="rules-more"
              aria-expanded={open}
              onClick={() => setMore((s) => (s.has(g.id) ? new Set([...s].filter((x) => x !== g.id)) : new Set([...s, g.id])))}
            >
              更多 {items.more.length} 项<span className={modMore ? 'a' : ''}>{modMore ? `改了 ${modMore} 项` : ''}</span>
              <Icon name="chevron" size={14} className="rs-chev" />
            </button>
            {open && items.more.map(block)}
          </div>
        )}
      </>
    );
  }

  // 最上一层的返回:回到打开它的地方(世界设定里点开的回世界设定,别处的回「规则」)
  const back = page === 'root' ? { label: sh.kind === 'world' ? '世界设定' : '规则', onClick: closeRulesSheet } : { label: r.name, onClick: () => go('root') };
  return (
    <div className="rs-root phone">
      <div className="rs-ph" role="dialog" aria-modal="true" aria-label={`规则：${r.name}`} onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
        <div className="rs-ph-body">
          <div className="rs-ph-top">
            <button className="rs-ph-back" data-act={page === 'root' ? 'rules-close' : 'rules-back'} onClick={back.onClick}>
              <Icon name="back" size={18} />
              <span>{back.label}</span>
            </button>
            <h1>{title}</h1>
            {sub && <p>{sub}</p>}
            {page === 'root' && sh.mine && !naming && (
              <div className="rs-ph-acts">
                <button className="rs-btn" data-act="rules-share" onClick={() => void shareRules(r)}>
                  <Icon name="share" size={15} />
                  分享
                </button>
                <button className="rs-btn" data-act="rules-rename" onClick={() => setNaming(true)}>
                  <Icon name="pen" size={15} />
                  改名
                </button>
                <MoreMenu btnClass="rs-btn sq" items={mineMenu(sh.mine, closeRulesSheet)} />
              </div>
            )}
          </div>
          {body}
        </div>
        <footer className="rs-ph-foot">
          {sh.kind === 'mine' ? (
            <>
              <p>
                <b>{n.total ? `改了 ${n.total} 项` : '还没改'}</b>
              </p>
              <CompareButton sh={sh} />
            </>
          ) : sh.kind === 'official' ? (
            <>
              <p>官方规则不能改</p>
              <button className="rs-btn pri" data-act="rules-copy-official" onClick={() => duplicateRules(null)}>
                复制一份改
              </button>
            </>
          ) : sh.kind === 'world' ? (
            <>
              <p>只能看</p>
              {sh.newer && sh.worldId && (
                <button className="rs-btn pri" data-act="rules-redo" onClick={() => redoWithNewer(sh.worldId!, sh.newer!)}>
                  用第 {sh.newer.rules.version} 版另存一份重推
                </button>
              )}
            </>
          ) : (
            <>
              <button className="rs-btn half" data-act="rules-new-world" onClick={() => newWorldFromShared(r)}>
                用它新建世界
              </button>
              <button className="rs-btn pri half" data-act="rules-adopt" onClick={() => adoptRules(r)}>
                加进我的规则
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
