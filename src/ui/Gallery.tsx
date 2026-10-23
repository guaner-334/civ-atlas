/**
 * 作品墙(数据和接口在 account/gallery.ts):作者投来、挑过以后放上去的世界、地图和新建参数。只能看、拿来用、举报,
 * 没有评论、点赞,也不写打开次数。服务器没开作品墙(或没配服务器)时这里的东西一样都不出现。
 *
 *   GalleryPage       作品墙那一页(样子和「我的世界」一套):本月精选(配推荐语)→ 正在进行的挑战 → 全部作品(按上架时间,
 *                     页签只按种类分)。加载中先占灰色的位置、取不到说清楚 +「再试一次」、还没有作品说一句在挑。
 *                     手机上精选一行横着滑,全部作品两列、不写上架日期。右上「怎么上作品墙」(HowToDialog:站外投稿、带上哪三样、投稿须知)
 *   GalleryFeatured   「我的世界」一个都没有时,空页面下面的一排本月精选 +「去作品墙看全部」
 *   PresetWorkDialog  点开一个新建参数作品:封面星球、这套参数、作者的一句话;「用这套参数新建」
 *   WorkGone          打开作品的地址时:取的时候一页空白,撤下了(或没有)整页写"这个作品已经撤下了"
 *   WorkBar           打开一个世界 / 地图作品时地图左上那一条:作品名、署名、一句话;「拿来用」(世界:另存一份接着改 /
 *                     用这张地图打造新文明;地图:直接「用这张地图打造文明」)、「举报」(举过的是灰的「已举报」)
 *   MapWorkView       地图作品:整屏是这颗星球(封面那张实景贴成球,能拖着转、能切「平面」、能放大缩小),没有文明
 *   ReportDialog      举报:六个理由选一个,不能打字;提交以后"收到了,谢谢"。同一台设备对同一个作品只能举报一次
 *
 * 样式在 gallery.css;卡片、页签、弹窗、单选照「我的世界」(worlds.css)和账号窗口(account.css)的。
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './icons';
import { Dialog } from './AccountDialogs';
import { useContact } from './contact';
import { ContactLink } from './ContactLink';
import { BeianLinks } from './BeianLinks';
import { BEIAN } from './beian';
import { VersionText } from './VersionNews';
import { PRIVACY_URL, SOURCE_URL, TERMS_URL } from './links';
import { PlanetGL } from './studio/planetGL';
import { StudioScene } from './studio/scene';
import { decodePresetHash } from './presetLink';
import type { SharedPreset } from './presetStore';
import { DEFAULT_PARAMS } from '../gen/params';
import { END_YEAR_DEFAULT } from '../gen/edits';
import { ServerError } from '../account/server';
import {
  REPORT_REASONS,
  WORK_KIND_NAME,
  coverUrl,
  fetchWork,
  isWorkGone,
  loadGallery,
  reportWork,
  useGallery,
  wasReported,
  type GalleryItem,
  type GalleryList,
  type GalleryWork,
  type ReportReason,
  type WorkKind,
} from '../account/gallery';
import './gallery.css';

const stop = (e: { stopPropagation(): void }) => e.stopPropagation();

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

/** 精选是哪个月的:"10 月" */
function monthText(s: string): string {
  const m = /^\d{4}-(\d{2})$/.exec(s);
  return m ? `${Number(m[1])} 月` : '';
}

/** 出处的说法:砚山的「金阳洋两岸」(没署名就只写作品名) */
export function workWho(w: Pick<GalleryWork, 'by' | 'title'>): string {
  return `${w.by ? `${w.by}的` : ''}「${w.title || '未命名'}」`;
}

// ---------------------------------------------------------------------------
// 卡片

function Cover({ w }: { w: GalleryWork }) {
  const url = coverUrl(w.id);
  return (
    <span className={`gl-cover${w.kind === 'preset' ? ' planet' : ''}`} style={url ? { backgroundImage: `url("${url}")` } : undefined}>
      <span className="gl-tag">{WORK_KIND_NAME[w.kind]}</span>
    </span>
  );
}

/** 一张作品卡:card = 全部作品里的(封面、作品名、上架日期、署名、一句话);feat = 精选(多一段推荐语);mini = 挑战里、空页面的(封面、名字、署名) */
function WorkCard({ w, kind, note, phone, onOpen }: { w: GalleryWork; kind: 'card' | 'feat' | 'mini'; note?: string; phone: boolean; onOpen: (w: GalleryWork) => void }) {
  return (
    <button className={`gl-card ${kind}`} data-work={w.id} data-kind={w.kind} onClick={() => onOpen(w)}>
      <Cover w={w} />
      <span className="gl-meta">
        <span className="gl-row1">
          <b className="gl-name">{w.title || '未命名'}</b>
          {kind === 'card' && !phone && <span className="gl-at">{dayText(w.addedAt)}</span>}
        </span>
        {w.by && <span className="gl-by">{w.by}</span>}
        {kind === 'card' && w.blurb && <span className="gl-blurb">{w.blurb}</span>}
        {kind === 'feat' && note && <span className="gl-note">{note}</span>}
      </span>
    </button>
  );
}

