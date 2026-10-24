/**
 * 「更多」菜单里「播放画面」那一行(右边灰字写现在选的):点了整个菜单换成一张卡片 ——
 * 左上「‹」回到菜单,自动 / 流畅优先 / 清晰优先 三选一(选了马上生效,菜单不收),底下一行写这台设备现在是哪种情况。
 * 设置本身在 playQuality.ts。样式在 sidebar.css(.pq-*)。
 */
import { useEffect, useRef } from 'react';
import { noGpu, useNarrow } from './device';
import { Icon } from './icons';
import { usePopMenuPanel } from './PopMenu';
import { playSmooth, setPlayQuality, usePlayQuality, type PlayQuality } from './playQuality';

const NAMES: Record<PlayQuality, string> = { auto: '自动', smooth: '流畅优先', sharp: '清晰优先' };

const OPTIONS: { q: PlayQuality; text: string }[] = [
  { q: 'auto', text: '没用上显卡加速时按「流畅优先」，用上了按「清晰优先」' },
  { q: 'smooth', text: '播放时地图每秒最多换 10 次，时间轴和拖动更顺；停下马上画清楚' },
  { q: 'sharp', text: '播放时每一帧都画全；没用上显卡加速的电脑上会一顿一顿' },
];

export function PlayQualityItem() {
  const q = usePlayQuality();
  const panel = usePopMenuPanel();
  if (!panel) return null;
  return (
    <button
      className="pm-item pq-row"
      role="menuitem"
      data-act="play-quality"
      aria-haspopup="true"
      onClick={(e) => {
        // 不收起菜单:菜单换成卡片
        e.stopPropagation();
        panel(<PlayQualityCard back={() => panel(null)} />);
      }}
    >
      <Icon name="play" size={16} />
      <span className="pm-text">播放画面</span>
      <small className="pm-note">{NAMES[q]}</small>
      <Icon name="chevron" size={12} className="pq-chev" />
    </button>
  );
}

function PlayQualityCard({ back }: { back: () => void }) {
  const q = usePlayQuality();
  const phone = useNarrow();
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus({ preventScroll: true }), []);
  const who = phone ? '这台设备' : '这台电脑';
  return (
    <div className="pq" role="group" aria-label="播放画面" data-testid="play-quality">
      <div className="pq-head">
        <button ref={first} className="pq-back" data-act="play-quality-back" aria-label="回到菜单" onClick={back}>
          <Icon name="back" size={16} />
        </button>
        <b>播放画面</b>
      </div>
      {OPTIONS.map((o) => (
        <button
          key={o.q}
          className={`pq-opt${q === o.q ? ' on' : ''}`}
          role="menuitemradio"
          aria-checked={q === o.q}
          data-act={`play-quality-${o.q}`}
          onClick={() => setPlayQuality(o.q)}
        >
          <Icon name="check" size={16} />
          <span>
            <b>{NAMES[o.q]}</b>
            <small>{o.text}</small>
          </span>
        </button>
      ))}
      <hr className="pm-sep" />
      <div className="pq-foot">
        {who}
        {noGpu() ? '没用上显卡加速' : '用上了显卡加速'}，现在按「{NAMES[playSmooth(q) ? 'smooth' : 'sharp']}」放。
      </div>
    </div>
  );
}
