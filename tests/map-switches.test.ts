/** 修改、删除地图和照图原样的开关:测试网站、正式网站都开着 */
import { describe, expect, it } from 'vitest';
import { exactImageOn } from '../src/ui/exactImageFlag';
import { mapEditOn } from '../src/ui/mapEditFlag';

describe('地图页的两个开关', () => {
  it('测试网站、正式网站都开着', () => {
    expect([mapEditOn(), exactImageOn()]).toEqual([true, true]);
  });
});
