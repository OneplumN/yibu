import { getStorageAdapter } from "./getStorageAdapter";
import type { FocusReference } from "../../types/focus";

export const focusRepository = {
  async add(reference: FocusReference) {
    return getStorageAdapter().focusRefs.add(reference);
  },

  async clear() {
    await getStorageAdapter().focusRefs.clear();
  },

  async list() {
    return getStorageAdapter().focusRefs.list();
  },

  async remove(taskId: string) {
    await getStorageAdapter().focusRefs.remove(taskId);
  },

  async replaceAll(references: FocusReference[], expected?: FocusReference[]) {
    return getStorageAdapter().focusRefs.replaceAll(references, expected);
  },
};
