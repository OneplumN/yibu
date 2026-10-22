import { scheduleLocalSnapshotSync } from "./localSnapshotSync";
export { persistLocalSnapshotNow } from "./localSnapshotSync";

export function queueLocalSnapshotSync() {
  scheduleLocalSnapshotSync();
}
