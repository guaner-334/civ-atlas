/**
 * 作品墙那一页和作品撤下页(进作品墙、打开作品地址时才下载;空页面上的精选和卡片在 Gallery.tsx)。
 */
import { Suspense, lazy, useDeferredValue, useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './icons';
import { ContactLink } from './ContactLink';
import { BeianLinks } from './BeianLinks';
import { BEIAN } from './beian';
import { VersionText } from './VersionNews';
import { PRIVACY_URL, SOURCE_URL, TERMS_URL } from './links';
import { closeRulesSheet, getRulesSheet, openRulesWork, rulesWorkId, useRulesSheet } from './rules/sheetStore';
import { rulesUiOn } from './rules/flag';
import { pluginsUiOn } from './plugins/flag';
import { loadGallery, useGallery, type GalleryItem, type GalleryList, type GalleryWork } from '../account/gallery';
import { PluginCards, WorkCard, dueText, galleryView, loadPlugins, wallList, type GalleryPageProps, type Tab, type WorkGoneProps } from './Gallery';
import './gallery.css';

type WorkDialogsModule = typeof import('./GalleryWorkDialogs');
const WorkDialog = lazy(() =>
  import('./GalleryWorkDialogs').then(
    (m) => ({ default: m.WorkDialog }),
    () => ({ default: (() => null) as unknown as WorkDialogsModule['WorkDialog'] }),
  ),
);

type GalleryDialogsModule = typeof import('./GalleryDialogs');
const loadDialogs = () => import('./GalleryDialogs');
const HowToDialog = lazy(() =>
  loadDialogs().then(
    (m) => ({ default: m.HowToDialog }),
    () => ({ default: (() => null) as unknown as GalleryDialogsModule['HowToDialog'] }),
  ),
);
const PresetWorkDialog = lazy(() =>
  loadDialogs().then(
    (m) => ({ default: m.PresetWorkDialog }),
    () => ({ default: (() => null) as unknown as GalleryDialogsModule['PresetWorkDialog'] }),
  ),
);

type GalleryPluginsModule = typeof import('./plugins/GalleryPlugins');
const PluginWorkDialog = lazy(() =>
  loadPlugins().then(
    (m) => ({ default: m.PluginWorkDialog }),
    () => ({ default: (() => null) as unknown as GalleryPluginsModule['PluginWorkDialog'] }),
  ),
);
// 搜的时候列表那一块:框里有字才下载
const loadFound = () => import('./GalleryFound');
const GalleryFound = lazy(() =>
  loadFound().then(
    (m) => ({ default: m.GalleryFound }),
    () => ({ default: (() => null) as unknown as (typeof import('./GalleryFound'))['GalleryFound'] }),
  ),
);

const stop = (e: { stopPropagation(): void }) => e.stopPropagation();

/** 精选是哪个月的:"10 月" */
function monthText(s: string): string {
  const m = /^\d{4}-(\d{2})$/.exec(s);
  return m ? `${Number(m[1])} 月` : '';
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

const workKind = (w: GalleryWork | null | undefined) => w?.kind === 'world' || w?.kind === 'map';

export function GalleryWall({ phone, onHome, onOpen, onPreset, onWorld, onPlanet, onMapCiv, shown, opening, onShown }: GalleryPageProps) {
  const g = useGallery();
  const [tab, setTabState] = useState<Tab>(galleryView.tab);
  const setTab = (t: Tab) => {
    galleryView.tab = t;
    setTabState(t);
  };
  const [find, setFindState] = useState(galleryView.find);
  const setFind = (v: string) => {
    galleryView.find = v;
    setFindState(v);
  };
  // 打字时框先跟上,列表晚一步筛(搜索那块第一次下载时照旧摆着原来的列表)
  const q = useDeferredValue(find);
  const findRef = useRef<HTMLInputElement>(null);
  const [howto, setHowto] = useState(false);
  const preset = shown?.kind === 'preset' ? shown : null;
  const [presetW, setPresetW] = useState<{ w: GalleryWork; item?: GalleryItem } | null>(preset ? { w: preset, item: preset } : null);
  useEffect(() => {
    if (preset) setPresetW({ w: preset, item: preset });
  }, [preset]);
  const plugin = shown?.kind === 'plugin' && pluginsUiOn() ? shown : null;
  const [pluginW, setPluginW] = useState<{ w: GalleryWork; item?: GalleryItem } | null>(plugin ? { w: plugin, item: plugin } : null);
  useEffect(() => {
    if (plugin) setPluginW({ w: plugin, item: plugin });
  }, [plugin]);
  const [workW, setWorkW] = useState<{ w: GalleryWork; item?: GalleryItem } | null>(() =>
    shown && workKind(shown) ? { w: shown, item: shown } : opening && workKind(opening) ? { w: opening } : null,
  );
  useEffect(() => {
    if (shown && workKind(shown)) setWorkW({ w: shown, item: shown });
  }, [shown]);
  useEffect(() => {
    if (opening && workKind(opening)) setWorkW({ w: opening });
  }, [opening]);
  useEffect(() => {
    if (shown?.kind === 'rules') openRulesWork(shown, shown.ruleLink ?? '');
  }, [shown]);
  // 规则作品的大卡不在这一页里:离开作品墙(后退、回我的世界)时一起关上,还在取的也作废
  useEffect(
    () => () => {
      if (rulesWorkId(getRulesSheet())) closeRulesSheet();
    },
    [],
  );
  const sheet = useRulesSheet();
  const shownId = presetW?.w.id ?? pluginW?.w.id ?? workW?.w.id ?? rulesWorkId(sheet);
  const shownRef = useRef(onShown);
  shownRef.current = onShown;
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
  const open = (w: GalleryWork) =>
    w.kind === 'preset' ? setPresetW({ w }) : w.kind === 'plugin' ? setPluginW({ w }) : w.kind === 'rules' ? openRulesWork(w) : onWorld ? setWorkW({ w }) : onOpen(w);
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
  } else if (!list.works.length && !(pluginsUiOn() && list.plugins.length)) {
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
    body = <GalleryBody list={list} phone={phone} tab={tab} onTab={setTab} onOpen={open} q={q} onClear={() => setFind('')} />;
  }
  const findBox = !(list ? !list.works.length && !(pluginsUiOn() && list.plugins.length) : g.status === 'error') && (
    <div className="sb-search gl-find">
      <Icon name="search" size={phone ? 17 : 15} />
      <input
        ref={findRef}
        data-act="gallery-find"
        value={find}
        maxLength={40}
        placeholder="搜作品名、作者"
        aria-label="搜作品"
        enterKeyHint="search"
        spellCheck={false}
        autoComplete="off"
        onFocus={() => loadFound().catch(() => {})}
        onChange={(e) => setFind(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Escape' || !find) return;
          e.stopPropagation();
          setFind('');
        }}
      />
      {find && (
        <button
          className="sb-clear"
          data-act="gallery-find-x"
          aria-label="清空"
          title="清空"
          onClick={() => {
            setFind('');
            findRef.current?.focus();
          }}
        >
          <Icon name="close" size={8} />
        </button>
      )}
    </div>
  );

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
            <p>{phone ? '作者投来、我们挑过的作品。点开随便看，想改就另存一份，出处会自动写上。' : '作者投来、我们挑过的世界、地图、新建参数和规则。点开随便看，想改就另存一份，出处会自动写上。'}</p>
            {phone && findBox}
          </div>
          {!phone && (
            <div className="gl-acts">
              {findBox}
              <button className="mw-btn" data-act="gallery-howto" onClick={() => setHowto(true)}>
                <Icon name="help" size={16} />
                怎么上作品墙
              </button>
            </div>
          )}
        </div>
      </header>
      {/* 换成搜的那块、它还在下载时照旧摆着原来的列表 */}
      <Suspense fallback={null}>{body}</Suspense>
      {!phone && <Foot />}
      {phone && BEIAN.length > 0 && (
        <footer className="mw-foot solo">
          <BeianLinks className="mw-beian" />
        </footer>
      )}
      {howto && (
        <Suspense fallback={null}>
          <HowToDialog phone={phone} onClose={() => setHowto(false)} />
        </Suspense>
      )}
      {presetW && (
        <Suspense fallback={null}>
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
        </Suspense>
      )}
      {workW && onWorld && (
        <Suspense fallback={null}>
          <WorkDialog
            key={workW.w.id}
            phone={phone}
            w={workW.w}
            item={workW.item}
            onClose={() => setWorkW(null)}
            onWorld={onWorld}
            onPlanet={(it) => onPlanet?.(it)}
            onMapCiv={(it) => onMapCiv?.(it)}
          />
        </Suspense>
      )}
      {pluginW && pluginsUiOn() && (
        <Suspense fallback={null}>
          <PluginWorkDialog id={pluginW.w.id} w={pluginW.w} item={pluginW.item} phone={phone} inPlace onClose={() => setPluginW(null)} />
        </Suspense>
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
  { id: 'rules', name: '规则' },
];

function GalleryBody({
  list: all,
  phone,
  tab: tab0,
  onTab,
  onOpen,
  q,
  onClear,
}: {
  list: GalleryList;
  phone: boolean;
  tab: Tab;
  onTab: (t: Tab) => void;
  onOpen: (w: GalleryWork) => void;
  q: string;
  onClear: () => void;
}) {
  const list = wallList(all);
  const tabs = [...(rulesUiOn() ? TABS : TABS.filter((t) => t.id !== 'rules')), ...(pluginsUiOn() ? [{ id: 'plugin' as const, name: '插件' }] : [])];
  const tab = tabs.some((t) => t.id === tab0) ? tab0 : 'all';
  const byId = new Map(list.works.map((w) => [w.id, w]));
  const feat = list.featured.filter((f) => byId.has(f.id));
  const month = monthText(list.month);
  const count = (t: Tab) => (t === 'all' ? list.works.length : t === 'plugin' ? list.plugins.length : list.works.filter((w) => w.kind === t).length);
  const shown = tab === 'all' ? list.works : list.works.filter((w) => w.kind === tab);
  const segOf = (n: (t: Tab) => number) => (
    <div className={`mw-seg gl-seg${tabs.length > 5 ? ' six' : tabs.length > 4 ? ' five' : ''}`} role="tablist" aria-label="按种类看">
      {tabs.map((t) => [
        t.id === 'plugin' && <span key="bar" className="gl-seg-bar" aria-hidden="true" />,
        <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} data-tab={t.id} onClick={() => onTab(t.id)}>
          {t.name}
          {!phone && <i>{n(t.id)}</i>}
        </button>,
      ])}
    </div>
  );
  const seg = segOf(count);
  if (q.trim()) return <GalleryFound list={list} q={q} tabs={tabs} tab={tab} phone={phone} seg={segOf} onTab={onTab} onOpen={onOpen} onClear={onClear} />;
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
        {tab === 'plugin' ? (
          <Suspense fallback={null}>
            <PluginCards works={list.plugins} phone={phone} onOpen={onOpen} />
          </Suspense>
        ) : shown.length ? (
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
// 打开作品的地址:取的时候、撤下了、取不到

export function WorkGoneView({ phone, state, onHome, onGallery, onRetry }: WorkGoneProps) {
  const plugin = typeof state === 'object' && 'plugin' in state ? state.plugin : null;
  const gone = state === 'gone' || plugin !== null;
  return (
    <div className={`share-gone${phone ? ' phone' : ''}`} role="main" data-testid="gallery-gone" onPointerDown={stop} onClick={stop} onWheel={stop}>
      {state !== 'loading' && (
        <div className="share-gone-box">
          <span className="share-gone-ic">
            <Icon name={plugin ? 'ban' : gone ? 'image' : 'cloudoff'} size={28} />
          </span>
          <h2>{plugin ? '这个插件已经停用了' : plugin !== null ? '这个插件已经撤下了' : gone ? '这个作品已经撤下了' : '暂时打不开这个作品'}</h2>
          {plugin !== null ? (
            <p>
              {plugin ? `${plugin}。` : '作者撤下了它。'}
              <br />
              {plugin ? '装了它的人：它不再启动，用过它的世界照常能看。' : '装了它的人照常能用，只是作品墙上不再列出。'}
            </p>
          ) : state === 'gone' ? (
            <p>
              作者要求撤下，或者它不再适合公开展示。
              <br />
              如果你之前另存过，它还在你的「我的世界」里。
            </p>
          ) : (
            typeof state === 'object' && 'error' in state && <p>{state.error}</p>
          )}
          <div className="share-gone-acts">
            <button className="acct-btn lg" data-act="home" onClick={onHome}>
              <Icon name="grid" size={16} />
              我的世界
            </button>
            {gone ? (
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
