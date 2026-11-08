// 柯本气候:
// - 改气候:季风让副热带、离海不远、偏东岸的陆地全年降水多两成(滑条「季风强弱」0–2,默认 1)
// - 出图层:估出每块陆地 12 个月的气温和降水,照柯本 - 盖格分类分成 30 类,画成一张分类图(海和湖不画)

// 舍入到 24 位。QuickJS 里的 Math.cos 这些在哪台设备上都一样,不舍入也行;
// 舍入了,同一份代码不经 QuickJS 直接跑也和 QuickJS 里逐位一样(这个示例的测试要用)
function r24(x) {
  if (!(Math.abs(x) < 1e290)) return x;
  const c = x * 536870913;
  return c - (c - x);
}

// 图层里每块陆地交的数是这张表的下标,和 plugin.json 里 map.layers 的 classes 一一对上
const KOPPEN = ['Af', 'Am', 'Aw', 'BWh', 'BWk', 'BSh', 'BSk', 'Csa', 'Csb', 'Csc', 'Cwa', 'Cwb', 'Cwc', 'Cfa', 'Cfb', 'Cfc', 'Dsa', 'Dsb', 'Dsc', 'Dsd', 'Dwa', 'Dwb', 'Dwc', 'Dwd', 'Dfa', 'Dfb', 'Dfc', 'Dfd', 'ET', 'EF'];

// 季风多强(0–1,再乘滑条):纬度 10°–35° 最强;离海 8 步以内,越近越强;
// 东岸按经度粗估(经度 140° 和 −40° 附近最强),east 在出图层时还用来估地中海式气候(西岸夏干)
function monsoonOf(lat, lon, dist, k) {
  const a = Math.abs(lat);
  const belt = a > 10 && a < 35 ? 1 : a > 5 && a < 40 ? 0.5 : 0;
  const coast = dist <= 8 ? 1 - dist / 9 : 0;
  const east = 0.5 + 0.5 * r24(Math.cos(((lon + 40) * Math.PI) / 90));
  return { m: belt * coast * east * k, east };
}

civAtlas.map({
  climate(d) {
    // 每块离海、湖几步(帮手在网站那头算,比自己写快几十倍)
    const dist = d.steps(d.water);
    const P = d.precipitation.slice();
    for (let i = 0; i < d.n; i++) {
      if (d.water[i] !== 0) continue;
      P[i] *= 1 + 0.2 * monsoonOf(d.lat[i], d.lon[i], dist[i], d.params.monsoon).m;
    }
    return { precipitation: P };
  },

  layers(d) {
    const { n, lat, lon, water, temperature: T, precipitation: P } = d;
    const dist = d.steps(water);
    const cls = new Float32Array(n).fill(NaN);
    const mt = new Float64Array(12);
    const mp = new Float64Array(12);
    for (let i = 0; i < n; i++) {
      if (water[i] !== 0) continue;
      // 冬夏温差:纬度越高、离海越远越大
      const a = Math.abs(lat[i]);
      const cont = Math.min(1, Math.max(0, dist[i]) / 14);
      const range = 3 + (6 + 30 * cont) * r24(Math.sin((a * Math.PI) / 180));
      const north = lat[i] >= 0 ? 1 : -1;
      // 夏半年下的雨占全年几成:季风区多,西岸中纬度(地中海式)少
      const { m: monsoon, east } = monsoonOf(lat[i], lon[i], dist[i], d.params.monsoon);
      const medi = a > 30 && a < 45 ? (1 - east) * (dist[i] <= 6 ? 1 : 0.3) : 0;
      const summer = Math.min(0.9, Math.max(0.15, 0.5 + 0.35 * monsoon - 0.3 * medi));
      // 12 个月的气温、降水(北半球 7 月最热,南半球反过来)
      let tmin = Infinity;
      let tmax = -Infinity;
      let warm = 0;
      let psum = 0;
      let pdriest = Infinity;
      let psMin = Infinity;
      let psMax = 0;
      let pwMin = Infinity;
      let pwMax = 0;
      for (let k = 0; k < 12; k++) {
        const ph = r24(Math.cos((2 * Math.PI * (k - 6.5)) / 12)) * north;
        mt[k] = T[i] + 0.5 * range * ph;
        const isSummer = ph > 0;
        mp[k] = ((P[i] * (isSummer ? summer : 1 - summer)) / 6) * (1 + 0.3 * Math.abs(ph) * (isSummer ? 1 : -1) * (summer - 0.5) * 2);
        tmin = Math.min(tmin, mt[k]);
        tmax = Math.max(tmax, mt[k]);
        if (mt[k] >= 10) warm++;
        psum += mp[k];
        pdriest = Math.min(pdriest, mp[k]);
        if (isSummer) {
          psMin = Math.min(psMin, mp[k]);
          psMax = Math.max(psMax, mp[k]);
        } else {
          pwMin = Math.min(pwMin, mp[k]);
          pwMax = Math.max(pwMax, mp[k]);
        }
      }
      // 柯本 - 盖格的判法:先看冷(E)、干(B),再按最冷月分热带(A)、温带(C)、冷温带(D)
      const pth = 20 * T[i] + (summer >= 0.7 ? 280 : summer <= 0.3 ? 0 : 140);
      let code;
      if (tmax < 10) code = tmax < 0 ? 'EF' : 'ET';
      else if (psum < 2 * pth) code = psum < pth ? (T[i] >= 18 ? 'BWh' : 'BWk') : T[i] >= 18 ? 'BSh' : 'BSk';
      else if (tmin >= 18) code = pdriest >= 60 ? 'Af' : pdriest >= 100 - psum / 25 ? 'Am' : 'Aw';
      else {
        const dry = psMin < 40 && psMin < pwMax / 3 ? 's' : pwMin < psMax / 10 ? 'w' : 'f';
        const third = tmax >= 22 ? 'a' : warm >= 4 ? 'b' : tmin < -38 ? 'd' : 'c';
        code = (tmin > -3 ? 'C' : 'D') + dry + (tmin > -3 && third === 'd' ? 'c' : third);
      }
      cls[i] = KOPPEN.indexOf(code);
    }
    return { layers: { koppen: cls } };
  },
});
