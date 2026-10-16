/**
 * 立国节奏与民族分布的多种子统计:npx tsx scripts/civ-tempo.ts [个数=20] [from=1] [cells=…]
 * 每个种子一行:首国年份、头 1000 年立国数、首战年份、立国 / 亡国总数、结束时没有国家的有人州占比、最大国州数占比、
 * 民族(总数 / 在世 / 后起 / 分化出来的)、在世民族里最大的纬度跨度和最多断成几块。最后一行是 20 个种子的最小 / 中位 / 最大
 */
import { generateWorld, type WorldParams } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { geometryOf } from '../src/gen/geometry';
import { AdjKind } from '../src/gen/civ/types';

const args = process.argv.slice(2);
const opt = (k: string) => args.find((a) => a.startsWith(`${k}=`))?.slice(k.length + 1);
const N = Number(args.find((a) => !a.includes('=')) ?? 20);
const from = Number(opt('from') ?? 1);
const rows: Record<string, number>[] = [];
for (let seed = from; seed < from + N; seed++) {
  const params = { seed } as WorldParams;
  if (opt('cells')) params.cells = Number(opt('cells'));
  const w = generateWorld(params);
  const t0 = performance.now();
  const civ = generateCiv(w);
  const ms = performance.now() - t0;
  const reg = civ.regions;
  const geo = geometryOf(w.mesh);
  const found = civ.annals.filter((a) => a.kind === 'found' || a.kind === 'split');
  const firstFound = civ.annals.find((a) => a.kind === 'found')?.year ?? Infinity;
  const firstWar = civ.annals.find((a) => a.kind === 'war')?.year ?? Infinity;
  let occ = 0, tribal = 0;
  const size = new Map<number, number>();
  for (let r = 0; r < reg.count; r++) {
    if (civ.culture[r] < 0) continue;
    occ++;
    if (civ.polity[r] < 0) tribal++;
    else size.set(civ.polity[r], (size.get(civ.polity[r]) ?? 0) + 1);
  }
  const maxPol = Math.max(0, ...size.values());
  // 民族:纬度跨度、断成几块(陆上相邻或隔海峡算连着)
  let maxSpan = 0, maxFrag = 0;
  const alive = civ.cultures.filter((c) => c.ended === undefined && !c.unborn);
  for (const cu of alive) {
    let lo = 90, hi = -90;
    const seen = new Uint8Array(reg.count);
    let frags = 0;
    for (let r = 0; r < reg.count; r++) {
      if (civ.culture[r] !== cu.id) continue;
      const lat = geo.latitude(reg.seat[r]);
      lo = Math.min(lo, lat);
      hi = Math.max(hi, lat);
      if (seen[r]) continue;
      frags++;
      const q = [r];
      seen[r] = 1;
      for (let h = 0; h < q.length; h++) {
        const a = q[h];
        for (let k = reg.adjStart[a]; k < reg.adjStart[a + 1]; k++) {
          const b = reg.adj[k];
          if (reg.adjKind[k] === AdjKind.SeaRoute || seen[b] || civ.culture[b] !== cu.id) continue;
          seen[b] = 1;
          q.push(b);
        }
      }
    }
    if (hi >= lo) maxSpan = Math.max(maxSpan, hi - lo);
    maxFrag = Math.max(maxFrag, frags);
  }
  const row = {
    seed,
    ms: Math.round(ms),
    首国: firstFound,
    千年内立国: found.filter((a) => a.year < 1000).length,
    首战: Math.round(firstWar),
    立国: civ.annals.filter((a) => a.kind === 'found').length,
    影响立国: civ.polities.filter((p) => (p as { mentor?: number }).mentor !== undefined).length,
    分裂复国: civ.annals.filter((a) => a.kind === 'split').length,
    亡国: civ.annals.filter((a) => a.kind === 'fall').length,
    部落占比: Math.round((100 * tribal) / Math.max(1, occ)),
    最大国占比: Math.round((100 * maxPol) / Math.max(1, occ)),
    民族: civ.cultures.filter((c) => !c.unborn).length,
    在世: alive.length,
    后起: civ.cultures.filter((c) => !c.unborn && c.born > 400).length,
    分化: civ.cultures.filter((c) => (c as { parent?: number }).parent !== undefined && !c.unborn).length,
    最大纬跨: Math.round(maxSpan),
    最多块: maxFrag,
  };
  rows.push(row);
  console.log(Object.entries(row).map(([k, v]) => `${k}=${v}`).join(' '));
}
const keys = Object.keys(rows[0]).filter((k) => k !== 'seed');
const q = (k: string, p: number) => {
  const v = rows.map((r) => r[k]).sort((a, b) => a - b);
  return v[Math.min(v.length - 1, Math.floor(p * (v.length - 1)))];
};
console.log('min/中位/max ' + keys.map((k) => `${k}=${q(k, 0)}/${q(k, 0.5)}/${q(k, 1)}`).join(' '));
