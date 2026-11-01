/**
 * 调规则的页、「我的世界 › 规则」上点按钮做的事:分享(复制链接)、存成文件、复制一份、加进我的规则、新建一套。
 * 做完在顶上的提示条说一声(saveStore.ts 的 notify)。
 */
import { notify } from '../saveStore';
import { copyText } from '../clipboard';
import { rulesFileName, rulesFileText, rulesHash } from '../../gen/civ/ruleShare';
import { OFFICIAL_RULES_NAME } from '../../gen/civ/ruleSetEdit';
import type { RuleSet } from '../../gen/civ/ruleSet';
import { MAX_MY_RULES, addSharedRules, copyRules, createRules, findMyRules } from '../rulesStore';
import { showRulesInWorlds } from '../MyWorlds';
import { openRulesSheet } from './sheetStore';

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

/** 新建一套(从官方规则开始),打开它、一打开就在改名 */
export function newRules() {
  const id = createRules('');
  if (!id) return notify({ kind: 'error', text: '没能新建', more: [FULL] });
  openRulesSheet({ kind: 'mine', id, name: true });
}

/** 别人分享的加进我的规则,打开加进来的那一套(这时才能改) */
export function adoptRules(r: RuleSet): string | null {
  const id = addSharedRules(r);
  if (!id) {
    notify({ kind: 'error', text: '没能加进我的规则', more: [FULL] });
    return null;
  }
  openRulesSheet({ kind: 'mine', id });
  // 回到「我的世界」时停在「规则」页签,看得到加进来的这一套
  showRulesInWorlds();
  notify({ kind: 'ok', text: `已把「${r.name}」加进我的规则`, more: ['现在能改了；出处会一直写着'] });
  return id;
}
