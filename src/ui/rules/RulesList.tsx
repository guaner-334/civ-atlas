/**
 * 「我的世界」的「规则」分段:官方规则在最上(只能看,能复制一份);下面是本机「我的规则」里的几套(自己调的、复制来的、别人分享了加进来的),
 * 一套一行:名字;出处和改了什么(摘要);用它建过几个世界;最近一次改的时间;「···」(复制一份、存成文件、删除)。
 * 点一行打开调规则的大卡(RulesSheet.tsx)。右上「新建一套规则」从官方规则开始。
 * 手机上一行只放名字和两行小字,「···」在右边。
 */
import { Icon } from '../icons';
import { when } from '../worldParts';
import { useMyRules, type MyRules } from '../rulesStore';
import { openRulesSheet } from './sheetStore';
import { MoreMenu } from './RuleRows';
import { mineMenu } from './RulesSheet';
import { rulesLine } from './rulesView';
import { duplicateRules, newRules } from './rulesActions';

/** 用它建过几个世界 */
const usedText = (e: MyRules) => (e.worlds ? `用它建过 ${e.worlds} 个世界` : '还没用过');

/**
 * fileBtn:「打开存档文件」在哪(电脑在右上、手机在列表下面;一个世界都没有时没有这个按钮,说拖进来)
 */
export function RulesTab({ phone, fileBtn }: { phone: boolean; fileBtn: boolean }) {
  const list = useMyRules();
  /** 键盘选中一行按回车 / 空格:打开(焦点在行里的按钮上时归按钮) */
  const open = (e: React.KeyboardEvent, f: () => void) => {
    if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    f();
  };
  /** 一行(点了打开;里面的按钮各做各的) */
  const row = (key: string, act: string, f: () => void, children: React.ReactNode) => (
    <div key={key} className="rs-rr" role="button" tabIndex={0} data-act={act} data-id={key} onClick={f} onKeyDown={(e) => open(e, f)}>
      {children}
    </div>
  );
  return (
    <div className={`rs-list${phone ? ' phone' : ''}`}>
      <div className="rs-intro">
        <p>新建世界时选一套规则，历史就照它推。一个世界只用一套，建好以后不变。</p>
        <button className={`mw-btn${phone ? ' wide' : ''}`} data-act="rules-new" onClick={newRules}>
          <Icon name="plus" size={16} />
          新建一套规则
        </button>
      </div>
      <div className="rs-card" role="list">
        {row(
          'official',
          'rules-open-official',
          () => openRulesSheet({ kind: 'official' }),
          <>
            <div className="rs-rr-t">
              <b>官方规则</b>
              <small>网站自带的那一套。不能改，想调就复制一份。</small>
            </div>
            {!phone && <span className="rs-rr-u" />}
            {!phone && <span className="rs-rr-d" />}
            <span className="rs-rr-a">
              <button
                className="mw-btn"
                data-act="rules-copy-official"
                onClick={(e) => {
                  e.stopPropagation();
                  duplicateRules(null);
                }}
              >
                <Icon name="copy" size={15} />
                复制一份
              </button>
            </span>
          </>,
        )}
        {list.map((e) =>
          row(
            e.rules.id,
            'rules-open',
            () => openRulesSheet({ kind: 'mine', id: e.rules.id }),
            <>
              <div className="rs-rr-t">
                <b>{e.rules.name}</b>
                <small>{rulesLine(e.rules, !!e.shared)}</small>
                {phone && (
                  <small className="rs-rr-m">
                    {usedText(e)}，{when(new Date(e.at).toISOString())}
                  </small>
                )}
              </div>
              {!phone && <span className="rs-rr-u">{usedText(e)}</span>}
              {!phone && <span className="rs-rr-d">{when(new Date(e.at).toISOString())}</span>}
              <span className="rs-rr-a">
                <MoreMenu btnClass="mw-btn sq" items={mineMenu(e)} />
              </span>
            </>,
          ),
        )}
      </div>
      <p className="rs-note">
        别人发来的规则链接，打开时会问你要不要加进来；
        {fileBtn ? `规则文件用${phone ? '下面' : '右上'}「打开存档文件」打开。` : '规则文件拖进这一页就能打开。'}
      </p>
    </div>
  );
}
