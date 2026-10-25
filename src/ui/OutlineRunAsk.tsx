/**
 * 点「照大纲推演」先弹的那一下:多认真地试(没自然发生的情节,每条最多试几版引法)。
 *
 *   照大纲推演
 *   一段说明(先照常推完、逐条查;没发生的先悄悄引一把、多试几版挑最贴的;实在引不过去才硬改)
 *   多认真地试   快 / 标准(推荐)/ 细 / 自己填(每条最多试 [20] 版),每档写每条几版、硬改大约少几成、大约多久
 *   一句小字(时间怎么估的;算的时候能拖、能取消)                                     取消  开始推演
 *
 * 电脑上浮在正中;手机上是从底部升起的一整页(「‹ 大纲」回去,底下「开始推演」)。选的那档记在浏览器里,下次默认选它。
 * Esc、点外面 = 取消;开始推演 = 收起概览、开始推(outlineStore 的 startOutline)。
 */
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useEdits } from './editsStore';
import { closeOverview } from './overviewStore';
import { OUTLINE_OWN_MAX, OUTLINE_OWN_MIN, OUTLINE_TIERS, clampOwn, closeOutlineAsk, loadOutlineTries, saveOutlineTries, startOutline, triesOf, useOutlineUi, type OutlineTier, type OutlineTries } from './outlineStore';
import { useNarrow } from './device';
import { Icon } from './icons';
import './outline.css';

/**
 * 每档的说法:电脑 / 手机上的一句,电脑上大约多久(和手机上),手机上大约多久。
 * 时间是默认大小的世界、10 条每条都得试引法的情节在电脑上量的(手机按 4 倍估);硬改少多少是 20 个种子、每个 12 条这样的情节量的
 * (不引硬改 91 条;快 59、标准 54、细 54 条,顺着引成的 51 / 57 / 59 条)
 */
const TIER_TEXT: Record<Exclude<OutlineTier, 'own'>, { desc: string; short: string; pc: string; pcPhone: string; phone: string }> = {
  fast: { desc: '每条最多试 4 版。硬改的多一些', short: '每条最多 4 版，硬改的多一些', pc: '约 10 秒', pcPhone: '手机约 40 秒', phone: '约 40 秒' },
  std: { desc: '每条最多试 12 版。硬改的大约比「快」少一成', short: '每条最多 12 版，硬改的比「快」少约一成', pc: '约 15 秒', pcPhone: '手机约 1 分钟', phone: '约 1 分钟' },
  fine: { desc: '每条最多试 30 版。硬改的最少，大约比「快」少一成', short: '每条最多 30 版，硬改的最少', pc: '约 20 秒', pcPhone: '手机 1 分多钟', phone: '1 分多钟' },
};

const stop = (e: { stopPropagation(): void }) => e.stopPropagation();

/** App 里挂一个:outlineStore 的 ask 开着才出来 */
export function OutlineRunAsk() {
  const { ask } = useOutlineUi();
  return ask ? <AskDialog /> : null;
}

function AskDialog() {
  const phone = useNarrow();
  const n = useEdits().outline?.plots.length ?? 0;
  const [pick, setPick] = useState<OutlineTries>(loadOutlineTries);
  /** 自己填那一格正在打的字(打的时候可以是空的) */
  const [ownText, setOwnText] = useState(() => String(pick.own));
  const go = () => {
    const t = { ...pick, own: clampOwn(Number(ownText)) };
    saveOutlineTries(t);
    closeOutlineAsk();
    closeOverview();
    startOutline(triesOf(t));
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      closeOutlineAsk();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  const opt = (tier: OutlineTier, main: ReactNode, small: ReactNode, side: ReactNode) => (
    <div
      key={tier}
      className={`ol-opt${pick.tier === tier ? ' on' : ''}`}
      role="radio"
      aria-checked={pick.tier === tier}
      tabIndex={0}
      data-tier={tier}
      onClick={() => setPick((p) => ({ ...p, tier }))}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget && (e.preventDefault(), setPick((p) => ({ ...p, tier })))}
    >
      <span className="rd" />
      <span className="m">
        <b>{main}</b>
        <small>{small}</small>
      </span>
      <span className="t">{side}</span>
    </div>
  );
  const own = (
    <input
      className="ol-own"
      type="number"
      inputMode="numeric"
      min={OUTLINE_OWN_MIN}
      max={OUTLINE_OWN_MAX}
      value={ownText}
      aria-label="每条最多试几版"
      onClick={stop}
      onFocus={() => setPick((p) => ({ ...p, tier: 'own' }))}
      onChange={(e) => setOwnText(e.target.value)}
      onBlur={() => setOwnText(String(clampOwn(Number(ownText))))}
      onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), go())}
    />
  );
  const tiers = (
    <div className="ol-f">
      <label>多认真地试</label>
      <div className="ol-opts" role="radiogroup" aria-label="多认真地试">
        {OUTLINE_TIERS.map((t) => {
          const x = TIER_TEXT[t.id];
          return opt(
            t.id,
            <>
              {t.name}
              {t.id === 'std' && <em>推荐</em>}
            </>,
            phone ? x.short : x.desc,
            phone ? (
              x.phone
            ) : (
              <>
                <b>{x.pc}</b>
                <br />
                {x.pcPhone}
              </>
            ),
          );
        })}
        {opt('own', '自己填', <>每条最多试 {own} 版</>, phone ? null : '越多越久')}
      </div>
    </div>
  );
  const note = '时间是默认大小的世界、10 条情节估的；算的时候地图照样能拖，随时能取消，已经定下来的几条留着。';
  const node = phone ? (
    <div className="ol-ph ol-ask-ph" role="dialog" aria-label="照大纲推演" data-testid="outline-ask">
      <div className="grab" />
      <div className="ol-ph-hd">
        <button className="back" data-act="outline-ask-back" onClick={closeOutlineAsk}>
          <Icon name="back" size={16} />
          大纲
        </button>
        <b>照大纲推演</b>
      </div>
      <div className="ol-ph-body">
        <div className="ol-note">{n} 条情节。没自然发生的先悄悄引一把、后台多试几版挑最贴的；实在引不过去才直接改过来，并标出来。</div>
        {tiers}
        <div className="ol-note">{note}</div>
      </div>
      <div className="ol-ph-ft">
        <button className="ol-btn primary" data-act="outline-ask-go" onClick={go}>
          开始推演
        </button>
      </div>
    </div>
  ) : (
    <>
      <div className="ol-ask-scrim" onClick={closeOutlineAsk} />
      <div className="ol-ask-wrap">
        <div className="ol-ask" role="dialog" aria-label="照大纲推演" data-testid="outline-ask" onPointerDown={stop} onClick={stop}>
          <h3>照大纲推演</h3>
          <p className="lead">
            {n} 条情节。先照常推完，再按年份一条条查：没自然发生的，先在它前面几十年悄悄引一把（让相关的国家更好战、国力更强），后台多试几版挑最贴的；实在引不过去，才在那一年直接改过来，并标出来。
          </p>
          {tiers}
          <div className="ol-note">{note}</div>
          <div className="ft">
            <button className="ol-btn small" data-act="outline-ask-cancel" onClick={closeOutlineAsk}>
              取消
            </button>
            <button className="ol-btn small primary" data-act="outline-ask-go" onClick={go}>
              开始推演
            </button>
          </div>
        </div>
      </div>
    </>
  );
  return createPortal(node, document.body);
}
