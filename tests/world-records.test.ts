/**
 * 世界之最(gen/civ/records.ts):逐年往后扫出来的保持者,和"那一年把所有人都比一遍"的笨办法一致
 * (数一样大、先到的保持、并列个数);沿革新的在前、首尾相接;数只增不减;同一个种子算出同一份。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import { annexedRemnants, populationAt } from '../src/gen/civ/growth';
import { peopleIndex } from '../src/gen/civ/peopleInfo';
import { ownersAt } from '../src/gen/civ/timeline';
import { RECORD_COUNTER, RECORD_GROUPS, recordBook, recordHistory, recordsAt, tieNote, type RecordKey, type RecordRef } from '../src/gen/civ/records';

const civs = new Map<number, Civ>();
function civOf(seed: number): Civ {
  let c = civs.get(seed);
  if (!c) civs.set(seed, (c = generateCiv(generateWorld({ ...DEFAULT_PARAMS, seed }))));
  return c;
}

const YEARS = [300, 600, 1000, 1500, 1722, 2252, 3000];

/** 笨办法:一群候选各自的数和"先到这个数"的那一刻,挑出保持者应有的数、并列几个、先到的是哪几个 */
function brute(items: { id: number; v: number; reach: number }[]) {
  const max = Math.max(0, ...items.map((x) => x.v));
  const top = items.filter((x) => x.v === max && max > 0);
  const first = Math.min(...top.map((x) => x.reach));
  return { max, ties: top.length - 1, firsts: new Set(top.filter((x) => x.reach === first).map((x) => x.id)) };
}

describe('并列那句的量词', () => {
  it('另有 N 位 / 朝 / 国 / 场 / 州同为…', () => {
    expect(tieNote({ ties: 14, ref: { kind: 'person', id: 0 } }, '51 年')).toBe('另有 14 位同为 51 年');
    expect(tieNote({ ties: 3, ref: { kind: 'polity', id: 0 } }, '2 次')).toBe('另有 3 国同为 2 次');
    expect(tieNote({ ties: 3, ref: { kind: 'war', war: 0, a: 0, b: 1, from: 0, to: 1 } }, '12 年')).toBe('另有 3 场同为 12 年');
    expect(tieNote({ ties: 3, ref: { kind: 'region', id: 0 } }, '5 回')).toBe('另有 3 州同为 5 回');
    expect(tieNote({ ties: 2, ref: { kind: 'dynasty', polity: 0, dynasty: 0, from: 0, to: 1 } }, '300 年')).toBe('另有 2 朝同为 300 年');
  });
});

