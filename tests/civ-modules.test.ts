/**
 * 官方推演的子系统清单(src/gen/civ/modules.ts):同一刻的事件按装的先后排,清单的次序就是历史的一部分。
 * 这里把次序钉死:要改次序(同一种子的历史会变),得同时改这张表,并照规矩升生成器版本。
 */
import { describe, expect, it } from 'vitest';
import { CIV_FINISH, CIV_MODULES } from '../src/gen/civ/modules';

describe('官方推演的子系统清单', () => {
  it('装、接着推的次序', () => {
    expect(CIV_MODULES.map((m) => m.id)).toEqual([
      'cultures',
      'polities',
      'wars',
      'politics',
      'dynasty',
      'assimilation',
      'cities',
      'diplomacy',
      'development',
      'ideology',
      'trade',
      'unrest',
      'control',
      'council',
      'regency',
      'marriage',
      'plague',
      'pandemic',
      'treaties',
      'migration',
      'religion',
      'interventions',
    ]);
  });

  it('名字不重复,每个模块至少会装或会接着推', () => {
    const ids = CIV_MODULES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of CIV_MODULES) expect(m.install || m.resume, m.id).toBeTruthy();
  });

  it('推完往结果上补东西的次序;有 finish 的都在 CIV_FINISH 里,CIV_FINISH 里的都在清单里', () => {
    expect(CIV_FINISH.map((m) => m.id)).toEqual(['religion', 'development', 'ideology', 'trade']);
    const withFinish = CIV_MODULES.filter((m) => m.finish).map((m) => m.id).sort();
    expect([...CIV_FINISH.map((m) => m.id)].sort()).toEqual(withFinish);
    for (const m of CIV_FINISH) expect(CIV_MODULES).toContain(m);
  });
});
