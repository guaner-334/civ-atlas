/**
 * 国家卡片的朝政(src/ui/courtInfo.ts、gen/civ/council.ts 的 courtRulesAt):议定的规矩由史事重建,和推演里的一样;
 * 封地、割据和管辖快照对得上;「朝政」一行只给够格议事或议过事的国家;句子写得出来。
 */
import { describe, expect, it } from 'vitest';
import { generateWorld, DEFAULT_PARAMS, type World } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import { CivSim } from '../src/gen/civ/sim';
import { COUNCIL_CONSTS, COUNCIL_GATE, councilModelOf, courtRulesAt } from '../src/gen/civ/council';
import { LORD_BYTE, controlAt, controlShare } from '../src/gen/civ/control';
import { ownersAt } from '../src/gen/civ/timeline';
import { polityAlive } from '../src/gen/civ/growth';
import { courtEmpty, courtEvents, courtRowNote, courtView, formChangeSay, isFiefRegion, levySay, lordFoot, regimeSays } from '../src/ui/courtInfo';
import { formChangesAt, formDims, polityFormAt } from '../src/gen/civ/story/polityForm';

let cached: { world: World; civ: Civ } | null = null;
function seed7() {
  if (!cached) {
    const world = generateWorld({ ...DEFAULT_PARAMS, seed: 7 });
    cached = { world, civ: generateCiv(world) };
  }
  return cached;
}