describe.each([7, 2024])('世界之最 · seed=%i', (seed) => {
  it('在位最久、最长寿:按起止年份相减比,一样长的先到的保持,并列个数对', () => {
    const civ = civOf(seed);
    const book = recordBook(civ);
    const rulers = civ.people!.filter((x) => x.role === 'ruler' && x.from !== undefined);
    for (const y of YEARS) {
      const at = recordsAt(book, y);
      const reign = brute(
        rulers.filter((x) => x.from! <= y).map((x) => {
          const v = Math.floor(Math.min(x.until ?? Infinity, y)) - Math.floor(x.from!);
          return { id: x.id, v, reach: Math.max(x.from!, Math.floor(x.from!) + v) };
        }),
      );
      const r = at.get('reign');
      if (!reign.max) expect(r).toBeNull();
      else {
        expect(r?.ref.kind).toBe('person');
        expect(r!.value).toBe(reign.max);
        expect(r!.ties).toBe(reign.ties);
        expect(reign.firsts.has((r!.ref as { id: number }).id)).toBe(true);
      }
      const old = brute(
        rulers
          .filter((x) => x.from! <= y && x.author === undefined)
          .map((x) => {
            const v = Math.floor(Math.min(x.died ?? Infinity, y)) - Math.floor(x.born);
            return { id: x.id, v, reach: Math.max(x.from!, Math.floor(x.born) + v) };
          }),
      );
      const o = at.get('old');
      if (old.max) {
        expect(o!.value).toBe(old.max);
        expect(o!.ties).toBe(old.ties);
        expect(old.firsts.has((o!.ref as { id: number }).id)).toBe(true);
      }
    }
  });

  it('攻下州最多:和人物卡上"攻取几州"同一个数,只数到那一年', () => {
    const civ = civOf(seed);
    const book = recordBook(civ);
    const A = civ.annals;
    const gens = peopleIndex(civ).generals.flat();
    for (const y of YEARS) {
      const items = gens.map((x) => {
        const ts: number[] = [];
        for (const c of x.commands ?? [])
          for (let i = Math.max(0, c.first); i <= c.last && i < A.length; i++) {
            const e = A[i];
            if (e.war === c.war && e.kind === 'conquer' && e.a === x.polity && e.year <= y) ts.push(e.year);
          }
        ts.sort((a, b) => a - b);
        return { id: x.id, v: ts.length, reach: ts.length ? ts[ts.length - 1] : Infinity };
      });
      const b = brute(items);
      const r = recordsAt(book, y).get('took');
      if (!b.max) expect(r).toBeNull();
      else {
        expect(r!.value).toBe(b.max);
        expect(r!.ties).toBe(b.ties);
        expect(b.firsts.has((r!.ref as { id: number }).id)).toBe(true);
      }
    }
  });

  it('疆域最大:鼎盛时的州数按整年数,和那一年国家页上的州数对得上', () => {
    const civ = civOf(seed);
    const book = recordBook(civ);
    const peak = new Int32Array(civ.polities.length);
    const end = Math.floor(civ.endYear);
    const want = new Map<number, number>();
    for (let y = 0; y <= end; y++) {
      const own = ownersAt(civ, y);
      const n = new Int32Array(civ.polities.length);
      for (let r = 0; r < civ.regions.count; r++) if (own.polity[r] >= 0) n[own.polity[r]]++;
      for (let p = 0; p < n.length; p++) peak[p] = Math.max(peak[p], n[p]);
      if (YEARS.includes(y)) want.set(y, Math.max(0, ...peak));
    }
    for (const y of YEARS.filter((y) => y <= end)) {
      const r = recordsAt(book, y).get('big');
      expect(r?.value ?? 0).toBe(want.get(y));
      if (r) {
        // 鼎盛那年国家页上就是这么多州
        const own = ownersAt(civ, r.at);
        let n = 0;
        for (let k = 0; k < civ.regions.count; k++) if (own.polity[k] === (r.ref as { id: number }).id) n++;
        expect(n).toBe(r.value);
      }
    }
  });

  it('一场仗攻下州最多:议和割让的、亡国时一并归过去的残部不算', () => {
    const civ = civOf(seed);
    const A = civ.annals;
    const ceded = new Set<number>();
    A.forEach((e, i) => {
      if (e.kind === 'peace' && e.region > 0) {
        for (let j = Math.max(0, i - e.region); j < i; j++) if (A[j].kind === 'conquer' && A[j].war === e.war) ceded.add(j);
      } else if (e.kind === 'fall' && e.war >= 0) for (const j of annexedRemnants(civ, i)) ceded.add(j);
    });
    expect(ceded.size).toBeGreaterThan(0);
    const wars = new Set(A.filter((e) => e.kind === 'war').map((e) => e.war));
    const n = new Map<number, number>();
    A.forEach((e, i) => {
      if (e.kind === 'conquer' && wars.has(e.war) && !ceded.has(i) && e.year <= civ.endYear) n.set(e.war, (n.get(e.war) ?? 0) + 1);
    });
    const r = recordsAt(recordBook(civ), civ.endYear).get('warTook');
    expect(r?.value).toBe(Math.max(...n.values()));
  });

  it('最大的城:那一年人口最多的城', () => {
    const civ = civOf(seed);
    const book = recordBook(civ);
    for (const y of YEARS) {
      let best = -1;
      let bv = 0;
      civ.settlements.forEach((s, i) => {
        const v = populationAt(s, y);
        if (v > bv) {
          bv = v;
          best = i;
        }
      });
      const r = recordsAt(book, y).get('city');
      if (best < 0) expect(r).toBeNull();
      else {
        expect(r?.ref).toEqual({ kind: 'settlement', id: civ.settlements[best].id });
        expect(r!.value).toBe(bv);
      }
    }
  });

  it('15 条都有;沿革新的在前、首尾相接;数只增不减(最大的城除外)', () => {
    const civ = civOf(seed);
    const book = recordBook(civ);
    const keys = RECORD_GROUPS.flatMap((g) => g.keys);
    expect(keys.length).toBe(15);
    const last = new Map<RecordKey, number>();
    for (const y of YEARS) {
      const at = recordsAt(book, y);
      expect([...at.keys()].sort()).toEqual([...keys].sort());
      for (const k of keys) {
        const r = at.get(k);
        if (!r) continue;
        expect(Number.isFinite(r.value) && r.value > 0).toBe(true);
        if (k !== 'city') {
          expect(r.value).toBeGreaterThanOrEqual(last.get(k) ?? 0);
          last.set(k, r.value);
        }
        const h = recordHistory(book, k, y);
        expect(h.length).toBe(r.count);
        expect(h[0].ref).toEqual(r.ref);
        expect(h[0].to).toBeUndefined();
        expect(h[0].from).toBe(r.since);
        for (let i = 1; i < h.length; i++) {
          expect(h[i].to).toBe(h[i - 1].from);
          expect(h[i].from).toBeLessThan(h[i - 1].from);
          expect(h[i].by).toEqual(h[i - 1].ref);
          // 被刷新:后一任的数比前一任大(最大的城是被超过,数可以更小)
          if (k !== 'city') expect(h[i - 1].value).toBeGreaterThan(h[i].value);
        }
        if (r.count > 1) expect(r.prev?.ref).toEqual(h[1].ref);
      }
    }
    // 第 3000 年:人物、王朝和国家、战争和地方都该有纪录了
    const end = recordsAt(book, civ.endYear);
    for (const k of keys) expect(end.get(k), k).not.toBeNull();
  });

  it('并列那句按保持者用量词:人"位"、国"国"、仗"场"、州"州"', () => {
    const civ = civOf(seed);
    const book = recordBook(civ);
    const kinds = new Set<RecordRef['kind']>();
    for (const y of YEARS) {
      for (const r of recordsAt(book, y).values()) {
        if (!r || r.ties <= 0) continue;
        kinds.add(r.ref.kind);
        expect(tieNote(r, '2 次')).toBe(`另有 ${r.ties} ${RECORD_COUNTER[r.ref.kind]}同为 2 次`);
      }
    }
    // 在位最久、最长寿常顶着上限并列;别的对象也会并列
    expect(kinds.has('person')).toBe(true);
    expect(kinds.size).toBeGreaterThan(1);
  });

  it('同一个种子算出同一份', () => {
    const a = recordsAt(recordBook(civOf(seed)), 2252);
    const b = recordsAt(recordBook(generateCiv(generateWorld({ ...DEFAULT_PARAMS, seed }))), 2252);
    expect(JSON.stringify([...b])).toBe(JSON.stringify([...a]));
  });
});
