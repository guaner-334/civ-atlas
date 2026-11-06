/**
 * 帮手模式(作品墙的后台在看不见的框里打开网站画封面、列名字;src/ui/helperProtocol.ts、src/ui/helperWork.ts、src/ui/helperRules.ts):
 * 只认所配服务器那个来源的后台、回的三样(封面、几样数、名字)格式对、名字不套用作者改的;
 * 第 2 版收世界文件、规则,回封面(规则还回摘要),第 1 版照旧。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { dynastyAt, polityAlive, polityName } from '../src/gen/civ/growth';
import { EMPTY_EDITS, GENERATOR_VERSION, applyNames, cultureKey, dynastyKey, personKey, polityKey, regionKey, settlementKey } from '../src/gen/edits';
import { makeSave, momentHash } from '../src/gen/savefile';
import { latestTuning } from '../src/gen/civ/ruleSet';
import { rulesHash } from '../src/gen/civ/ruleShare';
import { tuningSummary } from '../src/gen/civ/tuningText';
import {
  BRIEF_MAX,
  MSG_READY,
  MSG_RENDER,
  MSG_RENDERED,
  TEXTS_MAX,
  failedMsg,
  helperOrigin,
  listenHelper,
  readRender,
  renderedMsg,
  tidyRules,
  tidyTexts,
  type HelperHost,
  type HelperRequest,
  type Rendered,
} from '../src/ui/helperProtocol';
import { fileYear, helperCounts, helperJob, helperLoad, helperTexts } from '../src/ui/helperWork';
import { rulesBrief, rulesJob } from '../src/ui/helperRules';
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

  it('一开始先给后台说准备好了、听得懂哪几版(只发给服务器那个来源)', () => {
    const f = fakeHost();
    listenHelper(f.host, SERVER, async () => result);
    expect(f.sent).toEqual([{ msg: { type: MSG_READY, v: 1, versions: [1, 2] }, origin: SERVER }]);
  });

  it('只认服务器那个来源、上一层框发来的;别的来源、别的窗口、写得不对的都不理', async () => {
    const f = fakeHost();
    const got: HelperRequest[] = [];
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

describe('第 2 版的话:世界文件、规则', () => {
  const bytes = new Uint8Array([0x50, 0x4b, 3, 4, 1, 2, 3]);
  const fileReq = (file: unknown, extra: Record<string, unknown> = {}) => ({ type: MSG_RENDER, v: 2, id: 'f1', kind: 'world', file, ...extra });
  const rulesReq = { type: MSG_RENDER, v: 2, id: 'g1', kind: 'rules', rules: 'rules=1&name=战乱年代&v=1&war.odds=2' };
  const info = { seed: 7, year: 3000, states: 12, peoples: 14, generator: GENERATOR_VERSION };
  const result: Rendered = { cover: COVER, info, texts: [{ cat: '国名', text: '有龙皇朝', key: 'polity:c1#0', where: '国家' }] };

  it('世界文件:收 Blob 或 ArrayBuffer(都当 Blob 交出去),短链接 # 后面那段照带;空的、没带文件、带存档的不认', async () => {
    const a = readRender(fileReq(new Blob([bytes]), { at: 'at=1500&p=c1.0' }));
    expect(a).toMatchObject({ v: 2, id: 'f1', kind: 'world', at: 'at=1500&p=c1.0' });
    expect(a && 'file' in a && new Uint8Array(await a.file.arrayBuffer())).toEqual(bytes);
    const b = readRender(fileReq(bytes.slice().buffer));
    expect(b && 'file' in b && b.file instanceof Blob && b.file.size).toBe(bytes.length);
    expect(b).not.toHaveProperty('at');
    expect(readRender(fileReq(new Blob([])))).toBeNull();
    expect(readRender(fileReq(undefined, { save: { app: '文明与地图' } }))).toBeNull();
    expect(readRender(fileReq('PK…'))).toBeNull();
    expect(readRender(fileReq(new Blob([bytes]), { at: 'x'.repeat(301) }))).not.toHaveProperty('at');
  });

  it('规则:收规则链接 # 后面那段;没带的不认;地图、新建参数第 2 版不认(照旧走第 1 版)', () => {
    expect(readRender(rulesReq)).toEqual({ v: 2, id: 'g1', kind: 'rules', rules: rulesReq.rules });
    expect(readRender({ ...rulesReq, rules: '' })).toBeNull();
    expect(readRender({ ...rulesReq, rules: 3 })).toBeNull();
    expect(readRender({ type: MSG_RENDER, v: 2, id: 'a', kind: 'map', save: { app: '文明与地图' } })).toBeNull();
    expect(readRender({ type: MSG_RENDER, v: 2, id: 'a', kind: 'preset', preset: 'preset=1' })).toBeNull();
    expect(readRender({ type: MSG_RENDER, v: 3, id: 'a', kind: 'rules', rules: 'rules=1' })).toBeNull();
  });

  it('交一个世界文件:按第 2 版回封面和几样数(不列名字)', async () => {
    const f = fakeHost();
    const got: HelperRequest[] = [];
    listenHelper(f.host, SERVER, async (r) => {
      got.push(r);
      return { cover: COVER, info };
    });
    f.send(SERVER, f.parent, fileReq(new Blob([bytes])));
    await tick();
    expect(got[0]).toMatchObject({ v: 2, kind: 'world' });
    expect(f.sent[1]).toEqual({ msg: { type: MSG_RENDERED, v: 2, id: 'f1', ok: true, cover: COVER, info }, origin: SERVER });
  });

  it('交一套规则:按第 2 版回封面、几样数和摘要(摘要按约好的上限整理)', async () => {
    const f = fakeHost();
    const rules = { name: '战乱年代', changed: 3, brief: '战争 ×2' };
    listenHelper(f.host, SERVER, async () => ({ cover: COVER, info, rules }));
    f.send(SERVER, f.parent, rulesReq);
    await tick();
    expect(f.sent[1].msg).toEqual({ type: MSG_RENDERED, v: 2, id: 'g1', ok: true, cover: COVER, info, rules });
    expect(tidyRules({ name: '  ', changed: -1, brief: '甲'.repeat(BRIEF_MAX + 9) })).toEqual({ name: '未命名规则', changed: 0, brief: '甲'.repeat(BRIEF_MAX) });
    expect(tidyRules({ name: '名'.repeat(30), changed: 2.5, brief: '' }).name).toHaveLength(24);
  });

  it('第 2 版画不出来:回第 2 版的 ok = false 和原因;第 1 版和第 2 版排在一起,一次画一个', async () => {
    const f = fakeHost();
    const order: string[] = [];
    listenHelper(f.host, SERVER, async (r) => {
      order.push(r.id);
      if (r.id === 'g1') throw new Error('规则链接读不出来：链接里没有规则');
      await tick();
      return result;
    });
    f.send(SERVER, f.parent, { type: MSG_RENDER, v: 1, id: 'r1', kind: 'preset', preset: 'preset=1&seed=7' });
    f.send(SERVER, f.parent, rulesReq);
    for (let i = 0; i < 6; i++) await tick();
    expect(order).toEqual(['r1', 'g1']);
    expect(f.sent[1].msg).toMatchObject({ v: 1, id: 'r1', ok: true, texts: result.texts });
    expect(f.sent[2].msg).toEqual({ type: MSG_RENDERED, v: 2, id: 'g1', ok: false, error: '规则链接读不出来：链接里没有规则' });
  });
});

describe('规则作品:推哪张图、交回的摘要', () => {
  const values = { 'war.rest': 10, 'war.odds': 2, 'split.odds': 0, 'war.truce': 2 };
  const set = { name: '战乱年代', version: 2, by: '明月', values, biomes: { temperateDesert: '灰烬荒原' } };

  it('在并排试推默认的那张地图(默认参数、种子 7)上照这套规则推,推演年数、文明种子照默认', () => {
    const job = rulesJob(rulesHash(set).slice(1));
    expect(job.params).toEqual({ ...DEFAULT_PARAMS, seed: 7 });
    expect(job.input).toEqual({ params: job.params, scale: 1, tuning: latestTuning(set) });
    // 带不带 # 都认
    expect(rulesJob(rulesHash(set)).input).toEqual(job.input);
  });

  it('改了几项(规则项 + 地貌的叫法)、最显眼的三处(常用的项排前面,写法和摘要一样)', () => {
    const r = rulesJob(rulesHash(set)).rules;
    expect(r).toEqual({ name: '战乱年代', changed: 5, brief: '战争 ×2、议和后 2 年不再开战、不分裂' });
    expect(tuningSummary(values)).toBe(`改了 4 项：${r.brief}……`);
  });

  it('只改了地貌的叫法、都没改:摘要照「我的规则」那一行的说法;官方规则照官方推', () => {
    expect(rulesBrief({ name: 'a', version: 1, values: {}, biomes: { temperateDesert: '灰烬荒原' } })).toEqual({ name: 'a', changed: 1, brief: '改了地貌的名字 1 项' });
    const plain = rulesJob(rulesHash({ name: '照抄', version: 1, values: {} }));
    expect(plain.rules).toEqual({ name: '照抄', changed: 0, brief: '和官方规则一样' });
    expect(plain.input).not.toHaveProperty('tuning');
  });

  it('读不出来:给管理员看的中文原因', () => {
    expect(() => rulesJob('preset=1&name=x')).toThrow(/规则链接读不出来/);
    expect(() => rulesJob('rules=99&name=x')).toThrow(/更新版本/);
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
    // 新建世界时定的拓荒、天灾照存档带上(封面上的历史和作者的世界一样)
    const set = helperJob({ id: 'd', kind: 'world', save: makeSave({ ...DEFAULT_PARAMS, seed: 7 }, { ...EMPTY_EDITS, frontier: { spread: 2 }, calamity: 'many' }, 'c7') });
    expect(set.input.calamity).toBe('many');
    expect(set.input.frontier).toEqual({ spread: 2 });
    expect(job.input).not.toHaveProperty('calamity');
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

  it('世界文件:照存的内容打开(带着放进来的编号和配方),干预原样带上,改名不带;地图留着的世界也能打开', () => {
    const found = { kind: 'found' as const, region: regionKey(raw, 0), from: 1200, name: '作者国' };
    const names = { [polityKey(raw, p0.id)]: '饕餮' };
    const sv = makeSave({ ...DEFAULT_PARAMS, seed: 7 }, { ...EMPTY_EDITS, names, interventions: [found], endYear: 3200, calamity: 'many' }, 'c7');
    const load = helperLoad('wtmp1', sv, 'r'.repeat(64));
    expect(load.vault).toEqual({ id: 'wtmp1', recipe: 'r'.repeat(64), generator: sv.generator });
    expect(load.interventions).toEqual([found]);
    expect(load).toMatchObject({ params: sv.params, scale: 1, endYear: 3200, calamity: 'many' });
    expect(load).not.toHaveProperty('renames');
    expect(load).not.toHaveProperty('keptMap');
    const sum = 'a'.repeat(64);
    const kept = makeSave({ ...DEFAULT_PARAMS, seed: 7 }, { ...EMPTY_EDITS, map: { sum, from: 'w1', grown: 1 } }, 'c7');
    expect(helperLoad('wtmp2', kept, 'r'.repeat(64)).keptMap).toBe(sum);
    // 照存档生成的第 1 版还是不收地图留着的世界
    expect(() => helperJob({ id: 'k', kind: 'world', save: kept })).toThrow(/地图是存下来的/);
  });

  it('世界文件的封面停在哪年:短链接 # 后面那段 > 存档带的那一刻 > 结束那年', () => {
    const sv = makeSave({ ...DEFAULT_PARAMS, seed: 7 }, EMPTY_EDITS, 'c7');
    expect(fileYear(raw, sv)).toBe(raw.endYear);
    expect(fileYear(raw, { ...sv, moment: { year: 1800 } })).toBe(1800);
    expect(fileYear(raw, { ...sv, moment: { year: 1800 } }, momentHash({ year: 1500 }))).toBe(1500);
    expect(fileYear(raw, sv, 'at=1500&p=c1.0')).toBe(1500);
    // 认不出的 # 那段不算;超出这段历史的年份不要
    expect(fileYear(raw, { ...sv, moment: { year: 1800 } }, 'rules=1')).toBe(1800);
    expect(fileYear(raw, sv, 'at=99999')).toBe(raw.endYear);
  });
});
