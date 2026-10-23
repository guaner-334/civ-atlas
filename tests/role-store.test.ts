/**
 * 逐年推演里演一国(ui/roleStore.ts):按世界分开记;开始演绎时先记下、新世界打开以后再认上去
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const w = vi.hoisted(() => ({ id: 'a' as string | null }));
vi.mock('../src/ui/saveStore', () => ({ currentWorld: () => (w.id ? { id: w.id } : null) }));

import { _resetRole, armRole, bindArmedRole, getRole, setRole } from '../src/ui/roleStore';

beforeEach(() => {
  _resetRole();
  w.id = 'a';
});

describe('演一国 · 按世界记', () => {
  it('每个世界各记各的;切回造物主只清这个世界的', () => {
    setRole('polity:c1#0');
    w.id = 'b';
    expect(getRole()).toBeNull();
    setRole('polity:c2#0');
    w.id = 'a';
    expect(getRole()).toBe('polity:c1#0');
    setRole(null);
    expect(getRole()).toBeNull();
    w.id = 'b';
    expect(getRole()).toBe('polity:c2#0');
    // 没有打开的世界:认不了,也不算在演
    w.id = null;
    setRole('polity:c3#0');
    expect(getRole()).toBeNull();
  });

  it('开始演绎时先记下,新世界打开了才认上去;还是原来的世界不认', () => {
    armRole('polity:c5#0');
    expect(bindArmedRole()).toBeUndefined();
    expect(getRole()).toBeNull();
    w.id = 'story';
    expect(bindArmedRole()).toBe('polity:c5#0');
    expect(getRole()).toBe('polity:c5#0');
    // 认过一次就没了
    expect(bindArmedRole()).toBeUndefined();
    // 选的是造物主:新世界上清掉
    armRole(null);
    w.id = 'story2';
    setRole('polity:c6#0');
    expect(bindArmedRole()).toBeNull();
    expect(getRole()).toBeNull();
    w.id = 'story';
    expect(getRole()).toBe('polity:c5#0');
  });
});
