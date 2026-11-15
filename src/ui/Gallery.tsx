/**
 * 作品墙(数据和接口在 account/gallery.ts):作者投来、挑过以后放上去的世界、地图、新建参数和规则。只能看、拿来用、举报,
 * 没有评论、点赞,也不写打开次数。服务器没开作品墙(或没配服务器)时这里的东西一样都不出现。
 *
 *   GalleryPage       作品墙那一页(样子和「我的世界」一套):本月精选(配推荐语)→ 正在进行的挑战 → 全部作品(按上架时间,
 *                     页签只按种类分)。加载中先占灰色的位置、取不到说清楚 +「再试一次」、还没有作品说一句在挑。
 *                     手机上精选一行横着滑,全部作品两列、不写上架日期。右上「怎么上作品墙」(HowToDialog:服务器开着投稿时两条路
 *                     ——网站上投、群里投,不然只有群里投;带上哪三样、投稿须知)
 *   GalleryFeatured   「我的世界」一个都没有时,空页面下面的一排本月精选 +「去作品墙看全部」
 *   PresetWorkDialog  点开一个新建参数作品:封面星球、这套参数、作者的一句话;「用这套参数新建」
 *                     点开一个世界、地图作品是它们的介绍窗(GalleryWorkDialogs.tsx,点了才下载);
 *                     点开一个规则作品是调规则的大卡(rules/RulesSheet.tsx,盖在这一页上)
 *   WorkGone          打开作品的地址时:取的时候一页空白,撤下了(或没有)整页写"这个作品已经撤下了"
 *   ReportDialog      举报(窗在 ReportBox.tsx,点了才下载)。同一台设备对同一个作品只能举报一次(分享短链接的举报同一个窗,ShareReportDialog)
 *
 * 打开世界 / 地图作品以后的顶条、地图作品的星球在 GalleryWork.tsx(首页不用下载星球那一套);
 * 作品墙整页在 GalleryPage.tsx,怎么上作品墙与新建参数弹窗在 GalleryDialogs.tsx(都点开才下载)。
 * 样式在 gallery.css;卡片、页签、弹窗、单选照「我的世界」(worlds.css)和账号窗口(account.css)的。
 */
import { Suspense, lazy, type ReactNode } from 'react';
import { Icon } from './icons';
import type { SharedPreset } from './presetStore';
import { rulesUiOn } from './rules/flag';
import { DEFAULT_PARAMS } from '../gen/params';
import {
  WORK_KIND_NAME,
  coverUrl,
  reportWork,
  useGallery,
  type GalleryItem,
  type GalleryList,
  type GalleryWork,
  type ReportReason,
  type WorkKind,
} from '../account/gallery';
import type { WorkGoneState } from './world/worldTarget';
import type { SharedWorld } from './fullWorldPull';
import './gallery.css';

const ReportBox = lazy(() => import('./ReportBox'));

type GalleryPageModule = typeof import('./GalleryPage');
const loadGalleryPage = () => import('./GalleryPage');
const GalleryWall = lazy(() =>
  loadGalleryPage().then(
    (m) => ({ default: m.GalleryWall }),
    () => ({ default: (() => null) as unknown as GalleryPageModule['GalleryWall'] }),
  ),
);
const WorkGoneView = lazy(() =>
  loadGalleryPage().then(
    (m) => ({ default: m.WorkGoneView }),
    () => ({ default: (() => null) as unknown as GalleryPageModule['WorkGoneView'] }),
  ),
);

type GalleryPluginsModule = typeof import('./plugins/GalleryPlugins');
export const loadPlugins = () => import('./plugins/GalleryPlugins');
export const PluginCards = lazy(() =>
  loadPlugins().then(
    (m) => ({ default: m.PluginCards }),
    () => ({ default: (() => <p className="gl-none">没能打开插件，重新加载网页试试</p>) as GalleryPluginsModule['PluginCards'] }),
  ),
);

