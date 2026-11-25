import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';

/**
 * Envoltorio mínimo sobre `node:sqlite` (SQLite integrado en Node ≥ 22.13 y en Electron).
 * Sin módulos nativos: JARVIS se instala en Windows sin herramientas de compilación y
 * el mismo código funciona en el núcleo independiente y dentro de la app de escritorio.
 * Expone solo la API que usa el proyecto (inspirada en better-sqlite3).
 */
type Params = SQLInputValue[] | [Record<string, SQLInputValue>];

export class Statement {
  constructor(private st: StatementSync) {}
  run(...p: Params): { changes: number; lastInsertRowid: number } {
    const r = this.st.run(...(p as SQLInputValue[]));
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
  }
  get(...p: Params): unknown {
    return this.st.get(...(p as SQLInputValue[]));
  }
  all(...p: Params): unknown[] {
    return this.st.all(...(p as SQLInputValue[]));
  }
  iterate(...p: Params): IterableIterator<unknown> {
    return this.st.iterate(...(p as SQLInputValue[])) as IterableIterator<unknown>;
  }
}

export class Database {
  private db: DatabaseSync;
  private depth = 0;
  private cache = new Map<string, Statement>();

  constructor(file: string) {
    this.db = new DatabaseSync(file);
  }

  prepare(sql: string): Statement {
    let st = this.cache.get(sql);
    if (!st) {
      st = new Statement(this.db.prepare(sql));
      if (this.cache.size < 500) this.cache.set(sql, st);
    }
    return st;
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  /** `pragma('user_version', { simple: true })` devuelve el valor; sin `simple`, las filas. */
  pragma(source: string, opts: { simple?: boolean } = {}): unknown {
    const rows = this.db.prepare(`PRAGMA ${source}`).all() as Record<string, unknown>[];
    if (!opts.simple) return rows;
    const first = rows[0];
    return first ? Object.values(first)[0] : undefined;
  }

  /** Devuelve una función que ejecuta `fn` en una transacción (anidable mediante SAVEPOINT). */
  transaction<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
    return (...args: A) => {
      const sp = `sp${this.depth}`;
      this.db.exec(this.depth === 0 ? 'BEGIN' : `SAVEPOINT ${sp}`);
      this.depth++;
      try {
        const r = fn(...args);
        this.depth--;
        this.db.exec(this.depth === 0 ? 'COMMIT' : `RELEASE ${sp}`);
        return r;
      } catch (err) {
        this.depth--;
        this.db.exec(this.depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
        throw err;
      }
    };
  }

  close(): void {
    this.cache.clear();
    this.db.close();
  }
}
