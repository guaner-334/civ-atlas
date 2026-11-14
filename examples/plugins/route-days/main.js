// 量路程:请用的人在地图上点起点和终点,按地形找最省时的路(步行、骑马走陆路,坐船能过海过湖),算要走几天,列出沿路的城,画出路线
// 用到:点选(pick.cell)、插件面板和面板上的按钮、下拉(panel.set、panel.action)、标注图层(layer.marks)、可选的能力
// 用的人在「工具」里点开它,网站才开这个插件,所以顶层代码一跑完就请用的人点

const TERRAIN = [
  { name: '平地', below: 500, slow: 1 },
  { name: '丘陵', below: 1500, slow: 1.5 },
  { name: '山地', below: Infinity, slow: 2.5 },
];
// 坐船的在陆地上照步行算;sail = 海上、湖上每天多少公里
const MODES = [
  { value: 'walk', label: '步行', perDay: 30 },
  { value: 'horse', label: '骑马', perDay: 60 },
  { value: 'boat', label: '坐船', perDay: 30, sail: 120 },
];
/** 上一次船、下一次船各多算几天 */
const BOARD_DAYS = 1;
const NO_WAY = '这两个地方隔着水，走不过去。';
const NO_WAY_ICE = '这两个地方隔着结冰的海，走不过去。';
/** 海冰到这么多就当结冰,船过不去(和网站画海冰一样) */
const ICE = 0.5;

