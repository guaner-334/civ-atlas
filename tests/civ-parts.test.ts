import { describe, expect, it } from 'vitest';
import { CivPartInbox, splitCiv, type CivPart } from '../src/civParts';
import type { Civ } from '../src/gen/civ/types';

/** 只带切的那几个列表和几样别的(切、拼只看这几个列表) */
function fakeCiv(people: number, annals: number, settlements: number): Civ {
  return {
    seed: 7,
    endYear: 3000,
    people: Array.from({ length: people }, (_, i) => ({ id: i, role: 'ruler', polity: i % 7, name: `p${i}`, born: i, commands: i % 3 ? [{ war: i, year: i }] : undefined })),
    annals: Array.from({ length: annals }, (_, i) => ({ year: i, kind: 'war', a: i, b: i + 1, region: -1, settlement: -1, war: i })),
    settlements: Array.from({ length: settlements }, (_, i) => ({ id: i, cell: i * 3, name: `s${i}` })),
    polities: [{ name: 'x' }],
  } as unknown as Civ;
}

/** 像 postMessage 那样一条一条拷过去 */
const send = <T>(x: T): T => structuredClone(x);

describe('历史分段交(civParts)', () => {
  it('切成段、各自拷过去再拼回来,和整份一样;传进去的 civ 不改', () => {
    const civ = fakeCiv(9001, 25000, 801);
    const before = structuredClone(civ);
    const { parts, civ: rest } = splitCiv(civ, 3);
    expect(civ).toEqual(before);
    // 人物 3 段、纪事 3 段、城镇 3 段
    expect(parts.length).toBe(9);
    expect(rest.people).toEqual([]);
    expect(rest.annals).toEqual([]);
    expect(rest.settlements).toEqual([]);
    expect(rest.polities).toBe(civ.polities);
    const inbox = new CivPartInbox();
    for (const p of parts) inbox.take(send(p));
    const got = send(rest);
    inbox.join(got, { key: 3, parts: parts.length });
    expect(got).toEqual(civ);
  });

  it('短的不切,原样交', () => {
    const civ = fakeCiv(10, 10, 10);
    const { parts, civ: rest } = splitCiv(civ, 1);
    expect(parts).toEqual([]);
    expect(rest).toBe(civ);
  });

  it('没收齐就报错,不交半份;拼完以后这一份和更早的各段都放掉', () => {
    const civ = fakeCiv(9000, 0, 0);
    const a = splitCiv(civ, 1);
    const b = splitCiv(civ, 2);
    const inbox = new CivPartInbox();
    for (const p of a.parts) inbox.take(p);
    for (const p of b.parts.slice(1)) inbox.take(p);
    expect(() => inbox.join(send(b.civ), { key: 2, parts: b.parts.length })).toThrow();
    // 编号 1、2 的都放掉了:再拼 1 也收不齐
    expect(() => inbox.join(send(a.civ), { key: 1, parts: a.parts.length })).toThrow();
  });

  it('后来的编号拼的时候不碰更晚的各段', () => {
    const civ = fakeCiv(0, 30000, 0);
    const a = splitCiv(civ, 5);
    const b = splitCiv(civ, 6);
    const inbox = new CivPartInbox();
    for (const p of [...a.parts, ...b.parts] as CivPart[]) inbox.take(p);
    const ga = send(a.civ);
    inbox.join(ga, { key: 5, parts: a.parts.length });
    const gb = send(b.civ);
    inbox.join(gb, { key: 6, parts: b.parts.length });
    expect(ga.annals).toEqual(civ.annals);
    expect(gb.annals).toEqual(civ.annals);
  });
});
