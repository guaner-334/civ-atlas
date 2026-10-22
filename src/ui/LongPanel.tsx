/**
 * 故事长图的选项。宽屏:替换左边侧栏的一张卡片(和导出视频的面板同一个位置、同一套样子);
 * 手机:顶上一条(取消、保存),底下一张小卡片放常改的几项(范围、哪一国、分几段、每段大事、AI 段落、存成、底部网址),
 * 标题、地图张数照默认(电脑上能改)。
 * 世界写过 AI 史书时多一行「AI 段落:带上 / 不带」;史书写完以后又改了世界的,那一行写明没放。
 *
 * 范围选"一国"时多一行"哪一国":宽屏点开一个菜单,手机从下面升起一张列表 —— 现存的按州数排在上面,已亡的写起止年份。
 * 保存:宽屏直接下载(切成几张的先问一句,浏览器可能要允许下载多个文件);手机能走分享菜单的走分享菜单(直接存进相册),
 * 不能的照宽屏那样下载。还在画、还在压 JPEG 时按钮是灰的。
 */
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Civ } from '../gen/civ/types';
import { chronicleEraYears } from '../gen/civ/chronicle';
import type { Style } from './mapLayers';
import { PolityFlag } from './Flag';
import { Seg, Switch } from './FilmPanel';
import { useFilmSource } from './filmSource';
import { closeFilm } from './filmStore';
import { longPolities, polityLastYear, type LongScope } from './longPlan';
import { useEra } from './editsStore';
import { spaced, yearShort } from '../gen/era';
import { useNotesVersion } from '../ai/library';
import { canShareLong, downloadLong, longBookOf, longDefaultTitle, longFiles, longPolity, longResult, longSizeText, shareLong, type LongBookState } from './longRun';
import { getLong, setLong, setLongScope, useLong, type LongPer, type LongSegs } from './longStore';
import './film.css';
import './long.css';

export interface LongPanelProps {
  phone: boolean;
  /** 屏幕上的画风(面板里写一句"现在是手绘") */
  style: Style;
  /** 屏幕上的底图名(手绘、卫星、白模、高程……) */
  baseName?: string;
}

const SCOPES = [
  ['world', '整个世界'],
  ['one', '一国'],
] as const;
const SEGS = [
  [4, '最多 4 段'],
  [6, '6 段'],
  [8, '8 段'],
] as const satisfies readonly (readonly [LongSegs, string])[];
const PERS = [
  [3, '3 件'],
  [5, '5 件'],
  ['all', '全部'],
] as const satisfies readonly (readonly [LongPer, string])[];
const MAPS = [
  ['each', '每段一张'],
  ['first', '只要开头一张'],
] as const;
const AIS = [
  ['on', '带上'],
  ['off', '不带'],
] as const;
const SPLITS = [
  ['one', '一整张'],
  ['split', '切成 3:4'],
] as const;
const STYLE_NAME: Record<Style, string> = { fantasy: '手绘', realistic: '写实', data: '数据图层' };

const polCache = new WeakMap<Civ, ReturnType<typeof longPolities>>();
function polsOf(full: Civ) {
  let v = polCache.get(full);
  if (!v) polCache.set(full, (v = longPolities(full)));
  return v;
}

/** 保存:手机能分享的走分享菜单;切成几张的先问一句;别的直接下载 */
function save(phone: boolean) {
  const files = longFiles();
  if (!files) return;
  if (phone && canShareLong(files)) return shareLong(files);
  if (files.length > 1 && !getLong().ask) return setLong({ ask: true });
  setLong({ ask: false });
  void downloadLong(files);
}

/** "JPEG，1080×9236，约 2.5 MB"(切开:"JPEG，8 张，每张 1080×1440，约 2.6 MB") */
function sizeLine(): string {
  const r = longResult();
  if (!r) return '';
  const size = longSizeText();
  const dims = r.pages ? `${r.pages.length} 张，每张 1080×1440` : `1080×${r.lay.h}`;
  return `JPEG，${dims}${size ? `，${size}` : ''}`;
}

