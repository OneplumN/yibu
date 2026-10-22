import { create } from "zustand";
import { queueLocalSnapshotSync } from "../../lib/localPersistence/localSnapshotApi";
import { taskRepository } from "../../lib/storage/taskRepository";
import { StorageConflictError } from "../../lib/storage/writeQueue";
import { recordDesktopError } from "../../lib/desktop/errorLog";
import {
  appendTaskLog,
  completeTask,
  createChecklistItem,
  createTask,
  moveChecklistItem,
  moveChecklistItemToIndex,
  removeChecklistItem,
  type Task,
  type TaskCreateInput,
  type TaskPriority,
  type TaskStatus,
  updateChecklistItemText,
} from "../../types/task";

type CompletionInput = {
  keyChanges: string;
  notes: string;
  summary: string;
};

type TaskState = {
  addChecklistItem: (taskId: string, text: string) => Promise<Task | null>;
  appendProgressLog: (taskId: string, content: string) => Promise<Task | null>;
  completeTask: (
    taskId: string,
    input: CompletionInput,
  ) => Promise<Task | null>;
  createTask: (input: TaskCreateInput) => Promise<Task>;
  isLoaded: boolean;
  loadTasks: () => Promise<Task[]>;
  moveChecklistItem: (
    taskId: string,
    itemId: string,
    direction: "up" | "down",
  ) => Promise<Task | null>;
  moveChecklistItemToIndex: (
    taskId: string,
    itemId: string,
    toIndex: number,
  ) => Promise<Task | null>;
  removeTask: (taskId: string) => Promise<void>;
  removeChecklistItem: (taskId: string, itemId: string) => Promise<Task | null>;
  restoreTask: (task: Task) => Promise<Task>;
  setPriority: (taskId: string, priority: TaskPriority) => Promise<Task | null>;
  setStatus: (taskId: string, status: TaskStatus) => Promise<Task | null>;
  tasks: Task[];
  toggleChecklistItem: (taskId: string, itemId: string) => Promise<Task | null>;
  updateChecklistItemText: (
    taskId: string,
    itemId: string,
    text: string,
  ) => Promise<Task | null>;
  updateTask: (
    taskId: string,
    update: Partial<Pick<Task, "body" | "notes" | "title">>,
  ) => Promise<Task | null>;
};

function replaceTask(tasks: Task[], nextTask: Task) {
  return tasks.map((task) => (task.id === nextTask.id ? nextTask : task));
}

async function saveTask(next: Task, expected: Task) {
  if (!(await taskRepository.saveIfUnchanged(next, expected)))
    throw new StorageConflictError();
}

function serializeTaskMutations(
  state: TaskState,
  refresh: (id: string) => Promise<void>,
): TaskState {
  const queues = new Map<string, Promise<void>>();
  function serialize<Args extends [string, ...unknown[]], Result>(
    action: (...args: Args) => Promise<Result>,
  ) {
    return (...args: Args): Promise<Result> => {
      const taskId = args[0];
      const result = (queues.get(taskId) ?? Promise.resolve()).then(
        async () => {
          for (let attempt = 0; ; attempt += 1) {
            await refresh(taskId);
            try {
              return await action(...args);
            } catch (error) {
              if (!(error instanceof StorageConflictError) || attempt >= 3) {
                recordDesktopError("storage_write_failed");
                throw error;
              }
            }
          }
        },
      );
      // A failed write must not block later edits to the same task.
      const settled = result.then(
        () => {},
        () => {},
      );
      queues.set(taskId, settled);
      void settled.then(() => {
        if (queues.get(taskId) === settled) queues.delete(taskId);
      });
      return result;
    };
  }
  state.addChecklistItem = serialize(state.addChecklistItem);
  state.appendProgressLog = serialize(state.appendProgressLog);
  state.completeTask = serialize(state.completeTask);
  state.moveChecklistItem = serialize(state.moveChecklistItem);
  state.moveChecklistItemToIndex = serialize(state.moveChecklistItemToIndex);
  state.removeTask = serialize(state.removeTask);
  state.removeChecklistItem = serialize(state.removeChecklistItem);
  state.setPriority = serialize(state.setPriority);
  state.setStatus = serialize(state.setStatus);
  state.toggleChecklistItem = serialize(state.toggleChecklistItem);
  state.updateChecklistItemText = serialize(state.updateChecklistItemText);
  state.updateTask = serialize(state.updateTask);
  const restoreTask = state.restoreTask;
  const restore = serialize((_taskId: string, task: Task) => restoreTask(task));
  state.restoreTask = (task) => restore(task.id, task);
  return state;
}

