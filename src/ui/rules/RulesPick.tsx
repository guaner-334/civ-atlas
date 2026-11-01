/**
 * 新建世界里选规则的那一页:「文明」里点「规则」那一行进来,换掉左边(手机上是卡片里换页),左上「‹ 文明」回去;
 * 底下照旧是「开始推演」(和「地名风格」那一页一样,选好了直接就能建)。
 *
 *   一套一行   官方规则在最上(网站自带的那一套);下面是本机「我的规则」里的几套,各写出处和改了什么;选中的打勾。
 *              世界里带着的一套不在「我的规则」里(那一套删掉了,或者是别处来的世界的)也列出来,写明不在
 *   调这一套…  打开调规则的大卡(盖在新建界面上):我的规则里的能改,改了新建的世界跟着用改好的;官方的、不在我的规则里的只能看
 *   新建一套   从官方规则开始新建一套、打开大卡起名,同时选上它
 *
 * 在这一页上新加进「我的规则」的一套(新建、复制一份改)自动选上:是为这个世界调的。
 * 选了哪一套由 Studio.tsx 记着、写进这个世界的修改(建好以后不能换)。
 */
import { useEffect, useRef } from 'react';
import { Icon } from '../icons';
import type { RuleSet } from '../../gen/civ/ruleSet';
import { findMyRules, useMyRules, type MyRules } from '../rulesStore';
import { openRulesSheet } from './sheetStore';
import { rulesLine } from './rulesView';
import { newRules } from './rulesActions';

export interface RulesPickProps {
  phone: boolean;
  /** 选的是「我的规则」里的哪一套(本机编号;官方 = null) */
  picked: string | null;
  /** 这个世界的修改里现在的那一套(选的那一套删掉了、或者不在我的规则里时,照它列一行) */
  rules: RuleSet | undefined;
  /** 选一套(null = 官方规则) */
  onPick: (id: string | null) => void;
  onBack: () => void;
  /** 电脑:右上收起侧栏(和「文明」那一页一样) */
  onCollapse?: () => void;
}

export function RulesPick(p: RulesPickProps) {
  const list = useMyRules();
  const mine = p.picked ? list.find((e) => e.rules.id === p.picked) : undefined;
  /** 修改里有一套、却不是「我的规则」里选中的那一套:单独列一行(选中) */
  const other = !mine && p.rules ? p.rules : null;
  const officialOn = !mine && !other;

  // 在这一页上新加进来的一套(新建、在大卡里复制一份):自动选上
  const known = useRef<Set<string> | null>(null);
  useEffect(() => {
    const ids = list.map((e) => e.rules.id);
    if (known.current) {
      const fresh = ids.filter((id) => !known.current!.has(id));
      if (fresh.length === 1 && ids[0] === fresh[0]) p.onPick(fresh[0]);
    }
    known.current = new Set(ids);
    // 只看列表变没变;onPick 每次是新的
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list]);

  const tune = () => {
    if (mine) openRulesSheet({ kind: 'mine', id: mine.rules.id });
    else if (other) openRulesSheet({ kind: 'world', rules: other });
    else openRulesSheet({ kind: 'official' });
  };
  const create = () => {
    const id = newRules();
    if (id && findMyRules(id)) p.onPick(id);
  };
  const pick = (id: string | null) => {
    if (id === (mine?.rules.id ?? null) && !other) return;
    p.onPick(id);
  };

  const max = p.phone ? 2 : 4;
  const row = (key: string, on: boolean, name: string, line: string, onClick: () => void) => (
    <button key={key} className="sb-row rp-row" role="radio" aria-checked={on} data-rules={key} onClick={onClick}>
      <span className="rp-ck">{on && <Icon name="check" size={16} />}</span>
      <span className="sb-row-main">
        <b>{name}</b>
        <small>{line}</small>
      </span>
    </button>
  );
  const mineRow = (e: MyRules) => row(e.rules.id, mine === e, e.rules.name, rulesLine(e.rules, !!e.shared, max), () => pick(e.rules.id));

  return (
    <>
      <div className="st-top">
        <button className="nw-back" data-act="rules-pick-back" onClick={p.onBack}>
          <Icon name="back" size={18} />
          文明
        </button>
        {p.onCollapse && (
          <button className="sb-collapse" data-act="side-collapse" aria-label="收起侧栏" data-tip="收起侧栏" onClick={p.onCollapse}>
            <Icon name="sidebar" size={19} />
          </button>
        )}
      </div>
      <div className="nw-title-row">
        <div className="nw-title">规则</div>
      </div>
      <div className="nw-intro rp-intro">{p.phone ? '历史照哪一套规则推。建好以后不能换。' : '历史照哪一套规则推。建好以后不能换；想换，就以它为底稿另建一个世界。'}</div>
      <div className="sb-group rp-list" role="radiogroup" aria-label="规则">
        {row('official', officialOn, '官方规则', '网站自带的那一套', () => pick(null))}
        {other && row('other', true, other.name, `不在「我的规则」里。${rulesLine(other, false, max)}`, () => undefined)}
        {list.map(mineRow)}
      </div>
      <div className="rp-btns">
        <button className="rp-btn" data-act="rules-pick-tune" onClick={tune}>
          <Icon name="sliders" size={16} />
          调这一套…
        </button>
        <button className="rp-btn" data-act="rules-pick-new" onClick={create}>
          <Icon name="plus" size={16} />
          新建一套
        </button>
      </div>
      {!p.phone && <div className="nm-note rp-note">自己调的、别人分享来的规则，都在「我的世界」的「规则」里。</div>}
    </>
  );
}
