import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";
import { StorageConflictError } from "./writeQueue";
import { DEFAULT_PREFERENCES } from "../constants";
import {
  sortByCreatedAtDesc,
  sortByUpdatedAtDesc,
  sortFocusRefs,
  type StorageAdapter,
} from "./storageAdapter";
import { sortProjects } from "../../types/project";
import type { FocusReference } from "../../types/focus";
import type { Preferences } from "../../types/preferences";
import type { Project } from "../../types/project";
import type { SavedReport } from "../../types/report";
import type { Task } from "../../types/task";

const SQLITE_URL = "sqlite:yibu.db";

type JsonRow = {
  payload_json: string;
};

let databasePromise: Promise<Database> | null = null;

function getSqliteDatabase() {
  databasePromise ??= Database.load(SQLITE_URL).catch((error: unknown) => {
    databasePromise = null;
    throw error;
  });
  return databasePromise;
}

function serializePayload(payload: unknown) {
  return JSON.stringify(payload);
}

function parsePayload<T>(row: JsonRow) {
  return JSON.parse(row.payload_json) as T;
}

async function selectPayloads<T>(sql: string, bindValues: unknown[] = []) {
  const db = await getSqliteDatabase();
  const rows = await db.select<JsonRow[]>(sql, bindValues);
  return rows.map((row) => parsePayload<T>(row));
}

async function selectPayload<T>(sql: string, bindValues: unknown[] = []) {
  const rows = await selectPayloads<T>(sql, bindValues);
  return rows[0];
}

function getCompletedAt(task: Task) {
  return task.completionWrapUp?.completedAt ?? null;
}

async function clearAll() {
  await getSqliteDatabase();
  await invoke("sqlite_atomic_write", { write: { kind: "clear" } });
}

async function ensureReady() {
  await getSqliteDatabase();
}

