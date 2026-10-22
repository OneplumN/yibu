import { exportSnapshot, type AppSnapshot } from "../export/exportSnapshot";
import { importSnapshot, validateSnapshot } from "../import/importSnapshot";
import { isTauriRuntime } from "../platform/runtime";

const LOCAL_SNAPSHOT_ENDPOINT = "/api/local-snapshot";
const LOCAL_SYNC_DEBOUNCE_MS = 450;

let restorePromise: Promise<void> | null = null;
let syncTimeoutId: number | null = null;
let isRestoringLocalSnapshot = false;
let writeTail = Promise.resolve();

function canUseLocalSnapshotSync() {
  return import.meta.env.DEV && import.meta.env.MODE !== "test";
}

function hasSnapshotData(snapshot: AppSnapshot) {
  return (
    snapshot.projects.length > 0 ||
    snapshot.tasks.length > 0 ||
    snapshot.focusRefs.length > 0 ||
    snapshot.reports.length > 0
  );
}

async function readLocalSnapshot() {
  const response = await fetch(LOCAL_SNAPSHOT_ENDPOINT);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Local snapshot read failed (${response.status})`);
  }

  const snapshot = (await response.json()) as unknown;
  return validateSnapshot(snapshot) ? snapshot : null;
}

async function writeLocalSnapshot(snapshot: AppSnapshot) {
  const response = await fetch(LOCAL_SNAPSHOT_ENDPOINT, {
    body: JSON.stringify(snapshot),
    headers: {
      "Content-Type": "application/json",
    },
    method: "PUT",
  });
  if (!response.ok)
    throw new Error(`Local snapshot write failed (${response.status})`);
}

export function persistLocalSnapshotNow(): Promise<void> {
  if (!canUseLocalSnapshotSync()) return Promise.resolve();
  if (syncTimeoutId !== null) {
    window.clearTimeout(syncTimeoutId);
    syncTimeoutId = null;
  }
  const write = writeTail.then(async () =>
    writeLocalSnapshot(await exportSnapshot()),
  );
  writeTail = write.catch(() => {});
  return write;
}

export function scheduleLocalSnapshotSync() {
  if (!canUseLocalSnapshotSync() || isRestoringLocalSnapshot) {
    return;
  }

  if (syncTimeoutId !== null) {
    window.clearTimeout(syncTimeoutId);
  }

  syncTimeoutId = window.setTimeout(() => {
    syncTimeoutId = null;
    void persistLocalSnapshotNow().catch((error: unknown) => {
      console.warn("Local snapshot sync failed.", error);
    });
  }, LOCAL_SYNC_DEBOUNCE_MS);
}

export function restoreLocalSnapshot() {
  // Desktop SQLite is authoritative; a stale Vite snapshot must never replace it on startup.
  if (!canUseLocalSnapshotSync() || isTauriRuntime()) {
    return Promise.resolve();
  }

  restorePromise ??= (async () => {
    const localSnapshot = await readLocalSnapshot();
    const snapshotToRestore = localSnapshot ?? (await exportSnapshot());

    isRestoringLocalSnapshot = true;
    try {
      if (hasSnapshotData(snapshotToRestore)) {
        await importSnapshot(snapshotToRestore);
      }
    } finally {
      isRestoringLocalSnapshot = false;
    }

    if (!localSnapshot) {
      await writeLocalSnapshot(await exportSnapshot());
    }
  })();

  return restorePromise;
}
