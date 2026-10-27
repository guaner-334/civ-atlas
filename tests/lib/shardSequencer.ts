/**
 * 单测排队、分份的办法(vite.config.ts 的 test.sequence.sequencer)。
 *
 * PR 上的检查把单测分成几份,在几台机器上同时跑(vitest run --shard=第几份/共几份)。vitest 自带的分法
 * 按文件名的散列平均分文件个数,不管快慢:几个几分钟的慢文件扎堆分到一起时,最慢的一份要比最快的一份慢一倍多。
 * 这里按每个文件大概要跑多久分:从慢到快,一个个放进眼下最轻的那一份,几份的耗时就差不多。
 * 几台机器各算各的,文件和表一样,分出来就一样,不会漏跑、重跑。
 *
 * 每一份里(不分份时就是全部)也从慢到快排着跑,慢文件早早开跑,不会在最后单独拖长整份。
 * 只改先后和分份,不改跑哪些测试:本地 pnpm test 照样一次跑全。
 */
import { relative } from 'node:path';
import type { TestSequencer, Vitest, WorkspaceSpec } from 'vitest/node';

/**
 * 各测试文件(tests/ 下、去掉 .test.ts)在 GitHub 的机器上大概要跑几秒,大致准就行。
 *
 * 取自检查日志里 vitest 每个文件那行的毫秒数(几轮 main 和 PR 上的检查合起来看)。
 * GitHub 的机器快慢不一,同一个文件这一轮比那一轮慢一半也常见,表里是折算到中等快的机器上的数。
 * 一份里 3 个文件同时跑,一份的用时 ≈ 这份各文件秒数加起来 ÷ 2.8。
 * 全部加起来七千来秒,分 6 份每份约 7 分钟。
 */
const SECONDS: Record<string, number> = {
  'civ-interventions': 364,
  'civ-resume-fuzz': 334,
  stepwise: 234,
  'civ-more-interventions': 213,
  'stepwise-run-2024': 213,
  'civ-sim': 198,
  'stepwise-run-7': 186,
  'civ-upheaval': 183,
  'civ-policy': 179,
  'outline-guide': 179,
  outline: 178,
  'civ-crown': 170,
  'civ-pandemic': 145,
  'civ-base-cache': 142,
  'civ-resume': 139,
  'civ-keep': 136,
  'civ-frontier': 130,
  'civ-polities': 126,
  'names-stable': 126,
  'civ-cities': 120,
  'raster-edit': 112,
  'civ-labels': 104,
  'civ-assimilation': 100,
  'civ-wars': 99,
  'name-mix': 97,
  'civ-routes': 94,
  'civ-people-page': 89,
  'civ-extend': 83,
  'ai-assistant': 78,
  'civ-diplomacy': 78,
  'civ-unrest': 78,
  'civ-control': 77,
  'civ-politics': 77,
  'civ-council': 75,
  'civ-regions': 72,
  'edit-repaint': 65,
  'civ-boost': 58,
  'chronicle-handoff': 57,
  'stepwise-rewind': 56,
  'civ-dynasty': 55,
  'civ-fiscal-book': 50,
  'civ-play': 49,
  'sphere-labels': 49,
  'ai-agent': 48,
  'civ-sea-lanes': 44,
  'ai-lookup': 42,
  'civ-plague': 39,
  'civ-treaties': 39,
  'regency-iv': 39,
  portrait: 36,
  'civ-exile': 35,
  'crown-ui': 33,
  'keep-ui': 32,
  'civ-chronicle': 31,
  contours: 31,
  'places-labels': 31,
  'civ-development': 29,
  'sphere-raster': 29,
  'civ-pass-sites': 28,
  'new-iv-ui': 28,
  'stepwise-ui': 28,
  'civ-tempo': 27,
  marks: 27,
  'treaty-iv': 27,
  'civ-rulers': 26,
  'civ-seed': 26,
  'thumb-prep': 26,
  edits: 24,
  'share-moment': 24,
  'ai-history': 23,
  export: 23,
  finder: 23,
  'policy-ui': 22,
  'civ-officials': 21,
  savefile: 21,
  characters: 18,
  'projection-labels': 18,
  'civ-regency': 17,
  'globe-labels': 17,
  'stepwise-branches-run-2024': 17,
  'civ-people': 16,
  'civ-warfare': 16,
  'civ-swap-prep': 15,
  'globe-cpu-pool': 15,
  sketch: 15,
  'stepwise-branches-run-7': 15,
  'civ-vassals': 14,
  'stepwise-branches-run-11': 14,
  'civ-detail': 13,
  'civ-lineage-view': 13,
  determinism: 13,
  'court-ui': 12,
  follow: 12,
  'labels-charset': 12,
  'ui-overview-tables': 12,
  'ui-panels': 12,
  'ai-realwords': 11,
  'ai-rewrite': 11,
  'pixel-drain': 11,
  'selection-outline': 11,
  'ai-names': 10,
  'outline-move': 10,
  seaice: 10,
  'civ-religion': 9,
  'civ-royals': 9,
  'finder-ui': 9,
  snapshot: 9,
  'terrain-edits': 9,
  world: 9,
  'zoom-detail': 9,
  flags: 7,
  'regency-ui': 7,
  names: 6,
  'person-rename': 6,
  plates: 5,
  'inland-sea': 4,
  'story-strip': 4,
  'step-branches-ui': 3,
  'stepwise-branches': 3,
};

/** 不到 3 秒的文件,按 QUICK_SECONDS 算 */
const QUICK = new Set(
  `
  account-sync ai-calllog ai-client ai-providers ai-switch announcement band-labels-step beian beta-news
  civ-control-layer civ-parts civ-passes civ-state-tables civ-tables civ-wash clouds coast-chunks contact
  data-legend detail-jobs diag director-plan director-store end-year era extend-years file-name-case
  film-plan frozen-world gallery gallery-helper gen-speed geometry globe globe-lines globe-redraw
  grat-labels home-start ice-edge inline-icons labels-layout labels-polity load-screen long-plan map-groups
  map-wrap multiset-diff nav old-site outline-store play-quality preset-link presets projection
  projection-redraw realistic-shores result-store river-shape role-store sea-lines share sketch-image
  studio-planet styles-list tectonics terrain-full terrain-tools timeline-layout treaty-ui ui-book-search
  ui-mobile ui-outline-map ui-pending ui-shell ui-shortcuts ui-wheel ui-worlds upheaval-ui
`
    .split(/\s+/)
    .filter(Boolean),
);
const QUICK_SECONDS = 1;

/**
 * 上面两处都没有的(多半是新加的文件)按几秒算。近来新加的测试文件快的一两秒、慢的三四分钟,
 * 中间的多是二三十秒;按 30 秒算比按一两秒算离实际近。
 * 新加的文件要跑一分钟以上的,检查跑过一轮后照日志补进 SECONDS;不到 3 秒的补进 QUICK。
 */
const NEW_FILE_SECONDS = 30;
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
    const name = this.name(spec);
    const s = SECONDS[name] ?? (QUICK.has(name) ? QUICK_SECONDS : NEW_FILE_SECONDS);
    return s + LOAD_SECONDS;
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
