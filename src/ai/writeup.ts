/**
 * 卡片「更多」里让 AI 写的一段(民族的风俗、宗教的教义):调一次 AI(流式),收拾、扫一遍现实里的词,存进本地(ai/library.ts)。
 * 各功能只管材料和提示词(ai/prompts/customs.ts、doctrine.ts),拼成一份 WriteupJob;界面那一块见 ui/AiWriteup.tsx。
 */
import { aiChat } from './client';
import { AiError, type AiRequest } from './types';
import { putNote, type AiNote } from './library';
import { fixRealWords, type ScanOptions } from './realWords';

/** 存下的一段:再记上写的时候的历史指纹(过时检查)、按哪一年写的 */
export interface WriteupNote extends AiNote {
  stamp?: string;
  year?: number;
}

/** 写一段要的东西 */
export interface WriteupJob {
  /** 存在哪个世界(ui/AiNamePanel.tsx 的 worldId) */
  world: string;
  /** 存的键、哪个功能("风俗""教义") */
  key: string;
  kind: string;
  /** 标题(请求里没给 title 时用) */
  shown: string;
  req: AiRequest;
  /** 收拾 AI 写的(去标题、Markdown) */
  clean: (text: string) => string;
  /** 写完扫现实里的词用 */
  scan: ScanOptions;
  /** 写的时候的历史指纹、按哪一年写的 */
  stamp: string;
  year: number;
}

/** 写一段并存下;没写出内容、出错、取消都抛 AiError */
export async function runWriteup(job: WriteupJob, opts: { signal?: AbortSignal; onDelta?: (full: string) => void } = {}): Promise<WriteupNote> {
  const r = await aiChat(job.req, { signal: opts.signal, onDelta: (_, full) => opts.onDelta?.(full) });
  // 扫一遍现实里的词(真实的民族、宗教、节日、典籍……),命中的句子让 AI 改一次
  const text = await fixRealWords(job.clean(r.text), { ...job.scan, feature: job.req.feature, title: job.req.title, signal: opts.signal });
  if (!text) throw new AiError('bad-response', 'AI 没有写出内容,再试一次');
  const saved: WriteupNote = {
    key: job.key,
    kind: job.kind,
    title: job.req.title ?? job.shown,
    text,
    createdAt: new Date().toISOString(),
    provider: r.provider,
    model: r.model,
    stamp: job.stamp,
    year: job.year,
  };
  putNote(job.world, saved);
  return saved;
}
