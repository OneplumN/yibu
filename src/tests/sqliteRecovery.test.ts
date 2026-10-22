import { expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ load: vi.fn(), select: vi.fn() }));
vi.mock("@tauri-apps/plugin-sql", () => ({ default: { load: mocks.load } }));
import { sqliteStorageAdapter } from "../lib/storage/sqliteStorageAdapter";

test("allows reopening desktop SQLite after a transient initialization failure", async () => {
  mocks.load
    .mockRejectedValueOnce(new Error("temporarily unavailable"))
    .mockResolvedValue({ select: mocks.select });
  mocks.select.mockResolvedValue([]);
  await expect(sqliteStorageAdapter.tasks.listAll()).rejects.toThrow(
    "temporarily unavailable",
  );
  await expect(sqliteStorageAdapter.tasks.listAll()).resolves.toEqual([]);
  expect(mocks.load).toHaveBeenCalledTimes(2);
});