export const sqliteStorageAdapter: StorageAdapter = {
  async readSnapshot() {
    await ensureReady();
    return invoke("sqlite_read_snapshot");
  },
  async replaceSnapshot(snapshot) {
    await ensureReady();
    await invoke("sqlite_atomic_write", {
      write: { kind: "snapshot", snapshot },
    });
  },
  focusRefs: {
    async add(reference) {
      await ensureReady();
      const db = await getSqliteDatabase();
      await db.execute(
        "INSERT OR REPLACE INTO focus_refs (task_id, added_at, order_value, payload_json) VALUES ($1, $2, $3, $4)",
        [
          reference.taskId,
          reference.addedAt,
          reference.order ?? null,
          serializePayload(reference),
        ],
      );
      return reference;
    },
    async clear() {
      await ensureReady();
      const db = await getSqliteDatabase();
      await db.execute("DELETE FROM focus_refs");
    },
    async list() {
      await ensureReady();
      return sortFocusRefs(
        await selectPayloads<FocusReference>(
          "SELECT payload_json FROM focus_refs ORDER BY COALESCE(order_value, 2147483647), added_at ASC",
        ),
      );
    },
    async remove(taskId) {
      await ensureReady();
      const db = await getSqliteDatabase();
      await db.execute("DELETE FROM focus_refs WHERE task_id = $1", [taskId]);
    },
    async replaceAll(references, expected) {
      await ensureReady();
      const saved = await invoke<boolean>("sqlite_atomic_write", {
        write: { kind: "focus", references, expected },
      });
      if (!saved) throw new StorageConflictError();
      return references;
    },
  },
  preferences: {
    async load() {
      await ensureReady();
      return selectPayload<Preferences>(
        "SELECT payload_json FROM preferences WHERE id = $1",
        [DEFAULT_PREFERENCES.id],
      );
    },
    async save(preferences) {
      await ensureReady();
      const db = await getSqliteDatabase();
      await db.execute(
        "INSERT OR REPLACE INTO preferences (id, updated_at, payload_json) VALUES ($1, $2, $3)",
        [preferences.id, preferences.updatedAt, serializePayload(preferences)],
      );
      return preferences;
    },
  },
  projects: {
    async saveIfUnchanged(projects, expected) {
      await ensureReady();
      return invoke<boolean>("sqlite_atomic_write", {
        write: { kind: "projects", projects, expected },
      });
    },
    async delete(projectId) {
      await ensureReady();
      await invoke("sqlite_atomic_write", {
        write: { kind: "delete_project", project_id: projectId },
      });
    },
    async get(projectId) {
      await ensureReady();
      return selectPayload<Project>(
        "SELECT payload_json FROM projects WHERE id = $1",
        [projectId],
      );
    },
    async list() {
      await ensureReady();
      return sortProjects(
        await selectPayloads<Project>(
          "SELECT payload_json FROM projects ORDER BY updated_at DESC",
        ),
      );
    },
    async save(project) {
      await ensureReady();
      const db = await getSqliteDatabase();
      await db.execute(
        "INSERT OR REPLACE INTO projects (id, updated_at, payload_json) VALUES ($1, $2, $3)",
        [project.id, project.updatedAt, serializePayload(project)],
      );
      return project;
    },
  },
  reports: {
    async delete(reportId) {
      await ensureReady();
      const db = await getSqliteDatabase();
      await db.execute("DELETE FROM reports WHERE id = $1", [reportId]);
    },
    async get(reportId) {
      await ensureReady();
      return selectPayload<SavedReport>(
        "SELECT payload_json FROM reports WHERE id = $1",
        [reportId],
      );
    },
    async list() {
      await ensureReady();
      return sortByCreatedAtDesc(
        await selectPayloads<SavedReport>(
          "SELECT payload_json FROM reports ORDER BY created_at DESC",
        ),
      );
    },
    async save(report) {
      await ensureReady();
      const db = await getSqliteDatabase();
      await db.execute(
        "INSERT OR REPLACE INTO reports (id, type, created_at, payload_json) VALUES ($1, $2, $3, $4)",
        [report.id, report.type, report.createdAt, serializePayload(report)],
      );
      return report;
    },
  },
  async reset() {
    await clearAll();
  },
  tasks: {
    async saveIfUnchanged(task, expected) {
      await ensureReady();
      const db = await getSqliteDatabase();
      const result = await db.execute(
        "UPDATE tasks SET project_id=$1,status=$2,updated_at=$3,completed_at=$4,payload_json=$5 WHERE id=$6 AND payload_json=$7",
        [
          task.projectId,
          task.status,
          task.updatedAt,
          getCompletedAt(task),
          serializePayload(task),
          task.id,
          serializePayload(expected),
        ],
      );
      return result.rowsAffected === 1;
    },
    async delete(taskId) {
      await ensureReady();
      const db = await getSqliteDatabase();
      await db.execute("DELETE FROM tasks WHERE id = $1", [taskId]);
    },
    async get(taskId) {
      await ensureReady();
      return selectPayload<Task>(
        "SELECT payload_json FROM tasks WHERE id = $1",
        [taskId],
      );
    },
    async listAll() {
      await ensureReady();
      return sortByUpdatedAtDesc(
        await selectPayloads<Task>(
          "SELECT payload_json FROM tasks ORDER BY updated_at DESC",
        ),
      );
    },
    async listByIds(taskIds) {
      await ensureReady();
      const records = await Promise.all(
        taskIds.map((taskId) => this.get(taskId)),
      );
      return records.filter((task): task is Task => Boolean(task));
    },
    async listByProject(projectId) {
      await ensureReady();
      return sortByUpdatedAtDesc(
        await selectPayloads<Task>(
          "SELECT payload_json FROM tasks WHERE project_id = $1 ORDER BY updated_at DESC",
          [projectId],
        ),
      );
    },
    async save(task) {
      await ensureReady();
      const db = await getSqliteDatabase();
      await db.execute(
        "INSERT OR REPLACE INTO tasks (id, project_id, status, updated_at, completed_at, payload_json) VALUES ($1, $2, $3, $4, $5, $6)",
        [
          task.id,
          task.projectId,
          task.status,
          task.updatedAt,
          getCompletedAt(task),
          serializePayload(task),
        ],
      );
      return task;
    },
  },
};
