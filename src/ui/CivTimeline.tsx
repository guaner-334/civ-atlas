/**
 * 底部时间轴:播放 / 暂停、"第 N 年"(设了纪年:"公元前 850 年";点一下输入年份跳过去,见 JumpYear.tsx)、1× / 4×、时间轴(刻度 + 事件菱形 + 干预"令" + 播放头)。
 * 窄屏(手机)整条排成一行,1× / 4× 并成一个按钮(点一下换另一档)。
 * 编年史在世界概览里(国家面板"相关事件 · 全部 ›"也能到),时间轴上不另放按钮。
 *
 * - 打开网页、第一个世界显示出来时,从第 2600 年(结束年份前 400 年)起按 1× 自动播放;放到结束年份停下,
 *   再点播放从第 2600 年重播(网址给了 civYear、play=0,或在无头浏览器里不自动播放,见 civView.ts)。
 * - 导播开着(Director.tsx)时,速度前面多一档「自动」(事少快、事多慢),年份由导播按它的排期推进,这里不推;
 *   手机上那一个速度按钮在 自动 / 1× / 4× 之间换。
 * - 1× = 每秒 20 年,4× = 每秒 80 年;推得比 3000 年久的世界,速度和"结束年份前 400 年"都按年数放大(60000 年 = 20 倍,
 *   timelineLayout.ts 的 timeScale)。"回放世界形成"放完地质接着放文明时(story),从第 0 年用 15 秒放完一遍,
 *   这时自动打开"民族"和"国家",顶部显示"人类登场 / 列国并起"的说明。
 * - 干预重推完,App 调 playFrom(生效年份) 从那一年接着放;选中国家等看详情时暂停(civView.ts 的 setSelection)。
 * - 年份存在 civView.ts 里,地图(CivLayer)、图层弹层的民族图例和悬停信息(civDescribe)都读它。
 * - 刻度、菱形、"令"、悬停提示、拖动 / 点击在 TimelineMarks.tsx;播放头和进度按 CSS 变量 --p 画,播放时刻度不重新渲染。
 *   刻度用的纪事和编年史列出的一致:默认"大事",编年史切到"全部"或只看某国时,刻度跟着变。
 *   选中了国家(详情面板开着):时间轴上标出它从立国到亡的一道国色,立国那头一颗绿点(它的立国不在大事里也画);关掉面板就恢复。
 * - 放哪:dock="bottom"(默认)浮在地图底部一整行;"top" 浮在顶部;
 *   "inline" 不定位,填满父元素(放进别的布局的一行里时用;App 就是这样放进底部那一行的)。
 * - 颜色用主题变量(--ink、--line-strong、--ev-war……,见 timeline.css),没有主题时用浅色默认值。
 * - 再推 N 年(ExtendYears.tsx):轨道尽头、速度前面一个「再推」(导出视频选段、回放世界形成时不放)。推的时候时间轴马上按推完的长度排,
 *   第 0 年到原来的结束年份照样能拖、能放,新的一段推好以前拖不进去;正在放的照常放到原来的结束年份停,推好时还在放就接着放进新的一段。
 *   推完以后刚推的那段垫一道浅蓝(这次打开网页里一直标着,换了世界不标)。
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Civ } from '../gen/civ/types';
import { filterChronicle } from '../gen/civ/chronicle';
import { fullChronicle } from '../gen/civ/religionText';
import {
  clearChroniclePick,
  getCivTime,
  resetCivTime,
  setCivShow,
  setCivTime,
  startAutoplay,
  takeAutoplay,
  togglePlayback,
  useChronicle,
  useCivTime,
  useSelection,
} from './civView';
import { TimelineMarks, type TimelineLife } from './TimelineMarks';
import { TimelineYear } from './JumpYear';
import { baseRegions } from './eras';
import { useNarrow } from './device';
import { useEra } from './editsStore';
import { yearFull, type Era } from '../gen/era';
import { STORY_SECONDS, playRate, replayStart } from './timelineLayout';
import { filmRangeOf, getFilm, setFilmRange, useFilm } from './filmStore';
import { filmClock, lengthText } from './filmPlan';
import { setDirectorPace, useDirector } from './directorStore';
import { useExtend } from './extendStore';
import { ExtendButton, busyNote } from './ExtendYears';
import './timeline.css';

export interface CivTimelineProps {
  civ: Civ | null;
  /** 地质回放时藏起来 */
  hidden?: boolean;
  /** 浮在地图底部(默认)/ 顶部(数据图层的图例占着底部时)/ 不定位、填满父元素 */
  dock?: 'top' | 'bottom' | 'inline';
  /** 导播停用(回放世界形成、导出视频、新建):开着也照平常播放,没有「自动」 */
  directorOff?: boolean;
  /** 不放「再推」(地图上看着助手"先看看"的历史时:推的会是底下真的那个世界) */
  extendOff?: boolean;
}