/** 选哪一国:宽屏的菜单 / 手机的列表 */
function PolityList({ full, cur, phone, onPick }: { full: Civ; cur: number | null; phone: boolean; onPick: (id: number) => void }) {
  const { alive, fallen } = polsOf(full);
  const era = useEra();
  const row = (id: number, name: string, small: string) => (
    <button key={id} className={`long-pr${id === cur ? ' on' : ''}`} data-act={`long-pol-${id}`} onClick={() => onPick(id)}>
      <span className="nm">{name}</span>
      <small>{small}</small>
      {phone && <i />}
    </button>
  );
  const group = (h: string, items: JSX.Element[]) =>
    items.length ? (
      <>
        <div className="long-ph">{h}</div>
        {phone ? <div className="long-pg-grp">{items}</div> : items}
      </>
    ) : null;
  return (
    <>
      {group(
        '现存',
        alive.map((p) => row(p.id, p.name, `${p.regions} 州`)),
      )}
      {alive.length > 0 && fallen.length > 0 && !phone && <div className="long-sep" />}
      {group(
        '已亡',
        fallen.map((p) => row(p.id, p.name, `${yearShort(p.from, era)}—${yearShort(p.to, era)}`)),
      )}
    </>
  );
}

/** 哪一国:旗 + 国名(宽屏:像下拉框;手机:一整行,右边一个箭头) */
function PickRow({ full, id, phone, onOpen }: { full: Civ; id: number | null; phone: boolean; onOpen: () => void }) {
  const p = id !== null ? full.polities[id] : null;
  const name = p ? (polsOf(full).alive.find((x) => x.id === p.id) ?? polsOf(full).fallen.find((x) => x.id === p.id))?.name : '';
  return (
    <button className={phone ? 'long-prow' : 'long-pick'} data-act="long-pick" onClick={onOpen}>
      {p && <PolityFlag id={p.id} year={polityLastYear(full, p)} w={20} className="long-flag" />}
      <span className="nm">{name}</span>
    </button>
  );
}

/** 「AI 段落」那一行:能用 = 带上 / 不带;对不上 = 写一句没放(没写过史书不出这一行) */
function AiRow({ book, on }: { book: LongBookState; on: boolean }) {
  if (book.kind === 'none') return null;
  return (
    <div className="film-lbl">
      <b>AI 段落</b>
      {book.kind === 'ok' ? (
        <Seg value={on ? 'on' : 'off'} items={AIS} act="long-ai" onPick={(v) => setLong({ ai: v === 'on' })} />
      ) : (
        <span className="val">史书是改世界以前写的，没放</span>
      )}
    </div>
  );
}

