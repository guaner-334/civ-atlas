/**
 * 待推演的单子:命令和地形大事先排着,全部推演时一次加进修改(只记一步,⌘Z 一次撤掉整批);
 * 已经下过的、已经在单子里的不再加;换世界清空单子。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { EMPTY_EDITS, type Intervention, type Upheaval } from '../src/gen/edits';
import { addIntervention, addUpheaval, clearEdits, getEdits, removeEditsBatch, setEdits } from '../src/ui/editsStore';
import { clearPending, getPending, pendingHas, pushPending, queueIntervention, queueUpheaval, removePending, restorePending, takePendingBatch } from '../src/ui/pendingStore';
import { UPHEAVALS_MAX } from '../src/gen/terrainEdits';
import { getPanel, endRun } from '../src/ui/panelStore';
import { undoLastEdit } from '../src/ui/undo';
import { clearToast } from '../src/ui/toastStore';

const P = (n: number) => `polity:r${n}#0`;
const protect = (n: number, from = 100): Intervention => ({ kind: 'protect', a: P(n), from });
const VOLCANO: Upheaval = { year: 80, ops: [{ kind: 'volcano', pts: [1278, 768], r: 36, s: 1.1 }] };

afterEach(() => {
  clearPending();
  clearEdits();
  clearToast();
  endRun();
});

describe('待推演的单子', () => {
  it('先排着不进修改;已在单子里、已经下过的不再加', () => {
    expect(queueIntervention(protect(1), '甲国:保护')).toBeNull();
    expect(queueIntervention(protect(2, 50), '乙国:保护')).toBeNull();
    expect(getEdits().interventions).toEqual([]);
    expect(getPending().map((x) => x.text)).toEqual(['甲国:保护', '乙国:保护']);
    expect(pendingHas(protect(1))).toBe(true);
    expect(queueIntervention(protect(1), '甲国:保护')).toBe('这条命令已经在待推演里了');
    addIntervention(protect(3));
    expect(queueIntervention(protect(3), '丙国:保护')).toBe('这条命令已经下过了');
    removePending(getPending()[0].id);
    expect(getPending().map((x) => x.text)).toEqual(['乙国:保护']);
  });

  it('交出去没推成的几条放回单子最前面(照原来的先后,还在单子里的不重复放)', () => {
    queueIntervention(protect(1), '甲国:保护');
    queueIntervention(protect(2), '乙国:保护');
    const sent = getPending();
    for (const x of sent) removePending(x.id);
    queueIntervention(protect(3), '丙国:保护');
    restorePending(sent);
    restorePending(sent);
    expect(getPending().map((x) => x.text)).toEqual(['甲国:保护', '乙国:保护', '丙国:保护']);
  });

  it('全部推演:一次加进修改、清空单子;推演时面板先藏起;⌘Z 一次撤掉整批', () => {
    queueIntervention(protect(1), '甲国:保护', { self: 4, target: null });
    queueIntervention(protect(2, 50), '乙国:保护');
    expect(queueUpheaval(VOLCANO, '火山喷发')).toBeNull();
    pushPending();
    expect(getPending()).toEqual([]);
    expect(getEdits().interventions).toEqual([protect(1), protect(2, 50)]);
    expect(getEdits().upheavals).toHaveLength(1);
    // 几条一起:不浮名牌,从最早的那一年起
    expect(getPanel().run).toMatchObject({ self: -1, target: null, from: 50 });
    expect(undoLastEdit()).toBe(true);
    expect(getEdits().interventions).toEqual([]);
    expect(getEdits().upheavals ?? []).toEqual([]);
  });

  it('只有一条、知道下令的国家:照原来那样浮出名牌', () => {
    queueIntervention(protect(1, 70), '甲国:保护', { self: 4, target: { kind: 'polity', id: 9 }, shown: '甲国' });
    pushPending();
    expect(getPanel().run).toMatchObject({ self: 4, target: { kind: 'polity', id: 9 }, from: 70, shown: '甲国' });
  });

  it('推完提示上的撤销:去掉这一批,别的留着', () => {
    addIntervention(protect(9));
    queueIntervention(protect(1), '甲国:保护');
    queueUpheaval(VOLCANO, '火山喷发');
    pushPending();
    const ups = getEdits().upheavals!;
    removeEditsBatch([protect(1)], ups);
    expect(getEdits().interventions).toEqual([protect(9)]);
    expect(getEdits().upheavals).toBeUndefined();
  });

  it('排进来以后修改又变了:已经下过的干预拿掉、不算进这一批;地形大事满了的留在单子里', () => {
    queueIntervention(protect(1), '甲国:保护');
    queueIntervention(protect(2), '乙国:保护');
    queueUpheaval(VOLCANO, '火山喷发');
    addIntervention(protect(1));
    for (let i = 0; i < UPHEAVALS_MAX; i++) addUpheaval({ ...VOLCANO, year: 10 + i });
    pushPending();
    expect(getEdits().interventions).toEqual([protect(1), protect(2)]);
    expect(getPending().map((x) => x.text)).toEqual(['火山喷发']);
    expect(takePendingBatch(getEdits())).toEqual({ ivs: [protect(2)], ups: [] });
    expect(takePendingBatch(getEdits())).toBeNull();
  });

  it('一条也没加上:不进推演状态', () => {
    queueIntervention(protect(1), '甲国:保护');
    addIntervention(protect(1));
    pushPending();
    expect(getPending()).toEqual([]);
    expect(getPanel().run).toBeNull();
  });

  it('换世界、读档清空单子', () => {
    queueIntervention(protect(1), '甲国:保护');
    setEdits({ ...EMPTY_EDITS });
    expect(getPending()).toEqual([]);
  });
});