export function CivTimeline({ civ, hidden, dock = 'bottom', directorOff, extendOff }: CivTimelineProps) {
  const t = useCivTime();
  const dir = useDirector();
  const dirOn = dir.on && !directorOff;
  // 导播推进年份(故事回放照旧这里放)
  const directed = dirOn && !t.story;
  const auto = dirOn && dir.pace === 'auto';
  const narrow = useNarrow();
  // 导出回放视频时:时间轴上选一段(两头的把手),播放按成片的速度放这一段,右边写片长
  const film = useFilm();
  const chron = useChronicle();
  const era = useEra();
  const has = !!civ && civ.viable && civ.cultures.length > 0;
  const end = civ?.endYear ?? 0;
  const year = Math.min(end, Math.max(0, t.year ?? end));
  const [rootRef, compat] = useThemeCompat();
  // 再推:推的时候时间轴按推完的长度排(axis),推完以后刚推的那段标出来
  const ext = useExtend();
  const busy = ext.busy && ext.busy.from === end && film.mode !== 'video' ? ext.busy : null;
  const axis = busy ? busy.to : end;
  const grow = useMemo(() => (busy ? { from: busy.from, at: busy.slow ? null : busy.year, note: narrow ? undefined : busyNote(busy, era) } : undefined), [busy, narrow, era]);
  const fresh = !busy && ext.fresh && ext.fresh.to === end ? ext.fresh.from : undefined;

  // 换了新世界:回到结束年份(第一次拿到文明时保留网址里的 civYear)。
  // 按州(地理)认世界:改名(阶段 4)只换 civ 对象、州还是同一份,时间轴不动;
  // 地形大事以后州跟着时间轴换段,按第一件大事以前的那一份认(eras.ts 的 baseRegions;重推时沿用)
  const prev = useRef<Civ['regions'] | null>(null);
  const world = civ ? baseRegions(civ) : null;
  useEffect(() => {
    if (prev.current && prev.current !== world) {
      resetCivTime();
      clearChroniclePick();
    }
    prev.current = world;
  }, [world]);

  // 打开网页后第一个世界:从结束年份前 400 年起自动播放(只一次)
  useEffect(() => {
    if (has && takeAutoplay()) startAutoplay(replayStart(end));
  }, [has, end]);

  // 刻度用的纪事:和编年史面板列出的一致(fullChronicle 按 civ 缓存;只在换世界 / 换筛选时重算,播放时不变)
  const all = useMemo(() => (has ? fullChronicle(civ) : []), [civ, has]);
  const marks = useMemo(() => filterChronicle(all, { major: chron.major, polity: chron.polity }), [all, chron.major, chron.polity]);
  // 选中了国家(点地图、侧栏、搜索、编年史里的国名):时间轴上标出它的一生
  const sel = useSelection().sel;
  const lifeOf = sel?.kind === 'polity' ? sel.id : null;
  const life = useMemo<TimelineLife | undefined>(() => {
    const p = lifeOf !== null && has ? civ?.polities[lifeOf] : undefined;
    return p && lifeOf !== null ? { polity: lifeOf, founded: p.founded, ended: p.ended ?? null, color: p.color } : undefined;
  }, [civ, has, lifeOf]);

  // 播放:每帧按真实流逝的时间推进年份(导出视频的时长、片头片尾、年份变了,关掉面板,都按新的速度和终点接着放)
  useEffect(() => {
    if (!t.playing) return;
    if (!has) {
      setCivTime({ year: null, playing: false, story: false });
      return;
    }
    if (directed) return;
    if (t.story) setCivShow({ cultures: true, polities: true, faiths: false, eras: false, resources: false });
    const fm = getFilm();
    const span = fm.mode === 'video' && civ ? filmRangeOf(civ) : null;
    const rate = t.story ? end / STORY_SECONDS : span ? filmClock(span, fm.seconds, fm.cards).rate : playRate(t.speed, end);
    const stop = span ? span.to : end;
    let last = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const dt = Math.min(100, Math.max(0, now - last));
      last = now;
      const cur = getCivTime();
      if (!cur.playing) return;
      const ny = (cur.year ?? 0) + (dt / 1000) * rate;
      if (ny >= stop) {
        setCivTime({ year: span ? stop : null, playing: false, story: false });
        return;
      }
      setCivTime({ year: ny });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [t.playing, t.story, t.speed, has, end, civ, film.mode, film.seconds, film.cards, film.rangeKind, film.range, directed]);

  if (!has || hidden) return null;

  const filmOn = film.mode === 'video';
  const span = filmOn ? filmRangeOf(civ) : null;
  const locked = filmOn && !!film.run;
  // 放到头了(停在结束年份):从结束年份前 400 年重播;导出视频时从选的那一段开头重播
  const toggle = () => {
    if (locked) return;
    if (!span) return togglePlayback(end, replayStart(end));
    if (t.playing) return setCivTime({ playing: false });
    setCivTime({ playing: true, story: false, scrubbing: false, year: year >= span.to || year < span.from ? span.from : year });
  };
  const n = Math.floor(year);
  const firstPolity = civ.polities.length ? Math.min(...civ.polities.map((p) => p.founded)) : Infinity;
  const story =
    year < firstPolity
      ? '人类登场:各民族从发源地出发,一年年向外扩散,沿途建起村镇'
      : '列国并起:城市长大,人口够多的城立国,国家向外扩张、升格';
  const p = Math.min(1, year / Math.max(1, axis));
  // 「再推」:导出视频选段时、接着回放世界形成放文明时不放(和 1× / 4× 一样)
  const extendOn = !span && !t.story && !extendOff;
  return (
    <>
      {t.story && t.playing && (
        <div className={`civ-top${dock === 'top' ? ' dock-top' : ''}`}>
          <div className="caption">
            <div className="big">{yearFull(n, era)}</div>
            <div className="small">{story}</div>
            <div className="track">
              <div style={{ width: `${p * 100}%`, transition: 'none' }} />
            </div>
          </div>
        </div>
      )}
      <div
        ref={rootRef}
        className={`civ-timeline timebar dock-${dock}${compat ? ' tb-compat' : ''}`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        style={{ ['--p' as string]: p }}
      >
        <button
          className={`tb-play${t.playing || locked ? ' on' : ''}${locked ? ' locked' : ''}`}
          disabled={locked}
          onClick={toggle}
          aria-label={t.playing ? '暂停' : '播放'}
          data-tip={t.playing ? '暂停' : '播放'}
          data-tip-key="play"
          data-tip-side="above"
        >
          <i aria-hidden="true" />
        </button>
        {/* 点一下输入年份跳过去(JumpYear.tsx);纪年的字长短不一("公元元年""公元前 2500 年"):按最长的那个占位,播放时滑条不跟着伸缩 */}
        <TimelineYear world={world} range={span} year={n} end={end} era={era} narrow={narrow} locked={locked} below={dock === 'top'} ghost={era ? longestYear(end, era) : undefined} />
        {span ? (
          !narrow && (
            <span className="tb-film-len">
              片长 <b>{lengthText(film.seconds)}</b>
            </span>
          )
        ) : narrow ? (
          dirOn ? (
            // 导播开着:自动 → 1× → 4× → 自动
            <button
              className="tb-speed tb-speed-one"
              data-act="speed"
              onClick={() => (auto ? setDirectorPace('fixed', 1) : t.speed === 1 ? setDirectorPace('fixed', 4) : setDirectorPace('auto'))}
              aria-label={`播放速度 ${auto ? '自动' : `${t.speed}×`},点一下换成 ${auto ? '1×' : t.speed === 1 ? '4×' : '自动'}`}
            >
              {auto ? '自动' : `${t.speed}×`}
            </button>
          ) : (
            <button className="tb-speed tb-speed-one" data-act="speed" onClick={() => setCivTime({ speed: t.speed === 4 ? 1 : 4 })} aria-label={`播放速度 ${t.speed}×,点一下换成 ${t.speed === 4 ? 1 : 4}×`}>
              {t.speed}×
            </button>
          )
        ) : (
          <span className="tb-speed" role="group" aria-label="播放速度">
            {dirOn && (
              <button className={auto ? 'on' : ''} aria-pressed={auto} data-act="speed-auto" title="事少快、事多慢：没事的年份一闪而过，有大事时放慢，放完再走" onClick={() => setDirectorPace('auto')}>
                自动
              </button>
            )}
            {([1, 4] as const).map((s) => (
              <button
                key={s}
                className={!auto && t.speed === s ? 'on' : ''}
                aria-pressed={!auto && t.speed === s}
                onClick={() => (dirOn ? setDirectorPace('fixed', s) : setCivTime({ speed: s }))}
              >
                {s}×
              </button>
            ))}
          </span>
        )}
        {extendOn && <ExtendButton end={end} phone={narrow} />}
        <TimelineMarks
          entries={marks}
          end={axis}
          dock={dock}
          year={n}
          era={era}
          small={narrow}
          range={span ? { from: span.from, to: span.to, onRange: (from, to) => setFilmRange({ from, to }, end), labels: narrow, locked } : undefined}
          limit={busy ? end : undefined}
          grow={grow}
          fresh={span ? undefined : fresh}
          life={life}
        />
      </div>
    </>
  );
}

/** 这个世界里最长的那个年份(第 0 年、结束那年两头里字多的那个;汉字按一个字宽、数字按半个算) */
function longestYear(end: number, era: Era): string {
  const w = (s: string) => [...s].reduce((a, c) => a + (/[\x00-\x7f]/.test(c) ? 0.6 : 1), 0);
  const a = yearFull(0, era);
  const b = yearFull(end, era);
  return w(b) > w(a) ? b : a;
}

/**
 * 主题变量还没定义时(界面主题 theme.css 没加载;这时页面 :root 里就算有 --panel、--line、--accent,也可能是别的样式表定的深色值),
 * 组件根元素加 tb-compat,timeline.css 在组件里把这几个换成浅色默认值。以 --ink 有没有定义为准,
 * 根元素挂上时查一次。返回 [挂在根元素上的 ref, 要不要加 tb-compat]
 */
export function useThemeCompat(): [(el: HTMLElement | null) => void, boolean] {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [compat, setCompat] = useState(false);
  useLayoutEffect(() => {
    if (el) setCompat(getComputedStyle(el).getPropertyValue('--ink').trim() === '');
  }, [el]);
  return [setEl, compat];
}
