/**
 * 改人物、删人物时问的那一句(人物卡 CharacterPanel.tsx 编辑「完成」、更多里「删除」;说法见 crownInfo.ts 的 crownEditAsk / crownDeleteAsk)。
 * 样子照「存回推演模式」的弹窗:标题、一段说明、两个单选项(各一行字 + 一行小字)、取消 / 好;删除时主按钮是红的「删除」。
 * 电脑上浮在正中,手机上从底部升起。默认选第一项(一起改 / 连即位一起去掉);Esc、点外面 = 取消。
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CrownAsk } from './crownInfo';
import { useNarrow } from './device';
import './stepwise.css';

const stop = (e: { stopPropagation(): void }) => e.stopPropagation();

/** go = 主按钮上的字;danger = 主按钮是红的(删除);onPick(true) = 选了第一项 */
export function CrownAskDialog({ ask, go, danger, onPick, onClose }: { ask: CrownAsk; go: string; danger?: boolean; onPick: (yes: boolean) => void; onClose: () => void }) {
  const phone = useNarrow();
  const [yes, setYes] = useState(true);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  const radios = (
    <div className={`sw-grp${phone ? ' white' : ''}`} role="radiogroup" aria-label={ask.title}>
      {[true, false].map((k) => {
        const [t, small] = k ? ask.yes : ask.no;
        return (
          <button key={String(k)} className="sw-r sw-r-btn top" role="radio" aria-checked={yes === k} data-act={k ? 'crown-ask-yes' : 'crown-ask-no'} onClick={() => setYes(k)}>
            <span className={`sw-radio${yes === k ? ' on' : ''}`} />
            <span className="sw-r-main">
              <span>{t}</span>
              <small>{small}</small>
            </span>
          </button>
        );
      })}
    </div>
  );
  const ok = () => onPick(yes);
  const node = phone ? (
    <>
      <div className="sw-scrim" onClick={onClose} />
      <section className="sw-psheet cr-ask" role="dialog" aria-label={ask.title} onPointerDown={stop} onClick={stop}>
        <div className="sw-grip" />
        <div className="sw-psheet-top">
          <b>{ask.title}</b>
        </div>
        <div className="sw-lead">{ask.lead}</div>
        <div className="sw-psheet-body">{radios}</div>
        <div className="sw-psheet-btns">
          <button className="sw-big" data-act="crown-ask-cancel" onClick={onClose}>
            取消
          </button>
          <button className={`sw-big pri${danger ? ' danger' : ''}`} data-act="crown-ask-go" onClick={ok}>
            {go}
          </button>
        </div>
      </section>
    </>
  ) : (
    <>
      <div className="sw-scrim" onClick={onClose} />
      <div className="sw-dlg-wrap">
        <div className="sw-dlg cr-ask" role="dialog" aria-label={ask.title} onPointerDown={stop} onClick={stop}>
          <h2>{ask.title}</h2>
          <p className="sw-lead">{ask.lead}</p>
          <div className="sw-sec first">{radios}</div>
          <div className="sw-foot save">
            <span className="sw-sp" />
            <button className="sw-btn2" data-act="crown-ask-cancel" onClick={onClose}>
              取消
            </button>
            <button className={`sw-btn2 pri${danger ? ' danger' : ''}`} data-act="crown-ask-go" onClick={ok}>
              {go}
            </button>
          </div>
        </div>
      </div>
    </>
  );
  return createPortal(node, document.body);
}
