/**
 * 钉住世界文件第 1 版。tests/fixtures/world-file/v1.civworld 是第 1 版做好的成品,用的人手里的世界文件就长这样。
 *
 * **这个测试红了,说明用的人已经存好的世界打不开了,或者打开以后变了。** 这份文件和 v1.json 不能改、不能重新做一份:
 * 改掉它们,测试是绿了,用的人手里的文件还是打不开。正确的修法只有一个:改代码,让它继续读得开这份文件
 * (结构要变,就在 src/gen/worldMigrate.ts 加一步迁移,把第 1 版转成现在的结构)。
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { restoreEntries } from '../src/gen/civ/story/nameTokens';
import { applyNames } from '../src/gen/edits';
import { openWorldFile, readWorldContent, rewriteWorldFile, type OpenedWorldFile, type WorldContent } from '../src/gen/worldFile';
import { READERS, bytesOf } from './lib/worldFileSample';

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'world-file');
const file = new Uint8Array(readFileSync(join(DIR, 'v1.civworld')));
const FACTS = JSON.parse(readFileSync(join(DIR, 'v1.json'), 'utf8'));

const sha = (b: ArrayBufferView) => createHash('sha256').update(new Uint8Array(b.buffer, b.byteOffset, b.byteLength)).digest('hex');
const shaText = (s: string) => createHash('sha256').update(s).digest('hex');

const FIX_IT = '用的人存好的世界文件就长这样,它读不开或者读出来变了,他们的世界也一样。不能改这份文件:请改代码让它继续读得开,结构要变就在 src/gen/worldMigrate.ts 加一步迁移';

let opened: OpenedWorldFile;
let c: WorldContent;

beforeAll(async () => {
  opened = await openWorldFile(file, { readers: READERS });
  c = await readWorldContent(opened);
}, 60_000);

describe('世界文件第 1 版', () => {
  it('这份文件本身没被改过', () => {
    expect(sha(file), `这份样本被动过了。${FIX_IT}`).toBe(FACTS.file.sha256);
    expect(file.length).toBe(FACTS.file.bytes);
    // 文件大小在 1 MB 上下,仓库不涨太多
    expect(file.length).toBeLessThan(2_000_000);
  });

  it('打得开,校验全过,清单还是第 1 版那些字段', () => {
    const m = opened.manifest;
    expect(m.app, FIX_IT).toBe('文明与地图');
    expect(m.kind, FIX_IT).toBe('world');
    expect(m.format, FIX_IT).toBe(1);
    expect(m.id, FIX_IT).toBe('wfixture1');
    expect(m.title, FIX_IT).toBe('第一版样本');
    expect(m.made.commit, FIX_IT).toBe('3c4eea2');
    expect(m.readers, FIX_IT).toEqual({ terrain: 1, query: 1 });
    expect(m.revision, FIX_IT).toEqual({ n: 1 });
    expect(m.plugins[0], FIX_IT).toMatchObject({ id: 'fixture-sim', version: '1.2.0', role: 'sim' });
    expect(Object.fromEntries(m.parts.map((p) => [p.name, { sum: p.sum, bytes: p.bytes, schema: p.schema }])), FIX_IT).toEqual(FACTS.parts);
    expect(c.skipped, FIX_IT).toEqual([]);
  });

  it('读出来的地图不变', () => {
    expect(
      {
        cells: c.map.mesh.n,
        rivers: c.map.rivers.length,
        maxElevation: c.map.maxElevation,
        elevation: sha(c.map.elevation),
        temperature: sha(c.map.temperature),
        biome: sha(c.map.biome),
        adj: sha(c.map.mesh.adj),
      },
      FIX_IT,
    ).toEqual(FACTS.world);
    expect({ count: c.eras!.eras.length, elevation: sha(c.eras!.eras[0].world.elevation) }, FIX_IT).toEqual(FACTS.eras);
  });

  it('读出来的历史事实不变', () => {
    expect(
      {
        seed: c.civ.seed,
        endYear: c.civ.endYear,
        regions: c.civ.regions.count,
        cultures: c.civ.cultures.length,
        settlements: c.civ.settlements.length,
        polities: c.civ.polities.length,
        annals: c.civ.annals.length,
        people: c.civ.people!.length,
        polityAtEnd: sha(c.civ.polity),
        firstPolity: c.civ.polities[0].name,
        firstCity: c.civ.settlements[0].name,
        logYears: sha(c.civ.log.year),
        annalsText: shaText(JSON.stringify(c.civ.annals)),
      },
      FIX_IT,
    ).toEqual(FACTS.civ);
  });

  it('读出来的编年史原文、国旗、作者内容、封面不变', () => {
    // 第 1 版存的是算好的文字,读进来转成占位符;按配方里的改名换回名字,和当时存的一字不差
    const entries = restoreEntries(c.chronicle.entries, applyNames(c.civ, c.save.edits.names));
    expect({ entries: entries.length, first: entries[0].text, text: shaText(entries.map((e) => e.text).join('\n')) }, FIX_IT).toEqual(FACTS.chronicle);
    expect({ polities: c.flags.eras.length, faces: c.flags.eras.flat().length, specs: shaText(JSON.stringify(c.flags.eras.flat().map((e) => e.spec))) }, FIX_IT).toEqual(FACTS.flags);
    expect({ notes: c.author!.notes.length, first: c.author!.notes[0].title }, FIX_IT).toEqual(FACTS.author);
    expect({ bytes: c.thumb!.length, sha256: sha(c.thumb!) }, FIX_IT).toEqual(FACTS.thumb);
  });

  it('配方还读得出来:改名、人物、标记、出处', () => {
    expect(
      { title: c.save.title, seed: c.save.seed, names: Object.keys(c.save.edits.names).length, characters: c.save.edits.characters!.length, marks: c.save.edits.marks!.length, origin: c.save.origin!.url },
      FIX_IT,
    ).toEqual(FACTS.recipe);
  });

  it('插件的附加数据只当字节留着,另存带着', async () => {
    expect(opened.kept.map((p) => p.name), FIX_IT).toEqual(FACTS.kept);
    const again = await openWorldFile(await bytesOf(await rewriteWorldFile(opened)), { readers: READERS });
    expect(again.bytes.get('ext.fixture-sim'), FIX_IT).toEqual(opened.bytes.get('ext.fixture-sim'));
    expect(again.manifest.revision.n, FIX_IT).toBe(2);
    await readWorldContent(again);
  }, 30_000);
});
