/**
 * 照接口第 1 版写的两个插件(厌战、宗教生效)在种子 7、2024 默认参数推 3000 年钉住的结果:
 * 直接跑(tests/sim-plugin-v1.test.ts)和打成插件包经 QuickJS 跑(tests/sim-plugin-examples.test.ts)都对它。
 * 改了官方推演(同一种子的历史变了)跟着变:PRINT_PINS=1 跑 sim-plugin-v1.test.ts,照打出来的换掉
 */
import { createHash } from 'node:crypto';
import type { Civ } from '../../src/gen/civ';
import { packValue } from '../../src/gen/snapshot';

/** 推出来的历史的指纹:史事、归属、干预、插件写的编年史和状态 */
export function simDigest(civ: Civ): string {
  const x = packValue({ annals: civ.annals, polity: civ.polity, culture: civ.culture, interventions: civ.interventions ?? [], chronicle: civ.simChronicle ?? [], plugins: civ.simPlugins ?? [] });
  return createHash('sha256').update(x).digest('hex').slice(0, 16);
}

export const V1_SEEDS = [7, 2024] as const;
export type V1Seed = (typeof V1_SEEDS)[number];

export const V1_PINS: Record<V1Seed, { weariness: { digest: string } & Record<string, unknown>; faith: { digest: string } & Record<string, unknown> }> = {
  7: {
    weariness: { before: { wars: 90, meanYears: 7.25, long: 28 }, after: { wars: 39, meanYears: 3.96, long: 3 }, treaties: 23, digest: '57d64d61ff100c94' },
    faith: { before: { wars: 100, farWars: 27, pacts: 3, samePacts: 0 }, after: { wars: 109, farWars: 47, pacts: 8, samePacts: 4 }, declare: 0, ally: 2, digest: '576a425e9055be22' },
  },
  2024: {
    weariness: { before: { wars: 8, meanYears: 4.22, long: 0 }, after: { wars: 7, meanYears: 2.8, long: 0 }, treaties: 3, digest: 'c9bfc1aa61958641' },
    faith: { before: { wars: 94, farWars: 17, pacts: 1, samePacts: 0 }, after: { wars: 148, farWars: 82, pacts: 13, samePacts: 8 }, declare: 2, ally: 8, digest: '724181989f1f7336' },
  },
};
