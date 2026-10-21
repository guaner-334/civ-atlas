/**
 * 待推演的单子(数据在 pendingStore.ts):浮在时间轴上面,单子里有东西才出现。
 *
 *   标题「待推演的干预 N 条」+ 清空 + 全部推演;下面一行一条(年份、说法、✕ 删掉这一条),最后一句"从最早的 X 年起重新推演,之前的历史不变。"
 *   手机上默认只露标题这一行(点标题展开 / 收起),「全部推演」一直在。
 */
import { useState } from 'react';
import { eraText, spaced, yearAt } from '../gen/era';
import { useEra } from './editsStore';
import { clearPending, pushPending, removePending, usePending } from './pendingStore';

export function PendingTray({ phone, hidden }: { phone: boolean; hidden?: boolean }) {
  const list = usePending();
  const era = useEra();
  const [open, setOpen] = useState(false);
  if (!list.length || hidden) return null;
  const shown = !phone || open;
  const from = Math.max(0, Math.floor(Math.min(...list.map((x) => x.from))));
  const stop = (e: { stopPropagation(): void }) => e.stopPropagation();
  return (
    <div className={`ivq${phone ? ' phone' : ''}${shown ? ' open' : ''}`} data-pending={list.length} onPointerDown={stop} onClick={stop} onDoubleClick={stop}>
      <div className="ivq-head">
        {phone ? (
          <button className="ivq-title" aria-expanded={open} onClick={() => setOpen(!open)}>
            待推演的干预<em>{list.length} 条</em>
            <span className="ivq-chev" aria-hidden="true">
              {open ? '⌄' : '⌃'}
            </span>
          </button>
        ) : (
          <span className="ivq-title">
            待推演的干预<em>{list.length} 条</em>
          </span>
        )}
        {shown && (
          <button className="ivq-clear" data-act="iv-clear" onClick={clearPending}>
            清空
          </button>
        )}
        <button className="ivq-go" data-act="iv-push" onClick={pushPending}>
          全部推演
        </button>
      </div>
      {shown && (
        <>
          <div className="ivq-list">
            {list.map((x) => (
              <div key={x.id} className="ivq-row">
                <span className="ivq-yr">{yearAt(Math.floor(x.from), era)}</span>
                <span className="ivq-text">{eraText(x.text, era)}</span>
                <button className="ivq-x" data-act="iv-unqueue" onClick={() => removePending(x.id)} title="从待推演里删掉这一条" aria-label="删掉这一条">
                  ✕
                </button>
              </div>
            ))}
          </div>
          <div className="ivq-note">{list.length > 1 ? `从最早的${spaced(yearAt(from, era))}起重新推演,之前的历史不变。` : `从${spaced(yearAt(from, era))}起重新推演,之前的历史不变。`}</div>
        </>
      )}
    </div>
  );
}
