/**
 * 宗教卡片里的"教义"(「更多」→ 讲讲教义):让 AI 按这一教的材料写一段教义,写好的留在卡片最下面
 * (那一块的样子、存取、过时标记见 AiWriteup.tsx;材料、提示词在 ai/prompts/doctrine.ts)。民间信仰没有这一项。
 */
import type { Civ } from '../gen/civ/types';
import { AiError } from '../ai/types';
import { cleanDoctrine, doctrineJob, doctrineNoteKey, doctrineStamp } from '../ai/prompts/doctrine';
import { useAiWriteup, type AiWriteup } from './AiWriteup';

export function useDoctrineAi(civ: Civ, id: number, year: number): AiWriteup {
  const f = civ.religion?.faiths[id];
  return useAiWriteup(civ, {
    key: f && f.kind !== 'folk' ? doctrineNoteKey(civ, id) : '',
    label: '教义',
    tag: 'doctrine',
    stamp: () => doctrineStamp(civ, id),
    job: (world) => {
      const job = doctrineJob(civ, id, year, world);
      if (!job) throw new AiError('other', '找不到这个宗教了');
      return job;
    },
    clean: cleanDoctrine,
  });
}
