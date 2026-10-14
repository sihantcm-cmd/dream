import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

/** One Node process owns a mounted data volume. Never share it across replicas. */
export function createPrivateState<T>(filename: string, initial: () => T) {
  let pending: Promise<unknown> = Promise.resolve();
  async function read(): Promise<T> {
    try { return JSON.parse(await readFile(filename, 'utf8')) as T; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return initial();
      throw new Error('Private state is unavailable. Restore its backup before continuing.');
    }
  }
  return {
    async read() { await pending; return read(); },
    change<R>(operation: (state: T) => R | Promise<R>): Promise<R> {
      const result = pending.then(async () => {
        const state = await read();
        const value = await operation(state);
        await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
        const temporary = `${filename}.${randomUUID()}.tmp`;
        try {
          await writeFile(temporary, JSON.stringify(state), { flag: 'wx', mode: 0o600 });
          for (let attempt = 0; ; attempt++) {
            try { await rename(temporary, filename); break; }
            catch (error) {
              if (attempt >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes((error as NodeJS.ErrnoException).code || '')) throw error;
              await delay(20 * 2 ** attempt);
            }
          }
        } finally { await unlink(temporary).catch(() => undefined); }
        return value;
      });
      pending = result.catch(() => undefined);
      return result;
    },
  };
}
