import { beforeAll, describe, expect, it } from 'vitest';
import type { Mesh } from '../src/gen/mesh';
import { checkMarkLayer, type MarkLayer } from '../src/plugin/check';
import type { MarkFrame } from '../src/render/marks';
import { drawPluginMarks, marksTimed } from '../src/render/pluginMarks';

type Call = { fn: string; args: unknown[]; style: Record<string, unknown> };

/** 只记调用的画布:每次调用连同那一刻的 fillStyle、strokeStyle、lineWidth */
function recorder() {
  const calls: Call[] = [];
  const state: Record<string, unknown> = {};
  const ctx = new Proxy(
    {},
    {
      get: (_, k: string) =>
        k in state ? state[k] : k === 'measureText' ? (s: string) => ({ width: s.length * 7 }) : (...args: unknown[]) => calls.push({ fn: k, args, style: { fill: state.fillStyle, stroke: state.strokeStyle, width: state.lineWidth } }),
      set: (_, k: string, v) => ((state[k] = v), true),
    },
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

const W = 2048;
const mesh = { width: W, height: 1024, n: 0, x: new Float32Array(0), y: new Float32Array(0) } as unknown as Mesh;
const frame: MarkFrame = { pt: (x, y) => [x, y], period: 0, win: [0, W], w: W, h: 1024, k: 1, cut: 0 };
const world = { cells: 10, width: W, height: 1024 };
const layer = (items: unknown[]): MarkLayer => checkMarkLayer({ id: 'a', title: 'a', items }, world);

beforeAll(() => {
  (globalThis as { Path2D?: unknown }).Path2D ??= class {
    moveTo() {}
    lineTo() {}
  };
});

describe('插件标注怎么画', () => {
  it('带年份的项只在那几年画;不给年份都画', () => {
    const l = layer([
      { kind: 'point', points: [10, 10], from: 100, to: 200 },
      { kind: 'point', points: [20, 20], from: 150 },
      { kind: 'point', points: [30, 30] },
    ]);
    expect(marksTimed([l])).toBe(true);
    expect(marksTimed([layer([{ kind: 'point', points: [1, 1] }])])).toBe(false);
    const dots = (year?: number) => {
      const r = recorder();
      drawPluginMarks(r.ctx, [l], frame, mesh, year);
      return r.calls.filter((c) => c.fn === 'arc').map((c) => c.args[0]);
    };
    expect(dots(99)).toEqual([30]);
    expect(dots(100)).toEqual([10, 30]);
    expect(dots(200.7)).toEqual([10, 20, 30]);
    expect(dots(201)).toEqual([20, 30]);
    expect(dots()).toEqual([10, 20, 30]);
  });

  it('箭头:末端一个、两头各一个,尖落在线的端点上,颜色跟着线', () => {
    const tips = (arrow?: string) => {
      const r = recorder();
      drawPluginMarks(r.ctx, [layer([{ kind: 'line', points: [100, 100, 300, 100], style: { color: '#123456', width: 4, ...(arrow ? { arrow } : {}) } }])], frame, mesh);
      const out: number[][] = [];
      r.calls.forEach((c, i) => {
        if (c.fn === 'closePath') out.push(r.calls[i - 3].args as number[]);
      });
      const fills = r.calls.filter((c) => c.fn === 'fill').map((c) => c.style.fill);
      return { out, fills };
    };
    expect(tips().out).toEqual([]);
    expect(tips('end').out).toEqual([[300, 100]]);
    expect(tips('end').fills).toEqual(['#123456']);
    expect(tips('both').out).toEqual([[300, 100], [100, 100]]);
  });

  it('线宽照 width;很浅的色号描深色的边', () => {
    const widths = (style: Record<string, unknown>) => {
      const r = recorder();
      drawPluginMarks(r.ctx, [layer([{ kind: 'line', points: [100, 100, 300, 100], style }])], frame, mesh);
      return r.calls.filter((c) => c.fn === 'stroke').map((c) => [c.style.stroke, c.style.width]);
    };
    expect(widths({ width: 7, color: '#a0521c' })).toEqual([
      ['rgba(255,255,255,0.9)', 7 * 1.2 + 3.6],
      ['#a0521c', 7],
    ]);
    expect(widths({ color: '#fafafa' })[0][0]).toBe('rgba(44,44,46,0.85)');
    expect(widths({ color: 'white' })[0][0]).toBe('rgba(44,44,46,0.85)');
    expect(widths({ color: 'orange' })[0][0]).toBe('rgba(255,255,255,0.9)');
  });

  it('配图标的点:标注色的圆上画图案;战场是交叉的剑', () => {
    const r = recorder();
    drawPluginMarks(r.ctx, [layer([{ kind: 'label', points: [50, 50], text: '城', style: { icon: 'castle', color: 'teal' } }, { kind: 'point', points: [80, 50], style: { icon: 'battle' } }])], frame, mesh);
    const arcs = r.calls.filter((c) => c.fn === 'arc');
    expect(arcs.map((c) => c.args[2])).toEqual([15, 14, 12, 15, 14, 12]);
    expect(r.calls.some((c) => c.fn === 'fill' && c.args[0] instanceof Path2D && c.style.fill === '#ffffff')).toBe(true);
    expect(r.calls.some((c) => c.fn === 'stroke' && c.args[0] instanceof Path2D)).toBe(true);
    const text = r.calls.find((c) => c.fn === 'fillText')!;
    expect(text.args[1]).toBe(50 + 12 + 4 + 8);
  });
});
