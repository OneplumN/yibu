import { afterEach, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({ exportSnapshot: vi.fn() }));
vi.mock("../lib/export/exportSnapshot", () => ({
  exportSnapshot: mocks.exportSnapshot,
}));
vi.mock("../lib/platform/runtime", () => ({ isTauriRuntime: () => true }));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("desktop startup never replaces SQLite with the development JSON snapshot", async () => {
  vi.resetModules();
  vi.stubEnv("MODE", "development");
  vi.stubEnv("DEV", true);
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const { restoreLocalSnapshot } =
    await import("../lib/localPersistence/localSnapshotSync");
  await restoreLocalSnapshot();
  expect(fetch).not.toHaveBeenCalled();
});

test("serializes desktop development snapshot writes", async () => {
  vi.resetModules();
  vi.stubEnv("MODE", "development");
  vi.stubEnv("DEV", true);
  mocks.exportSnapshot
    .mockResolvedValueOnce({ revision: 1 })
    .mockResolvedValueOnce({ revision: 2 });
  let resolveFirst!: (value: Response) => void;
  const fetch = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveFirst = resolve;
        }),
    )
    .mockResolvedValueOnce(new Response("{}"));
  vi.stubGlobal("fetch", fetch);
  const { persistLocalSnapshotNow } =
    await import("../lib/localPersistence/localSnapshotSync");
  const first = persistLocalSnapshotNow();
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  const second = persistLocalSnapshotNow();
  await Promise.resolve();
  expect(fetch).toHaveBeenCalledTimes(1);
  resolveFirst(new Response("{}"));
  await Promise.all([first, second]);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ revision: 2 });
});

test("reports snapshot HTTP failures and permits the next save", async () => {
  vi.resetModules();
  vi.stubEnv("MODE", "development");
  vi.stubEnv("DEV", true);
  mocks.exportSnapshot.mockResolvedValue({ version: 1 });
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(new Response("disk full", { status: 500 }))
      .mockResolvedValueOnce(new Response("{}")),
  );
  const { persistLocalSnapshotNow } =
    await import("../lib/localPersistence/localSnapshotSync");
  await expect(persistLocalSnapshotNow()).rejects.toThrow("500");
  await expect(persistLocalSnapshotNow()).resolves.toBeUndefined();
});
