// 量路程:请用的人在地图上点起点和终点,沿陆路按地形找最省时的路,算要走几天,画出路线
// 用到:点选(pick.cell)、插件面板和面板上的按钮(panel.set、panel.action)、标注图层(layer.marks)、可选的能力

const TERRAIN = [
  { name: '平地', below: 500, slow: 1 },
  { name: '丘陵', below: 1500, slow: 1.5 },
  { name: '山地', below: Infinity, slow: 2.5 },
];
const MODES = [
  { value: 'walk', label: '步行', perDay: 30 },
  { value: 'horse', label: '骑马', perDay: 60 },
];

/** 最小堆:每次取出花时间最少的地块 */
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
  const host = await civAtlas.host.info();
  const world = await civAtlas.world.info();
  const cells = await civAtlas.world.cells({ fields: ['x', 'y', 'lon', 'lat', 'elevation', 'water'] });
  const { start, list } = await civAtlas.world.neighbors();

  const terrainOf = (i) => TERRAIN.findIndex((t) => cells.elevation[i] < t.below);
  const km = (a, b) => {
    let dx = Math.abs(cells.x[a] - cells.x[b]);
    if (dx > world.width / 2) dx = world.width - dx;
    dx *= Math.cos((((cells.lat[a] + cells.lat[b]) / 2) * Math.PI) / 180);
    const dy = cells.y[a] - cells.y[b];
    return Math.sqrt(dx * dx + dy * dy) * world.kmPerUnit;
  };

  // 看历史是可选的能力:用的人给了,就拿最后一年的城给起点、终点起名字;没给或者还没有历史,就写经纬度
  let towns = [];
  if (host.caps.includes('history.read@1')) {
    try {
      const { to } = await civAtlas.history.span();
      towns = await civAtlas.history.settlements({ year: to });
    } catch (e) {
      civAtlas.log('拿不到城的名字,改写经纬度', e.code);
    }
  }
  const placeName = (c) => {
    let best = null;
    let bestKm = Infinity;
    for (const t of towns) {
      const d = km(c, t.cell);
      if (d < bestKm) [best, bestKm] = [t, d];
    }
    if (best && best.cell === c) return best.name;
    if (best && bestKm < 300) return `${best.name}附近`;
    const lat = cells.lat[c];
    const lon = cells.lon[c];
    return `${lat >= 0 ? '北纬' : '南纬'} ${Math.abs(lat).toFixed(0)}°，${lon >= 0 ? '东经' : '西经'} ${Math.abs(lon).toFixed(0)}°`;
  };

  /** 从 a 到 b 最省时的陆路:每一步一半按出发那块的地形算,一半按到的那块算 */
  const findRoute = (a, b) => {
    const cost = new Float64Array(world.cells).fill(Infinity);
    const prev = new Int32Array(world.cells).fill(-1);
    const heap = new Heap();
    cost[a] = 0;
    heap.push(a, 0);
    while (heap.size) {
      const [i, c] = heap.pop();
      if (i === b) break;
      if (c > cost[i]) continue;
      for (let k = start[i]; k < start[i + 1]; k++) {
        const j = list[k];
        if (cells.water[j] !== 0) continue;
        const d = km(i, j) / 2;
        const next = c + d * TERRAIN[terrainOf(i)].slow + d * TERRAIN[terrainOf(j)].slow;
        if (next < cost[j]) {
          cost[j] = next;
          prev[j] = i;
          heap.push(j, next);
        }
      }
    }
    if (cost[b] === Infinity) return null;
    const path = [b];
    while (path[path.length - 1] !== a) path.push(prev[path[path.length - 1]]);
    path.reverse();
    const kmBy = TERRAIN.map(() => 0);
    for (let s = 1; s < path.length; s++) {
      const d = km(path[s - 1], path[s]) / 2;
      kmBy[terrainOf(path[s - 1])] += d;
      kmBy[terrainOf(path[s])] += d;
    }
    return { a, b, path, kmBy };
  };

  let mode = MODES[0];
  let route = null;

  const showStart = (note) =>
    civAtlas.panel.set({
      nodes: [
        { type: 'text', text: `${note ? `${note}\n` : ''}在地图上点起点和终点，沿陆路按地形算要走几天。` },
        { type: 'button', id: 'again', label: '开始量' },
      ],
    });

  const showRoute = async () => {
    const { a, b, path, kmBy } = route;
    const daysBy = kmBy.map((d, t) => (d * TERRAIN[t].slow) / mode.perDay);
    const days = Math.ceil(daysBy.reduce((s, v) => s + v, 0));
    await civAtlas.panel.set({
      nodes: [
        { type: 'heading', text: '这条路' },
        { type: 'text', text: `起点 ${placeName(a)}\n终点 ${placeName(b)}` },
        { type: 'number', label: '路程', value: Math.round(kmBy.reduce((s, v) => s + v, 0)), unit: '公里' },
        { type: 'number', label: '要走', value: days, unit: '天' },
        { type: 'select', id: 'mode', label: '走法', options: MODES.map((m) => ({ value: m.value, label: m.label })), value: mode.value },
        { type: 'text', text: `平地每天走 ${mode.perDay} 公里，丘陵慢一半，山地要多花一倍半的工夫；水上过不去。` },
        {
          type: 'table',
          columns: ['一路上', '公里', '天'],
          rows: TERRAIN.map((t, i) => [t.name, Math.round(kmBy[i]), Math.round(daysBy[i])]).filter((_, i) => Math.round(kmBy[i]) > 0),
        },
        { type: 'button', id: 'again', label: '换个起点' },
        { type: 'button', id: 'clear', label: '清掉路线' },
      ],
    });
    // 地块编号交给网站,网站按地块中心画;同一个 id 再交一次就是换掉
    await civAtlas.layer.marks({
      id: 'route',
      title: '路线',
      items: [
        { kind: 'line', cells: path, style: { color: 'red', size: 'm' } },
        { kind: 'label', cells: [a], text: '起点', style: { color: 'red' } },
        { kind: 'label', cells: [b], text: `终点：约 ${days} 天`, style: { color: 'red' } },
      ],
    });
  };

  const clearRoute = () => {
    route = null;
    return civAtlas.layer.remove({ id: 'route' });
  };

  let picking = false;
  const measure = async () => {
    if (picking) return;
    picking = true;
    try {
      // 重新量先清掉上一条:中途退出、点到水上时,地图上不留一条面板里已经没有的路线
      await clearRoute();
      await civAtlas.panel.set({ nodes: [{ type: 'text', text: '在地图上点起点。' }] });
      const a = (await civAtlas.pick.cell({ hint: '点起点' })).cell;
      if (cells.water[a] !== 0) return await showStart('起点在水上，换一块陆地点。');
      await civAtlas.panel.set({ nodes: [{ type: 'text', text: `起点 ${placeName(a)}。再点终点。` }] });
      const b = (await civAtlas.pick.cell({ hint: '再点终点' })).cell;
      if (cells.water[b] !== 0) return await showStart('终点在水上，换一块陆地点。');
      if (b === a) return await showStart('起点和终点是同一块地方。');
      route = findRoute(a, b);
      if (!route) return await showStart('这两个地方隔着水，走不过去。');
      await showRoute();
    } catch (e) {
      // cancelled = 用的人退出了点选;别的出错码见开发文档
      await showStart(e.code === 'cancelled' ? '没量完。' : `出错了（${e.code}）：${e.message}`);
    } finally {
      picking = false;
    }
  };

  civAtlas.on('panel.action', (d) => {
    if (d.id === 'again') measure();
    else if (d.id === 'clear') {
      clearRoute();
      showStart();
    } else if (d.id === 'mode') {
      mode = MODES.find((m) => m.value === d.value) ?? mode;
      if (route) showRoute();
    }
  });

  measure();
})();
