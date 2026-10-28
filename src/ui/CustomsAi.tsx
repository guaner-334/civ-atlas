/**
 * 民族卡片里的"风俗"(「更多」→ 讲讲风俗):让 AI 按这一族的材料写一段风俗,边写边显示(可停止);
 * 写好的存在本地(按世界,ai/library.ts),下次打开卡片还在卡片最下面,能重写、复制、收起;
 * 历史改写过(干预、改地形)以后标"写于历史改写前"。样子和名字由来那一块一样(AiNamePanel.tsx)。
 * 材料、提示词在 ai/prompts/customs.ts;没设置 AI / 失败 / 取消都给中文提示,没设置的带"设置 AI"。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Civ } from '../gen/civ/types';
import { aiChat, useAiOn } from '../ai/client';
import { AiError } from '../ai/types';
import { getNote, putNote, useNotesVersion, type AiNote } from '../ai/library';
import { fixRealWords } from '../ai/realWords';
import { cleanCustoms, cultureMaterial, customsNoteKey, customsRequest, customsScan, customsStamp } from '../ai/prompts/customs';
import { eraText } from '../gen/era';
import { useEra } from './editsStore';
import { AiTag } from './aiTag';
import { ErrLine, dateLabel, providerLabel, toErr, worldId, type Err } from './AiNamePanel';

/** 存下的风俗:再记上写的时候的历史指纹(过时检查)、按哪一年写的 */
interface CustomsNote extends AiNote {
  stamp?: string;
  year?: number;
}

interface State {
  key: string;
  writing: boolean;
  live: string;
  err: Err | null;
  expanded: boolean;
  copied: boolean;
}

const fresh = (key: string): State => ({ key, writing: false, live: '', err: null, expanded: true, copied: false });

export interface CustomsAi {
  /** 风俗那一块(没写过、没在写 = null) */
  panel: ReactNode;
  /** 「讲讲风俗」:没写过 = 让 AI 写;写过 = 展开 */
  ask: () => void;
  busy: boolean;
  /** 正在写:已经写出来几个字(卡片跟着往下划) */
  live: number;
}

export function useCustomsAi(civ: Civ, id: number, year: number): CustomsAi {
  useNotesVersion();
  const on = useAiOn();
  const era = useEra();
  const key = civ.cultures[id] ? customsNoteKey(civ, id) : '';
  const [st, setSt] = useState<State>(() => fresh(key));
  const ctl = useRef<AbortController | null>(null);
  // 换了民族(或卸载):停掉进行中的调用
  useEffect(() => () => ctl.current?.abort(), [key]);
  // 「使用 AI 功能」关了:停掉(写过的留着,只是不显示)
  useEffect(() => {
    if (!on) ctl.current?.abort();
  }, [on]);
  const s = st.key === key ? st : fresh(key);
  if (st.key !== key) setSt(s);
  const patch = (k: string, p: Partial<State>) => setSt((prev) => (prev.key === k ? { ...prev, ...p } : prev));

  if (!on || !key) return { panel: null, ask: () => {}, busy: false, live: 0 };
  const world = worldId(civ);
  const note = getNote(world, key) as CustomsNote | undefined;
  const stale = !!note && typeof note.stamp === 'string' && note.stamp !== customsStamp(civ, id);

  const write = async () => {
    const k = key;
    ctl.current?.abort();
    const c = new AbortController();
    ctl.current = c;
    patch(k, { writing: true, live: '', err: null, expanded: true, copied: false });
    try {
      const m = cultureMaterial(civ, id, year);
      if (!m) throw new AiError('other', '找不到这个民族了');
      const req = customsRequest(m);
      const r = await aiChat(req, { signal: c.signal, onDelta: (_, full) => patch(k, { live: full }) });
      // 扫一遍现实里的词(真实的民族、节日、典籍……),命中的句子让 AI 改一次
      const text = await fixRealWords(cleanCustoms(r.text), { ...customsScan(m), feature: req.feature, title: req.title, signal: c.signal });
      if (!text) throw new AiError('bad-response', 'AI 没有写出内容,再试一次');
      const saved: CustomsNote = {
        key: k,
        kind: '风俗',
        title: req.title ?? m.shown,
        text,
        createdAt: new Date().toISOString(),
        provider: r.provider,
        model: r.model,
        stamp: m.stamp,
        year: m.year,
      };
      putNote(world, saved);
      patch(k, { writing: false, live: '' });
    } catch (e) {
      patch(k, { writing: false, live: '', err: toErr(e) });
    } finally {
      if (ctl.current === c) ctl.current = null;
    }
  };
  const stop = () => ctl.current?.abort();
  const copy = () => {
    if (!note) return;
    navigator.clipboard?.writeText(eraText(note.text, era)).then(
      () => {
        patch(key, { copied: true });
        setTimeout(() => patch(key, { copied: false }), 1500);
      },
      () => {},
    );
  };

  const panel =
    s.writing || s.err || note ? (
      <div className={`ain-box ain-note${s.writing ? ' writing' : ''}`} data-ai="customs">
        <div className="ain-head">
          <span className="ain-title">
            风俗
            <AiTag />
          </span>
          {s.writing ? (
            <span className="ain-status">AI 正在写…</span>
          ) : (
            stale && (
              <span className="ain-stale" title="之后历史被改写过(干预 / 改地形),里面的年份、事件可能对不上了">
                写于历史改写前
              </span>
            )
          )}
        </div>
        {s.writing ? (
          <p className="ain-text">
            {eraText(s.live, era) || <span className="ain-wait-text">生成中…</span>}
            {s.live && <span className="ain-caret" />}
          </p>
        ) : note ? (
          <p className={`ain-text${s.expanded ? '' : ' clamp'}`} onClick={() => !s.expanded && patch(key, { expanded: true })} title={s.expanded ? undefined : '点一下看全文'}>
            {eraText(cleanCustoms(note.text), era)}
          </p>
        ) : null}
        {s.err && <ErrLine err={s.err} retry={write} />}
        {(s.writing || note) && (
          <div className="ain-actions">
            {s.writing ? (
              <button onClick={stop}>停止</button>
            ) : (
              note && (
                <>
                  <button onClick={write}>重写</button>
                  <button onClick={copy}>{s.copied ? '已复制' : '复制'}</button>
                  <button onClick={() => patch(key, { expanded: !s.expanded })}>{s.expanded ? '收起' : '展开'}</button>
                  <span className="ain-by">
                    {providerLabel(note.provider, note.model)}
                    {dateLabel(note.createdAt) && `，${dateLabel(note.createdAt)}`}
                  </span>
                </>
              )
            )}
          </div>
        )}
      </div>
    ) : null;

  return {
    panel,
    ask: () => {
      if (s.writing) return;
      if (note && !s.err) patch(key, { expanded: true });
      else void write();
    },
    busy: s.writing,
    live: s.writing ? s.live.length : 0,
  };
}