export function LongPanel({ phone, style, baseName }: LongPanelProps) {
  const s = useLong();
  const src = useFilmSource();
  const notesVer = useNotesVersion();
  const full = src?.full ?? null;
  const seed = src ? src.at(src.full.endYear).world.params.seed : 0;
  const files = s.busy ? null : longFiles();
  const ready = !!files;
  // 还没有国家的世界:只能做整个世界
  const noPol = !!full && !full.polities.length;
  const scope: LongScope = noPol ? 'world' : s.scope;
  const pol = full && scope === 'one' ? longPolity(full) : null;
  const title = s.title ?? (full ? longDefaultTitle(full, seed) : '');
  // 一段多少年:画好的那一张按选项算出来的;还没画好先按编年史的分法写
  const span = (s.ver ? longResult()?.span : undefined) ?? (full ? chronicleEraYears(full.endYear) : 500);
  const book: LongBookState = useMemo(
    () => (full ? longBookOf(full, scope === 'one' ? pol : null) : { kind: 'none' }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [full, scope, pol, notesVer],
  );
  const pickRef = useRef<HTMLDivElement>(null);
  const [menuAt, setMenuAt] = useState<{ left: number; top: number; maxH: number } | null>(null);
  const stop = (e: { stopPropagation(): void }) => e.stopPropagation();

  // 宽屏:菜单开在"哪一国"那一行下面
  useLayoutEffect(() => {
    if (phone || !s.picker) return setMenuAt(null);
    const r = pickRef.current?.getBoundingClientRect();
    if (r) setMenuAt({ left: r.left, top: r.bottom + 6, maxH: window.innerHeight - r.bottom - 20 });
  }, [phone, s.picker]);

  // 手机:卡片多高,预览就让出多高(long.css 的 --long-sheet-h)
  const sheetRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = sheetRef.current;
    const app = el?.closest('.app') as HTMLElement | null;
    if (!el || !app) return;
    const set = () => app.style.setProperty('--long-sheet-h', `${el.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => {
      ro.disconnect();
      app.style.removeProperty('--long-sheet-h');
    };
  }, [phone]);

  const pick = (id: number) => setLongScope('one', id);
  const busyNote = s.busy ? '画好以后就能保存' : '';
  const segs = <Seg value={s.segs} items={SEGS} act="long-segs" onPick={(v) => setLong({ segs: v })} />;
  const pers = <Seg value={s.per} items={PERS} act="long-per" onPick={(v) => setLong({ per: v })} />;
  const brand = <Switch on={s.brand} label="底部网址" act="long-brand" onFlip={() => setLong({ brand: !s.brand })} />;

  // 手机上卡片里那一句:"每 500 年一段，每段一张地图和 3 件大事。1080×7786"
  const phoneFine = useMemo(() => {
    const r = longResult();
    const dims = !r ? '' : r.pages ? `${r.pages.length} 张，每张 1080×1440` : `1080×${r.lay.h}`;
    const what = `${scope === 'one' ? '这一国的' : ''}${s.per === 'all' ? '全部大事' : `${s.per} 件大事`}`;
    return `每 ${span} 年一段，每段${s.maps === 'each' ? `一张地图和${spaced(what)}` : spaced(what)}。${dims}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [span, scope, s.per, s.maps, s.ver]);

  if (phone) {
    const many = files && files.length > 1;
    return (
      <>
        <div className="long-nav" onPointerDown={stop} onClick={stop}>
          <button className="film-link" data-act="film-close" onClick={closeFilm}>
            取消
          </button>
          <b>故事长图</b>
          <button className="film-link s" data-act="long-save" disabled={!ready} onClick={() => save(true)}>
            保存
          </button>
        </div>
        <div className="film-sheet long-sheet" ref={sheetRef} onPointerDown={stop} onClick={stop} onDoubleClick={stop}>
          {s.ask && many ? (
            <div className="long-ask">
              <b>一次下载 {files.length} 张图片</b>
              <div className="film-hint">
                浏览器可能会问“允许这个网页下载多个文件吗”，点允许。文件是 {files[0].name} 到 -{files.length}.jpg。
              </div>
              <div className="long-row2">
                <button className="film-btn plain" data-act="long-ask-no" onClick={() => setLong({ ask: false })}>
                  取消
                </button>
                <button className="film-btn primary" data-act="long-ask-yes" onClick={() => save(true)}>
                  下载 {files.length} 张
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="film-lbl">
                <b>范围</b>
                <Seg value={scope} items={SCOPES} act="long-scope" off={noPol ? ['one'] : undefined} onPick={(v) => setLongScope(v)} />
              </div>
              {scope === 'one' && full && (
                <div className="film-lbl">
                  <b>国家</b>
                  <PickRow full={full} id={pol} phone onOpen={() => setLong({ picker: true })} />
                </div>
              )}
              <div className="film-lbl">
                <b>分几段</b>
                {segs}
              </div>
              <div className="film-lbl">
                <b>每段大事</b>
                {pers}
              </div>
              <AiRow book={book} on={s.ai} />
              <div className="film-lbl">
                <b>存成</b>
                <Seg value={s.split ? 'split' : 'one'} items={SPLITS} act="long-split" onPick={(v) => setLong({ split: v === 'split', ask: false })} />
              </div>
              <div className="film-two">
                <div>
                  底部网址
                  {brand}
                </div>
                <div />
              </div>
              <div className="film-fine">{phoneFine}</div>
            </>
          )}
        </div>
        {s.picker && full && (
          <>
            <div className="long-shade" onClick={() => setLong({ picker: false })} />
            <div className="long-list" onPointerDown={stop} onClick={stop}>
              <div className="long-list-hd">
                <button className="film-link" data-act="long-pick-close" onClick={() => setLong({ picker: false })}>
                  取消
                </button>
                <b>选一个国家</b>
              </div>
              <div className="long-list-body">
                <PolityList full={full} cur={pol} phone onPick={pick} />
              </div>
            </div>
          </>
        )}
      </>
    );
  }

  const many = files && files.length > 1;
  return (
    <aside className="film-side" onPointerDown={stop} onClick={stop} onDoubleClick={stop}>
      <button className="film-back" data-act="film-close" onClick={closeFilm}>
        回到地图
      </button>
      <div className="film-ttl">
        <b>故事长图</b>
        <span>按时代一段一段：那时的地图和几件大事</span>
      </div>
      <div className="film-grp">
        <div className="film-lbl">
          <b>范围</b>
          <Seg value={scope} items={SCOPES} act="long-scope" off={noPol ? ['one'] : undefined} onPick={(v) => setLongScope(v)} />
        </div>
        {scope === 'one' && full && (
          <div className="film-lbl" ref={pickRef}>
            <b>哪一国</b>
            <PickRow full={full} id={pol} phone={false} onOpen={() => setLong({ picker: !s.picker })} />
          </div>
        )}
      </div>
      <div className="film-grp">
        <div className="film-lbl">
          <b>分几段</b>
          {segs}
        </div>
        <div className="film-lbl">
          <b>每段大事</b>
          {pers}
        </div>
        <div className="film-hint">
          {scope === 'one'
            ? `每 ${span} 年一段，按这一国存续的年数分，不超过上限。没列出的大事在编年史里都有`
            : `每 ${span} 年一段，和导出的编年史分法一样；推得更久的世界一段更长，不超过上限。没列出的大事在编年史里都有`}
        </div>
      </div>
      <div className="film-grp">
        <div className="film-lbl">
          <b>地图</b>
          <Seg value={s.maps} items={MAPS} act="long-maps" onPick={(v) => setLong({ maps: v })} />
        </div>
        <AiRow book={book} on={s.ai} />
        {book.kind === 'ok' && <div className="film-hint">这个世界写过{book.name}：每段配上那一章的开头，标「AI 写」；选「不带」只导出不是 AI 写的部分</div>}
      </div>
      <div className="film-grp">
        <div className="film-lbl">
          <b>存成</b>
          <Seg value={s.split ? 'split' : 'one'} items={SPLITS} act="long-split" onPick={(v) => setLong({ split: v === 'split', ask: false })} />
        </div>
        <div className="film-hint">一整张发微博、QQ、微信、贴吧；切成 3:4 的几张发小红书，大多一段正好一张</div>
      </div>
      <div className="film-grp">
        <div className="film-lbl">
          <b>标题</b>
          <input className="film-field" value={title} maxLength={40} data-act="long-title" onChange={(e) => setLong({ title: e.target.value })} />
        </div>
        <div className="film-line" />
        <div className="film-lbl">
          <b>底部网址</b>
          <span className="sp" />
          {brand}
        </div>
        <div className="film-hint">最下面一行“文明与地图 atlas.gerdor.top”</div>
      </div>
      {!s.ask && book.kind === 'none' && <div className="film-fine">地图照屏幕上的画风（现在是{baseName ?? STYLE_NAME[style]}）。选中了一个国家时，范围默认是「一国」。</div>}
      <div className="film-foot">
        {s.ask && many ? (
          <div className="long-ask">
            <b>一次下载 {files.length} 张图片</b>
            <div className="film-hint">
              浏览器可能会问“允许这个网页下载多个文件吗”，点允许。文件是 {files[0].name} 到 -{files.length}.jpg。
            </div>
            <div className="long-row2">
              <button className="film-btn plain" data-act="long-ask-no" onClick={() => setLong({ ask: false })}>
                取消
              </button>
              <button className="film-btn primary" data-act="long-ask-yes" onClick={() => save(false)}>
                下载 {files.length} 张
              </button>
            </div>
          </div>
        ) : (
          <>
            <button className="film-btn primary" data-act="long-save" disabled={!ready} onClick={() => save(false)}>
              保存图片
            </button>
            <div className="film-fine center">{busyNote || sizeLine() || ' '}</div>
          </>
        )}
      </div>
      {menuAt && full && (
        <>
          <div className="long-catch" onClick={() => setLong({ picker: false })} />
          <div className="long-menu" style={{ left: menuAt.left + 68, top: menuAt.top, maxHeight: menuAt.maxH }}>
            <PolityList full={full} cur={pol} phone={false} onPick={pick} />
          </div>
        </>
      )}
    </aside>
  );
}
