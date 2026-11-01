/**
 * 调规则的页、「我的世界 › 规则」、新建世界里选规则那一页上点按钮做的事:分享(复制链接)、存成文件、复制一份、加进我的规则、
 * 新建一套;别人分享的「用它新建世界」;世界用的那一版有了新版时「用新版另存一份重推」。
 * 做完在顶上的提示条说一声(saveStore.ts 的 notify)。
 */
import { notify } from '../saveStore';
import { copyText } from '../clipboard';
import { rulesFileName, rulesFileText, rulesHash } from '../../gen/civ/ruleShare';
import { OFFICIAL_RULES_NAME } from '../../gen/civ/ruleSetEdit';
import type { RuleSet } from '../../gen/civ/ruleSet';
import { MAX_MY_RULES, adoptSharedRules, copyRules, createRules, findMyRules, type MyRules } from '../rulesStore';
import { showRulesInWorlds } from '../MyWorlds';
import { redoWithRules } from '../newCivAction';
import { closeRulesSheet, newWorldWithRules, openRulesSheet } from './sheetStore';

/** 「我的规则」满了 */
const FULL = `「我的规则」最多 ${MAX_MY_RULES} 套，先删掉几套再来`;

/** 分享:把这套规则的链接复制下来(数全在链接里,不经服务器) */
export async function shareRules(r: RuleSet) {
  const url = `${location.origin}${location.pathname}${rulesHash(r)}`;
  if (await copyText(url)) notify({ kind: 'ok', text: '已复制规则链接', more: ['发给别人，对方打开就能看到这套规则'] });
  else notify({ kind: 'warn', text: '没能自动复制，请手动复制这个链接', more: [url] });
}

/** 存成文件(.json) */
export function downloadRules(r: RuleSet) {
  const name = rulesFileName(r);
  const url = URL.createObjectURL(new Blob([rulesFileText(r)], { type: 'application/json;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  notify({ kind: 'ok', text: '已存成文件', more: [name] });
}

/** 名字后面加「副本」(超长的由清理截掉) */
const copyName = (name: string) => `${name} 副本`;

/** 复制一份(fromId = null:复制官方规则),打开新的那一套;复制官方的一打开就在改名 */
export function duplicateRules(fromId: string | null) {
  const src = fromId === null ? null : findMyRules(fromId);
  const id = copyRules(fromId, src ? copyName(src.rules.name) : '');
  if (!id) return notify({ kind: 'error', text: '没能复制', more: [FULL] });
  openRulesSheet({ kind: 'mine', id, ...(src ? {} : { name: true }) });
  notify({ kind: 'ok', text: `已复制一份「${src ? src.rules.name : OFFICIAL_RULES_NAME}」`, more: ['新的这一套能随便调，原来的不变'] });
}

/** 新建一套(从官方规则开始),打开它、一打开就在改名;返回本机编号(满了 = null) */
export function newRules(): string | null {
  const id = createRules('');
  if (!id) {
    notify({ kind: 'error', text: '没能新建', more: [FULL] });
    return null;
  }
  openRulesSheet({ kind: 'mine', id, name: true });
  return id;
}

/** 已经在我的规则里了(加进来过、没改过,用的是原来那一套) */
const already = (r: RuleSet) => `「${r.name}」已经在我的规则里了`;

/**
 * 别人分享的加进我的规则,打开加进来的那一套(这时才能改)。
 * 同一套加进来过、加进来以后没改过的,不再加一套,打开原来那一套(rulesStore.ts 的 adoptSharedRules)
 */
export function adoptRules(r: RuleSet): string | null {
  const got = adoptSharedRules(r);
  if (!got) {
    notify({ kind: 'error', text: '没能加进我的规则', more: [FULL] });
    return null;
  }
  openRulesSheet({ kind: 'mine', id: got.id });
  // 回到「我的世界」时停在「规则」页签,看得到加进来的这一套
  showRulesInWorlds();
  if (got.existed) notify({ kind: 'ok', text: already(r), more: ['打开的就是原来加进来的那一套'] });
  else notify({ kind: 'ok', text: `已把「${r.name}」加进我的规则`, more: ['现在能改了；出处会一直写着'] });
  return got.id;
}

/**
 * 别人分享的「用它新建世界」:先加进我的规则(出处写着),再进新建世界、规则选好加进来的这一套。
 * 同一套加进来过、没改过的,不再加一套,选好原来那一套
 */
export function newWorldFromShared(r: RuleSet) {
  const got = adoptSharedRules(r);
  const e = got ? findMyRules(got.id) : undefined;
  if (!got || !e) return notify({ kind: 'error', text: '没能加进我的规则', more: [FULL] });
  closeRulesSheet();
  showRulesInWorlds();
  const opened = newWorldWithRules(e.rules);
  const more = opened ? (got.existed ? '新建的世界照原来加进来的那一套推，建好以前还能换' : '新建的世界照它推，建好以前还能换') : '新建世界时选它';
  notify({ kind: 'ok', text: got.existed ? already(r) : `已把「${r.name}」加进我的规则`, more: [more] });
}

/** 世界用的那一版有了新版:用「我的规则」里现在的那一套,把这个世界另存一份重推(进「打造文明」;原来的不动) */
export function redoWithNewer(worldId: string, mine: MyRules) {
  closeRulesSheet();
  redoWithRules(worldId, mine.rules);
}
