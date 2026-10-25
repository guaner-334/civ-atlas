/**
 * AI 释名 / 起名(阶段 5):材料里有语感 / 地理 / 历史;起名 JSON 的解析与兜底;选一个后 setName 生效。
 * 全程用测试用假 AI,不联网。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { rasterize } from '../src/gen/raster';
import { NAME_STYLES } from '../src/gen/names';
import { worldNameStyle } from '../src/gen/civ/places';
import { applyNames } from '../src/gen/edits';
import { polityName, portAt } from '../src/gen/civ/growth';
import { aiChat, setActiveProvider, setMockResponder } from '../src/ai/client';
import { AiError, type AiRequest } from '../src/ai/types';
import { WESTERN_STYLES } from '../src/gen/names/western';
import { transcribe } from '../src/gen/names/transcribe';
import { ownersAt } from '../src/gen/civ/timeline';
import {
  EXPLAIN_CHARS,
  FIXED_LATIN,
  SEA_GUIDE,
  STYLE_GUIDES,
  SUGGEST_SHOW,
  WESTERN_TR,
  cleanExplanation,
  defaultName,
  explainRequest,
  explainScan,
  explainTooLong,
  latinForm,
  regionOwnerRuns,
  shortenRequest,
  isMockReply,
  mockSuggestions,
  nameInfo,
  nameMaterial,
  nameStamp,
  noteStale,
  parseSuggestions,
  placePortStamp,
  styleGuide,
  suggestRequest,
  suggestionEdit,
  suggestionPreview,
  takenNames,
  worldStyleId,
  type NameInfo,
  type NameTarget,
} from '../src/ai/prompts/names';
import { clearEdits, getEdits, setName } from '../src/ui/editsStore';

/** 发给 AI 的文字里不该出现的现实语言 / 民族名("拉丁字母"是文字,不在其内) */
const REAL_LANG = /拉丁风|拉丁语|英法|英语|法语|古诺尔斯|北欧|斯拉夫风|斯拉夫语|古斯拉夫|希腊|阿拉伯|波斯|突厥|蒙古|罗马|维京|东欧|爱琴/;

const world = generateWorld({ ...DEFAULT_PARAMS, seed: 7 });
const raw = generateCiv(world);
const raster = rasterize(world, 1);

// 中原、江南一类的国号(边塞风叫"汗国"、留拉丁字母,不是这里要看的)
const eastPolity = raw.polities.filter((p) => p.eastern && raw.cultures[p.culture].style !== 'frontier').sort((a, b) => (b.dynasties?.length ?? 0) - (a.dynasties?.length ?? 0))[0];
const westCity = raw.settlements.find((s) => styleGuide(raw.cultures[s.culture]?.style)?.family === 'western' && s.capitalSpans?.length)!;
const riverId = raw.places.findIndex((p) => p.kind === 'river');
/** 测试用的新国号:挑一个这个世界里没人用、也不是它现在国号的字(换了世界也不会碰巧撞名被丢掉) */
const FRESH = ['澜', '瀚', '沅', '湘', '汾', '洹'].find(
  (s) => !takenNames(raw, { kind: 'polity', id: eastPolity.id }).has(s) && s !== nameInfo(raw, { kind: 'polity', id: eastPolity.id })!.name,
)!;
const userText = (req: AiRequest) => req.messages.find((m) => m.role === 'user')!.content;
const systemText = (req: AiRequest) => req.messages.find((m) => m.role === 'system')!.content;

afterEach(() => {
  setMockResponder(null);
  setActiveProvider(null);
  clearEdits();
});

describe('语感说明', () => {
  it('12 种语感和起名器一一对应(顺序、名字、说明一致);没人住的地方的语感和 places.ts 一样', () => {
    expect(STYLE_GUIDES.map((s) => [s.id, s.label, s.family, s.desc])).toEqual(NAME_STYLES.map((s) => [s.id, s.label, s.family, s.desc]));
    for (const s of STYLE_GUIDES) {
      expect(s.explain.length).toBeGreaterThan(30);
      expect(s.suggest.length).toBeGreaterThan(10);
    }
    for (const seed of [1, 7, 2024, 99999]) expect(worldStyleId(seed)).toBe(worldNameStyle(seed));
  });

  it('发给 AI 的语感名、说明、讲法、起名提示里没有现实中的语言 / 民族名', () => {
    for (const g of [...STYLE_GUIDES, SEA_GUIDE]) {
      for (const t of [g.aiLabel, g.aiDesc, g.explain, g.suggest]) expect(t).not.toMatch(REAL_LANG);
    }
    // 界面上给人看的名字不变
    expect(STYLE_GUIDES.find((s) => s.id === 'imperial')!.label).toBe('帝国(拉丁风)');
  });
});

