/**
 * 作品墙上搜的时候列表那一块(框里有字才下载):「搜到 N 个」、每类搜到几个、搜到的字标底色;
 * 「全部」里插件排在别的作品后面单独一组;没搜到、这一类没有别类有时说清楚。
 */
import { Suspense, type ReactNode } from 'react';
import type { GalleryList, GalleryWork } from '../account/gallery';
import { PluginCards, WorkCard, type Tab } from './Gallery';
import { findHit, findKeys, findLead, findPieces, findWords, fold, workTexts } from './gallerySearch';
import { Icon } from './icons';
import './galleryFound.css';

const folded = new WeakMap<GalleryWork, string[]>();
function textsOf(w: GalleryWork): string[] {
  let t = folded.get(w);
  if (!t) folded.set(w, (t = workTexts(w).map(fold)));
  return t;
}

export interface GalleryFoundProps {
  list: GalleryList;
  q: string;
  /** 露出来的页签(插件入口关着时没有「插件」,也不搜插件) */
  tabs: { id: Tab; name: string }[];
  tab: Tab;
  phone: boolean;
  /** 种类切换,数字换成每类搜到几个 */
  seg: (count: (t: Tab) => number) => ReactNode;
  onTab: (t: Tab) => void;
  onOpen: (w: GalleryWork) => void;
  onClear: () => void;
}

export function GalleryFound({ list, q, tabs, tab, phone, seg, onTab, onOpen, onClear }: GalleryFoundProps) {
  const words = findWords(q);
  const keys = findKeys(words);
  const hit = (w: GalleryWork) => findHit(textsOf(w), keys);
  const works = list.works.filter(hit);
  const plugins = tabs.some((t) => t.id === 'plugin') ? list.plugins.filter(hit) : [];
  const count = (t: Tab) => (t === 'all' ? works.length + plugins.length : t === 'plugin' ? plugins.length : works.filter((w) => w.kind === t).length);
  const here = count(tab);
  const shown = tab === 'all' ? works : works.filter((w) => w.kind === tab);
  const hl = (s: string) =>
    findPieces(s, keys).map((p, i) =>
      p.hit ? (
        <mark key={i} className="gl-hit">
          {p.text}
        </mark>
      ) : (
        p.text
      ),
    );
  const name = (t: Tab) => tabs.find((x) => x.id === t)?.name ?? '';
  const said = `「${words.join(' ')}」`;
  // 这一类没有:别的类里搜到最多的那一类
  const other = here ? null : tabs.reduce<Tab | null>((a, t) => (t.id !== 'all' && count(t.id) > (a ? count(a) : 0) ? t.id : a), null);

  return (
    <div className="gl-body">
      <section aria-label="搜到的作品" data-testid="gallery-found">
        <div className="gl-sec-h">
          <h2>搜到 {count('all')} 个</h2>
          {!phone && here > 0 && <small>{findLead(words)}</small>}
          {!phone && (
            <>
              <span className="gl-sp" />
              {seg(count)}
            </>
          )}
        </div>
        {phone && seg(count)}
        {here ? (
          <>
            {shown.length > 0 && (
              <div className="gl-grid" role="list">
                {shown.map((w) => (
                  <WorkCard key={w.id} w={w} kind="card" phone={phone} onOpen={onOpen} hl={hl} />
                ))}
              </div>
            )}
            {(tab === 'all' || tab === 'plugin') && plugins.length > 0 && (
              <>
                {tab === 'all' && (
                  <div className="gl-grp-h">
                    插件<small>{plugins.length} 个</small>
                  </div>
                )}
                <Suspense fallback={null}>
                  <PluginCards works={plugins} wall={list.plugins} phone={phone} onOpen={onOpen} hl={hl} />
                </Suspense>
              </>
            )}
          </>
        ) : (
          <div className="gl-miss" role="status">
            <span className="gl-miss-ic">
              <Icon name="search" size={26} />
            </span>
            <h3>{other ? `${name(tab)}里没有搜到${said}` : `没有搜到${said}`}</h3>
            <p>{other ? `${name(other)}里有 ${count(other)} 个` : '试试作品名或作者名里的字'}</p>
            <div className="gl-miss-acts">
              {other && (
                <button className="mw-btn blue" data-act="gallery-find-tab" onClick={() => onTab(other)}>
                  看{name(other)}里的 {count(other)} 个
                </button>
              )}
              <button className="mw-btn" data-act="gallery-find-clear" onClick={onClear}>
                清空搜索
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
