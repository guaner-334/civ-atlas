// 人口密度:每 50 年算一次各国的人口密度(一国的人口 ÷ 一国的面积),这个国家的每个州涂这个数。
// 按州按年份的图层最小的例子:读每一年的历史 → 每州一个数 → 整串交给网站,网站跟着时间轴挑那一年的画;
// 用的人点「存进这个世界」存的是整串,别人没装这个插件,拖时间轴也跟着变

const EVERY = 50;
const RAMP = { colors: ['#c7e9b4', '#7fcdbb', '#41b6c4', '#1d91c0', '#225ea8', '#0c2c84'], min: 0, max: 6 };

(async () => {
  const { to } = await civAtlas.history.span();
  // 一份几格 = 州数(不给年份时列的是全部的州,地形大事以后才有的州也算)
  const count = (await civAtlas.history.regions({})).length;
  const years = [];
  for (let y = 0; y <= to; y += EVERY) years.push(y);
  if (Math.floor(to) > years[years.length - 1]) years.push(Math.floor(to));

  // 第 k 份接在第 k − 1 份后面;没人管的州、那一年还没有的州是 NaN,不画
  const values = new Float32Array(years.length * count).fill(NaN);
  for (let k = 0; k < years.length; k++) {
    const year = years[k];
    const regions = await civAtlas.history.regions({ year });
    const { polity } = await civAtlas.history.at({ year, fields: ['polity'] });
    // 治所归哪国,这个州就算哪国的
    const owner = new Map();
    const people = new Map();
    const area = new Map();
    for (const r of regions) {
      const p = r.seat >= 0 ? polity[r.seat] : -1;
      if (p < 0) continue;
      owner.set(r.id, p);
      people.set(p, (people.get(p) ?? 0) + (r.population ?? 0) * 1000);
      area.set(p, (area.get(p) ?? 0) + r.area);
    }
    for (const [id, p] of owner) if (area.get(p) > 0) values[k * count + id] = people.get(p) / area.get(p);
  }

  await civAtlas.layer.regions({ id: 'density', title: '各国人口密度', years, values, ramp: RAMP, legend: '人/平方公里' });
  civAtlas.log(`算好了：第 ${years[0]} 到 ${years[years.length - 1]} 年，${years.length} 份`);
})();
