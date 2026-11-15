// 雨影与极地:
// - 改海拔:北极、南极两个滑条(−1 到 1)把纬度高过「极区从几度起」的那片改成海或陆地:正数往陆地推、负数往海推,
//   拨到 ±1 改整片,拨到一半只改离极点近的那一半(按纬度算);改成陆地的给 200 米,改成海的给 −2000 米。0 = 不动
// - 改气候:每块陆地顺着风往上风走,找 500 公里内最高的山,比本块高得越多,本块降水打折越多
//   (高出 1500 米打满:滑条「雨影」1 乘 0.6,2 乘 0.6²,3 乘 0.6³);风吹上坡的地方多下一点(最多多 1 成 × 滑条)。0 = 不动

const REACH_KM = 500; // 往上风看多远
const SHADOW_KEEP = 0.6; // 滑条 1 时背风最少剩几成
const SHADOW_FULL_M = 1500; // 上风的山比本块高出这么多,打折打满
const LIFT = 0.1; // 滑条 1 时迎风坡最多多几成
const LIFT_FULL_M = 1000; // 比上风那一块高出这么多,多到顶
const NEW_LAND_M = 200;
const NEW_SEA_M = -2000;

// 每块往上风走一步到哪块:邻居里方向和逆风最一致的那块(夹角 60° 以内),没有是 −1。
// 方向按经纬度在本块那里展平了算。只和风向、位置有关,先一次算好,后面顺着它走
function upwindOf(d) {
  const up = new Int32Array(d.n).fill(-1);
  for (let c = 0; c < d.n; c++) {
    const cosLat = Math.cos((d.lat[c] * Math.PI) / 180);
    // 风往东是 windX、往南是 windY;逆风往东是 −windX,往北是 windY
    const ue = -d.windX[c];
    const un = d.windY[c];
    let bestDot = 0.5;
    for (let k = d.adjStart[c]; k < d.adjStart[c + 1]; k++) {
      const j = d.adj[k];
      let dl = d.lon[j] - d.lon[c];
      if (dl > 180) dl -= 360;
      else if (dl < -180) dl += 360;
      const de = dl * cosLat;
      const dn = d.lat[j] - d.lat[c];
      const len = Math.sqrt(de * de + dn * dn);
      if (len === 0) continue;
      const dot = (de * ue + dn * un) / len;
      if (dot > bestDot) {
        bestDot = dot;
        up[c] = j;
      }
    }
  }
  return up;
}

civAtlas.map({
  height(d) {
    const { north, south, polar } = d.params;
    if (north === 0 && south === 0) return;
    const e = d.elevation.slice();
    const land = d.land.slice();
    for (let i = 0; i < d.n; i++) {
      const v = d.lat[i] >= 0 ? north : south;
      // 离极点 (90 − polar) × |v| 度以内的改
      if (v === 0 || Math.abs(d.lat[i]) < 90 - Math.abs(v) * (90 - polar)) continue;
      if (v > 0 && land[i] === 0) {
        e[i] = NEW_LAND_M;
        land[i] = 1;
      } else if (v < 0 && land[i] === 1) {
        e[i] = NEW_SEA_M;
        land[i] = 0;
      }
    }
    return { elevation: e, land };
  },

  climate(d) {
    const s = d.params.shadow;
    if (s === 0) return;
    const up = upwindOf(d);
    // 海面、湖底按 0 米算
    const h = new Float64Array(d.n);
    for (let i = 0; i < d.n; i++) h[i] = Math.max(0, d.elevation[i]);
    const P = d.precipitation.slice();
    for (let i = 0; i < d.n; i++) {
      if (d.water[i] !== 0) continue;
      const own = h[i];
      const first = up[i];
      let peak = own;
      let lastKm = 0;
      // 顺着风一步步往回走,离本块越来越远才接着走(风向转弯处不打转)
      for (let j = first; j >= 0; j = up[j]) {
        const km = d.km(i, j);
        if (km > REACH_KM || km <= lastKm) break;
        if (h[j] > peak) peak = h[j];
        lastKm = km;
      }
      let f = 1;
      if (peak > own) f *= Math.pow(SHADOW_KEEP, s * Math.min(1, (peak - own) / SHADOW_FULL_M));
      if (first >= 0 && own > h[first]) f *= 1 + LIFT * s * Math.min(1, (own - h[first]) / LIFT_FULL_M);
      P[i] *= f;
    }
    return { precipitation: P };
  },
});
