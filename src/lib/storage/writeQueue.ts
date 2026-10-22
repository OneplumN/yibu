import { recordDesktopError } from "../desktop/errorLog";

export class StorageConflictError extends Error {
  constructor() {
    super("数据刚被其他操作修改，请重试。");
  }
}

export function createWriteQueue() {
  let tail = Promise.resolve();
  return function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = tail.then(async () => {
      for (let attempt = 0; ; attempt += 1) {
        try {
          return await operation();
        } catch (error) {
          if (!(error instanceof StorageConflictError) || attempt >= 3) {
            recordDesktopError("storage_write_failed");
            throw error;
          }
        }
      }
    });
    tail = result.then(
      () => {},
      () => {},
    );
    return result;
  };
}
