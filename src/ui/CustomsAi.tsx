/**
 * 民族卡片里的"风俗"(「更多」→ 讲讲风俗):让 AI 按这一族的材料写一段风俗,写好的留在卡片最下面
 * (那一块的样子、存取、过时标记见 AiWriteup.tsx;材料、提示词在 ai/prompts/customs.ts)。
 */
import type { Civ } from '../gen/civ/types';
import { AiError } from '../ai/types';
import { cleanCustoms, cultureMaterial, customsNoteKey, customsRequest, customsScan, customsStamp } from '../ai/prompts/customs';
import { useAiWriteup, type AiWriteup } from './AiWriteup';

export type CustomsAi = AiWriteup;

export function useCustomsAi(civ: Civ, id: number, year: number): CustomsAi {
  return useAiWriteup(civ, {
    key: civ.cultures[id] ? customsNoteKey(civ, id) : '',
    label: '风俗',
    tag: 'customs',
    stamp: () => customsStamp(civ, id),
    job: (world) => {
      const m = cultureMaterial(civ, id, year);
      if (!m) throw new AiError('other', '找不到这个民族了');
      const req = customsRequest(m);
      return { world, key: customsNoteKey(civ, id), kind: '风俗', shown: m.shown, req, clean: cleanCustoms, scan: customsScan(m), stamp: m.stamp, year: m.year };
    },
    clean: cleanCustoms,
  });
}
