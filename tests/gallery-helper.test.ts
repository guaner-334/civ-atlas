/**
 * 帮手模式(作品墙的后台在看不见的框里打开网站画封面、列名字;src/ui/helperProtocol.ts、src/ui/helperWork.ts):
 * 只认所配服务器那个来源的后台、回的三样(封面、几样数、名字)格式对、名字不套用作者改的。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { dynastyAt, polityAlive, polityName } from '../src/gen/civ/growth';
import { EMPTY_EDITS, GENERATOR_VERSION, applyNames, cultureKey, dynastyKey, personKey, polityKey, regionKey, settlementKey } from '../src/gen/edits';
import { makeSave } from '../src/gen/savefile';
import {
  MSG_READY,
  MSG_RENDER,
  MSG_RENDERED,
  TEXTS_MAX,
  failedMsg,
  helperOrigin,
  listenHelper,
  readRender,
  renderedMsg,
  tidyTexts,
  type HelperHost,
  type Rendered,
  type RenderRequest,
} from '../src/ui/helperProtocol';
import { helperCounts, helperJob, helperTexts } from '../src/ui/helperWork';
import { presetHash } from '../src/ui/presetLink';

const SERVER = 'https://ai.example.com';
const COVER = 'data:image/jpeg;base64,/9j/AAAA';

/** 假的窗口:上一层框收到的消息记下来,发消息 = 直接叫听的那个函数 */
function fakeHost() {
  const sent: { msg: unknown; origin: string }[] = [];
  const parent = { postMessage: (msg: unknown, origin: string) => void sent.push({ msg, origin }) };
  let onMsg: ((e: { origin: string; source: unknown; data: unknown }) => void) | null = null;
  const host: HelperHost = {
    parent,
    addEventListener: (_t, f) => void (onMsg = f),
    removeEventListener: () => void (onMsg = null),
  };
  return { host, parent, sent, send: (origin: string, source: unknown, data: unknown) => onMsg?.({ origin, source, data }) };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('帮手和后台怎么传话', () => {
  const req = { type: MSG_RENDER, v: 1, id: 'r1', kind: 'preset', preset: 'preset=1&seed=7' };
  const result: Rendered = { cover: COVER, info: { seed: 7, year: 2995, states: 15, peoples: 16, generator: GENERATOR_VERSION }, texts: [{ cat: '国名', text: '有龙皇朝', key: 'polity:c1#0', where: '国家' }] };

  it('服务器的来源:按配的地址算;没配、写得不对 = 不帮', () => {
    expect(helperOrigin('https://ai.example.com/', 'https://atlas.example.com/?gallery-helper=1')).toBe(SERVER);
    expect(helperOrigin('https://ai.example.com:8443/api', 'https://atlas.example.com/')).toBe('https://ai.example.com:8443');
    // 开发时的假服务器是相对地址:就是网站自己
    expect(helperOrigin('/__fake-ai', 'http://localhost:5188/?gallery-helper=1')).toBe('http://localhost:5188');
    expect(helperOrigin(null, 'https://atlas.example.com/')).toBeNull();
    expect(helperOrigin('http://[bad', 'https://atlas.example.com/')).toBeNull();
  });

  it('一开始先给后台说准备好了(只发给服务器那个来源)', () => {
    const f = fakeHost();
    listenHelper(f.host, SERVER, async () => result);
    expect(f.sent).toEqual([{ msg: { type: MSG_READY, v: 1 }, origin: SERVER }]);
  });

  it('只认服务器那个来源、上一层框发来的;别的来源、别的窗口、写得不对的都不理', async () => {
    const f = fakeHost();
    const got: RenderRequest[] = [];
    listenHelper(f.host, SERVER, async (r) => {
      got.push(r);
      return result;
    });
    f.send('https://evil.example.com', f.parent, req);
    f.send('https://ai.example.com.evil.com', f.parent, req);
    f.send(SERVER, {}, req);
    f.send(SERVER, f.parent, { ...req, v: 2 });
    f.send(SERVER, f.parent, { ...req, kind: 'other' });
    f.send(SERVER, f.parent, { ...req, preset: undefined });
    f.send(SERVER, f.parent, { type: MSG_RENDER, v: 1, id: 'r2', kind: 'world' });
    f.send(SERVER, f.parent, 'civ-atlas:render');
    await tick();
    expect(got).toEqual([]);
    expect(f.sent).toHaveLength(1);
    f.send(SERVER, f.parent, req);
    await tick();
    expect(got).toEqual([{ id: 'r1', kind: 'preset', preset: 'preset=1&seed=7' }]);
  });

  it('画好了回三样:封面(JPEG)、几样数、名字,带着原来的编号,只发给服务器那个来源', async () => {
    const f = fakeHost();
    listenHelper(f.host, SERVER, async () => result);
    f.send(SERVER, f.parent, req);
    await tick();
    expect(f.sent).toHaveLength(2);
    const { msg, origin } = f.sent[1];
    expect(origin).toBe(SERVER);
    expect(msg).toEqual({ type: MSG_RENDERED, v: 1, id: 'r1', ok: true, cover: COVER, info: result.info, texts: result.texts });
  });

  it('画不出来:回 ok = false 和给管理员看的原因', async () => {
    const f = fakeHost();
    listenHelper(f.host, SERVER, async () => {
      throw new Error('存档读不出来：不是存档');
    });
    f.send(SERVER, f.parent, req);
    await tick();
    expect(f.sent[1].msg).toEqual({ type: MSG_RENDERED, v: 1, id: 'r1', ok: false, error: '存档读不出来：不是存档' });
    expect(failedMsg('x', '').error).toBeTruthy();
  });

  it('一次画一个:后到的等前一个画完', async () => {
    const f = fakeHost();
    let open = 0;
    let most = 0;
    listenHelper(f.host, SERVER, async () => {
      most = Math.max(most, ++open);
      await tick();
      open--;
      return result;
    });
    f.send(SERVER, f.parent, req);
    f.send(SERVER, f.parent, { ...req, id: 'r2' });
    for (let i = 0; i < 6; i++) await tick();
    expect(most).toBe(1);
    expect(f.sent.slice(1).map((s) => (s.msg as { id: string }).id)).toEqual(['r1', 'r2']);
  });

  it('名字按约好的上限整理:空的去掉、各项截短、最多一万条', () => {
    const t = tidyTexts([
      { cat: '一个很长很长很长很长的类别名', text: '名'.repeat(120), key: 'k'.repeat(201), where: '在'.repeat(80) },
      { cat: '', text: '  \n ' },
      { cat: '城名', text: '竹影\u0007城' },
    ]);
    expect(t).toHaveLength(2);
    expect([...t[0].cat].length).toBe(12);
    expect([...t[0].text].length).toBe(100);
    expect(t[0].key).toBeUndefined();
    expect([...t[0].where!].length).toBe(60);
    expect(t[1]).toEqual({ cat: '城名', text: '竹影 城' });
    expect(tidyTexts(Array.from({ length: TEXTS_MAX + 5 }, (_, i) => ({ cat: '人名', text: `甲${i}` })))).toHaveLength(TEXTS_MAX);
    expect(renderedMsg('a', { ...result, texts: [{ cat: '', text: '' }] }).texts).toEqual([]);
  });

  it('readRender:世界、地图要带存档,新建参数要带参数串', () => {
    expect(readRender({ type: MSG_RENDER, v: 1, id: 'a', kind: 'map', save: { app: '文明与地图' } })).toEqual({ id: 'a', kind: 'map', save: { app: '文明与地图' } });
    expect(readRender({ type: MSG_RENDER, v: 1, id: 'a', kind: 'map', preset: 'preset=1' })).toBeNull();
    expect(readRender({ type: MSG_RENDER, v: 1, id: '', kind: 'preset', preset: 'preset=1' })).toBeNull();
    expect(readRender(null)).toBeNull();
  });
});

describe('帮手列的名字和几样数', () => {
  const world = generateWorld({ ...DEFAULT_PARAMS, seed: 7 });
  const raw = generateCiv(world);
  const year = 2400;
  const alive = raw.polities.filter((p) => polityAlive(p, year));
  const p0 = alive[0];
  const s0 = raw.settlements.find((s) => s.founded <= year)!;

  it('世界作品:照存档生成,不带作者改的名字;封面停在分享时那一年、中央经线照存档', () => {
    const names = { [polityKey(raw, p0.id)]: '饕餮', [settlementKey(raw, s0.id)]: '馋城' };
    const save = makeSave({ ...DEFAULT_PARAMS, seed: 7 }, { ...EMPTY_EDITS, names, endYear: 3200 }, 'c7', '大羽王朝', undefined, { projection: 'equirect', center: 40 });
    const job = helperJob({ id: 'a', kind: 'world', save: { ...save, moment: { year } } });
    expect(job.params.seed).toBe(7);
    expect(job.input).not.toHaveProperty('renames');
    expect(JSON.stringify(job.input)).not.toContain('饕餮');
    expect(job.input.endYear).toBe(3200);
    expect(job.moment).toEqual({ year });
    expect(job.lon).toBe(40);
    // 干预"立国"里作者起的国名不带(逐年推演下的命令也一样),别的照旧
    const found = { kind: 'found' as const, region: regionKey(raw, 0), from: 1200, name: '作者国' };
    const withFound = makeSave({ ...DEFAULT_PARAMS, seed: 7 }, { ...EMPTY_EDITS, interventions: [found], play: { year: 1500, commands: [{ ...found, from: 1300 }] } }, 'c7');
    const fj = helperJob({ id: 'c', kind: 'world', save: withFound });
    expect(fj.input.interventions).toEqual([{ kind: 'found', region: found.region, from: 1200 }]);
    expect(fj.input.play?.commands).toEqual([{ kind: 'found', region: found.region, from: 1300 }]);
    expect(JSON.stringify(fj.input)).not.toContain('作者国');
    // 地图作品:不停在哪年、中央经线 0°(封面贴在地球仪上)
    const map = helperJob({ id: 'b', kind: 'map', save: { ...save, moment: { year } } });
    expect(map.moment).toBeUndefined();
    expect(map.lon).toBeUndefined();
  });

  it('新建参数作品:照这套参数生成;没带种子的用默认种子;读不出来给中文原因', () => {
    const hash = presetHash({ name: '两块完整大陆', params: { ...DEFAULT_PARAMS, landFraction: 0.4, continents: 2 }, seed: 5730, endYear: 6000 });
    const job = helperJob({ id: 'a', kind: 'preset', preset: hash.replace(/^#/, '') });
    expect(job.params).toMatchObject({ seed: 5730, landFraction: 0.4, continents: 2 });
    expect(job.input.endYear).toBe(6000);
    const noSeed = helperJob({ id: 'a', kind: 'preset', preset: 'preset=1&name=x&landFraction=0.3' });
    expect(noSeed.params.seed).toBe(DEFAULT_PARAMS.seed);
    expect(() => helperJob({ id: 'a', kind: 'preset', preset: 'nonsense' })).toThrow(/新建参数读不出来/);
    expect(() => helperJob({ id: 'a', kind: 'world', save: { app: 'x' } })).toThrow(/存档读不出来/);
  });

  it('那一年看得到的名字:国名、城名、州名、族名、人名……带着和改名同一套的稳定键', () => {
    const texts = helperTexts(raw, year);
    const by = (cat: string) => texts.filter((t) => t.cat === cat);
    // 每个现存的国家都列了那年的全称
    for (const p of alive) expect(by('国名').some((t) => t.text === polityName(p, year))).toBe(true);
    for (const p of alive) {
      const d = p.eastern && p.dynasties && p.dynasties.length > 1 ? dynastyAt(p, year) : undefined;
      const di = d ? p.dynasties!.indexOf(d) : 0;
      const mine = by('国名').filter((t) => t.key === polityKey(raw, p.id) || t.key?.startsWith(`dynasty:${polityKey(raw, p.id).slice(7)}/`));
      if (!di) expect(mine).toEqual([{ cat: '国名', text: polityName(p, year), key: polityKey(raw, p.id), where: '国家' }]);
      else {
        // 东方改朝换代以后:那年的全称跟着当朝的键,国家的键列立国时那一朝的国名
        expect(mine.find((t) => t.key === dynastyKey(raw, p.id, di))?.text).toBe(polityName(p, year));
        expect(mine.find((t) => t.key === polityKey(raw, p.id))?.text).toBe(polityName(p, p.founded));
      }
    }
    // 键不重复
    const keys = texts.filter((t) => t.key).map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(by('城名').find((t) => t.key === settlementKey(raw, s0.id))?.text).toBe(s0.name);
    // 还没建的城不列
    const later = raw.settlements.find((s) => s.founded > year);
    if (later) expect(by('城名').some((t) => t.key === settlementKey(raw, later.id))).toBe(false);
    expect(by('州名').find((t) => t.key === regionKey(raw, 0))?.text).toBe(raw.regions.name![0]);
    const cu = raw.cultures.findIndex((c) => !c.unborn && c.born <= year && (c.ended === undefined || c.ended > year));
    expect(by('族名').find((t) => t.key === cultureKey(raw, cu))?.text).toBe(`${raw.cultures[cu].name}族`);
    expect(by('地名').length).toBe(raw.places.length);
    const ruler = raw.people!.find((x) => x.role === 'ruler' && x.born <= year && (x.died === undefined || x.died > year))!;
    expect(by('人名').find((t) => t.key === personKey(raw, ruler.id))).toMatchObject({ text: ruler.name });
    expect(texts.length).toBeLessThanOrEqual(TEXTS_MAX);
    expect(texts.every((t) => t.text && t.cat.length <= 12)).toBe(true);
  });

  it('不套用作者改的名字:改过名的键列的还是生成时的名字', () => {
    const named = applyNames(raw, { [polityKey(raw, p0.id)]: '饕餮', [settlementKey(raw, s0.id)]: '馋城' });
    expect(polityName(named.polities[p0.id], year)).toContain('饕餮');
    // 帮手用的是推演出来的原样(galleryHelper.ts 不过 applyNames):名字照生成时的
    const texts = helperTexts(raw, year);
    expect(texts.find((t) => t.key === polityKey(raw, p0.id))?.text).toBe(polityName(p0, year));
    expect(texts.find((t) => t.key === settlementKey(raw, s0.id))?.text).toBe(s0.name);
    expect(texts.some((t) => t.text.includes('饕餮') || t.text.includes('馋城'))).toBe(false);
  });

  it('几样数:那一年现存几国、几族;没长出文明 = 0', () => {
    const c = helperCounts(raw, year);
    expect(c.states).toBe(alive.length);
    expect(c.peoples).toBeGreaterThan(0);
    expect(helperCounts(null, year)).toEqual({ states: 0, peoples: 0 });
  });
});
