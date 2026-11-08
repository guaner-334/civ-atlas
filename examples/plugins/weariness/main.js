// 厌战:有议会的国家开战要先过议会;久攻不下、打得太久的仗,议会厌战,遣使议和
// 每年出手一次。什么时候出手、听哪几种史事、交给哪个影响口、会下哪种命令,写在 plugin.json 的 sim 段

const WEARY = {
  /** 议会点头的几成(乘在宣战的几率上) */
  vote: 0.45,
  /** 连着几年没打下一州就罢兵 */
  stall: 4,
  /** 一场仗最多打几年就罢兵 */
  years: 8,
  /** 罢兵立约几年 */
  term: 10,
};

/** 开战要议的国:设了议事会、议会的王国,共和国;军政府不算 */
const parliamentary = (p) => (p.regime === 'crown' && p.charter >= 1) || p.regime === 'republic';

/** 小本子里一场仗占几个数:编号、攻方、守方、开战那年、上回打下一州那年、遣使那年(−1 = 还没有) */
const W = 6;

civAtlas.sim({
  act(turn) {
    // 在打的仗记在小本子里,一场 W 个数接在一起;小本子是复制的一份,改完在回话里交回
    const had = /** @type {{ w?: number[] } | undefined} */ (turn.note);
    const w = (had?.w ?? []).slice();
    const at = (war) => {
      for (let i = 0; i < w.length; i += W) if (w[i] === war) return i;
      return -1;
    };
    for (const e of turn.heard) {
      const i = at(e.war);
      if (e.kind === 'war' && i < 0) w.push(e.war, e.a, e.b, e.year, e.year, -1);
      else if (e.kind === 'conquer' && i >= 0 && e.a === w[i + 1]) w[i + 4] = e.year;
      else if (e.kind === 'peace' && i >= 0) w.splice(i, W);
    }

    // 有议会的国家宣战的几率打折(交给影响口 war.odds,一国一个数)
    const ps = turn.read.polities();
    const odds = turn.influence('war.odds');
    for (let p = 0; p < odds.length; p++) odds[p] = ps[p].ended === undefined && parliamentary(ps[p]) ? WEARY.vote : 1;

    // 攻方有议会的仗(打自己分出去的国不算):连着几年没打下一州、或打得太久,下令和守方立约罢兵
    const commands = [];
    const chronicle = [];
    for (let i = 0; i < w.length; ) {
      const [, a, b, start, gain, asked] = w.slice(i, i + W);
      // 仗已经停了(亡国、别的缘故收了兵):不再记着
      if (!ps[a] || !ps[a].wars.includes(b)) {
        w.splice(i, W);
        continue;
      }
      const long = turn.year - start >= WEARY.years;
      const stuck = turn.year - gain >= WEARY.stall;
      if (asked < 0 && parliamentary(ps[a]) && ps[b].parent !== a && (long || stuck)) {
        commands.push({ kind: 'treaty', a, ps: [b], term: WEARY.term });
        const n = Math.round(turn.year - start);
        chronicle.push(
          gain > start
            ? { text: `{国:a}伐{国:b}久攻不下,议会厌战,遣使议和`, refs: { a, b } }
            : { text: `{国:a}伐{国:b},战${n}年不决,议会厌战,遣使议和`, refs: { a, b } },
        );
        w[i + 5] = turn.year;
      }
      i += W;
    }
    return { note: { w }, influences: { 'war.odds': odds }, ...(commands.length ? { commands, chronicle } : {}) };
  },
});
