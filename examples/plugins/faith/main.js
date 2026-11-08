// 宗教生效:异教的州难治、难融合,异教邻国之间更容易开战;圣城被异教国占了就兴兵去夺,同教的小国联手对付异教强邻
// 每 5 年出手一次(信仰也是每 5 年算一步)。按州交动荡、同化,按国交宣战的几率;下两种命令,都在编年史记一句

const FAITH = {
  /** 一州信的和本国国教不同(异教 1、同一大教的别派 0.5):本国动荡加 unrest × 这几成 */
  unrest: 0.3,
  /** 同化的快慢:异教 × 0.6(别派按一半折),同教 × 1.1 */
  assimFar: 0.6,
  assimSame: 1.1,
  /** 宣战的几率:邻国全同教 × 0.85,全异教 × 1.3,按邻国里异教占几成折 */
  warSame: 0.85,
  warFar: 1.3,
  /** 圣城在接壤的异教国手里,每次出手兴兵的几成;打过一次隔几年才再为它打 */
  holy: 0.2,
  holyGap: 40,
  /** 同教的两国都和一个更强的异教国接壤:每次出手结盟的几成、盟约几年 */
  ally: 0.15,
  allyYears: 40,
  /** 一次出手最多下几条命令 */
  most: 8,
};

/** 两种信仰隔得多远:一样 0,同一大教的别派 0.5,别的 1;不知道(没人住、没有国教)= −1 */
function faithGap(faiths, f, g) {
  if (f < 0 || g < 0 || !faiths[f] || !faiths[g]) return -1;
  if (f === g) return 0;
  const root = (x) => (faiths[x].kind === 'sect' && faiths[x].parent !== undefined ? faiths[x].parent : x);
  return root(f) === root(g) ? 0.5 : 1;
}

civAtlas.sim({
  act(turn) {
    const r = turn.read;
    const ps = r.polities();
    const faiths = r.faiths();
    const owner = r.owners('polity');
    const faith = r.owners('faith');
    const { start, list } = r.regions().neighbors;
    const R = owner.length;
    const unrest = turn.influence('unrest.add');
    const assim = turn.influence('assim.rate');
    const odds = turn.influence('war.odds');
    const stateOf = (p) => (p >= 0 && ps[p] ? ps[p].faith : -1);
    for (let q = 0; q < R; q++) {
      const gap = faithGap(faiths, stateOf(owner[q]), faith[q]);
      unrest[q] = gap > 0 ? FAITH.unrest * gap : 0;
      assim[q] = gap < 0 ? 1 : gap === 0 ? FAITH.assimSame : 1 - (1 - FAITH.assimFar) * gap;
    }
    // 接壤的国(按编号升序)
    const near = ps.map(() => new Set());
    for (let q = 0; q < R; q++) {
      const a = owner[q];
      if (a < 0) continue;
      for (let e = start[q]; e < start[q + 1]; e++) {
        const b = owner[list[e]];
        if (b >= 0 && b !== a) near[a].add(b);
      }
    }
    for (let p = 0; p < odds.length; p++) {
      let n = 0;
      let far = 0;
      for (const q of near[p]) {
        const gap = faithGap(faiths, stateOf(p), stateOf(q));
        if (gap < 0) continue;
        n++;
        far += gap;
      }
      odds[p] = n ? FAITH.warSame + (FAITH.warFar - FAITH.warSame) * (far / n) : 1;
    }

    // 小本子 holy:国 → 上回为圣城兴兵那年;pact:「甲:乙」→ 下令结的盟到哪年
    const had = /** @type {{ holy?: Record<string, number>, pact?: Record<string, number> } | undefined} */ (turn.note);
    const note = { holy: { ...(had?.holy ?? {}) }, pact: { ...(had?.pact ?? {}) } };
    for (const k of Object.keys(note.holy)) if (turn.year - note.holy[k] >= FAITH.holyGap) delete note.holy[k];
    for (const k of Object.keys(note.pact)) if (turn.year >= note.pact[k]) delete note.pact[k];
    const commands = [];
    const chronicle = [];
    const alive = (p) => p >= 0 && !!ps[p] && ps[p].ended === undefined && ps[p].size > 0;
    const busy = (a, b) => ps[a].wars.includes(b) || ps[a].allies.includes(b);
    const ss = r.settlements();
    // 复圣城
    for (const f of faiths) {
      if (f.kind !== 'great' || f.holy === undefined || commands.length >= FAITH.most) continue;
      const s = ss[f.holy];
      if (!s || s.ended !== undefined) continue;
      const b = owner[s.region];
      if (!alive(b) || faithGap(faiths, f.id, stateOf(b)) !== 1) continue;
      for (const a of [...near[b]].sort((x, y) => x - y)) {
        const mine = faithGap(faiths, f.id, stateOf(a));
        if (!alive(a) || busy(a, b) || note.holy[a] !== undefined || mine < 0 || mine > 0.5) continue;
        if (turn.rand(a, f.id, Math.round(turn.year), 1) >= FAITH.holy) continue;
        commands.push({ kind: 'declare', a, b });
        chronicle.push({ text: '{国:a}欲复圣城{城:s},兴兵伐{国:b}', refs: { a, b, s: f.holy } });
        note.holy[a] = turn.year;
        break;
      }
    }
    // 同教联手拒强邻
    for (let s = 0; s < ps.length && commands.length < FAITH.most; s++) {
      if (!alive(s) || stateOf(s) < 0) continue;
      const around = [...near[s]].filter((p) => alive(p) && ps[p].power < ps[s].power && faithGap(faiths, stateOf(p), stateOf(s)) === 1).sort((x, y) => x - y);
      for (let i = 0; i < around.length && commands.length < FAITH.most; i++) {
        for (let j = i + 1; j < around.length; j++) {
          const a = around[i];
          const b = around[j];
          if (faithGap(faiths, stateOf(a), stateOf(b)) !== 0 || !near[a].has(b) || busy(a, b) || note.pact[`${a}:${b}`] !== undefined) continue;
          if (turn.rand(a, b, Math.round(turn.year), 2) >= FAITH.ally) continue;
          const until = Math.floor(turn.year) + FAITH.allyYears;
          commands.push({ kind: 'ally', a, b, until });
          note.pact[`${a}:${b}`] = until;
          chronicle.push({ text: '{国:a}与{国:b}同奉一教,结盟以拒{国:s}', refs: { a, b, s } });
          break;
        }
      }
    }
    return {
      note,
      influences: { 'unrest.add': unrest, 'assim.rate': assim, 'war.odds': odds },
      ...(commands.length ? { commands, chronicle } : {}),
    };
  },
});