describe('释名 / 起名的材料(seed 7)', () => {
  it('seed 7 里有东方国家、西幻城、河', () => {
    expect(eastPolity).toBeTruthy();
    expect(westCity).toBeTruthy();
    expect(riverId).toBeGreaterThanOrEqual(0);
  });

  it('东方国家:国名本身 + 国号规则、语感、民族、国都的地理、立国年份、国号变迁、编年史', () => {
    const m = nameMaterial(raw, { kind: 'polity', id: eastPolity.id }, raster)!;
    const u = userText(explainRequest(m));
    const style = styleGuide(raw.cultures[eastPolity.culture].style)!;
    expect(style.family).toBe('eastern');
    expect(u).toContain(`"${eastPolity.name}"是国名本身`);
    expect(u).toContain(`语感:${style.aiLabel}`);
    expect(u).toContain(style.explain);
    expect(u).toContain('主体民族:');
    expect(u).toContain('【地理】');
    expect(u).toContain(`立国时的国都 ${raw.settlements[eastPolity.capital].name}`);
    expect(u).toMatch(/年均温 -?\d+°C、年降水 \d+ mm/);
    expect(u).toContain('【历史】');
    expect(u).toContain(`第 ${Math.floor(eastPolity.founded)} 年立国`);
    expect(u).toContain('国号变迁:');
    expect(u).toContain('【编年史里和它有关的几条】');
    // 中式讲字义典故
    expect(systemText(explainRequest(m))).toContain('逐字讲字义');
    // 起名:东方国号单字或双字、不带"大"和国号
    const s = userText(suggestRequest(m, '要带水字旁'));
    expect(s).toContain('单字为主');
    expect(s).toContain('作者的额外要求:要带水字旁');
    expect(suggestRequest(m).json).toBe(true);
  });

  it('改朝换代过的东方国家:指定第几朝时,释 / 改的是那一朝的国号,材料里写上那次改朝换代', () => {
    const d = eastPolity.dynasties;
    if (!d || d.length < 2) return;
    const t: NameTarget = { kind: 'polity', id: eastPolity.id, dynasty: 1 };
    const info = nameInfo(raw, t)!;
    expect(info.keyKind).toBe('dynasty');
    expect(info.name).toBe(d[1].name);
    expect(info.key).toMatch(/^dynasty:c\d+#\d+\/1$/);
    const u = userText(explainRequest(nameMaterial(raw, t, raster)!));
    expect(u).toContain('第 2 朝的国号');
    expect(u).toContain(`第 ${Math.floor(d[1].year)} 年`);
  });

  it('西幻城:语感(拟造词源)、建城年份、做过国都、地理', () => {
    const m = nameMaterial(raw, { kind: 'settlement', id: westCity.id }, raster)!;
    const u = userText(explainRequest(m));
    const style = styleGuide(raw.cultures[westCity.culture].style)!;
    expect(style.family).toBe('western');
    expect(u).toContain(`名字:${westCity.name}`);
    expect(u).toContain(`语感:${style.aiLabel}`);
    expect(u).toContain(`第 ${Math.floor(westCity.founded)} 年建城`);
    expect(u).toContain('做过国都:');
    expect(u).toMatch(/位于地图.*部/);
    expect(u).toContain('同一语感的其他名字');
    expect(systemText(explainRequest(m))).toContain('拟造的原文拼写');
    expect(userText(suggestRequest(m))).toContain('名字格式:城名');
    // 释名、起名发给 AI 的整段文字(系统提示 + 材料 + 讲法 / 起名提示)里没有现实中的语言 / 民族名
    for (const req of [explainRequest(m), suggestRequest(m)]) expect(req.messages.map((x) => x.content).join('\n')).not.toMatch(REAL_LANG);
  });

  it('河:起名的民族、流经之地的归属变迁、沿河的城', () => {
    const m = nameMaterial(raw, { kind: 'place', id: riverId }, raster)!;
    const u = userText(explainRequest(m));
    expect(m.info.kindLabel).toBe('河流');
    expect(u).toContain('种类:河流');
    expect(u).toMatch(/按.+族.+民族.的语感起名|无人居住/);
    expect(u).toContain('【地理】');
    expect(m.geography.join('\n') + m.history.join('\n')).toMatch(/沿河的城|流经之地归属变迁/);
    expect(userText(suggestRequest(m))).toContain('河名');
  });

  it('民族、州、海也能整理材料;没有 raster 时少写地理但不出错', () => {
    const cu = raw.cultures[0];
    const mc = nameMaterial(raw, { kind: 'culture', id: cu.id }, raster)!;
    expect(userText(explainRequest(mc))).toContain(`${cu.name}族`);
    expect(mc.history.join('\n')).toContain('兴起于');
    const r = raw.regions.name!.findIndex((x) => !!x);
    const mr = nameMaterial(raw, { kind: 'region', id: r }, null)!;
    expect(mr.info.kindLabel).toBe('州');
    expect(userText(explainRequest(mr))).toContain('宜居度');
    const sea = raw.places.findIndex((p) => p.kind === 'sea');
    const ms = nameMaterial(raw, { kind: 'place', id: sea }, raster)!;
    expect(ms.people).toContain('不带哪个民族的语感');
    expect(ms.format).toMatch(/结尾/);
    expect(nameMaterial(raw, { kind: 'settlement', id: 1e6 }, raster)).toBeNull();
  });

  it('材料和时间轴无关、不太长;改名不改 stamp,历史变了 stamp 才变', () => {
    const t: NameTarget = { kind: 'settlement', id: westCity.id };
    const m = nameMaterial(raw, t, raster)!;
    expect(userText(explainRequest(m)).length).toBeLessThan(2500);
    const renamed = applyNames(raw, { [nameInfo(raw, t)!.key]: '饕餮城' });
    expect(nameInfo(renamed, t)!.name).toBe('饕餮城');
    expect(nameStamp(renamed, t)).toBe(nameStamp(raw, t));
    const moved = { ...raw, settlements: raw.settlements.map((s) => (s.id === westCity.id ? { ...s, founded: s.founded + 50 } : s)) };
    expect(nameStamp(moved, t)).not.toBe(nameStamp(raw, t));
    const pt: NameTarget = { kind: 'polity', id: eastPolity.id };
    const renamedP = applyNames(raw, { [nameInfo(raw, pt)!.key]: '秦' });
    expect(nameStamp(renamedP, pt)).toBe(nameStamp(raw, pt));
  });

  it('地形大事改过港口的城:材料按最后一段地形写、写明哪年变的;stamp 跟着变', () => {
    const t: NameTarget = { kind: 'settlement', id: westCity.id };
    const year = westCity.founded + 300;
    const flipped = {
      ...raw,
      settlements: raw.settlements.map((s) =>
        s.id === westCity.id ? { ...s, reshaped: [{ year, capacity: s.capacity, port: !s.port }] } : s,
      ),
    };
    const geo = nameMaterial(flipped, t, raster)!.geography.join('\n');
    expect(geo).toContain('地形大事以后');
    expect(geo).toContain(westCity.port ? '不再是港口' : '成了港口');
    expect(nameStamp(flipped, t)).not.toBe(nameStamp(raw, t));
    // 只改了人口上限、港口没变的:材料里港口那句和原来一样,stamp 照样变(人口最盛可能变了)
    const shrunk = {
      ...raw,
      settlements: raw.settlements.map((s) =>
        s.id === westCity.id ? { ...s, reshaped: [{ year, capacity: s.capacity / 2, port: s.port }] } : s,
      ),
    };
    expect(nameMaterial(shrunk, t, raster)!.geography).toEqual(nameMaterial(raw, t, raster)!.geography);
    expect(nameStamp(shrunk, t)).not.toBe(nameStamp(raw, t));
  });

  it('地形大事改掉海边城的港口:海名的释名记下沿岸港口,变了标过时;远处/没列出的城不影响', () => {
    // 找一片材料里列了港城的海
    let target: NameTarget | null = null;
    let cityId = -1;
    for (let i = 0; i < raw.places.length && !target; i++) {
      const p = raw.places[i];
      if (p.kind !== 'sea') continue;
      const t: NameTarget = { kind: 'place', id: i };
      const line = nameMaterial(raw, t, raster)!.geography.find((x) => x.startsWith('沿岸的港口')) ?? '';
      const s = raw.settlements.find((x) => portAt(x, Infinity) && line.includes(`${x.name}(`));
      if (s) {
        target = t;
        cityId = s.id;
      }
    }
    expect(target).not.toBeNull();
    expect(cityId).toBeGreaterThanOrEqual(0);
    const sea = raw.places[target!.id];
    const line = nameMaterial(raw, target!, raster)!.geography.find((x) => x.startsWith('沿岸的港口')) ?? '';
    const distToSea = (s: (typeof raw.settlements)[number]) => {
      let d = Infinity;
      for (let i = 0; i + 1 < sea.path.length; i += 2) {
        let dx = Math.abs(sea.path[i] - world.mesh.x[s.cell]);
        if (dx > world.mesh.width / 2) dx = world.mesh.width - dx;
        d = Math.min(d, Math.hypot(dx, sea.path[i + 1] - world.mesh.y[s.cell]));
      }
      return d;
    };
    const before = placePortStamp(raw, target!, raster);
    const oldStamp = nameStamp(raw, target!);
    expect(before).not.toBeNull();
    expect(nameMaterial(raw, target!, raster)!.portStamp).toBe(before);
    const year = (raw.settlements[cityId].reshaped?.at(-1)?.year ?? raw.settlements[cityId].founded) + 100;
    const flip = (id: number, port: boolean) => ({
      ...raw,
      settlements: raw.settlements.map((s) =>
        s.id === id ? { ...s, reshaped: [...(s.reshaped ?? []), { year, capacity: s.capacity, port }] } : s,
      ),
    });
    const flipped = flip(cityId, !portAt(raw.settlements[cityId], Infinity));
    expect(nameMaterial(flipped, target!, raster)!.geography.join('\n')).not.toContain(`${raw.settlements[cityId].name}(`);
    expect(placePortStamp(flipped, target!, raster)).not.toBe(before);
    expect(nameStamp(flipped, target!)).toBe(oldStamp);
    const newNote = { stamp: oldStamp, portStamp: before! };
    expect(noteStale(raw, target!, newNote, raster)).toBe(false);
    expect(noteStale(flipped, target!, newNote, raster)).toBe(true);
    // 老笔记没有 portStamp:只比原来的 stamp,不会因为新加的港口记录被误标
    expect(noteStale(flipped, target!, { stamp: oldStamp }, raster)).toBe(false);

    // 大事在城建城以前、城是在新地形上生成的(没有 reshaped):建城时就不是港口,同样看得出来
    const byFounding = {
      ...raw,
      settlements: raw.settlements.map((s) => (s.id === cityId ? { ...s, port: false, reshaped: [] } : s)),
    };
    expect(nameMaterial(byFounding, target!, raster)!.geography.join('\n')).not.toContain(`${raw.settlements[cityId].name}(`);
    expect(placePortStamp(byFounding, target!, raster)).not.toBe(before);
    expect(noteStale(byFounding, target!, newNote, raster)).toBe(true);

    // 别处历史改写挪了城的编号:这份记录只认地块和建城年,不该跟着变
    const reordered = { ...raw, settlements: [...raw.settlements].reverse() };
    expect(placePortStamp(reordered, target!, raster)).toBe(before);
    expect(noteStale(reordered, target!, newNote, raster)).toBe(false);

    // 离这片海很远的港城变了港口:材料里没有它,港口记录也不变
    const far = raw.settlements.find((s) => portAt(s, Infinity) && s.id !== cityId && distToSea(s) > (sea.size ?? 0) + 60);
    if (far) {
      const moved = flip(far.id, false);
      expect(nameMaterial(moved, target!, raster)!.geography.join('\n')).not.toContain(`${far.name}(`);
      expect(placePortStamp(moved, target!, raster)).toBe(before);
      expect(noteStale(moved, target!, newNote, raster)).toBe(false);
    }

    // 在这片海边上、但没进"沿岸的港口"前 6 名的港城变了:材料那一行没变,港口记录也不变
    const nearUnlisted = raw.settlements.find(
      (s) => portAt(s, Infinity) && s.id !== cityId && !line.includes(`${s.name}(`) && distToSea(s) <= (sea.size ?? 0) + 20,
    );
    if (nearUnlisted) {
      const moved = flip(nearUnlisted.id, false);
      expect(nameMaterial(moved, target!, raster)!.geography.find((x) => x.startsWith('沿岸的港口')) ?? '').toBe(line);
      expect(placePortStamp(moved, target!, raster)).toBe(before);
      expect(noteStale(moved, target!, newNote, raster)).toBe(false);
    }
  });
});

describe('名字由来:拉丁原形、归属、字数', () => {
  /** 一种西幻语感里写成"ton=顿"的固定译法部件(中文 → 第一种拉丁写法) */
  const fixedParts = (style: unknown): Map<string, string> => {
    const out = new Map<string, string>();
    const walk = (v: unknown) => {
      if (!v || typeof v !== 'object') return;
      const o = v as Record<string, unknown>;
      if (typeof o.l === 'string' && typeof o.zh === 'string' && !out.has(o.zh)) out.set(o.zh, o.l);
      for (const x of Object.values(o)) walk(x);
    };
    walk(style);
    return out;
  };

  it('音译规则、固定译法和起名器一致', () => {
    expect(Object.keys(WESTERN_TR).sort()).toEqual(WESTERN_STYLES.map((s) => s.id).sort());
    let n = 0;
    for (const s of WESTERN_STYLES) {
      expect(WESTERN_TR[s.id]).toEqual(s.tr);
      const want = fixedParts(s);
      const got = FIXED_LATIN[s.id] ?? new Map();
      expect([...got.keys()].sort(), s.id).toEqual([...want.keys()].sort());
      for (const [zh, l] of want) expect(got.get(zh), `${s.id} ${zh}`).toBe(l);
      n += want.size;
    }
    expect(n).toBeGreaterThan(50);
  });

  it('西幻的国名、城名、族名倒推出拉丁原形,正着音译回去和中文名一致;东方、边塞不给', () => {
    for (const seed of [7, 2024]) {
      const civ = seed === 7 ? raw : generateCiv(generateWorld({ ...DEFAULT_PARAMS, seed }));
      const names: [string, string][] = [];
      for (const p of civ.polities) if (!p.eastern) names.push([p.name, civ.cultures[p.culture].style]);
      for (const s of civ.settlements) names.push([s.name, civ.cultures[s.culture].style]);
      for (const c of civ.cultures) names.push([c.name, c.style]);
      let west = 0;
      let got = 0;
      for (const [name, style] of names) {
        const f = latinForm(name, style);
        if (styleGuide(style)?.family !== 'western') {
          expect(f).toBeNull();
          continue;
        }
        west++;
        if (!f) continue;
        got++;
        expect(f.latin).toMatch(/^[A-Z][a-z]+$/);
        // 没用固定译法、没去掉意译字的,正着音译回去一字不差
        const core = [...name].slice(f.dropped.length && name.startsWith(f.dropped[0]) ? 1 : 0).join('');
        const fixed = [...(FIXED_LATIN[style]?.keys() ?? [])].some((z) => core.endsWith(z) || core.startsWith(z));
        if (!fixed && !f.dropped.length) expect(transcribe(f.latin, WESTERN_TR[style])).toBe(name);
      }
      expect(west).toBeGreaterThan(100);
      expect(got / west).toBeGreaterThan(0.97);
    }
    // AI 拼错过的两个(哈尔米尔 → Hālmeria,尼梅亚 → Nimel'thar):读音对得上
    expect(latinForm('哈尔米尔', 'kingdom')!.latin).toMatch(/^Halm/);
    expect(latinForm('尼梅亚', 'elven')!.latin).toBe('Nimea');
    // 固定译法的词尾整块认
    expect(latinForm('克尔顿', 'kingdom')!.latin).toBe('Kelton');
    expect(latinForm('卡斯特维尔', 'kingdom')!.latin).toMatch(/ville$/);
    expect(latinForm('新奥利亚', 'imperial')).toEqual({ latin: 'Olia', dropped: ['新'] });
    // 两个字的通名整个去掉
    expect(latinForm('奥利亚渡口', 'imperial')).toEqual({ latin: 'Olia', dropped: ['渡口'] });
    expect(latinForm('新奥利亚港', 'imperial')).toEqual({ latin: 'Olia', dropped: ['新', '港'] });
  });

  it('材料:西幻的国家、城写上拉丁原形;东方的不写;扫现实词时"拉丁"两个字不算材料、拼写算', () => {
    const wp = raw.polities.find((p) => !p.eastern && latinForm(p.name, raw.cultures[p.culture].style))!;
    const mp = nameMaterial(raw, { kind: 'polity', id: wp.id }, raster)!;
    const f = latinForm(wp.name, raw.cultures[wp.culture].style)!;
    expect(userText(explainRequest(mp))).toContain(`拉丁字母原形:${f.latin}`);
    expect(systemText(explainRequest(mp))).toContain('就用那个拼写');
    const mc = nameMaterial(raw, { kind: 'settlement', id: westCity.id }, raster)!;
    const fc = latinForm(westCity.name, raw.cultures[westCity.culture].style);
    if (fc) expect(mc.nameNote).toContain(fc.latin);
    const scan = explainScan(mp);
    expect(scan.material).toContain(f.latin);
    expect(scan.material).not.toContain('拉丁');
    const me = nameMaterial(raw, { kind: 'polity', id: eastPolity.id }, raster)!;
    expect(me.nameNote).not.toContain('拉丁');
  });

  it('城的归属变迁一次不漏:和逐年看的一致,写明共易主几次;没易过主的写"没有易过主"', () => {
    let changed = 0;
    let still = 0;
    for (const s of raw.settlements.slice(0, 60)) {
      const to = s.ended ?? raw.endYear;
      const runs = regionOwnerRuns(raw, s.region, s.founded, to);
      // 每一段的主人和那一刻的归属一致,相邻两段不同
      for (let k = 0; k < runs.length; k++) {
        expect(ownersAt(raw, runs[k].year).polity[s.region]).toBe(runs[k].polity);
        if (k) expect(runs[k].polity).not.toBe(runs[k - 1].polity);
      }
      // 逐年看:易主的次数不会比日志里的少
      let flips = 0;
      let last = ownersAt(raw, s.founded).polity[s.region];
      for (let y = Math.ceil(s.founded); y <= to; y++) {
        const q = ownersAt(raw, y).polity[s.region];
        if (q !== last) flips++;
        last = q;
      }
      expect(runs.length - 1).toBeGreaterThanOrEqual(flips);
      const line = nameMaterial(raw, { kind: 'settlement', id: s.id })!.history.find((x) => x.startsWith('归属变迁(一次不漏)'))!;
      expect(line).toBeTruthy();
      if (runs.length > 1) {
        changed++;
        expect(line).toContain(`共易主 ${runs.length - 1} 次`);
      } else {
        still++;
        expect(line).toContain('没有易过主');
      }
    }
    expect(changed).toBeGreaterThan(0);
    expect(still + changed).toBe(60);
    // 州、山河的是抽看的,标明;写法要求里说清楚只照归属变迁写、抽看的不说次数
    const m = nameMaterial(raw, { kind: 'region', id: westCity.region }, raster)!;
    expect(m.history.join('\n')).toContain('归属变迁(按年代抽看)');
    expect(systemText(explainRequest(m))).toMatch(/不要说出易主的次数/);
  });

  it('字数:要求写短一截(上限写明);写超了能让 AI 压一次', () => {
    const m = nameMaterial(raw, { kind: 'settlement', id: westCity.id }, raster)!;
    const sys = systemText(explainRequest(m));
    expect(sys).toContain(`${EXPLAIN_CHARS.min}–${EXPLAIN_CHARS.max} 字`);
    expect(sys).toContain(`不要超过 ${EXPLAIN_CHARS.cap} 字`);
    expect(EXPLAIN_CHARS.cap).toBeLessThan(EXPLAIN_CHARS.hard);
    const long = '甲'.repeat(EXPLAIN_CHARS.hard + 1);
    expect(explainTooLong(long)).toBe(true);
    expect(explainTooLong('甲'.repeat(EXPLAIN_CHARS.hard))).toBe(false);
    const req = shortenRequest(long, m);
    expect(req.feature).toBe('释名');
    expect(userText(req)).toContain(long);
    expect(systemText(req)).toContain(`绝不超过 ${EXPLAIN_CHARS.cap} 字`);
  });
});

describe('起名 JSON 的解析与兜底', () => {
  const cityInfo = (): NameInfo => nameInfo(raw, { kind: 'settlement', id: westCity.id })!;
  const polInfo = (): NameInfo => nameInfo(raw, { kind: 'polity', id: eastPolity.id })!;

  it('约定的格式:5 个名字 + 含义 + 拉丁原形', () => {
    const text = JSON.stringify({
      names: [
        { name: '阿尔瑟维尔', meaning: 'Alsaville:高地上的城镇', latin: 'Alsaville' },
        { name: '洛兰堡', meaning: '洛兰人的堡寨' },
        { name: '塞伦福德', meaning: '塞伦河上的渡口' },
        { name: '维斯特港', meaning: '西边的港口' },
        { name: '卡雷诺纳', meaning: '古语"卡雷"是岩石' },
      ],
    });
    const r = parseSuggestions(text, cityInfo());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.list.map((x) => x.name)).toEqual(['阿尔瑟维尔', '洛兰堡', '塞伦福德', '维斯特港', '卡雷诺纳']);
    expect(r.list[0].latin).toBe('Alsaville');
    expect(r.list[1].meaning).toBe('洛兰人的堡寨');
  });

  it('多要的两个补上被丢掉的:7 个里有 2 个和已有名字重复,作者看到的还是 5 个', () => {
    const info = cityInfo();
    const taken = new Set(['洛兰堡', '维斯特港']);
    const names = ['阿尔瑟维尔', '洛兰堡', '塞伦福德', '维斯特港', '卡雷诺纳', '奥斯特伦', '米拉福德'];
    const r = parseSuggestions(JSON.stringify({ names: names.map((name) => ({ name, meaning: '含义' })) }), info, taken);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.list.map((x) => x.name)).toEqual(['阿尔瑟维尔', '塞伦福德', '卡雷诺纳', '奥斯特伦', '米拉福德']);
    expect(r.list).toHaveLength(SUGGEST_SHOW);
    expect(userText(suggestRequest(nameMaterial(raw, { kind: 'settlement', id: westCity.id }, raster)!))).toContain(`起 ${SUGGEST_SHOW + 2} 个新名字`);
  });

  it('释名正文去掉 Markdown 记号:加粗、*斜体*、列表记号', () => {
    expect(cleanExplanation('**萨尔斯坦**,源自 *Sāl-istān*,意为"河谷之民"。\n- 萨尔:河谷\n* 斯坦:人们')).toBe('萨尔斯坦,源自 Sāl-istān,意为"河谷之民"。\n萨尔:河谷\n斯坦:人们');
    expect(cleanExplanation('3*4 不是强调')).toBe('3*4 不是强调');
  });

  it('宽松:代码围栏、直接一个数组、别的键名、"名字:含义"字符串', () => {
    const fenced = '好的,给你:\n```json\n{"candidates":[{"名字":"洛兰堡","含义":"堡寨"}]}\n```';
    const a = parseSuggestions(fenced, cityInfo());
    expect(a.ok && a.list[0].name).toBe('洛兰堡');
    const arr = parseSuggestions('[{"name":"「塞伦福德」","desc":"渡口"}]', cityInfo());
    expect(arr.ok && arr.list[0]).toEqual({ name: '塞伦福德', meaning: '渡口' });
    const strs = parseSuggestions('{"names":["维斯特港:西边的港口","卡雷诺纳 —— 岩石之城"]}', cityInfo());
    expect(strs.ok && strs.list.map((x) => [x.name, x.meaning])).toEqual([
      ['维斯特港', '西边的港口'],
      ['卡雷诺纳', '岩石之城'],
    ]);
  });

  it('JSON 坏了(收尾引号写成中文引号、后面跟一大段废话)也能一条条捞出来', () => {
    // 某个模型回过的样子(名字换成了测试用的)
    const broken =
      '{"names":[{"name":"洛兰堡","latin":"Lorenburg","meaning":"洛兰人的堡寨"},{"name":"塞伦福德","meaning":"塞伦河上的渡口"},' +
      '{"name":"维斯特港","meaning":"西边的港口”}]}   按要求生成5个名字。已完成。 ```json {"  }';
    const r = parseSuggestions(broken, cityInfo());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.list.map((x) => x.name)).toEqual(['洛兰堡', '塞伦福德', '维斯特港']);
    expect(r.list[0]).toMatchObject({ latin: 'Lorenburg', meaning: '洛兰人的堡寨' });
    expect(r.list[2].meaning).toBe('西边的港口');
  });

  it('中式名字不留拉丁字母(模型常顺手给拼音)', () => {
    const r = parseSuggestions(JSON.stringify({ names: [{ name: FRESH, latin: 'Fresh', meaning: '新' }] }), polInfo());
    expect(r.ok && r.list[0].latin).toBeUndefined();
  });

  it('东方国号:去掉顺手打上的"国""王朝",超过两个字、带拉丁字母、重名、和现在一样的丢掉', () => {
    const info = polInfo();
    const taken = takenNames(raw, { kind: 'polity', id: eastPolity.id });
    const someTaken = [...taken][0];
    const text = JSON.stringify({
      names: [
        { name: `${FRESH}国`, meaning: '' },
        { name: '昭王朝', meaning: '' },
        { name: '大衡', meaning: '' },
        { name: '天水之国度', meaning: '太长' },
        { name: 'Qin', meaning: '拉丁字母' },
        { name: someTaken, meaning: '重名' },
        { name: info.name, meaning: '和现在一样' },
        { name: FRESH, meaning: '重复' },
      ],
    });
    const r = parseSuggestions(text, info, taken);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.list.map((x) => x.name)).toEqual([FRESH, '昭', '大衡']);
    expect(r.dropped).toBe(5);
    // 预览:国号怎么变
    expect(suggestionPreview(raw, { kind: 'polity', id: eastPolity.id }, info, FRESH)).toBe(`${FRESH}部 → ${FRESH}国 → 大${FRESH} → 大${FRESH}王朝`);
  });

  it('不合格式 / 全都不合要求时给中文提示', () => {
    const bad = parseSuggestions('抱歉,我不能帮你起名。', cityInfo());
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.message).toMatch(/格式.*换一批/);
    const empty = parseSuggestions('{"names":[]}', cityInfo());
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.message).toContain('没给出候选名字');
    const allBad = parseSuggestions('{"names":[{"name":"Aldoria"},{"name":""},{"name":"一二三四五六七八九十一二"}]}', cityInfo());
    expect(allBad.ok).toBe(false);
    if (!allBad.ok) expect(allBad.message).toContain('都不合要求');
  });

  it('测试用假 AI 的默认回复 → 占位候选', () => {
    expect(isMockReply('{"mock":true,"feature":"起名"}')).toBe(true);
    expect(isMockReply('{"names":[{"name":"洛兰堡"}]}')).toBe(false);
    const list = mockSuggestions(raw, { kind: 'settlement', id: westCity.id }, cityInfo());
    expect(list.length).toBeGreaterThanOrEqual(3);
    for (const c of list) expect(raw.settlements.some((s) => s.name === c.name)).toBe(false);
  });
});

