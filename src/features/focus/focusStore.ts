import { create } from "zustand";
import { queueLocalSnapshotSync } from "../../lib/localPersistence/localSnapshotApi";
import { focusRepository } from "../../lib/storage/focusRepository";
import type { FocusReference } from "../../types/focus";
import { createWriteQueue } from "../../lib/storage/writeQueue";

type FocusState = {
  addTask: (taskId: string) => Promise<void>;
  focusRefs: FocusReference[];
  isLoaded: boolean;
  loadFocus: () => Promise<FocusReference[]>;
  removeTask: (taskId: string) => Promise<void>;
  reorderTask: (taskId: string, toIndex: number) => Promise<void>;
  toggleTask: (taskId: string) => Promise<void>;
};

function normalizeFocusRefs(focusRefs: FocusReference[]) {
  return focusRefs.map((reference, index) => ({
    ...reference,
    order: index,
  }));
}

export const useFocusStore = create<FocusState>((set) => {
  const write = createWriteQueue();
  async function change(
    transform: (refs: FocusReference[]) => FocusReference[],
  ) {
    const expected = await focusRepository.list();
    const next = normalizeFocusRefs(transform([...expected]));
    await focusRepository.replaceAll(next, expected);
    set({ focusRefs: next });
    queueLocalSnapshotSync();
  }
  return {
    addTask: (taskId) =>
      write(async () =>
        change((refs) => {
          if (refs.some((ref) => ref.taskId === taskId)) return refs;
          return [
            ...refs,
            { taskId, addedAt: new Date().toISOString(), order: refs.length },
          ];
        }),
      ),
    focusRefs: [],
    isLoaded: false,
    async loadFocus() {
      const focusRefs = await focusRepository.list();
      set({ focusRefs, isLoaded: true });
      return focusRefs;
    },
    removeTask: (taskId) =>
      write(async () =>
        change((refs) => refs.filter((ref) => ref.taskId !== taskId)),
      ),
    reorderTask: (taskId, toIndex) =>
      write(async () =>
        change((refs) => {
          const from = refs.findIndex((ref) => ref.taskId === taskId);
          if (from < 0) return refs;
          const [moved] = refs.splice(from, 1);
          refs.splice(Math.max(0, Math.min(toIndex, refs.length)), 0, moved);
          return refs;
        }),
      ),
    toggleTask: (taskId) =>
      write(async () =>
        change((refs) =>
          refs.some((ref) => ref.taskId === taskId)
            ? refs.filter((ref) => ref.taskId !== taskId)
            : [
                ...refs,
                {
                  taskId,
                  addedAt: new Date().toISOString(),
                  order: refs.length,
                },
              ],
        ),
      ),
  };
});
