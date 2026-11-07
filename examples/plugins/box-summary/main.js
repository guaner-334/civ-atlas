// 框选合计:请用的人在地图上框一片,按正在看的那一年合计陆地、州、人口、城市和各国占多少;
// 点「存成标记」时把框住的州圈成一个标记,合计写进说明
// 用到:框选(pick.box)、看的年份变了的事件(view.year)、读历史、改你写的东西(author.apply)

/** 只数 10 万人以上的城(人口的单位是千人) */
const CITY_MIN = 100;
/** 一个标记最多圈几个州 */
const MARK_REGIONS_MAX = 500;
/** 各国占多少最多列几行,其余并成「其他」 */
const TOP = 8;

const fmt = (v) => String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const pct = (k, all) => `${Math.round((k / all) * 100)}%`;

(async () => {
  const { area, water } = await civAtlas.world.cells({ fields: ['area', 'water'] });
  let year = Math.floor((await civAtlas.view.get()).year);
  let box = null;
  let sum = null;
  let run = 0;

  const summarize = async () => {
    const mine = ++run;
    const inBox = new Set(box);
    const [at, regions, towns, polities] = await Promise.all([
      civAtlas.history.at({ year, fields: ['polity'] }),
      civAtlas.history.regions({ year }),
      civAtlas.history.settlements({ year }),
      civAtlas.history.polities({ year }),
    ]);
    // 合计的时候年份又变了:这一份作废,等新的那一份
    if (mine !== run) return;

    let land = 0;
    for (const c of box) if (water[c] === 0) land += area[c];
    // 州按治所算:治所在框里就算这一州
    const picked = regions.filter((r) => inBox.has(r.seat));
    const people = picked.reduce((s, r) => s + (r.population ?? 0), 0);
    const cities = towns.filter((t) => inBox.has(t.cell) && (t.population ?? 0) >= CITY_MIN).length;

    const count = new Map();
    for (const r of picked) {
      const p = at.polity[r.seat];
      count.set(p, (count.get(p) ?? 0) + 1);
    }
    const nameOf = new Map(polities.map((p) => [p.id, p.name]));
    const shares = [...count].sort((u, v) => v[1] - u[1] || u[0] - v[0]);
    const rows = shares.slice(0, TOP).map(([p, k]) => [p >= 0 ? (nameOf.get(p) ?? '？') : '没有国家', k, pct(k, picked.length)]);
    if (shares.length > TOP) {
      const rest = shares.slice(TOP).reduce((s, [, k]) => s + k, 0);
      rows.push(['其他', rest, pct(rest, picked.length)]);
    }
    sum = { year, land, regions: picked, people, cities, rows };
    await show();
  };

  const show = (note) =>
    civAtlas.panel.set({
      nodes: [
        { type: 'heading', text: `框住的地方（第 ${sum.year} 年）` },
        { type: 'number', label: '陆地', value: Math.round(sum.land / 1e4), unit: '万平方公里' },
        { type: 'number', label: '州', value: sum.regions.length, unit: '个' },
        { type: 'number', label: '人口', value: Math.round(sum.people / 10), unit: '万' },
        { type: 'number', label: '城市', value: sum.cities, unit: '座' },
        { type: 'text', text: '州按治所算；城市只算 10 万人以上的。' },
        { type: 'group', title: '各国占多少（按州）', children: [{ type: 'table', columns: ['国家', '州', '占比'], rows: sum.rows }] },
        { type: 'text', text: note ?? (sum.regions.length ? '点「存成标记」，把框住的州圈成一个标记，合计写在说明里。' : '框里没有州的治所，框大一点试试。') },
        { type: 'button', id: 'again', label: '重新框' },
        { type: 'button', id: 'save', label: '存成标记', disabled: !sum.regions.length },
      ],
    });

  const save = async () => {
    if (!sum || !sum.regions.length) return;
    const keys = sum.regions.slice(0, MARK_REGIONS_MAX).map((r) => r.key);
    const lines = [
      `陆地约 ${fmt(sum.land / 1e4)} 万平方公里，${sum.regions.length} 个州，人口约 ${fmt(sum.people / 10)} 万，10 万人以上的城市 ${sum.cities} 座。`,
      ...sum.rows.map(([name, k, share]) => `${name}：${k} 州（${share}）`),
    ];
    if (sum.regions.length > keys.length) lines.push(`州太多，标记只圈了前 ${keys.length} 个。`);
    try {
      // 网站照办以后整批记一步撤销;有一条不合格就整批不改,回 bad-args
      const r = await civAtlas.author.apply({
        changes: [{ kind: 'mark', mark: { title: `框选合计（第 ${sum.year} 年）`, note: lines.join('\n'), color: 'blue', from: sum.year, regions: keys } }],
      });
      await show(r.marks.length ? '存好了，在「标记」里能找到，不想要可以撤销。' : '没存上。');
    } catch (e) {
      await show(e.code === 'blocked' ? `网站这时不让改：${e.message}` : `没存上（${e.code}）：${e.message}`);
    }
  };

  let picking = false;
  const pickBox = async () => {
    if (picking) return;
    picking = true;
    try {
      box = (await civAtlas.pick.box({ hint: '拖一个框，框住想合计的地方' })).cells;
      await summarize();
    } catch (e) {
      if (e.code !== 'cancelled') civAtlas.log('框选出错', e.code, e.message);
      if (!sum) {
        await civAtlas.panel.set({
          nodes: [
            { type: 'text', text: '在地图上框一片，合计里面的陆地、州、人口、城市和各国占多少。' },
            { type: 'button', id: 'again', label: '开始框' },
          ],
        });
      }
    } finally {
      picking = false;
    }
  };

  civAtlas.on('view.year', (d) => {
    year = Math.floor(d.year);
    if (box) summarize();
  });
  civAtlas.on('panel.action', (d) => {
    if (d.id === 'again') pickBox();
    else if (d.id === 'save') save();
  });

  pickBox();
})();