/** 加载中的一张:灰色的封面、几道灰条 */
function GhostCard({ kind }: { kind: 'feat' | 'mini' }) {
  return (
    <span className={`gl-card ghost ${kind}`} aria-hidden="true">
      <span className="gl-cover" />
      <span className="gl-meta">
        <i className="gl-bar" style={{ width: '46%' }} />
        <i className="gl-bar" style={{ width: '24%' }} />
        {kind === 'feat' ? (
          <>
            <i className="gl-bar" style={{ width: '92%' }} />
            <i className="gl-bar" style={{ width: '70%' }} />
          </>
        ) : (
          <i className="gl-bar" style={{ width: '80%' }} />
        )}
      </span>
    </span>
  );
}

function Foot() {
  return (
    <footer className="mw-foot">
      <a href={SOURCE_URL} target="_blank" rel="noreferrer" data-link="source">
        源代码
      </a>
      <a href={PRIVACY_URL} target="_blank" rel="noreferrer" data-link="privacy">
        隐私政策
      </a>
      <a href={TERMS_URL} target="_blank" rel="noreferrer" data-link="terms">
        用户协议
      </a>
      <ContactLink />
      <BeianLinks className="mw-beian" />
      <VersionText className="mw-ver" />
    </footer>
  );
}

/** 整页正中的一段说明(照「分享停了」那一页):图标、标题、一两句话、按钮 */
function PageNote({ icon, title, lines, acts }: { icon: IconName; title: string; lines: ReactNode; acts: ReactNode }) {
  return (
    <div className="gl-note-box" role="status">
      <span className="share-gone-ic">
        <Icon name={icon} size={28} />
      </span>
      <h2>{title}</h2>
      <p>{lines}</p>
      <div className="share-gone-acts">{acts}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 作品墙那一页

type Tab = 'all' | WorkKind;
/** 回到这一页还是上次看的页签 */
let lastTab: Tab = 'all';

export interface GalleryPageProps {
  phone: boolean;
  /** 「‹ 我的世界」 */
  onHome: () => void;
  /** 点开一个世界 / 地图作品(新建参数在这一页里弹窗) */
  onOpen: (w: GalleryWork) => void;
  /** 新建参数作品里点了「用这套参数新建」 */
  onPreset: (p: SharedPreset) => void;
  /** 一进来就开着的新建参数作品(打开它的地址时;取好了的) */
  preset?: GalleryItem | null;
  /** 开着的新建参数作品换了(编号;关上 = null):网址跟着换 */
  onPresetShown?: (id: string | null) => void;
}

export function GalleryPage({ phone, onHome, onOpen, onPreset, preset, onPresetShown }: GalleryPageProps) {
  const g = useGallery();
  const [tab, setTabState] = useState<Tab>(lastTab);
  const setTab = (t: Tab) => {
    lastTab = t;
    setTabState(t);
  };
  const [howto, setHowto] = useState(false);
  const [presetW, setPresetW] = useState<{ w: GalleryWork; item?: GalleryItem } | null>(preset ? { w: preset, item: preset } : null);
  useEffect(() => {
    if (preset) setPresetW({ w: preset, item: preset });
  }, [preset]);
  const shownId = presetW?.w.id ?? null;
  const shownRef = useRef(onPresetShown);
  shownRef.current = onPresetShown;
  const firstShown = useRef(true);
  useEffect(() => {
    // 一进来什么都没开着:网址本来就是作品墙那一页的
    if (firstShown.current && shownId === null) return void (firstShown.current = false);
    firstShown.current = false;
    shownRef.current?.(shownId);
  }, [shownId]);
  // 进来时取一次最新的(取到之前照旧摆着上次的)
  useEffect(() => loadGallery(true), []);
  // 服务器没开作品墙:回我的世界
  useEffect(() => {
    if (g.status === 'off') onHome();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g.status]);
  const open = (w: GalleryWork) => (w.kind === 'preset' ? setPresetW({ w }) : onOpen(w));
  const list = g.list;

  const homeBtn = (
    <button className="mw-btn lg gl-lg" data-act="home" onClick={onHome}>
      <Icon name="grid" size={16} />
      我的世界
    </button>
  );
  let body: ReactNode;
  if (!list && g.status === 'error') {
    body = (
      <PageNote
        icon="cloudoff"
        title="暂时打不开作品墙"
        lines={
          <>
            网络不通，或者我们的服务器在维护。
            <br />
            你自己的世界都在这个浏览器里，不受影响。
          </>
        }
        acts={
          <>
            {homeBtn}
            <button className="mw-btn lg gl-lg blue" data-act="gallery-retry" onClick={() => loadGallery(true)}>
              <Icon name="again" size={16} />
              再试一次
            </button>
          </>
        }
      />
    );
  } else if (!list) {
    body = <GallerySkeleton phone={phone} />;
  } else if (!list.works.length) {
    body = (
      <PageNote
        icon="image"
        title="作品墙还没有作品"
        lines={
          <>
            第一批作品正在挑，过些日子再来看。
            <br />
            想让自己的世界上墙，看看怎么投稿。
          </>
        }
        acts={
          <>
            {homeBtn}
            <button className="mw-btn lg gl-lg blue" data-act="gallery-howto" onClick={() => setHowto(true)}>
              <Icon name="help" size={16} />
              怎么上作品墙
            </button>
          </>
        }
      />
    );
  } else {
    body = <GalleryBody list={list} phone={phone} tab={tab} onTab={setTab} onOpen={open} />;
  }

  return (
    <div className={`mw gl${phone ? ' mw-phone' : ''}`} role="main" aria-label="作品墙" data-testid="gallery" onPointerDown={stop} onClick={stop} onDoubleClick={stop} onWheel={stop}>
      <header className="gl-top">
        <div className="gl-row">
          <button className="gl-back" data-act="gallery-home" onClick={onHome}>
            <Icon name="back" size={17} />
            我的世界
          </button>
          {phone && (
            <button className="mw-btn round" data-act="gallery-howto" onClick={() => setHowto(true)}>
              <Icon name="help" size={16} />
              怎么投稿
            </button>
          )}
        </div>
        <div className="gl-head">
          <div className="mw-heading">
            <h1>作品墙</h1>
            <p>{phone ? '作者投来、我们挑过的作品。点开随便看，想改就另存一份，出处会自动写上。' : '作者投来、我们挑过的世界、地图和新建参数。点开随便看，想改就另存一份，出处会自动写上。'}</p>
          </div>
          {!phone && (
            <button className="mw-btn" data-act="gallery-howto" onClick={() => setHowto(true)}>
              <Icon name="help" size={16} />
              怎么上作品墙
            </button>
          )}
        </div>
      </header>
      {body}
      {!phone && <Foot />}
      {phone && BEIAN.length > 0 && (
        <footer className="mw-foot solo">
          <BeianLinks className="mw-beian" />
        </footer>
      )}
      {howto && <HowToDialog phone={phone} onClose={() => setHowto(false)} />}
      {presetW && (
        <PresetWorkDialog
          phone={phone}
          w={presetW.w}
          item={presetW.item}
          onClose={() => setPresetW(null)}
          onUse={(p) => {
            setPresetW(null);
            onPreset(p);
          }}
        />
      )}
    </div>
  );
}

function GallerySkeleton({ phone }: { phone: boolean }) {
  return (
    <div className="gl-body" aria-busy="true">
      <div className="gl-sec-h">
        <h2>本月精选</h2>
      </div>
      <div className={phone ? 'gl-scroll' : 'gl-grid'}>
        {[0, 1, 2, 3].map((i) => (
          <GhostCard key={i} kind="feat" />
        ))}
      </div>
      <div className="gl-sec-h">
        <h2>正在进行的挑战</h2>
      </div>
      <div className="gl-chal ghost">
        <div className="gl-chal-l">
          <i className="gl-bar" style={{ width: '40%', height: 16 }} />
          <i className="gl-bar" style={{ width: '22%' }} />
          <i className="gl-bar" style={{ width: '90%' }} />
          <i className="gl-bar" style={{ width: '70%' }} />
        </div>
        <div className="gl-chal-r">
          {[0, 1, 2].map((i) => (
            <GhostCard key={i} kind="mini" />
          ))}
        </div>
      </div>
    </div>
  );
}

const TABS: { id: Tab; name: string }[] = [
  { id: 'all', name: '全部' },
  { id: 'world', name: '世界' },
  { id: 'map', name: '地图' },
  { id: 'preset', name: '新建参数' },
];

function GalleryBody({ list, phone, tab, onTab, onOpen }: { list: GalleryList; phone: boolean; tab: Tab; onTab: (t: Tab) => void; onOpen: (w: GalleryWork) => void }) {
  const byId = new Map(list.works.map((w) => [w.id, w]));
  const feat = list.featured.filter((f) => byId.has(f.id));
  const month = monthText(list.month);
  const count = (t: Tab) => (t === 'all' ? list.works.length : list.works.filter((w) => w.kind === t).length);
  const shown = tab === 'all' ? list.works : list.works.filter((w) => w.kind === tab);
  const seg = (
    <div className="mw-seg gl-seg" role="tablist" aria-label="按种类看">
      {TABS.map((t) => (
        <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} data-tab={t.id} onClick={() => onTab(t.id)}>
          {t.name}
          {!phone && <i>{count(t.id)}</i>}
        </button>
      ))}
    </div>
  );
  return (
    <div className="gl-body">
      {feat.length > 0 && (
        <section aria-label="本月精选">
          <div className="gl-sec-h">
            <h2>本月精选</h2>
            <small>{phone ? month : `${month ? `${month}，` : ''}我们挑的 ${feat.length} 个`}</small>
          </div>
          <div className={phone ? 'gl-scroll' : 'gl-grid'}>
            {feat.map((f) => (
              <WorkCard key={f.id} w={byId.get(f.id)!} kind="feat" note={f.note} phone={phone} onOpen={onOpen} />
            ))}
          </div>
        </section>
      )}
      {list.challenges.length > 0 && (
        <section aria-label="正在进行的挑战">
          <div className="gl-sec-h">
            <h2>正在进行的挑战</h2>
          </div>
          {list.challenges.map((c) => {
            const ws = c.works.map((id) => byId.get(id)).filter((w): w is GalleryWork => !!w);
            return (
              <div className="gl-chal" key={c.id} data-challenge={c.id}>
                <div className="gl-chal-l">
                  <h3>{c.title}</h3>
                  {dueText(c.deadline) && <span className="gl-due">{dueText(c.deadline)}</span>}
                  {c.blurb && <p>{c.blurb}</p>}
                  {!phone && <span className="gl-chal-n">{ws.length ? `收到 ${ws.length} 个作品` : '还没收到作品'}</span>}
                </div>
                {ws.length > 0 && (
                  <div className="gl-chal-r">
                    {ws.map((w) => (
                      <WorkCard key={w.id} w={w} kind="mini" phone={phone} onOpen={onOpen} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </section>
      )}
      <section aria-label="全部作品">
        <div className="gl-sec-h">
          <h2>全部作品</h2>
          <small>按上架时间</small>
          {!phone && (
            <>
              <span className="gl-sp" />
              {seg}
            </>
          )}
        </div>
        {phone && seg}
        {shown.length ? (
          <div className="gl-grid" role="list">
            {shown.map((w) => (
              <WorkCard key={w.id} w={w} kind="card" phone={phone} onOpen={onOpen} />
            ))}
          </div>
        ) : (
          <p className="gl-none">还没有{TABS.find((t) => t.id === tab)?.name}作品</p>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 「我的世界」空页面下面的精选

export function GalleryFeatured({ phone, onOpen, onGallery }: { phone: boolean; onOpen: (w: GalleryWork) => void; onGallery: () => void }) {
  const g = useGallery();
  const list = g.list;
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
// 怎么上作品墙

function HowToDialog({ phone, onClose }: { phone: boolean; onClose: () => void }) {
  const contact = useContact();
  return (
    <Dialog phone={phone} label="怎么上作品墙" width={600} onClose={onClose} testId="gallery-howto" className="gl-howto">
      <div className="acct-body">
        <p className="acct-lead">作品墙上的作品都是作者投来、我们看过才放上去的。网站上不收稿，请到 QQ 交流群里找管理员，带上三样：</p>
        <div className="acct-grp gl-three">
          <div className="acct-gr">
            <b>分享链接</b>
            <span>世界、地图用存档菜单里的「复制分享链接」；新建参数用预设菜单里的「复制分享链接…」</span>
          </div>
          <div className="acct-gr">
            <b>署名</b>
            <span>作品墙上显示的名字，用笔名就行</span>
          </div>
          <div className="acct-gr">
            <b>一句话介绍</b>
            <span>40 字以内，说说它特别在哪</span>
          </div>
        </div>
        <h3 className="gl-h3">投之前请知道</h3>
        <ol className="gl-ol">
          <li>作品是你自己做的；改的是别人的作品，网站会自动写上原来的出处。</li>
          <li>你同意它在作品墙上公开展示：谁都能打开看、另存一份接着改、用你的地图或参数打造新世界；另存的那份写着你的署名和出处，改不掉。</li>
          <li>我们会看过里面所有的字（国名、人名、改的名字、人物和标注、介绍）再决定上不上；可能选进本月精选，配一句推荐语。封面由网站自动截地图。</li>
          <li>想撤下随时说。撤下后作品墙上不再出现；别人已经另存的在他们自己的浏览器里，我们删不掉。</li>
          <li>被举报、核实不适合公开的，我们会撤下。</li>
        </ol>
        <p className="acct-small">投稿时回一句“同意在作品墙展示”就行，我们会记下是哪天、在哪同意的。</p>
      </div>
      <div className="acct-foot">
        <span className="acct-sp" />
        <button className="acct-btn" data-act="howto-ok" onClick={onClose}>
          知道了
        </button>
        {contact && (
          <a className="acct-btn blue" href={contact.url} target="_blank" rel="noreferrer" data-link="contact">
            <Icon name="bubble" size={15} />
            加交流群
          </a>
        )}
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// 新建参数作品

/** 这套参数的八格:种子、陆地比例、大陆数量、板块数量、造山强度、气温和降水、精细度、推演到 */
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
    ['推演到', `第 ${p.endYear ?? END_YEAR_DEFAULT} 年`],
  ];
}

function PresetWorkDialog({ phone, w, item, onClose, onUse }: { phone: boolean; w: GalleryWork; item?: GalleryItem; onClose: () => void; onUse: (p: SharedPreset) => void }) {
  const [got, setGot] = useState<{ p: SharedPreset } | { error: string; gone?: boolean } | null>(() => (item ? read(item) : null));
  const [report, setReport] = useState(false);
  const g = useGallery();
  const reported = g.rev >= 0 && wasReported(w.id);
  useEffect(() => {
    if (item) return;
    let alive = true;
    fetchWork(w.id).then(
      (it) => alive && setGot(read(it)),
      (e: unknown) => {
        if (!alive) return;
        if (isWorkGone(e)) {
          setGot({ error: '这个作品已经撤下了', gone: true });
          loadGallery(true);
        } else setGot({ error: e instanceof Error ? e.message : String(e) });
      },
    );
    return () => {
      alive = false;
    };
  }, [w.id, item]);
  const ok = got && 'p' in got ? got.p : null;
  const head = (
    <div className="gl-pcover" style={{ backgroundImage: coverUrl(w.id) ? `url("${coverUrl(w.id)}")` : undefined }}>
      <button className="acct-x" onClick={onClose} title="关闭" aria-label="关闭">
        <Icon name="close" size={14} />
      </button>
    </div>
  );
  return (
    <Dialog phone={phone} label={w.title || '新建参数'} width={560} onClose={onClose} head={head} testId="gallery-preset" className="gl-pdlg">
      <div className="acct-head">
        <h2>{w.title || '未命名'}</h2>
      </div>
      <div className="acct-body">
        <div className="gl-who">
          <span className="gl-tag">新建参数</span>
          {w.by}
        </div>
        {w.blurb && <p className="gl-pblurb">{w.blurb}</p>}
        {ok ? (
          <div className="acct-grp gl-pp" data-testid="preset-rows">
            {presetRows(ok).map(([k, v]) => (
              <div className="acct-gr" key={k}>
                <span className="k">{k}</span>
                <span className="v">{v}</span>
              </div>
            ))}
          </div>
        ) : got ? (
          <p className="acct-err" role="alert">
            {(got as { error: string }).error}
          </p>
        ) : (
          <div className="acct-grp gl-pp ghost" aria-busy="true">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
              <div className="acct-gr" key={i}>
                <i className="gl-bar" style={{ width: '40%' }} />
              </div>
            ))}
          </div>
        )}
        {ok && (
          <p className="acct-small">
            {ok.seed !== undefined
              ? '带着种子：新建出来就是上面这颗星球。在新建窗口里换个种子，大陆的样子照这套参数、位置会不一样。'
              : '没带种子：新建时随机一个种子，大陆的样子照这套参数，每次都不一样。'}
          </p>
        )}
      </div>
      <div className="acct-foot">
        <button className="acct-btn gl-ghost" data-act="gallery-report" disabled={reported} onClick={() => setReport(true)}>
          <Icon name={reported ? 'check' : 'flag'} size={15} />
          {reported ? '已举报' : '举报'}
        </button>
        <span className="acct-sp" />
        <button className="acct-btn lg blue" data-act="gallery-use-preset" disabled={!ok} onClick={() => ok && onUse(ok)}>
          用这套参数新建
        </button>
      </div>
      {report && <ReportDialog phone={phone} work={w} onClose={() => setReport(false)} />}
    </Dialog>
  );
}

/** 作品里的预设串 → 分享来的那一套(名字用作品名,带上署名) */
function read(it: GalleryItem): { p: SharedPreset } | { error: string } {
  const r = decodePresetHash(`#${it.preset ?? ''}`);
  if (!r.ok) return { error: r.error };
  return { p: { ...r.preset, name: it.title || r.preset.name, gallery: { by: it.by } } };
}

// ---------------------------------------------------------------------------
// 打开作品的地址:取的时候、撤下了、取不到

export function WorkGone({ phone, state, onHome, onGallery, onRetry }: { phone: boolean; state: 'loading' | 'gone' | { error: string }; onHome: () => void; onGallery: () => void; onRetry: () => void }) {
  return (
    <div className={`share-gone${phone ? ' phone' : ''}`} role="main" data-testid="gallery-gone" onPointerDown={stop} onClick={stop} onWheel={stop}>
      {state !== 'loading' && (
        <div className="share-gone-box">
          <span className="share-gone-ic">
            <Icon name={state === 'gone' ? 'image' : 'cloudoff'} size={28} />
          </span>
          <h2>{state === 'gone' ? '这个作品已经撤下了' : '暂时打不开这个作品'}</h2>
          {state === 'gone' ? (
            <p>
              作者要求撤下，或者它不再适合公开展示。
              <br />
              如果你之前另存过，它还在你的「我的世界」里。
            </p>
          ) : (
            <p>{state.error}</p>
          )}
          <div className="share-gone-acts">
            <button className="acct-btn lg" data-act="home" onClick={onHome}>
              <Icon name="grid" size={16} />
              我的世界
            </button>
            {state === 'gone' ? (
              <button className="acct-btn lg blue" data-act="gallery" onClick={onGallery}>
                <Icon name="image" size={16} />
                去作品墙看看
              </button>
            ) : (
              <button className="acct-btn lg blue" data-act="gallery-retry" onClick={onRetry}>
                <Icon name="again" size={16} />
                再试一次
              </button>
            )}
          </div>
        </div>
      )}
      {!phone && state !== 'loading' && <Foot />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 打开一个作品时顶上那一条、「拿来用」、举报

export interface WorkBarProps {
  phone: boolean;
  work: GalleryWork;
  /** 地图作品:「‹ 作品墙」在这一条里(世界作品的在侧栏左上) */
  onBack?: () => void;
  /** 另存一份接着改(世界作品) */
  onSaveCopy?: () => void;
  /** 用这张地图打造新文明 */
  onNewCiv: () => void;
}

export function WorkBar({ phone, work, onBack, onSaveCopy, onNewCiv }: WorkBarProps) {
  const g = useGallery();
  const reported = g.rev >= 0 && wasReported(work.id);
  const [menu, setMenu] = useState(false);
  const [report, setReport] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const useBtn = useRef<HTMLButtonElement>(null);
  /** 菜单挂在「拿来用」下面,比按钮往左错开一点 */
  const [menuAt, setMenuAt] = useState<{ left: number; top: number } | null>(null);
  const map = work.kind === 'map';
  useLayoutEffect(() => {
    const b = useBtn.current;
    const r = root.current;
    if (!menu || phone || !b || !r) return setMenuAt(null);
    setMenuAt({ left: Math.max(0, b.getBoundingClientRect().left - r.getBoundingClientRect().left - 70), top: r.offsetHeight + 4 });
  }, [menu, phone]);
  useEffect(() => {
    if (!menu || phone) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setMenu(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setMenu(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [menu, phone]);
  const who = workWho(work);
  const pick = (f: (() => void) | undefined) => () => {
    setMenu(false);
    f?.();
  };
  return (
    <>
      <div ref={root} className={`gw-bar${phone ? ' phone' : ''}${map ? ' map' : ''}`} data-testid="gallery-bar" onPointerDown={stop} onClick={stop} onDoubleClick={stop} onWheel={stop}>
        {map && onBack && (
          <button className="gw-back" data-act="gallery-back" onClick={onBack} title="回到作品墙">
            <Icon name="back" size={16} />
            {!phone && '作品墙'}
          </button>
        )}
        <div className="gw-tx">
          <div className="gw-1">
            <span className="gw-pill">{map ? '地图' : '作品墙'}</span>
            <b>{work.title || '未命名'}</b>
            {!phone && work.by && <span>{work.by}</span>}
          </div>
          {phone && work.by && <span className="gw-by">{work.by}</span>}
          {work.blurb && (
            <div className="gw-2" title={work.blurb}>
              {work.blurb}
            </div>
          )}
        </div>
        <div className="gw-acts">
          {map ? (
            <button className="gw-btn blue" data-act="gallery-new-civ" onClick={onNewCiv}>
              {phone ? '打造文明' : '用这张地图打造文明'}
              {!phone && <Icon name="chevron" size={14} />}
            </button>
          ) : (
            <button ref={useBtn} className={`gw-btn blue${menu ? ' on' : ''}`} data-act="gallery-use" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((o) => !o)}>
              拿来用
              {!phone && <Icon name={menu ? 'up' : 'down'} size={14} />}
            </button>
          )}
          <button className={`gw-btn${phone ? ' ic' : ''}`} data-act="gallery-report" disabled={reported} onClick={() => setReport(true)} title={reported ? '已举报' : '举报这个作品'}>
            <Icon name={reported ? 'check' : 'flag'} size={15} />
            {!phone && (reported ? '已举报' : '举报')}
          </button>
        </div>
        {menu && !phone && (
          <div className="gw-menu" role="menu" style={menuAt ?? { visibility: 'hidden' }}>
            <button className="gw-mi" role="menuitem" data-act="gallery-copy" onClick={pick(onSaveCopy)}>
              <Icon name="copy" size={18} />
              <span>
                <b>另存一份接着改</b>
                <small>存进「我的世界」，写上出处：{who}</small>
              </span>
            </button>
            <button className="gw-mi" role="menuitem" data-act="gallery-new-civ" onClick={pick(onNewCiv)}>
              <Icon name="globe" size={18} />
              <span>
                <b>用这张地图打造新文明</b>
                <small>地形照搬，文明和历史从头推演</small>
              </span>
            </button>
            <hr />
            <div className="gw-foot">不另存也能随便看；改了名字或历史，也会自动另存一份。</div>
          </div>
        )}
      </div>
      {menu && phone && (
        <Dialog phone label={`拿来用「${work.title || '未命名'}」`} onClose={() => setMenu(false)} testId="gallery-use">
          <div className="acct-body">
            <div className="acct-grp gw-big">
              <button className="acct-gr" data-act="gallery-copy" onClick={pick(onSaveCopy)}>
                <Icon name="copy" size={22} />
                <span>
                  <b>另存一份接着改</b>
                  <small>存进「我的世界」，写上出处：{who}</small>
                </span>
                <Icon name="chevron" size={14} className="gw-chev" />
              </button>
              <button className="acct-gr" data-act="gallery-new-civ" onClick={pick(onNewCiv)}>
                <Icon name="globe" size={22} />
                <span>
                  <b>用这张地图打造新文明</b>
                  <small>地形照搬，文明和历史从头推演</small>
                </span>
                <Icon name="chevron" size={14} className="gw-chev" />
              </button>
            </div>
            <p className="acct-small">不另存也能随便看；改了名字或历史，也会自动另存一份。</p>
          </div>
          <div style={{ height: 8 }} />
        </Dialog>
      )}
      {report && <ReportDialog phone={phone} work={work} onClose={() => setReport(false)} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// 举报

export function ReportDialog({ phone, work, onClose }: { phone: boolean; work: GalleryWork; onClose: () => void }) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);
  const submit = async () => {
    if (!reason || busy) return;
    setBusy(true);
    setErr('');
    try {
      await reportWork(work.id, reason);
      setDone(true);
    } catch (e) {
      setErr(
        e instanceof ServerError && e.code === 'rate-limit'
          ? '举报太频繁，请稍后再试'
          : isWorkGone(e)
            ? '这个作品已经撤下了'
            : e instanceof Error
              ? e.message
              : String(e),
      );
    }
    setBusy(false);
  };
  if (done)
    return (
      <Dialog phone={phone} label="收到了，谢谢" width={400} onClose={onClose} head={<span />} testId="gallery-reported" className="gw-done">
        <div className="gw-ok">
          <span className="gw-ok-ic">
            <Icon name="check" size={28} />
          </span>
          <h2>收到了，谢谢</h2>
          <p>我们会尽快看。核实有问题就撤下，结果不另外通知。</p>
          <p className="acct-small">如果是你的作品被抄、署名被冒用，请到 QQ 交流群联系我们，方便核实。</p>
        </div>
        <div className="acct-foot">
          <button className="acct-btn lg blue gw-wide" data-act="report-ok" onClick={onClose}>
            好
          </button>
        </div>
      </Dialog>
    );
  const note = <span className="acct-small">不用登录，也不会告诉作者是谁举报的。</span>;
  return (
    <Dialog phone={phone} label="举报这个作品" width={440} onClose={busy ? undefined : onClose} testId="gallery-report" className="gw-report">
      <div className="acct-body">
        <p className="acct-lead">{workWho(work)}。选一个理由，我们看过后决定要不要撤下。</p>
        <div className="gw-rds" role="radiogroup" aria-label="举报理由">
          {REPORT_REASONS.map((r) => (
            <label key={r.key} className={`acct-radio${reason === r.key ? ' on' : ''}`} data-reason={r.key}>
              <input type="radio" name="gallery-report" checked={reason === r.key} onChange={() => setReason(r.key)} />
              <i className="o" aria-hidden="true" />
              <span>
                <b>{r.title}</b>
                {r.sub && <small>{r.sub}</small>}
              </span>
            </label>
          ))}
        </div>
        {phone && note}
        {err && (
          <p className="acct-err" role="alert">
            {err}
          </p>
        )}
      </div>
      <div className="acct-foot">
        {phone ? (
          <button className="acct-btn full blue" data-act="report-send" disabled={!reason || busy} onClick={() => void submit()}>
            {busy ? '正在提交' : '提交'}
          </button>
        ) : (
          <>
            {note}
            <span className="acct-sp" />
            <button className="acct-btn" data-act="report-cancel" disabled={busy} onClick={onClose}>
              取消
            </button>
            <button className="acct-btn blue" data-act="report-send" disabled={!reason || busy} onClick={() => void submit()}>
              提交
            </button>
          </>
        )}
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// 地图作品:整屏是这颗星球

/** 放大缩小一下乘多少、最多最少 */
const ZOOM_STEP = 1.3;
const ZOOM_RANGE: [number, number] = [0.6, 3];

export function MapWorkView({ phone, work, onBack, onNewCiv }: { phone: boolean; work: GalleryWork; onBack: () => void; onNewCiv: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const glow = useRef<HTMLDivElement>(null);
  const scene = useRef<StudioScene | null>(null);
  const [flat, setFlat] = useState(false);
  /** WebGL 用不了、封面取不到:平铺一张封面 */
  const [plain, setPlain] = useState(false);
  const zoom = useRef(1);
  useLayoutEffect(() => {
    const canvas = cv.current;
    const el = box.current;
    if (!canvas || !el) return;
    const gl = PlanetGL.create(canvas, { small: phone });
    if (!gl) {
      setPlain(true);
      return;
    }
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    // 大气光(和新建界面一样):越接近地球仪越亮
    const frame = ({ cx, cy, r, m }: { cx: number; cy: number; r: number; m: number }) => {
      const g = glow.current;
      if (!g) return;
      const R = r * 1.2;
      g.style.opacity = m > 0.02 ? String(Math.pow(m, 3)) : '0';
      g.style.width = g.style.height = `${R * 2}px`;
      g.style.transform = `translate(${cx - R}px, ${cy - R}px)`;
    };
    const s = new StudioScene(gl, { frame, flat: () => {}, touched: () => {}, still: () => {} }, reduce);
    scene.current = s;
    const fit = () => s.setViewport(el.clientWidth, el.clientHeight, devicePixelRatio || 1);
    fit();
    s.setLayout({ l: 0, r: 0, b: phone ? 60 : 0, bar: false, phone }, false);
    s.showProj('globe');
    // 宽屏上没有新建界面左边那块面板,星球放大一点,和新建界面里看到的一样大
    s.zoom = zoom.current = phone ? 1 : 1.14;
    s.spin = true;
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit);
    ro?.observe(el);
    let alive = true;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (!alive || gl.isLost) return;
      gl.setStyle('cover', img);
      s.showStyle('cover');
      s.start();
    };
    img.onerror = () => alive && setPlain(true);
    img.src = coverUrl(work.id);
    gl.onLost = () => alive && setPlain(true);
    return () => {
      alive = false;
      ro?.disconnect();
      scene.current = null;
      s.dispose();
    };
  }, [work.id, phone]);
  const toggle = () => {
    const s = scene.current;
    const next = !flat;
    setFlat(next);
    if (!s) return;
    s.spin = false;
    void s.setProj(next ? 'equirect' : 'globe');
  };
  const zoomBy = (f: number) => {
    const s = scene.current;
    const z = Math.min(ZOOM_RANGE[1], Math.max(ZOOM_RANGE[0], zoom.current * f));
    zoom.current = z;
    if (s) void s.tween('zoom', z, 260);
  };
  const url = coverUrl(work.id);
  return (
    <div ref={box} className={`gw-map${phone ? ' phone' : ''}`} data-theme="dark" role="main" aria-label={work.title} data-testid="gallery-map" onWheel={stop}>
      {plain ? (
        <div className="gw-plain" style={url ? { backgroundImage: `url("${url}")` } : undefined} />
      ) : (
        <>
          <div ref={glow} className="gw-glow" aria-hidden="true" />
          <canvas ref={cv} className="gw-cv" aria-label="这颗星球" />
        </>
      )}
      <WorkBar phone={phone} work={work} onBack={onBack} onNewCiv={onNewCiv} />
      <div className="gw-hint">{phone ? '拖动看看这颗星球；它还没有文明' : '拖动看看这颗星球；它还没有文明，点「用这张地图打造文明」从头推演'}</div>
      {!plain && (
        <div className="gw-ctl">
          <button className="gw-glass" data-act="gallery-flat" onClick={toggle}>
            <Icon name={flat ? 'globe' : 'map'} size={16} />
            {flat ? '地球' : '平面'}
          </button>
          <div className="gw-glass gw-zoom">
            <button data-act="zoom-in" onClick={() => zoomBy(ZOOM_STEP)} aria-label="放大">
              <Icon name="plus" size={16} />
            </button>
            <button data-act="zoom-out" onClick={() => zoomBy(1 / ZOOM_STEP)} aria-label="缩小">
              <Icon name="minus" size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