describe('经 aiChat 走一遍(测试用假 AI)', () => {
  it('起名:json 请求 → 解析 → 选第一个 → setName → 套上改名后城名变了;选回生成时的名字 = 恢复默认', async () => {
    setActiveProvider('mock');
    let seen: AiRequest | null = null;
    setMockResponder((req) => {
      seen = req;
      return JSON.stringify({ names: [{ name: '洛兰堡', meaning: '洛兰人的堡寨' }, { name: '塞伦福德', meaning: '渡口' }] });
    });
    const t: NameTarget = { kind: 'settlement', id: westCity.id };
    const m = nameMaterial(raw, t, raster)!;
    const res = await aiChat(suggestRequest(m, '听起来威严一点'));
    expect(seen!.feature).toBe('起名');
    expect(seen!.json).toBe(true);
    expect(userText(seen!)).toContain('作者的额外要求:听起来威严一点');
    const p = parseSuggestions(res.text, m.info, takenNames(raw, t));
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const e = suggestionEdit(m.info, p.list[0].name, defaultName(raw, t, m.info));
    setName(e.key, e.value);
    const civ = applyNames(raw, getEdits().names);
    expect(civ.settlements[westCity.id].name).toBe('洛兰堡');
    // 选回生成时的名字 = 从改名表里去掉
    const back = suggestionEdit(nameInfo(civ, t)!, westCity.name, defaultName(raw, t, m.info));
    expect(back.value).toBeNull();
    setName(back.key, back.value);
    expect(getEdits().names[e.key]).toBeUndefined();
  });

  it('起名:东方国家改的是国名词根,地图上的全称跟着变', async () => {
    setActiveProvider('mock');
    setMockResponder(() => `{"names":[{"name":"${FRESH}国","meaning":"水波"}]}`);
    const t: NameTarget = { kind: 'polity', id: eastPolity.id };
    const m = nameMaterial(raw, t, raster)!;
    const p = parseSuggestions((await aiChat(suggestRequest(m))).text, m.info, takenNames(raw, t));
    expect(p.ok && p.list[0].name).toBe(FRESH);
    if (!p.ok) return;
    const e = suggestionEdit(m.info, p.list[0].name, defaultName(raw, t, m.info));
    setName(e.key, e.value);
    const civ = applyNames(raw, getEdits().names);
    expect(civ.polities[eastPolity.id].name).toBe(FRESH);
    expect(polityName(civ.polities[eastPolity.id], eastPolity.founded)).toBe(`${FRESH}部`);
  });

  it('释名:流式拼出全文;没设置 AI 时抛中文的 not-configured', async () => {
    setActiveProvider('mock');
    setMockResponder((req) => `**${req.title}**:取"凌霄"之意。\n\n相传……`);
    const m = nameMaterial(raw, { kind: 'polity', id: eastPolity.id }, raster)!;
    const chunks: string[] = [];
    const r = await aiChat(explainRequest(m), { onDelta: (c) => chunks.push(c) });
    expect(chunks.join('')).toBe(r.text);
    expect(cleanExplanation(r.text)).toBe(`${m.info.shown} · 国家:取"凌霄"之意。\n相传……`);
    setActiveProvider(null);
    const err = await aiChat(explainRequest(m)).catch((e) => e);
    expect(err).toBeInstanceOf(AiError);
    expect(err.code).toBe('not-configured');
    expect(err.message).toMatch(/[一-龥]/);
  });
});
