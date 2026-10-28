/**
 * "生成史书"窗口(右上"成书"、国家面板"写国史"打开):写什么 / 文体 / 篇幅 → 开始生成。
 * 从人物卡「让 AI 写列传」、世系图「让 AI 写这一朝的家传」打开时,写什么多一个"某某列传""某朝某氏家传"(默认选它),
 * 选它时文体换成史书体 / 白话讲述 / 传说故事,篇幅只有一档(列传约 2000 字、家传约 3000 字)。
 * 开始后窗口关上,写作在后台继续(右上显示进度);同一时间只写一部。下面列着已写的(史书、列传、家传在一起),点一部阅读。
 * 状态在 bookStore.ts。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Civ } from '../gen/civ/types';
import { useAiStatus } from '../ai/client';
import { useNotesVersion } from '../ai/library';
import { BOOK_LENGTHS, BOOK_STYLES, HISTORY_LENGTHS, HISTORY_STYLES, type HistoryLength, type HistoryStyle } from '../ai/prompts/history';
import { LIFE_STYLES, bookNoteKey, bookPrompts, bookStoreScope, houseName, isLifeScope, lifeLength, lifeOptionLabel, type BookOptions, type LifeScope } from '../ai/prompts/lives';
import { bookHowText, historyNoteStatus, historyStyleLabel, listHistoryNotes, shortDate } from '../ai/history';
import { personName } from '../gen/civ/peopleText';
import { getCivTime, useSelection } from './civView';
import { currentWorld, useSavesVersion } from './saveStore';
import { bookTitleText, closeHistoryBook, getBook, getBookSource, openBookReader, setBookPrefs, setLifeStyle, startBook, useBook } from './bookStore';
import { polityNameAt } from './searchIndex';
import { openAiSettings } from './AiSettings';
import './book.css';

/** 选项上的字 */
const LENGTH_TEXT: Record<string, string> = { k3: '短 · 约 3 千字', k10: '中 · 约 1 万字', k30: '长 · 约 3 万字' };

/** 大约要写多久:qwen-plus 实测三千字约 1 分钟、一万字约 3 分钟 */
function minutes(chars: number): string {
  const m = chars / 3300;
  const lo = Math.max(1, Math.round(m));
  const hi = Math.max(lo + 1, Math.round(m * 1.6));
  return `${lo}–${hi} 分钟`;
}

/** 对话框开着时按 Esc = f(上面压着 AI 设置时让给它) */
export function useDialogEscape(on: boolean, f: () => void) {
  const latest = useRef(f);
  latest.current = f;
  useEffect(() => {
    if (!on) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('.ai-dialog')) return;
      e.stopPropagation();
      latest.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [on]);
}

export function BookDialog({ civ }: { civ: Civ }) {
  const st = useBook();
  const open = st.dialog.open;
  useDialogEscape(open, closeHistoryBook);
  if (!open) return null;
  return <Dialog civ={civ} />;
}