// 先放进变量再交给网站的面板控件、标注要标上类型,不然类型检查把 'select'、'line' 当成普通的字符串
/** @typedef {Parameters<typeof civAtlas.panel.set>[0]['nodes'][number]} PanelNode */
/** @typedef {Parameters<typeof civAtlas.layer.marks>[0]['items'][number]} MarkItem */

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
  const cells = await civAtlas.world.cells({ fields: ['x', 'y', 'lon', 'lat', 'elevation', 'water', 'seaIce'] });
  const { start, list } = await civAtlas.world.neighbors();

  const terrainOf = (i) => TERRAIN.findIndex((t) => cells.elevation[i] < t.below);
  const wet = (i) => cells.water[i] !== 0;
  const km = (a, b) => {
    let dx = Math.abs(cells.x[a] - cells.x[b]);
    if (dx > world.width / 2) dx = world.width - dx;
    dx *= Math.cos((((cells.lat[a] + cells.lat[b]) / 2) * Math.PI) / 180);
    const dy = cells.y[a] - cells.y[b];
    return Math.sqrt(dx * dx + dy * dy) * world.kmPerUnit;
  };

  // 看历史是可选的能力:用的人给了,就拿最后一年的城给起点、终点起名字、列出沿路的城;没给或者还没有历史,就写经纬度
  const canHistory = host.caps.includes('history.read@1');
  let towns = [];
  if (canHistory) {
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

  let mode = MODES[0];

  // 每一步一半按出发那块算,一半按到的那块算。走陆路的按地形折成平地的公里,不下水
  const landStep = (c, i, j) => {
    if (wet(j)) return Infinity;
    const d = km(i, j) / 2;
    return c + d * TERRAIN[terrainOf(i)].slow + d * TERRAIN[terrainOf(j)].slow;
  };
  // 坐船的折成天数:陆地和水相邻的一步就是上船或下船,所以只能在挨着水的陆地上船下船;结冰的海上不去
  const half = (i, d) => (wet(i) ? d / mode.sail : (d * TERRAIN[terrainOf(i)].slow) / mode.perDay);
  const boatStep = (c, i, j) => {
    if (wet(j) && cells.seaIce[j] >= ICE) return Infinity;
    const d = km(i, j) / 2;
    return c + half(i, d) + half(j, d) + (wet(i) !== wet(j) ? BOARD_DAYS : 0);
  };

  /** 从 a 到 b 最省时的路;走不过去 = null */
  const findRoute = (a, b) => {
    const step = mode.sail ? boatStep : landStep;
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
        const next = step(c, i, j);
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
    let seaKm = 0;
    let boards = 0;
    for (let s = 1; s < path.length; s++) {
      const d = km(path[s - 1], path[s]) / 2;
      for (const i of [path[s - 1], path[s]]) {
        if (wet(i)) seaKm += d;
        else kmBy[terrainOf(i)] += d;
      }
      if (wet(path[s - 1]) !== wet(path[s])) boards++;
    }
    return { a, b, path, kmBy, seaKm, boards };
  };

  /** 路线上、或者挨着路线的城,按走到它旁边的先后;起点、终点那块上的城不算 */
  const passedTowns = ({ a, b, path }) => {
    const near = new Map();
    path.forEach((c, s) => {
      for (let k = start[c]; k < start[c + 1]; k++) if (!near.has(list[k])) near.set(list[k], s);
    });
    path.forEach((c, s) => near.set(c, s));
    return towns
      .filter((t) => near.has(t.cell) && t.cell !== a && t.cell !== b)
      .map((t) => ({ name: t.name, s: near.get(t.cell), d: km(t.cell, path[near.get(t.cell)]) }))
      .sort((x, y) => x.s - y.s || x.d - y.d)
      .map((t) => t.name);
  };

  // 面板一共最多 4000 字:城太多时只列前面的,后面写省略号
  const passedLine = (names) => {
    const text = `经过：${names.join('、')}`;
    return text.length <= 1000 ? text : `${text.slice(0, text.lastIndexOf('、', 1000))}……`;
  };

  let pair = null;
  let route = null;

  /** @returns {PanelNode} */
  const modeSelect = () => ({ type: 'select', id: 'mode', label: '走法', options: MODES.map((m) => ({ value: m.value, label: m.label })), value: mode.value });

  /** modes = 两个地方都点好了、这种走法走不过去:给用的人换一种走法 */
  const showStart = (note, modes = false) =>
    civAtlas.panel.set({
      nodes: [
        { type: 'text', text: `${note ? `${note}\n` : ''}在地图上点起点和终点，按地形算要走几天。` },
        ...(modes ? [modeSelect()] : []),
        { type: 'button', id: 'again', label: '开始量' },
      ],
    });

  const showRoute = async () => {
    const { a, b, path, kmBy, seaKm, boards } = route;
    const daysBy = kmBy.map((d, t) => (d * TERRAIN[t].slow) / mode.perDay);
    const seaDays = mode.sail ? seaKm / mode.sail : 0;
    const days = Math.ceil(daysBy.reduce((s, v) => s + v, 0) + seaDays + boards * BOARD_DAYS);
    const passed = canHistory ? passedTowns(route) : null;
    const rows = TERRAIN.map((t, i) => [t.name, Math.round(kmBy[i]), Math.round(daysBy[i])]).filter((_, i) => Math.round(kmBy[i]) > 0);
    if (Math.round(seaKm) > 0) rows.push(['水上', Math.round(seaKm), Math.round(seaDays)]);
    if (boards) rows.push(['上船、下船', '', boards * BOARD_DAYS]);
    await civAtlas.panel.set({
      nodes: [
        { type: 'heading', text: '这条路' },
        { type: 'text', text: `起点 ${placeName(a)}\n终点 ${placeName(b)}` },
        { type: 'text', text: !passed ? '没给看历史，列不出城' : passed.length ? passedLine(passed) : '沿路没有城' },
        { type: 'number', label: '路程', value: Math.round(kmBy.reduce((s, v) => s + v, 0) + seaKm), unit: '公里' },
        { type: 'number', label: '要走', value: days, unit: '天' },
        modeSelect(),
        {
          type: 'text',
          text: `平地每天走 ${mode.perDay} 公里，丘陵慢一半，山地要多花一倍半的工夫；${mode.sail ? `水上坐船每天 ${mode.sail} 公里，上船、下船各多算一天` : '水上过不去'}。`,
        },
        { type: 'table', columns: ['一路上', '公里', '天'], rows },
        { type: 'button', id: 'again', label: '换个起点' },
        { type: 'button', id: 'clear', label: '清掉路线' },
      ],
    });
    // 地块编号交给网站,网站按地块中心画;同一个 id 再交一次就是换掉。水上那几段画成虚线
    const legs = [];
    for (let s = 1; s < path.length; s++) {
      const sea = wet(path[s - 1]) || wet(path[s]);
      const leg = legs[legs.length - 1];
      if (leg && leg.sea === sea) leg.cells.push(path[s]);
      else legs.push({ sea, cells: [path[s - 1], path[s]] });
    }
    /** @type {MarkItem[]} */
    const items = [];
    for (const l of legs) items.push({ kind: 'line', cells: l.cells, style: l.sea ? { color: 'red', size: 'm', line: 'dashed' } : { color: 'red', size: 'm' } });
    items.push({ kind: 'label', cells: [a], text: '起点', style: { color: 'red' } });
    items.push({ kind: 'label', cells: [b], text: `终点：约 ${days} 天`, style: { color: 'red' } });
    await civAtlas.layer.marks({ id: 'route', title: '路线', items });
  };

  const clearRoute = () => {
    pair = null;
    route = null;
    return civAtlas.layer.remove({ id: 'route' });
  };

  /** 按现在的走法把点好的两个地方再算一遍 */
  const remeasure = async () => {
    route = findRoute(pair.a, pair.b);
    if (route) return showRoute();
    await civAtlas.layer.remove({ id: 'route' });
    return showStart(mode.sail ? NO_WAY_ICE : NO_WAY, true);
  };

  let picking = false;
  /**
   * 量一条路。again = 量完一条接着等下一条:上一条路线先留着,点了新的起点才清掉;
   * 这时用的人不点了(顶上那条的「退出」、Esc),上一条照旧留着
   */
  const measure = async (again = false) => {
    if (picking) return;
    picking = true;
    let cleared = false;
    try {
      // 重新量先清掉上一条:中途退出、点到水上时,地图上不留一条面板里已经没有的路线
      if (!again) {
        await clearRoute();
        cleared = true;
        await civAtlas.panel.set({ nodes: [{ type: 'text', text: '在地图上点起点。' }] });
      }
      const a = (await civAtlas.pick.cell({ hint: again ? '再点两个点，换一条路' : '点起点' })).cell;
      if (!cleared) {
        await clearRoute();
        cleared = true;
      }
      if (cells.water[a] !== 0) return await showStart('起点在水上，换一块陆地点。');
      await civAtlas.panel.set({ nodes: [{ type: 'text', text: `起点 ${placeName(a)}。再点终点。` }] });
      const b = (await civAtlas.pick.cell({ hint: '再点终点' })).cell;
      if (cells.water[b] !== 0) return await showStart('终点在水上，换一块陆地点。');
      if (b === a) return await showStart('起点和终点是同一块地方。');
      pair = { a, b };
      route = findRoute(a, b);
      if (!route) return await showStart(mode.sail ? NO_WAY_ICE : NO_WAY, true);
      await showRoute();
    } catch (e) {
      // cancelled = 用的人退出了点选;别的出错码见开发文档
      if (e.code === 'cancelled' && !cleared) return;
      return await showStart(e.code === 'cancelled' ? '没量完。' : `出错了（${e.code}）：${e.message}`);
    } finally {
      picking = false;
    }
    // 量完一条接着等下一条:顶上那条一直在,用的人量完一条接着点下一条
    measure(true);
  };

  civAtlas.on('panel.action', (d) => {
    if (d.id === 'again') measure();
    else if (d.id === 'clear') {
      clearRoute();
      showStart();
    } else if (d.id === 'mode') {
      mode = MODES.find((m) => m.value === d.value) ?? mode;
      if (pair) remeasure();
    }
  });

  measure();
})();
