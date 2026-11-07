// 离海多远:每块陆地走陆路到海边有多少公里,交给网站画成一个地块图层
// 地块图层最小的例子:读地图 → 每个地块算一个数 → 交给网站画

const BANDS = [
  { below: 100, color: '#2b83ba', label: '100 公里以内' },
  { below: 250, color: '#abdda4', label: '100–250 公里' },
  { below: 500, color: '#ffffbf', label: '250–500 公里' },
  { below: 1000, color: '#fdae61', label: '500–1000 公里' },
  { below: Infinity, color: '#d7191c', label: '1000 公里以上' },
];

/** 最小堆:每次取出离得最近的地块 */
class Heap {
  constructor() {
    this.items = [];
  }
  get size() {
    return this.items.length;
  }
  push(cell, d) {
    const a = this.items;
    a.push([cell, d]);
    for (let i = a.length - 1; i > 0; ) {
      const p = (i - 1) >> 1;
      if (a[p][1] <= a[i][1]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      for (let i = 0; ; ) {
        const l = 2 * i + 1;
        let m = i;
        if (l < a.length && a[l][1] < a[m][1]) m = l;
        if (l + 1 < a.length && a[l + 1][1] < a[m][1]) m = l + 1;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

(async () => {
  const world = await civAtlas.world.info();
  const { x, y, lat, water } = await civAtlas.world.cells({ fields: ['x', 'y', 'lat', 'water'] });
  const { start, list } = await civAtlas.world.neighbors();
  const n = world.cells;

  // 两个地块中心相距多少公里:地图东西两头是连着的,离赤道越远东西方向越短
  const km = (a, b) => {
    let dx = Math.abs(x[a] - x[b]);
    if (dx > world.width / 2) dx = world.width - dx;
    dx *= Math.cos((((lat[a] + lat[b]) / 2) * Math.PI) / 180);
    const dy = y[a] - y[b];
    return Math.sqrt(dx * dx + dy * dy) * world.kmPerUnit;
  };

  // 海岸线在陆地和海的地块中间,所以挨着海的地块离海是到那块海中心的一半;湖不算海,但走得过去
  const dist = new Float64Array(n).fill(Infinity);
  const heap = new Heap();
  for (let i = 0; i < n; i++) {
    if (water[i] === 1) continue;
    for (let k = start[i]; k < start[i + 1]; k++) {
      if (water[list[k]] === 1) dist[i] = Math.min(dist[i], km(i, list[k]) / 2);
    }
    if (dist[i] < Infinity) heap.push(i, dist[i]);
  }
  while (heap.size) {
    const [i, d] = heap.pop();
    if (d > dist[i]) continue;
    for (let k = start[i]; k < start[i + 1]; k++) {
      const j = list[k];
      if (water[j] === 1) continue;
      const next = d + km(i, j);
      if (next < dist[j]) {
        dist[j] = next;
        heap.push(j, next);
      }
    }
  }

  // 每个地块交一个数:在第几段;海、湖交 NaN,不画
  const values = new Float32Array(n);
  let farthest = 0;
  for (let i = 0; i < n; i++) {
    if (water[i] !== 0 || dist[i] === Infinity) {
      values[i] = NaN;
      continue;
    }
    values[i] = BANDS.findIndex((b) => dist[i] < b.below);
    farthest = Math.max(farthest, dist[i]);
  }

  // 想要连续的渐变:values 直接交公里数,classes 换成 ramp: { colors: [...], min: 0, max: 1500 }
  await civAtlas.layer.cells({
    id: 'coast',
    title: '离海多远',
    values,
    classes: BANDS.map((b, i) => ({ value: i, color: b.color, label: b.label })),
    legend: '走陆路到海边',
    opacity: 0.7,
  });
  civAtlas.log(`算好了：离海最远的地方约 ${Math.round(farthest)} 公里`);
})();
