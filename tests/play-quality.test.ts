import { describe, expect, it } from 'vitest';
import { SMOOTH_MS, nextDrawn, playSmooth } from '../src/ui/playQuality';

describe('播放画面', () => {
  it('流畅优先地播放:隔够 SMOOTH_MS 才换年份,停下当场换上', () => {
    let d = nextDrawn(null, 100, true, 0);
    expect(d.year).toBe(100);
    d = nextDrawn(d, 101, true, 16);
    expect(d.year).toBe(100);
    d = nextDrawn(d, 105, true, SMOOTH_MS - 1);
    expect(d.year).toBe(100);
    d = nextDrawn(d, 106, true, SMOOTH_MS);
    expect(d).toEqual({ year: 106, at: SMOOTH_MS });
    d = nextDrawn(d, 107, true, SMOOTH_MS + 16);
    expect(d.year).toBe(106);
    // 停下:马上画停的那一年
    d = nextDrawn(d, 107.4, false, SMOOTH_MS + 20);
    expect(d.year).toBe(107.4);
  });

  it('不是流畅优先:每次都换', () => {
    let d = nextDrawn(null, 1, false, 0);
    d = nextDrawn(d, 2, false, 1);
    expect(d.year).toBe(2);
  });

  it('流畅优先总是少画;清晰优先总是画全', () => {
    expect(playSmooth('smooth')).toBe(true);
    expect(playSmooth('sharp')).toBe(false);
  });
});
