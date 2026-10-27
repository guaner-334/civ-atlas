/**
 * 照故事找世界那一页(新建世界第 1 步点「照故事找世界」进来):
 *
 *   电脑   左边一张浮在地图上的卡片(和侧栏一样,宽一点):条件 → 搜的时候 / 结果 → 一个结果;右边是地图(FinderMap.tsx)
 *   手机   条件是整页;搜的时候、结果、一个结果是底部卡片,上面露出地图
 *
 * 页里的三页见 FinderConds.tsx、FinderResults.tsx;状态在 finderStore.ts;「用这个世界」、离开、地图飞过去由 App 接。
 */
import { useState } from 'react';
import { FinderConds } from './FinderConds';
import { FinderDetail, FinderResults, type FinderFlyTo, type FinderPreview } from './FinderResults';
import { finderEstimate, useFinder } from './finderStore';
import { Icon } from './icons';
import './finder.css';

export interface FinderPageProps {
  phone: boolean;
  /** 新建世界现在的种子(「都用种子 N 这张」) */
  seed: number;
  /** 打开着的那个结果的世界(生成好了才有) */
  preview: FinderPreview | null;
  /** 「‹ 新建世界」 */
  onExit: () => void;
  /** 「用这个世界」(选中的那一个) */
  onUse: () => void;
  onFly: (to: FinderFlyTo) => void;
}

export function FinderPage(p: FinderPageProps) {
  const ui = useFinder();
  const [full, setFull] = useState(false);
  const page = ui.page === 'conds' || !ui.run ? 'conds' : ui.page === 'detail' && ui.sel ? 'detail' : 'results';
  const estimate = (n: number) => finderEstimate(n, p.phone);
  const condsTop = (
    <div className="fd-top">
      <button className="fd-back" data-act="finder-exit" onClick={p.onExit}>
        <Icon name="back" size={15} />
        新建世界
      </button>
      <div className="fd-title">照故事找世界</div>
      <div className="fd-lead">把一批世界各推一遍，挑出最合你故事的几个。</div>
    </div>
  );
  const body =
    page === 'conds' ? (
      <>
        {condsTop}
        <FinderConds ui={ui} phone={p.phone} seed={p.seed} estimate={estimate} />
      </>
    ) : page === 'detail' ? (
      <FinderDetail ui={ui} phone={p.phone} preview={p.preview} onUse={p.onUse} onFly={p.onFly} />
    ) : (
      <FinderResults ui={ui} phone={p.phone} onUse={p.onUse} />
    );
  const stop = (e: { stopPropagation(): void }) => e.stopPropagation();
  if (!p.phone)
    return (
      <aside className="fd-panel" data-page={page} aria-label="照故事找世界" onPointerDown={stop} onWheel={stop} onDoubleClick={stop}>
        {body}
      </aside>
    );
  if (page === 'conds')
    return (
      <section className="fd-phone-page" aria-label="照故事找世界">
        {body}
      </section>
    );
  return (
    <section className={`fd-sheet${full ? ' full' : ''}`} data-page={page} aria-label="照故事找世界" onPointerDown={stop} onWheel={stop}>
      <button className="fd-grip" data-act="finder-sheet" aria-label={full ? '收起' : '展开'} aria-expanded={full} onClick={() => setFull(!full)}>
        <i aria-hidden="true" />
      </button>
      {body}
    </section>
  );
}