describe('朝政', () => {
  it('某一年的规矩:由史事重建的和推演到那一年时模型里的一样', () => {
    const { world, civ } = seed7();
    const Y = 2500;
    const sim = CivSim.fromCiv(world, generateCiv(world, { endYear: 1500 }));
    sim.run(Y);
    const cm = councilModelOf(sim)!;
    let checked = 0;
    for (const P of civ.polities) {
      if (!polityAlive(P, Y)) continue;
      const r = courtRulesAt(civ, P.id, Y);
      expect({ tax: r.tax, fief: r.fiefBy >= 0, army: r.army, office: r.office }, `国家 ${P.id}`).toEqual(cm.rules(P.id));
      if (r.events.length) checked++;
      // 定下征法、分封的那次议事都在这一国议过的事里,按先后排
      if (r.taxBy >= 0) expect(r.events).toContain(r.taxBy);
      if (r.fiefBy >= 0) expect(civ.annals[r.fiefBy]).toMatchObject({ kind: 'council', a: P.id, war: 4, n: 0 });
      expect([...r.events].sort((a, b) => a - b)).toEqual(r.events);
    }
    expect(checked).toBeGreaterThan(0);
  }, 120_000);

  it('封地、割据和管辖快照对得上;「朝政」一行只给够格议事或议过事的国家', () => {
    const { civ } = seed7();
    const Y = civ.endYear;
    const own = ownersAt(civ, Y).polity;
    const snap = controlAt(civ, Y)!;
    let fiefs = 0;
    let lords = 0;
    let hidden = 0;
    for (const P of civ.polities) {
      if (!polityAlive(P, Y)) continue;
      const v = courtView(civ, P.id, Y);
      const n = own.filter((x) => x === P.id).length;
      const able = n >= COUNCIL_GATE.size && Y - P.founded >= COUNCIL_GATE.age;
      expect(v.able, `国家 ${P.id}`).toBe(able);
      expect(v.shown).toBe(able || v.rules.events.length > 0);
      if (!v.shown) hidden++;
      if (!v.rules.events.length) expect(courtRowNote(v)).toBe('没议过事');
      for (const r of v.fiefs) {
        expect(own[r]).toBe(P.id);
        expect(snap[r]).not.toBe(LORD_BYTE);
        expect(controlShare(snap[r])).toBeLessThan(COUNCIL_CONSTS.FIEF_C);
        expect(isFiefRegion(civ, P.id, r, Y)).toBe(true);
      }
      if (v.fiefs.length) {
        fiefs++;
        // 分封那次点了名的州还是封地的话排第一
        const named = civ.annals[v.rules.fiefBy].region;
        if (v.fiefs.includes(named)) expect(v.fiefs[0]).toBe(named);
        expect(v.tribute).toBeGreaterThan(0);
      } else if (v.rules.fiefBy < 0) {
        for (let r = 0; r < own.length; r++) if (own[r] === P.id) expect(isFiefRegion(civ, P.id, r, Y)).toBe(false);
      }
      for (const w of v.lords) for (const r of w.regions) expect([own[r], snap[r]]).toEqual([P.id, LORD_BYTE]);
      if (v.lords.length) {
        lords++;
        expect(lordFoot(civ, P.id, v, Y)).toMatch(/^名义上还归.+一文不交/);
      }
      if (!v.shown) continue;
      // 征税那句话:代收(各州自己收税)/ 分成 / 直征各有各的写法
      const say = levySay(v);
      expect(say, say).toMatch([/自己收税/, /分成/, /直征/][v.rules.tax]);
      // 历次议事:新的在上;规矩变了的有"从此……"
      const evs = courtEvents(civ, v);
      expect(evs.length).toBe(v.rules.events.length);
      for (let i = 1; i < evs.length; i++) expect(evs[i - 1].year).toBeGreaterThanOrEqual(evs[i].year);
      if (v.rules.taxBy >= 0) expect(evs.find((e) => e.id === v.rules.taxBy)?.then).toMatch(/^从此/);
      // 每种议题都有名字(第二批:收兵权 / 罢边镇、设边镇 / 罢禁军、行铨选 / 收回辟署、许自辟 / 罢铨选、分镇、脱离);办成的都写出后来怎样
      for (const ev of evs) {
        expect(ev.issue).not.toBe('议事');
        if (ev.out === 0) expect(ev.then, `${ev.issue} ${ev.year}`).toBeTruthy();
      }
    }
    expect(fiefs).toBeGreaterThan(0);
    expect(lords).toBeGreaterThan(0);
    expect(hidden).toBeGreaterThan(0);
  }, 120_000);

  it('还没立国的年份:没有规矩、不显示', () => {
    const { civ } = seed7();
    const P = civ.polities.find((p) => p.founded > 500)!;
    const v = courtView(civ, P.id, P.founded);
    expect(v.rules.events).toEqual([]);
    expect(v.shown).toBe(false);
  }, 120_000);

  it('没议过事那一句:会议的几类事都列着(征税、分封、削藩、兵权、任免、分镇、脱离)', () => {
    const s = courtEmpty();
    for (const w of ['改征税的法子', '分封或收回边地', '削藩', '收放兵权', '收放任免', '分镇', '脱离']) expect(s).toContain(w);
    expect(s).toContain(`${COUNCIL_GATE.size} 个州`);
  });

  it('改制:继任、议政、参与三条各一句;历次改制里革命、复辟开头写是哪一种,复辟写旗用回哪年以前那面', () => {
    const { civ } = seed7();
    let n = 0;
    for (const P of civ.polities) {
      if (!P.dynasties?.some((d) => d.regime)) continue;
      for (const c of formChangesAt(civ, P.id, civ.endYear)) {
        if (c.cause !== 'reform') continue;
        n++;
        const e = civ.annals[c.event];
        const say = formChangeSay(civ, P.id, c, false);
        expect(say.length, say).toBeGreaterThan(6);
        if (e.kind === 'reform') expect(say).toMatch(e.n === 0 ? /^革命：/ : e.n === 1 ? /^政变：/ : /^复辟：/);
        if (e.kind === 'reform' && e.n === 2 && e.b >= 0) expect(say).toMatch(/旗用回.+以前那面$/);
        const form = polityFormAt(civ, P.id, c.year)!;
        const d = formDims(form.facts);
        const [a, b, v] = regimeSays(civ, P.id, c.year, form);
        for (const t of [a, b, v]) expect(t).toMatch(/。$/);
        if (form.facts.regime === 'republic') expect([d.succession, a]).toEqual([3, expect.stringContaining('执政')]);
        if (form.facts.regime === 'crown') expect(d.succession).toBe(1);
      }
    }
    expect(n).toBeGreaterThan(0);
  });
});
