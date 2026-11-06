/**
 * 用一个带规则的预设新建世界(新建弹窗里点「开始」、新建页里选了这个预设)时,这个世界用哪一套:见 rulesStore.ts 的 settlePresetRules。
 * 朋友链接、作品墙上带来的这一套这次加进了「我的规则」,顶上说一声(字和别人分享的规则「用它新建世界」一样)。
 */
import type { RuleSet } from '../gen/civ/ruleSet';
import { settlePresetRules } from './rulesStore';
import { notify } from './saveStore';

export function takePresetRules(r: RuleSet): RuleSet {
  const s = settlePresetRules(r);
  if (s.adopted) {
    const n = s.rules.name;
    notify(
      s.adopted.existed
        ? { kind: 'ok', text: `「${n}」已经在我的规则里了`, more: ['新建的世界照原来加进来的那一套推，建好以前还能换'] }
        : { kind: 'ok', text: `已把「${n}」加进我的规则`, more: ['新建的世界照它推，建好以前还能换'] },
    );
  }
  return s.rules;
}
