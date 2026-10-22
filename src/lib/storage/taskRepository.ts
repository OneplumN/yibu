import { getStorageAdapter } from "./getStorageAdapter";
import type { Task } from "../../types/task";

export const taskRepository = {
  async saveIfUnchanged(task: Task, expected: Task) {
    return getStorageAdapter().tasks.saveIfUnchanged(task, expected);
  },
  async delete(taskId: string) {
    await getStorageAdapter().tasks.delete(taskId);
  },

  async get(taskId: string) {
    return getStorageAdapter().tasks.get(taskId);
  },

  async listAll() {
    return getStorageAdapter().tasks.listAll();
  },

  async listByIds(taskIds: string[]) {
    return getStorageAdapter().tasks.listByIds(taskIds);
  },

  async listByProject(projectId: string) {
    return getStorageAdapter().tasks.listByProject(projectId);
  },

  async listCompletedBetween(rangeStart: string, rangeEnd: string) {
    const tasks = await this.listAll();
    return tasks.filter((task) => {
      if (task.status !== "done" || !task.completionWrapUp?.completedAt) {
        return false;
      }

      return (
        task.completionWrapUp.completedAt >= rangeStart &&
        task.completionWrapUp.completedAt <= rangeEnd
      );
    });
  },

  async save(task: Task) {
    return getStorageAdapter().tasks.save(task);
  },
};
