import { Icon } from './icons';
import { MAX_WORLDS } from './saveStore';
import type { SpaceBarState } from './spaceFacts';
import { barWords } from './spaceWords';
import { withFileFlow } from './worldFileLazy';
import './spaceNotice.css';

export interface SpaceBarProps {
  state: SpaceBarState;
  phone: boolean;
  onClose: () => void;
  onLook: () => void;
}

const saveAll = () => withFileFlow('没能存成文件', (m) => m.saveAllToFile());

export function SpaceBarView({ state, phone, onClose, onLook }: SpaceBarProps) {
  const w = barWords(state, MAX_WORLDS);
  return (
    <div className={`mwn${w.warn ? ' warn' : ''}`} role="status" data-space-bar={state.kind}>
      <div className="mwn-txt">
        <b>{w.title}</b>
        {w.body}
      </div>
      {(w.saveAll || w.look) && (
        <div className="mwn-acts">
          {w.saveAll && (
            <button className={`mw-btn${phone ? ' blue' : ''}`} data-act="save-all" onClick={saveAll}>
              全部存成文件
            </button>
          )}
          {w.look && (
            <button className="mw-btn" data-act="space-open" onClick={onLook}>
              看占了多少
            </button>
          )}
        </div>
      )}
      <button className="mwn-x" data-act="space-bar-close" aria-label="关闭" title="关闭" onClick={onClose}>
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}
