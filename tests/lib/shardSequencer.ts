/**
 * 单测排队、分份的办法(vite.config.ts 的 test.sequence.sequencer)。
 *
 * PR 上的检查把单测分成几份,在几台机器上同时跑(vitest run --shard=第几份/共几份)。vitest 自带的分法
 * 按文件名的散列平均分文件个数,不管快慢:几个一两分钟的慢文件扎堆分到一起时,最慢的一份要比最快的一份慢一倍多。
 * 这里按每个文件大概要跑多久分:从慢到快,一个个放进眼下最轻的那一份,几份的耗时就差不多。
 * 几台机器各算各的,文件和表一样,分出来就一样,不会漏跑、重跑。
 *
 * 每一份里(不分份时就是全部)也从慢到快排着跑,慢文件早早开跑,不会在最后单独拖长整份。
 * 只改先后和分份,不改跑哪些测试:本地 pnpm test 照样一次跑全。
 */
import { relative } from 'node:path';
import type { TestSequencer, Vitest, WorkspaceSpec } from 'vitest/node';

/**
 * 各测试文件(tests/ 下、去掉 .test.ts)在 GitHub 的机器上大概要跑几秒,取自 PR 检查的日志,大致准就行。
 * 没列出来的按 DEFAULT_SECONDS 算。新加的文件要跑半分钟以上的,记得补一行,不然可能和别的慢文件分到同一份。
 */
const SECONDS: Record<string, number> = {
  stepwise: 128,
  'civ-interventions': 112,
  'civ-labels': 101,
  'stepwise-run-2024': 91,
  'stepwise-run-7': 79,
  'raster-edit': 73,
  'edit-repaint': 73,
  'civ-polities': 70,
  'civ-upheaval': 70,
  'civ-sim': 63,
  'civ-extend': 51,
  'civ-cities': 50,
  'civ-play': 49,
  'civ-resume-fuzz': 45,
  'civ-resume': 39,
  contours: 38,
  'civ-diplomacy': 37,
  'civ-routes': 36,
  'civ-frontier': 36,
  'names-stable': 35,
  'name-mix': 34,
  'civ-politics': 33,
  'civ-regions': 32,
  'sphere-labels': 30,
  'civ-dynasty': 29,
  'civ-wars': 29,
  'civ-assimilation': 28,
  'sphere-raster': 27,
  'terrain-edits': 26,
  'thumb-prep': 26,
  'civ-people-page': 22,
  'civ-unrest': 20,
  'civ-development': 19,
  'civ-chronicle': 19,
  export: 18,
  sketch: 17,
  'places-labels': 17,
  'civ-tempo': 16,
  'civ-sea-lanes': 16,
  characters: 16,
  'civ-plague': 16,
  marks: 15,
  portrait: 15,
  edits: 15,
  'globe-cpu-pool': 14,
  'ai-assistant': 14,
  'civ-rulers': 14,
  'ai-agent': 14,
  savefile: 13,
  'projection-labels': 13,
  'civ-seed': 12,
  'pixel-drain': 12,
  'globe-labels': 12,
  'civ-officials': 12,
  'zoom-detail': 11,
  names: 10,
  'civ-warfare': 9,
  'ui-panels': 9,
  'civ-vassals': 9,
  world: 9,
  'civ-people': 9,
  seaice: 8,
  'civ-detail': 8,
  'civ-lineage-view': 8,
  'ui-overview-tables': 8,
};
/** 表里没有的文件按几秒算(没列的那些大多一两秒以内) */
const DEFAULT_SECONDS = 2;
/** 每个文件另有载入代码的开销(秒) */
const LOAD_SECONDS = 1;

export class ShardSequencer implements TestSequencer {
  constructor(private readonly ctx: Vitest) {}

  /** 表里的名字:tests/ 下的路径、去掉 .test.ts */
  private name(spec: WorkspaceSpec): string {
    return relative(this.ctx.config.root, spec.moduleId)
      .replace(/\\/g, '/')
      .replace(/^tests\//, '')
      .replace(/\.test\.ts$/, '');
  }

  private seconds(spec: WorkspaceSpec): number {
    return (SECONDS[this.name(spec)] ?? DEFAULT_SECONDS) + LOAD_SECONDS;
  }

  /** 从慢到快;一样慢的按名字排,哪台机器上排出来都一样 */
  private slowFirst(files: WorkspaceSpec[]): WorkspaceSpec[] {
    const keyed = files.map((spec) => ({ spec, s: this.seconds(spec), n: this.name(spec) }));
    keyed.sort((a, b) => b.s - a.s || (a.n < b.n ? -1 : a.n > b.n ? 1 : 0));
    return keyed.map((k) => k.spec);
  }

  shard(files: WorkspaceSpec[]): WorkspaceSpec[] {
    const { index, count } = this.ctx.config.shard!;
    const load = new Array<number>(count).fill(0);
    const mine: WorkspaceSpec[] = [];
    for (const spec of this.slowFirst(files)) {
      let k = 0;
      for (let i = 1; i < count; i++) if (load[i] < load[k]) k = i;
      load[k] += this.seconds(spec);
      if (k === index - 1) mine.push(spec);
    }
    return mine;
  }

  sort(files: WorkspaceSpec[]): WorkspaceSpec[] {
    return this.slowFirst(files);
  }
}