export const useTaskStore = create<TaskState>((set, get) =>
  serializeTaskMutations(
    {
      async addChecklistItem(taskId, text) {
        const task = get().tasks.find((item) => item.id === taskId);
        const trimmed = text.trim();

        if (!task || !trimmed) {
          return null;
        }

        const nextTask: Task = {
          ...task,
          checklist: [...task.checklist, createChecklistItem(trimmed)],
          updatedAt: new Date().toISOString(),
        };
        await saveTask(nextTask, task);
        set({ tasks: replaceTask(get().tasks, nextTask) });
        queueLocalSnapshotSync();
        return nextTask;
      },
      async appendProgressLog(taskId, content) {
        const task = get().tasks.find((item) => item.id === taskId);
        if (!task) {
          return null;
        }
        const nextTask = appendTaskLog(task, content);
        await saveTask(nextTask, task);
        set({ tasks: replaceTask(get().tasks, nextTask) });
        queueLocalSnapshotSync();
        return nextTask;
      },
      async completeTask(taskId, input) {
        const task = get().tasks.find((item) => item.id === taskId);
        if (!task) {
          return null;
        }
        const nextTask = completeTask(task, input);
        await saveTask(nextTask, task);
        set({ tasks: replaceTask(get().tasks, nextTask) });
        queueLocalSnapshotSync();
        return nextTask;
      },
      async createTask(input) {
        const task = createTask(input);
        await taskRepository.save(task);
        set({ tasks: [task, ...get().tasks] });
        queueLocalSnapshotSync();
        return task;
      },
      isLoaded: false,
      async loadTasks() {
        const tasks = await taskRepository.listAll();
        set({ isLoaded: true, tasks });
        return tasks;
      },
      async moveChecklistItem(taskId, itemId, direction) {
        const task = get().tasks.find((item) => item.id === taskId);
        if (!task) {
          return null;
        }
        const nextTask = moveChecklistItem(task, itemId, direction);
        await saveTask(nextTask, task);
        set({ tasks: replaceTask(get().tasks, nextTask) });
        queueLocalSnapshotSync();
        return nextTask;
      },
      async moveChecklistItemToIndex(taskId, itemId, toIndex) {
        const task = get().tasks.find((item) => item.id === taskId);
        if (!task) {
          return null;
        }
        const nextTask = moveChecklistItemToIndex(task, itemId, toIndex);
        await saveTask(nextTask, task);
        set({ tasks: replaceTask(get().tasks, nextTask) });
        queueLocalSnapshotSync();
        return nextTask;
      },
      async removeTask(taskId) {
        await taskRepository.delete(taskId);
        set({ tasks: get().tasks.filter((task) => task.id !== taskId) });
        queueLocalSnapshotSync();
      },
      async removeChecklistItem(taskId, itemId) {
        const task = get().tasks.find((item) => item.id === taskId);
        if (!task) {
          return null;
        }
        const nextTask = removeChecklistItem(task, itemId);
        await saveTask(nextTask, task);
        set({ tasks: replaceTask(get().tasks, nextTask) });
        queueLocalSnapshotSync();
        return nextTask;
      },
      async restoreTask(task) {
        await taskRepository.save(task);
        const exists = get().tasks.some((item) => item.id === task.id);
        set({
          tasks: exists
            ? replaceTask(get().tasks, task)
            : [...get().tasks, task],
        });
        queueLocalSnapshotSync();
        return task;
      },
      async setPriority(taskId, priority) {
        const task = get().tasks.find((item) => item.id === taskId);
        if (!task) {
          return null;
        }
        const nextTask: Task = {
          ...task,
          priority,
          updatedAt: new Date().toISOString(),
        };
        await saveTask(nextTask, task);
        set({ tasks: replaceTask(get().tasks, nextTask) });
        queueLocalSnapshotSync();
        return nextTask;
      },
      async setStatus(taskId, status) {
        const task = get().tasks.find((item) => item.id === taskId);
        if (!task) {
          return null;
        }
        const now = new Date().toISOString();
        const nextTask: Task = {
          ...task,
          completionWrapUp:
            status === "done"
              ? (task.completionWrapUp ?? {
                  completedAt: now,
                  keyChanges: "",
                  notes: "",
                  summary: "",
                })
              : null,
          status,
          updatedAt: now,
        };
        await saveTask(nextTask, task);
        set({ tasks: replaceTask(get().tasks, nextTask) });
        queueLocalSnapshotSync();
        return nextTask;
      },
      tasks: [],
      async toggleChecklistItem(taskId, itemId) {
        const task = get().tasks.find((item) => item.id === taskId);
        if (!task) {
          return null;
        }
        const nextTask: Task = {
          ...task,
          checklist: task.checklist.map((item) =>
            item.id === itemId ? { ...item, done: !item.done } : item,
          ),
          updatedAt: new Date().toISOString(),
        };
        await saveTask(nextTask, task);
        set({ tasks: replaceTask(get().tasks, nextTask) });
        queueLocalSnapshotSync();
        return nextTask;
      },
      async updateChecklistItemText(taskId, itemId, text) {
        const task = get().tasks.find((item) => item.id === taskId);
        if (!task) {
          return null;
        }
        const nextTask = updateChecklistItemText(task, itemId, text);
        await saveTask(nextTask, task);
        set({ tasks: replaceTask(get().tasks, nextTask) });
        queueLocalSnapshotSync();
        return nextTask;
      },
      async updateTask(taskId, update) {
        const task = get().tasks.find((item) => item.id === taskId);
        if (!task) {
          return null;
        }
        const nextTask: Task = {
          ...task,
          body: update.body === undefined ? task.body : update.body.trim(),
          notes: update.notes === undefined ? task.notes : update.notes.trim(),
          title: update.title === undefined ? task.title : update.title.trim(),
          updatedAt: new Date().toISOString(),
        };
        await saveTask(nextTask, task);
        set({ tasks: replaceTask(get().tasks, nextTask) });
        queueLocalSnapshotSync();
        return nextTask;
      },
    },
    async (taskId) => {
      const current = await taskRepository.get(taskId);
      set({
        tasks: current
          ? get().tasks.some((task) => task.id === taskId)
            ? replaceTask(get().tasks, current)
            : [...get().tasks, current]
          : get().tasks.filter((task) => task.id !== taskId),
      });
    },
  ),
);
