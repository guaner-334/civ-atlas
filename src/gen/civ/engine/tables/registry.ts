import type { TableCard } from './cards';
import type { TableEngine } from './engine';

/**
 * 一次推演里各组数表的总登记:每组一个引擎,照旧各算各的;别处按「组名.表名」找表。
 * 只记引擎在哪,不碰它们的状态。
 */
export class TableRegistry {
  private readonly groups = new Map<string, TableEngine>();

  /** 登记一组(组名只用字母数字);同名的后登记的顶替先登记的 */
  add(group: string, eng: TableEngine): void {
    if (!/^[a-z][a-z0-9]*$/.test(group)) throw new Error(`数表组名 ${group} 只能用小写字母和数字`);
    this.groups.set(group, eng);
  }

  /** 某组的引擎;没登记 = undefined */
  engine(group: string): TableEngine | undefined {
    return this.groups.get(group);
  }

  /** 登记过的组名(按登记先后) */
  groupNames(): string[] {
    return [...this.groups.keys()];
  }

  private find(name: string): { eng: TableEngine; id: string } | undefined {
    const dot = name.indexOf('.');
    if (dot < 0) return undefined;
    const eng = this.groups.get(name.slice(0, dot));
    const id = name.slice(dot + 1);
    return eng?.card(id) ? { eng, id } : undefined;
  }

  /** 「组名.表名」的卡;没有 = undefined */
  card(name: string): TableCard | undefined {
    const f = this.find(name);
    return f && f.eng.card(f.id);
  }

  /** 「组名.表名」此刻的值(格 × 栏;只读;算一步会换数组,用时再取);没有 = undefined */
  get(name: string): Float64Array | undefined {
    const f = this.find(name);
    return f && f.eng.get(f.id);
  }

  /** 所有表的「组名.表名」(按组登记的先后,组里按卡的先后) */
  names(): string[] {
    const out: string[] = [];
    for (const [g, eng] of this.groups) for (const c of eng.cards) out.push(`${g}.${c.id}`);
    return out;
  }
}