function Dialog({ civ }: { civ: Civ }) {
  const st = useBook();
  const ai = useAiStatus();
  const sel = useSelection().sel;
  useSavesVersion();
  const notesVersion = useNotesVersion();
  const world = currentWorld();
  // 国名按打开窗口那一刻时间轴上的年份(播放时不跟着每一年重画)
  const [year] = useState(() => Math.floor(Math.min(civ.endYear, Math.max(0, getCivTime().year ?? civ.endYear))));

  const src = getBookSource();
  // 打开那一刻定下默认值:人物卡、世系图进来 = 那一篇列传 / 家传;国家面板进来 = 那一国;上次没设置 AI 没写成 = 上次选的;
  // 否则整个世界(选中了国家、人物就多一个他那一国)
  const [init] = useState(() => {
    const b = getBook();
    const pend = b.dialog.polity === null ? b.pending : null;
    const life: LifeScope | null = b.dialog.life ?? (pend && isLifeScope(pend.scope) ? pend.scope : null);
    const preset = b.dialog.polity ?? (pend?.scope.kind === 'polity' ? pend.scope.polity : null);
    const lifePolity = life?.kind === 'person' ? (civ.people?.[life.person]?.polity ?? null) : life?.kind === 'house' ? life.polity : null;
    const chosen = lifePolity ?? (sel?.kind === 'polity' ? sel.id : sel?.kind === 'person' ? (civ.people?.[sel.id]?.polity ?? null) : null);
    const lifePend = !!pend && isLifeScope(pend.scope);
    return {
      life,
      polity: preset !== null && civ.polities[preset] ? preset : chosen !== null && civ.polities[chosen] ? chosen : null,
      scope: (life ? 'life' : preset !== null && civ.polities[preset] ? 'polity' : 'world') as 'world' | 'polity' | 'life',
      style: (!lifePend && pend?.style) || b.prefs.style,
      length: (!lifePend && pend?.length) || b.prefs.length,
      lifeStyle: (lifePend && pend?.style) || b.lifeStyle,
    };
  });
  const [scope, setScope] = useState(init.scope);
  const [style, setStyle] = useState<HistoryStyle>(BOOK_STYLES.includes(init.style) ? init.style : BOOK_STYLES[0]);
  const [length, setLength] = useState<HistoryLength>(BOOK_LENGTHS.includes(init.length) ? init.length : BOOK_LENGTHS[1]);
  const [lifeStyle, setLifeStyleHere] = useState<HistoryStyle>(LIFE_STYLES.includes(init.lifeStyle) ? init.lifeStyle : LIFE_STYLES[0]);
  const polity = init.polity;
  const life = init.life;
  const isLife = scope === 'life' && life !== null;

  const opts: BookOptions = isLife
    ? { scope: life, style: lifeStyle, length: lifeLength(life) }
    : { scope: scope === 'polity' && polity !== null ? { kind: 'polity', polity } : { kind: 'world' }, style, length };
  const prompts = useMemo(() => bookPrompts(civ, opts, src), [civ, scope, polity, style, length, lifeStyle, life, src]);
  const target = HISTORY_LENGTHS[opts.length].chars;
  const thin = !prompts.empty && prompts.chars < target * 0.95;

  const notes = useMemo(() => (world ? listHistoryNotes(world.id) : []), [world?.id, notesVersion]);
  const status = useMemo(() => new Map(notes.map((n) => [n.key, historyNoteStatus(civ, n, src)])), [notes, civ, src]);
  const key = bookNoteKey(bookStoreScope(civ, opts.scope, src), opts.style, opts.length);
  const existing = notes.find((n) => n.key === key);

  const job = st.job;
  const busy = job?.status === 'writing';
  const busyName = busy ? bookTitleText(job.title, job.opts.scope, world?.title) : '';

  const scopes: { k: 'world' | 'polity' | 'life'; label: string }[] = [{ k: 'world', label: '整个世界' }];
  if (polity !== null) scopes.push({ k: 'polity', label: polityNameAt(civ.polities[polity], year) });
  if (life) scopes.push({ k: 'life', label: lifeOptionLabel(civ, life, src) });

  let hint: string;
  if (busy) hint = `正在撰写${busyName},写完才能开始下一部。`;
  else if (prompts.empty) hint = isLife ? '找不到要写的人了。' : '这段历史里没有史事可写。';
  else if (isLife) {
    const charName = life.kind === 'character' ? (src?.character(life.char)?.name ?? '') : '';
    hint = `${lifeHint(civ, life, charName)}${thin ? `（事迹约够 ${prompts.chars} 字）` : ''}，由 AI 撰写，约需 ${minutes(prompts.chars)}。生成期间可继续浏览地图。`;
  } else {
    const who = scope === 'polity' ? '这一国' : '这个世界';
    hint = `${thin ? `${who}的史料约够 ${prompts.chars} 字。` : ''}由 AI 撰写,约需 ${minutes(prompts.chars)}。生成期间可继续浏览地图。`;
  }

  const stopBubble = (e: { stopPropagation(): void }) => e.stopPropagation();
  return (
    <div className="bk-bg" onPointerDown={(e) => e.target === e.currentTarget && closeHistoryBook()}>
      <section className="bk-dialog" role="dialog" aria-modal="true" aria-label="生成史书" onPointerDown={stopBubble} onWheel={stopBubble}>
        <header className="bk-head">
          <h2 className="bk-title">生成史书</h2>
          <button className="bk-x" onClick={closeHistoryBook} title="关闭" aria-label="关闭">
            ✕
          </button>
        </header>
        <div className="bk-body">
          <Row label="写什么">
            {scopes.map((s) => (
              <Opt key={s.k} on={scope === s.k} onClick={() => setScope(s.k)} data-scope={s.k}>
                {s.label}
              </Opt>
            ))}
          </Row>
          <Row label="文体">
            {isLife
              ? LIFE_STYLES.map((k) => (
                  <Opt
                    key={k}
                    on={lifeStyle === k}
                    onClick={() => {
                      setLifeStyleHere(k);
                      setLifeStyle(k);
                    }}
                    data-style={k}
                  >
                    {HISTORY_STYLES[k].label}
                  </Opt>
                ))
              : BOOK_STYLES.map((k) => (
                  <Opt
                    key={k}
                    on={style === k}
                    onClick={() => {
                      setStyle(k);
                      setBookPrefs({ style: k });
                    }}
                    data-style={k}
                  >
                    {historyStyleLabel(k)}
                  </Opt>
                ))}
          </Row>
          <Row label="篇幅">
            {isLife ? (
              <Opt on onClick={() => {}} data-length={opts.length}>
                {`约 ${HISTORY_LENGTHS[opts.length].chars} 字`}
              </Opt>
            ) : (
              BOOK_LENGTHS.map((k) => (
                <Opt
                  key={k}
                  on={length === k}
                  onClick={() => {
                    setLength(k);
                    setBookPrefs({ length: k });
                  }}
                  data-length={k}
                >
                  {LENGTH_TEXT[k] ?? HISTORY_LENGTHS[k].label}
                </Opt>
              ))
            )}
          </Row>
          <p className="bk-hint" data-testid="book-hint">
            {hint}
            {existing && !busy && <span className="bk-hint-2">{isLife ? '已写过这一篇，重新生成会替换它。' : '已写过这一部,重新生成会替换它。'}</span>}
          </p>
          {notes.length > 0 && (
            <div className="bk-lib">
              <div className="bk-lib-k">
                已写的 <span>{notes.length}</span>
              </div>
              <div className="bk-lib-list">
                {notes.map((n) => {
                  const s = status.get(n.key);
                  return (
                    <button key={n.key} className="bk-lib-row" onClick={() => openBookReader(n.key)}>
                      <span className="bk-lib-t">{bookTitleText(n.book.title, n.book.scope, world?.title)}</span>
                      <span className="bk-lib-m">
                        {bookHowText(n.book.scope, n.book.style, n.book.length, ' · ')} · {shortDate(n.createdAt)}
                        {s?.stale && <em className="bk-tag">历史已变</em>}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        <footer className="bk-foot">
          <button className={`bk-ai${ai.ready ? '' : ' off'}`} onClick={() => openAiSettings()} title="选用哪家 AI、填密钥、看调用记录">
            AI 设置
            <span>{ai.ready ? `${ai.label}${ai.model && ai.model !== 'mock' ? ` · ${ai.model}` : ''}` : '未设置'}</span>
          </button>
          <button className="bk-btn" onClick={closeHistoryBook}>
            取消
          </button>
          <button className="bk-btn primary" data-act="book-start" disabled={busy || prompts.empty} onClick={() => startBook(opts)}>
            {existing && !busy ? '重新生成' : '开始生成'}
          </button>
        </footer>
      </section>
    </div>
  );
}

/** 写列传、家传时那一句:"照世祖苏珩羽卡片上的事写一篇传""照作者写的经历写沈青禾的传""照世系图写衍朝苏氏这一朝的家事" */
function lifeHint(civ: Civ, life: LifeScope, charName: string): string {
  if (life.kind === 'person') {
    const x = civ.people?.[life.person];
    return `照${x ? personName(civ, x) : '他'}卡片上的事写一篇传`;
  }
  if (life.kind === 'character') return `照作者写的经历写${charName || '这个人物'}的传`;
  return `照世系图写${houseName(civ, life.polity, life.dynasty) || '这一朝'}这一朝的家事`;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bk-row">
      <span className="bk-k">{label}</span>
      <div className="bk-opts">{children}</div>
    </div>
  );
}

function Opt({ on, onClick, children, ...rest }: { on: boolean; onClick: () => void; children: React.ReactNode; [k: `data-${string}`]: string }) {
  return (
    <button className={`bk-opt${on ? ' on' : ''}`} aria-pressed={on} onClick={onClick} {...rest}>
      {children}
    </button>
  );
}
