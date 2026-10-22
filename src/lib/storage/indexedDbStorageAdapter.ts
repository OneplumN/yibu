import { getDatabase, resetDatabase } from "./db";
import {
  sortByCreatedAtDesc,
  sortByUpdatedAtDesc,
  sortFocusRefs,
  type StorageAdapter,
} from "./storageAdapter";
import { sortProjects } from "../../types/project";
import type { Task } from "../../types/task";
import { StorageConflictError } from "./writeQueue";

export const indexedDbStorageAdapter: StorageAdapter = {
  async readSnapshot() {
    const db = await getDatabase();
    const tx = db.transaction(
      ["projects", "tasks", "focusRefs", "reports", "preferences"],
      "readonly",
    );
    const [projects, tasks, focusRefs, reports, preferences] =
      await Promise.all([
        tx.objectStore("projects").getAll(),
        tx.objectStore("tasks").getAll(),
        tx.objectStore("focusRefs").getAll(),
        tx.objectStore("reports").getAll(),
        tx.objectStore("preferences").get("preferences"),
      ]);
    await tx.done;
    return { projects, tasks, focusRefs, reports, preferences };
  },
  async replaceSnapshot(snapshot) {
    const db = await getDatabase();
    const tx = db.transaction(
      ["projects", "tasks", "focusRefs", "reports", "preferences"],
      "readwrite",
    );
    try {
      for (const name of [
        "projects",
        "tasks",
        "focusRefs",
        "reports",
        "preferences",
      ] as const) {
        await tx.objectStore(name).clear();
      }
      for (const project of snapshot.projects)
        await tx.objectStore("projects").put(project);
      for (const task of snapshot.tasks)
        await tx.objectStore("tasks").put(task);
      for (const ref of snapshot.focusRefs)
        await tx.objectStore("focusRefs").put(ref);
      for (const report of snapshot.reports)
        await tx.objectStore("reports").put(report);
      await tx.objectStore("preferences").put(snapshot.preferences);
      await tx.done;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        /* The request may have already aborted the transaction. */
      }
      await tx.done.catch(() => {});
      throw error;
    }
  },
  focusRefs: {
    async add(reference) {
      const db = await getDatabase();
      await db.put("focusRefs", reference);
      return reference;
    },
    async clear() {
      const db = await getDatabase();
      await db.clear("focusRefs");
    },
    async list() {
      const db = await getDatabase();
      return sortFocusRefs(await db.getAll("focusRefs"));
    },
    async remove(taskId) {
      const db = await getDatabase();
      await db.delete("focusRefs", taskId);
    },
    async replaceAll(references, expected) {
      const db = await getDatabase();
      const transaction = db.transaction("focusRefs", "readwrite");
      try {
        if (expected) {
          const canonical = (items: typeof references) =>
            JSON.stringify(
              [...items].sort((a, b) => a.taskId.localeCompare(b.taskId)),
            );
          if (
            canonical(await transaction.store.getAll()) !== canonical(expected)
          )
            throw new StorageConflictError();
        }
        await transaction.store.clear();
        for (const reference of references) {
          await transaction.store.put(reference);
        }
        await transaction.done;
      } catch (error) {
        try {
          transaction.abort();
        } catch {
          /* Already aborted. */
        }
        await transaction.done.catch(() => {});
        throw error;
      }
      return references;
    },
  },
  preferences: {
    async load() {
      const db = await getDatabase();
      return db.get("preferences", "preferences");
    },
    async save(preferences) {
      const db = await getDatabase();
      await db.put("preferences", preferences);
      return preferences;
    },
  },
  projects: {
    async saveIfUnchanged(projects, expected) {
      const db = await getDatabase();
      const tx = db.transaction("projects", "readwrite");
      try {
        for (const project of expected) {
          if (
            JSON.stringify(await tx.store.get(project.id)) !==
            JSON.stringify(project)
          ) {
            await tx.done;
            return false;
          }
        }
        for (const project of projects) await tx.store.put(project);
        await tx.done;
        return true;
      } catch (error) {
        try {
          tx.abort();
        } catch {
          /* Already aborted. */
        }
        await tx.done.catch(() => {});
        throw error;
      }
    },
    async delete(projectId) {
      const db = await getDatabase();
      const tx = db.transaction(
        ["projects", "tasks", "focusRefs"],
        "readwrite",
      );
      try {
        const tasks = await tx
          .objectStore("tasks")
          .index("by-projectId")
          .getAll(projectId);
        for (const task of tasks) {
          await tx.objectStore("focusRefs").delete(task.id);
          await tx.objectStore("tasks").delete(task.id);
        }
        await tx.objectStore("projects").delete(projectId);
        await tx.done;
      } catch (error) {
        try {
          tx.abort();
        } catch {
          /* Already aborted. */
        }
        await tx.done.catch(() => {});
        throw error;
      }
    },
    async get(projectId) {
      const db = await getDatabase();
      return db.get("projects", projectId);
    },
    async list() {
      const db = await getDatabase();
      return sortProjects(await db.getAll("projects"));
    },
    async save(project) {
      const db = await getDatabase();
      await db.put("projects", project);
      return project;
    },
  },
  reports: {
    async delete(reportId) {
      const db = await getDatabase();
      await db.delete("reports", reportId);
    },
    async get(reportId) {
      const db = await getDatabase();
      return db.get("reports", reportId);
    },
    async list() {
      const db = await getDatabase();
      return sortByCreatedAtDesc(await db.getAll("reports"));
    },
    async save(report) {
      const db = await getDatabase();
      await db.put("reports", report);
      return report;
    },
  },
  reset: resetDatabase,
  tasks: {
    async saveIfUnchanged(task, expected) {
      const db = await getDatabase();
      const tx = db.transaction("tasks", "readwrite");
      try {
        if (
          JSON.stringify(await tx.store.get(task.id)) !==
          JSON.stringify(expected)
        ) {
          await tx.done;
          return false;
        }
        await tx.store.put(task);
        await tx.done;
        return true;
      } catch (error) {
        try {
          tx.abort();
        } catch {
          /* Already aborted. */
        }
        await tx.done.catch(() => {});
        throw error;
      }
    },
    async delete(taskId) {
      const db = await getDatabase();
      await db.delete("tasks", taskId);
    },
    async get(taskId) {
      const db = await getDatabase();
      return db.get("tasks", taskId);
    },
    async listAll() {
      const db = await getDatabase();
      return sortByUpdatedAtDesc(await db.getAll("tasks"));
    },
    async listByIds(taskIds) {
      const db = await getDatabase();
      const records = await Promise.all(
        taskIds.map((taskId) => db.get("tasks", taskId)),
      );
      return records.filter((task): task is Task => Boolean(task));
    },
    async listByProject(projectId) {
      const db = await getDatabase();
      return sortByUpdatedAtDesc(
        await db.getAllFromIndex("tasks", "by-projectId", projectId),
      );
    },
    async save(task) {
      const db = await getDatabase();
      await db.put("tasks", task);
      return task;
    },
  },
};