/** 上架日期:"10 月 20 日"(不是今年的带上年份) */
export function dayText(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const md = `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
  return d.getFullYear() === new Date().getFullYear() ? md : `${d.getFullYear()} 年 ${md}`;
}

/** 挑战的截止日期:"11 月 30 日截止" */
export function dueText(s: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? `${Number(m[2])} 月 ${Number(m[3])} 日截止` : '';
}

/** 出处的说法:砚山的「金阳洋两岸」(没署名就只写作品名) */
export function workWho(w: Pick<GalleryWork, 'by' | 'title'>): string {
  return `${w.by ? `${w.by}的` : ''}「${w.title || '未命名'}」`;
}

// ---------------------------------------------------------------------------
// 卡片

/** 用了非官方规则的世界:规则叫什么 */
const worldRules = (w: GalleryWork) => (w.kind === 'world' && w.rules && rulesUiOn() ? w.rules.name : '');

function Cover({ w }: { w: GalleryWork }) {
  const url = coverUrl(w.id);
  const rules = worldRules(w);
  return (
    <span className={`gl-cover${w.kind === 'preset' ? ' planet' : ''}`} style={url ? { backgroundImage: `url("${url}")` } : undefined}>
      <span className="gl-tags">
        <span className="gl-tag">{WORK_KIND_NAME[w.kind]}</span>
        {rules && <span className="gl-tag rl">规则：{rules}</span>}
      </span>
    </span>
  );
}

/** 搜的时候把搜到的字标出来 */
type Hl = (s: string) => ReactNode;

/** 规则作品卡上那一行:「改了 6 项」+ 最显眼的几处(还有没写到的接省略号) */
function RulesLine({ w, t }: { w: GalleryWork; t: Hl }) {
  const r = w.rules;
  if (!r) return w.blurb ? <span className="gl-blurb">{t(w.blurb)}</span> : null;
  const items = /^(改了|和官方)/.test(r.brief) ? 0 : r.brief.split('、').length;
  return (
    <span className="gl-rule">
      <span className="gl-n">改了 {r.changed} 项</span>
      {t(r.brief)}
      {items > 0 && r.changed > items ? '……' : ''}
    </span>
  );
}

/** 一张作品卡:card = 全部作品里的(封面、作品名、上架日期、署名、一句话,规则作品换成改了几项);feat = 精选(多一段推荐语);mini = 挑战里、空页面的(封面、名字、署名) */
export function WorkCard({ w, kind, note, phone, onOpen, hl }: { w: GalleryWork; kind: 'card' | 'feat' | 'mini'; note?: string; phone: boolean; onOpen: (w: GalleryWork) => void; hl?: Hl }) {
  const t = (s: string) => (hl ? hl(s) : s);
  return (
    <button className={`gl-card ${kind}${hl ? ' found' : ''}`} data-work={w.id} data-kind={w.kind} onClick={() => onOpen(w)}>
      <Cover w={w} />
      <span className="gl-meta">
        <span className="gl-row1">
          <b className="gl-name">{t(w.title || '未命名')}</b>
          {kind === 'card' && !phone && <span className="gl-at">{dayText(w.addedAt)}</span>}
        </span>
        {w.by && <span className="gl-by">{t(w.by)}</span>}
        {kind === 'card' && (w.kind === 'rules' ? <RulesLine w={w} t={t} /> : w.blurb && <span className="gl-blurb">{t(w.blurb)}</span>)}
        {kind === 'feat' && note && <span className="gl-note">{note}</span>}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// 作品墙那一页(界面在 GalleryPage.tsx,进作品墙才下载)

export type Tab = 'all' | WorkKind;
/** 回到作品墙还是上次看的页签;搜索框的字回到我的世界就清空 */
export const galleryView: { tab: Tab; find: string } = { tab: 'all', find: '' };
export function forgetGalleryFind(): void {
  galleryView.find = '';
}

export interface GalleryPageProps {
  phone: boolean;
  /** 「‹ 我的世界」 */
  onHome: () => void;
  /** 点开一个世界 / 地图作品,没给 onWorld 时(先出来的首页:交给主程序去开窗;新建参数、规则在这一页上打开) */
  onOpen: (w: GalleryWork) => void;
  /** 新建参数作品里点了「用这套参数新建」 */
  onPreset: (p: SharedPreset) => void;
  /** 世界作品的窗里「打开这个世界」,世界文件取完了(只存了存档的旧作品没有 file)。给了它,世界、地图作品在这一页上开窗 */
  onWorld?: (it: GalleryItem, file?: SharedWorld) => void;
  /** 地图作品的窗里「看看这颗星球」 */
  onPlanet?: (it: GalleryItem) => void;
  /** 地图作品的窗里「用这张地图打造文明」 */
  onMapCiv?: (it: GalleryItem) => void;
  /** 一进来就开着窗的作品(打开它的地址时;取好了的) */
  shown?: GalleryItem | null;
  /** 一进来就开着窗的世界 / 地图作品(列表里那一项,窗里再取) */
  opening?: GalleryWork;
  /** 开着窗的作品换了(编号;关上 = null):网址跟着换 */
  onShown?: (id: string | null) => void;
}

export function GalleryPage(p: GalleryPageProps) {
  return (
    <Suspense fallback={null}>
      <GalleryWall {...p} />
    </Suspense>
  );
}

/** 调规则的入口关着时,规则作品不露 */
export function wallList(list: GalleryList): GalleryList {
  return rulesUiOn() ? list : { ...list, works: list.works.filter((w) => w.kind !== 'rules') };
}

// ---------------------------------------------------------------------------
// 「我的世界」空页面下面的精选

export function GalleryFeatured({ phone, onOpen, onGallery }: { phone: boolean; onOpen: (w: GalleryWork) => void; onGallery: () => void }) {
  const g = useGallery();
  const list = g.list && wallList(g.list);
  if (!list) return null;
  const byId = new Map(list.works.map((w) => [w.id, w]));
  const items = list.featured
    .map((f) => byId.get(f.id))
    .filter((w): w is GalleryWork => !!w)
    .slice(0, 4);
  if (!items.length) return null;
  return (
    <section className="gl-fe" aria-label="看看别人做了什么" data-testid="gallery-featured">
      <div className="gl-sec-h">
        <h2>看看别人做了什么</h2>
        {!phone && <small>作品墙上的本月精选，点开随便看</small>}
        <span className="gl-sp" />
        <button className="gl-more" data-act="gallery" onClick={onGallery}>
          {phone ? '全部' : '去作品墙看全部'}
          <Icon name="chevron" size={phone ? 12 : 13} />
        </button>
      </div>
      <div className="gl-grid">
        {items.map((w) => (
          <WorkCard key={w.id} w={w} kind="mini" phone={phone} onOpen={onOpen} />
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 新建参数作品的七格(新建参数窗、地图作品介绍窗共用)

/** 这套参数的七格:种子、陆地比例、大陆数量、板块数量、造山强度、气温和降水、精细度 */
export function presetRows(p: SharedPreset): [string, string][] {
  const q = { ...DEFAULT_PARAMS, ...p.params };
  const t = q.temperature;
  return [
    ['种子', p.seed !== undefined ? String(p.seed) : '随机'],
    ['陆地比例', `${Math.round(q.landFraction * 100)}%`],
    ['大陆数量', q.continents ? `${q.continents} 块` : '不指定'],
    ['板块数量', String(q.plates)],
    ['造山强度', q.mountains.toFixed(2)],
    ['气温、降水', `${t > 0 ? '+' : ''}${t}°C、${q.rainfall.toFixed(2)}`],
    ['精细度', `${Math.round(q.cells / 1000)}k 地块`],
  ];
}

// ---------------------------------------------------------------------------
// 打开作品的地址:取的时候、撤下了、取不到

export interface WorkGoneProps {
  phone: boolean;
  state: WorkGoneState;
  onHome: () => void;
  onGallery: () => void;
  onRetry: () => void;
}

export function WorkGone(p: WorkGoneProps) {
  return (
    <Suspense fallback={null}>
      <WorkGoneView {...p} />
    </Suspense>
  );
}

// ---------------------------------------------------------------------------
// 举报

export function ReportDialog({ phone, work, onClose }: { phone: boolean; work: GalleryWork; onClose: () => void }) {
  return (
    <Suspense fallback={null}>
      <ReportBox phone={phone} what="work" lead={workWho(work)} send={(r) => reportWork(work.id, r)} onClose={onClose} />
    </Suspense>
  );
}

/** 举报别人的分享短链接:lead 是「谁分享的「世界名」」;send 发出去(这台设备举报过的记下) */
export function ShareReportDialog({ phone, lead, send, onClose }: { phone: boolean; lead: string; send: (r: ReportReason) => Promise<void>; onClose: () => void }) {
  return (
    <Suspense fallback={null}>
      <ReportBox phone={phone} what="share" lead={lead} send={(r) => send(r as ReportReason)} onClose={onClose} />
    </Suspense>
  );
}
