// 假插件:把接口的每样能力拿一遍、每种越界试一遍,结果交回网站页面(scripts/sandbox-check.ts 判过没过)。
// 网站页面那边会在插件说 listening 以后改看的年份、选中的东西,点面板上的按钮。
(async () => {
  const out = {};
  const sum = (a) => {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i];
    return s;
  };
  const codeOf = async (p) => {
    try {
      await p;
      return 'ok';
    } catch (e) {
      return (e && e.code) || 'throw:' + (e && e.name);
    }
  };
  const events = [];
  civAtlas.on('view.year', (d) => events.push(['view.year', d.year]));
  civAtlas.on('view.select', (d) => events.push(['view.select', d && d.key]));
  civAtlas.on('panel.action', (d) => events.push(['panel.action', d.id]));
  const all = civAtlas.request;
  try {
    out.info = await civAtlas.host.info();

    const w = await civAtlas.world.info();
    const cells = await civAtlas.world.cells({ fields: ['elevation', 'water', 'lat', 'area', 'biome'] });
    out.world = {
      cells: w.cells,
      title: w.title,
      n: cells.elevation.length,
      f32: cells.elevation instanceof Float32Array,
      u8: cells.water instanceof Uint8Array,
      elev: sum(cells.elevation),
      area: sum(cells.area),
      latOk: Math.max(...cells.lat) <= 90 && Math.min(...cells.lat) >= -90,
    };
    cells.elevation.fill(12345);
    const nb = await civAtlas.world.neighbors();
    out.neighbors = [nb.start.length, nb.list.length];
    out.rivers = (await civAtlas.world.rivers()).length;
    out.legend = (await civAtlas.world.legend({ kind: 'biome' })).length;

    const span = await civAtlas.history.span();
    const at = await civAtlas.history.at({ year: 600, fields: ['polity', 'culture', 'faith', 'region'] });
    const pol = await civAtlas.history.polities({ year: 600 });
    const owned = new Set();
    for (const p of at.polity) if (p >= 0) owned.add(p);
    out.history = {
      span,
      atLen: at.polity.length,
      i16: at.polity instanceof Int16Array,
      ownedPolities: owned.size,
      polities: pol.length,
      polityKey: pol[0] && pol[0].key,
      settlements: (await civAtlas.history.settlements({ year: 600 })).length,
      routes: (await civAtlas.history.routes({})).length,
      places: (await civAtlas.history.places()).length,
      cultures: (await civAtlas.history.cultures()).length,
      faiths: (await civAtlas.history.faiths()).length,
      regions: (await civAtlas.history.regions({ year: 600 })).length,
      people: (await civAtlas.history.people({ limit: 5 })).items.length,
      events: (await civAtlas.history.events({ from: 0, to: 800, limit: 7 })).items.length,
    };

    out.author = {
      marks: (await civAtlas.author.marks())[0].title,
      names: await civAtlas.author.names(),
      characters: (await civAtlas.author.characters()).length,
      interventions: (await civAtlas.author.interventions()).length,
      notes: (await civAtlas.author.notes({})).items[0].title,
    };
    out.view = await civAtlas.view.get();

    out.pick = {
      cell: (await civAtlas.pick.cell({ hint: '点起点' })).cell,
      cells: Array.from((await civAtlas.pick.cells({ max: 5 })).cells),
      box: (await civAtlas.pick.box({})).cells.length,
    };

    const polKey = pol[0].key;
    const regKey = (await civAtlas.history.regions({}))[5].key;
    out.apply = await civAtlas.author.apply({
      changes: [
        { kind: 'name', key: polKey, name: '插件起的国' },
        { kind: 'mark', mark: { title: '插件标的', color: 'blue', from: 0, regions: [regKey] } },
        { kind: 'intervention', v: { kind: 'protect', a: polKey, from: 100 } },
      ],
    });
    out.applyAfter = { names: await civAtlas.author.names(), marks: (await civAtlas.author.marks()).length };
    out.store = [
      await civAtlas.store.local.get(),
      await codeOf(civAtlas.store.local.set({ schema: 1, value: { speed: 3 } })),
      await civAtlas.store.local.get(),
      await codeOf(civAtlas.store.world.set({ schema: 2, value: { route: new Int32Array([1, 2, 3]) } })),
      Array.from((await civAtlas.store.world.get()).value.route),
      await codeOf(civAtlas.store.world.clear()),
      await civAtlas.store.world.get(),
    ];

    out.panel = await codeOf(
      civAtlas.panel.set({
        nodes: [
          { type: 'heading', text: '量路程' },
          { type: 'number', label: '天数', value: 12 },
          { type: 'button', id: 'go', label: '开始' },
        ],
      }),
    );
    const values = new Float32Array(w.cells).fill(1);
    out.layers = [];
    for (const id of ['a', 'b', 'c', 'd', 'e']) out.layers.push(await codeOf(civAtlas.layer.cells({ id, title: id, values, ramp: { colors: ['#000000', '#ffffff'] } })));
    out.layers.push(await codeOf(civAtlas.layer.marks({ id: 'route', title: '路线', items: [{ kind: 'line', cells: [0, 1, 2] }, { kind: 'label', cells: [3], text: '起点' }] })));
    out.layers.push(await codeOf(civAtlas.layer.remove({ id: 'b' })));

    // 越界
    out.bad = {
      field: await codeOf(civAtlas.world.cells({ fields: ['secret'] })),
      fields17: await codeOf(civAtlas.world.cells({ fields: Array(17).fill('x') })),
      year: await codeOf(civAtlas.history.at({ year: 1e9, fields: ['polity'] })),
      people: await codeOf(civAtlas.history.people({ limit: 2001 })),
      panelNode: await codeOf(civAtlas.panel.set({ nodes: [{ type: 'html', html: '<img>' }] })),
      panelBig: await codeOf(civAtlas.panel.set({ nodes: Array(2001).fill({ type: 'divider' }) })),
      layerLen: await codeOf(civAtlas.layer.cells({ id: 'a', title: 'a', values: [1, 2, 3], ramp: { colors: ['#000000', '#ffffff'] } })),
      markText: await codeOf(civAtlas.layer.marks({ id: 'route', title: 'x', items: [{ kind: 'label', cells: [1], text: 'x'.repeat(41) }] })),
      unknown: await codeOf(all('foo.bar', {})),
      proto: await codeOf(all('constructor', {})),
      applyKey: await codeOf(civAtlas.author.apply({ changes: [{ kind: 'name', key: 'polity:c99999999#0', name: 'x' }] })),
      applyKind: await codeOf(civAtlas.author.apply({ changes: [{ kind: 'terrain', op: {} }] })),
      storeBig: await codeOf(civAtlas.store.local.set({ schema: 1, value: 'x'.repeat(70000) })),
      storeKind: await codeOf(civAtlas.store.world.set({ schema: 1, value: new Date() })),
      uncloneable: await codeOf(civAtlas.world.info({ f: () => 1 })),
      stillUp: (await civAtlas.host.info()).api,
    };
  } catch (e) {
    out.threw = String((e && e.code) || '') + ' ' + String((e && e.message) || e);
  }
  civAtlas.post({ type: 'listening' });
  await new Promise((r) => setTimeout(r, 1200));
  out.events = events;
  civAtlas.post({ type: 'results', out });
})();
