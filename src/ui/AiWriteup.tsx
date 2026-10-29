/**
 * 卡片「更多」里让 AI 写的一段(民族卡片的"风俗"、宗教卡片的"教义")那一块:边写边显示(可停止);
 * 写好的存在本地(按世界,ai/library.ts),下次打开卡片还在卡片最下面,能重写、复制、收起;
 * 历史改写过(干预、改地形)以后标"写于历史改写前"。样子和名字由来那一块一样(AiNamePanel.tsx)。
 * 写的那一步在 ai/writeup.ts;没设置 AI / 失败 / 取消都给中文提示,没设置的带"设置 AI"。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Civ } from '../gen/civ/types';
import { useAiOn } from '../ai/client';
import { getNote, useNotesVersion } from '../ai/library';
import { runWriteup, type WriteupJob, type WriteupNote } from '../ai/writeup';
import { eraText } from '../gen/era';
import { useEra } from './editsStore';
import { AiTag } from './aiTag';
import { ErrLine, dateLabel, providerLabel, toErr, worldId, type Err } from './AiNamePanel';

export interface WriteupSpec {
  /** 存的键;'' = 这张卡片没有这一项 */
  key: string;
  /** 那一块的标题("风俗""教义") */
  label: string;
  /** 那一块的 data-ai(冒烟、截图认它) */
  tag: string;
  /** 现在的历史指纹(和存下的对不上 = 写于历史改写前;只在有存下的时候问) */
  stamp: () => string;
  /** 点了才拼材料;找不到了就抛 AiError */
  job: (world: string) => WriteupJob;
  /** 显示前收拾一遍(老的存档里可能还带着标题) */
  clean: (text: string) => string;
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

export interface AiWriteup {
  /** 那一块(没写过、没在写 = null) */
  panel: ReactNode;
  /** 菜单里那一项:没写过 = 让 AI 写;写过 = 展开 */
  ask: () => void;
  busy: boolean;
  /** 正在写:已经写出来几个字(卡片跟着往下划) */
  live: number;
}

export function useAiWriteup(civ: Civ, spec: WriteupSpec): AiWriteup {
  useNotesVersion();
  const on = useAiOn();
  const era = useEra();
  const { key, label, tag } = spec;
  const [st, setSt] = useState<State>(() => fresh(key));
  const ctl = useRef<AbortController | null>(null);
  // 换了一个(或卸载):停掉进行中的调用
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
  const note = getNote(world, key) as WriteupNote | undefined;
  const stale = !!note && typeof note.stamp === 'string' && note.stamp !== spec.stamp();

  const write = async () => {
    const k = key;
    ctl.current?.abort();
    const c = new AbortController();
    ctl.current = c;
    patch(k, { writing: true, live: '', err: null, expanded: true, copied: false });
    try {
      await runWriteup(spec.job(world), { signal: c.signal, onDelta: (full) => patch(k, { live: full }) });
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
      <div className={`ain-box ain-note${s.writing ? ' writing' : ''}`} data-ai={tag}>
        <div className="ain-head">
          <span className="ain-title">
            {label}
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
            {eraText(spec.clean(note.text), era)}
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
