/**
 * 世界文件测试用的小世界:最小的地块数、3000 年、带一件地形大事,一两秒生成完;作者内容、封面、配方都填上。
 * 只给世界文件的测试用,文件的第 1 版样本不是从这里来的(那份是做好的成品,不重新生成,见 tests/world-file-v1.test.ts)。
 */
import { generateCiv } from '../../src/gen/civ';
import { chronicleBlock } from '../../src/gen/civ/story/nameTokens';
import { flagBook } from '../../src/gen/civ/story/flags';
import { upheavalSteps } from '../../src/gen/civ/upheaval';
import { GENERATOR_VERSION, type Upheaval, type WorldEdits } from '../../src/gen/edits';
import { makeSave, worldCheck } from '../../src/gen/savefile';
import { DEFAULT_PARAMS, generateWorld } from '../../src/gen/world';
import type { PackInput, WorldEras } from '../../src/gen/worldFile';
import type { AuthorContent, WorldMade, WorldReaders } from '../../src/gen/worldFormat';

export const READERS: WorldReaders = { terrain: 1, query: 1 };
export const MADE: WorldMade = { app: '1.5.0', generator: GENERATOR_VERSION, commit: '3c4eea2', at: '2026-11-04T08:00:00.000Z' };

const UPHEAVALS: Upheaval[] = [{ year: 1500, ops: [{ kind: 'volcano', pts: [812, 403], r: 60, s: 1.5 }] }];

/** 最小的合格 JPEG 头:开头、带尺寸的一段(SOF0)、结尾。校验器只看这几样;真的封面见第 1 版样本 */
export function tinyJpeg(w = 48, h = 24): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, h >> 8, h & 0xff, w >> 8, w & 0xff, 0x01, 0x01, 0x11, 0x00, 0xff, 0xd9]);
}

const AUTHOR: AuthorContent = {
  notes: [{ key: '史书:polity:c1#0', kind: '史书', title: '大昌本纪', text: '大昌立国于河东,传九世而亡。\n\n这是 AI 写的正文,<b>不当网页内容</b>。', createdAt: '2026-11-04T08:00:00.000Z', provider: 'test', model: 'test-1' }],
};

/** 打包要的全部内容 */
export function makeSample(): PackInput & { eras: WorldEras } {
  const params = { ...DEFAULT_PARAMS, seed: 7, cells: 2000 };
  const world = generateWorld(params);
  const steps = upheavalSteps(params, [], null, UPHEAVALS);
  const civ = generateCiv(world, { endYear: 3000, upheavals: steps });
  const eras: WorldEras = {
    baseKey: 'base',
    eras: steps.map((s, i) => {
      const { mesh: _mesh, history: _history, ...rest } = s.world;
      void _mesh;
      void _history;
      return { key: `era${i}`, world: { ...rest, history: [] } };
    }),
  };
  const edits: WorldEdits = { names: { 'polity:c1#0': '饕餮王朝' }, interventions: [], terrain: [], upheavals: UPHEAVALS };
  return {
    id: 'wsample',
    title: '九州大陆',
    made: MADE,
    readers: READERS,
    recipe: makeSave(params, edits, worldCheck(world), '九州大陆', '2026-11-04T08:00:00.000Z', { projection: 'robinson', center: 120 }, { title: '苍澜界', url: 'https://example.org/s/k7Qm2xPa' }),
    map: world,
    eras,
    civ,
    chronicle: chronicleBlock(civ),
    flags: flagBook(world, civ),
    author: AUTHOR,
    thumb: tinyJpeg(),
  };
}

/** 把 Blob 读成字节 */
export const bytesOf = async (b: Blob) => new Uint8Array(await b.arrayBuffer());
