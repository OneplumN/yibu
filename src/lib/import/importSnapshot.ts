import { getStorageAdapter } from "../storage/getStorageAdapter";
import {
  normalizePreferences,
  preferenceRepository,
} from "../storage/preferenceRepository";
import type { AppSnapshot } from "../export/exportSnapshot";
import type { Preferences } from "../../types/preferences";

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("导入文件包含无效对象。");
  return value as Record<string, unknown>;
}
function text(
  value: unknown,
  name: string,
  nonempty = false,
): asserts value is string {
  if (typeof value !== "string" || (nonempty && !value.trim()))
    throw new Error(`导入字段无效：${name}`);
}
function date(value: unknown, name: string) {
  text(value, name, true);
  if (!Number.isFinite(Date.parse(value)))
    throw new Error(`导入日期无效：${name}`);
  return new Date(value).toISOString();
}
function records(value: unknown, name: string) {
  if (!Array.isArray(value)) throw new Error(`导入列表无效：${name}`);
  return value.map(object);
}
function unique(items: Record<string, unknown>[], field: string) {
  const ids = new Set<string>();
  for (const item of items) {
    const id = item[field];
    text(id, field, true);
    if (ids.has(id)) throw new Error(`导入标识重复：${field}`);
    ids.add(id);
  }
  return ids;
}
function strings(value: unknown, name: string) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
    throw new Error(`导入列表无效：${name}`);
}

export function parseSnapshot(input: unknown): AppSnapshot {
  const root = object(input);
  if (root.version !== 1) throw new Error("不支持的备份版本。");
  const projects = records(root.projects, "projects");
  const tasks = records(root.tasks, "tasks");
  const focusRefs = records(root.focusRefs, "focusRefs");
  const reports = records(root.reports, "reports");
  const projectIds = unique(projects, "id");
  const taskIds = unique(tasks, "id");
  unique(focusRefs, "taskId");
  unique(reports, "id");
  for (const project of projects) {
    for (const key of ["name", "description", "manualProgressNote"])
      text(project[key], key);
    if (
      project.manualProgressOverride !== null &&
      (typeof project.manualProgressOverride !== "number" ||
        !Number.isFinite(project.manualProgressOverride) ||
        project.manualProgressOverride < 0 ||
        project.manualProgressOverride > 100)
    )
      throw new Error("项目进度无效。");
    if (
      project.sortOrder !== undefined &&
      (typeof project.sortOrder !== "number" ||
        !Number.isFinite(project.sortOrder))
    )
      throw new Error("项目顺序无效。");
  }
  for (const task of tasks) {
    if (task.notes === undefined) task.notes = "";
    for (const key of ["projectId", "title", "body", "notes"])
      text(task[key], key);
    if (!projectIds.has(task.projectId as string))
      throw new Error("任务引用了不存在的项目。");
    if (
      !["todo", "in_progress", "blocked", "done"].includes(
        task.status as string,
      )
    )
      throw new Error("任务状态无效。");
    // Older v1 backups did not include priority.
    if (task.priority === undefined) task.priority = "normal";
    if (!["normal", "important", "urgent"].includes(task.priority as string))
      throw new Error("任务优先级无效。");
    const checklist = records(task.checklist, "checklist");
    unique(checklist, "id");
    for (const item of checklist) {
      text(item.text, "checklist.text");
      if (typeof item.done !== "boolean") throw new Error("清单完成状态无效。");
    }
    const logs = records(task.progressLog, "progressLog");
    unique(logs, "id");
    for (const log of logs) {
      text(log.content, "log.content");
      log.createdAt = date(log.createdAt, "log.createdAt");
    }
    if (task.completionWrapUp !== null) {
      const completion = object(task.completionWrapUp);
      for (const key of ["summary", "keyChanges", "notes"])
        text(completion[key], key);
      completion.completedAt = date(completion.completedAt, "completedAt");
    }
  }
  for (const ref of focusRefs) {
    if (!taskIds.has(ref.taskId as string))
      throw new Error("焦点引用了不存在的任务。");
    if (
      ref.order !== undefined &&
      (!Number.isInteger(ref.order) || (ref.order as number) < 0)
    )
      throw new Error("焦点顺序无效。");
    ref.addedAt = date(ref.addedAt, "addedAt");
  }
  for (const report of reports) {
    for (const key of ["title", "polishedContent"]) text(report[key], key);
    if (
      !["custom", "daily", "weekly", "monthly"].includes(report.type as string)
    )
      throw new Error("报告类型无效。");
    strings(report.sourceTaskIds, "sourceTaskIds");
    const draft = object(report.draft);
    text(draft.overview, "draft.overview");
    for (const key of ["blockers", "completedItems", "keyChanges", "nextSteps"])
      strings(draft[key], key);
    const start = date(report.rangeStart, "rangeStart"),
      end = date(report.rangeEnd, "rangeEnd");
    if (start > end) throw new Error("报告日期范围无效。");
    report.rangeStart = start;
    report.rangeEnd = end;
  }
  for (const item of [...projects, ...tasks, ...reports]) {
    item.createdAt = date(item.createdAt, "createdAt");
    item.updatedAt = date(item.updatedAt, "updatedAt");
  }
  const preferences = object(root.preferences);
  if (preferences.id !== undefined && preferences.id !== "preferences")
    throw new Error("设置标识无效。");
  for (const key of ["todayStepDocked", "todayStepPinned"]) {
    if (preferences[key] !== undefined && typeof preferences[key] !== "boolean")
      throw new Error("窗口设置无效。");
  }
  if (preferences.laneColors !== undefined) {
    const colors = object(preferences.laneColors);
    for (const key of ["task", "doing", "done"]) {
      if (
        colors[key] !== undefined &&
        (typeof colors[key] !== "string" ||
          !/^#[0-9a-f]{6}$/i.test(colors[key] as string))
      )
        throw new Error("颜色设置无效。");
    }
  }
  if (
    preferences.theme !== undefined &&
    !["light", "dark"].includes(preferences.theme as string)
  )
    throw new Error("主题设置无效。");
  for (const key of [
    "aiEndpoint",
    "aiKey",
    "aiRole",
    "activeAiProfileId",
    "activeAiRoleTemplateId",
    "todayStepShortcut",
  ]) {
    if (preferences[key] !== undefined) text(preferences[key], key);
  }
  if (preferences.aiProfiles !== undefined) {
    const profiles = records(preferences.aiProfiles, "aiProfiles");
    unique(profiles, "id");
    for (const profile of profiles) {
      for (const key of ["name", "endpoint", "apiKey"]) text(profile[key], key);
      for (const key of ["model", "modelsEndpoint", "extraBodyJson"])
        if (profile[key] !== undefined) text(profile[key], key);
      if (profile.models !== undefined) strings(profile.models, "models");
    }
  }
  if (preferences.updatedAt !== undefined)
    preferences.updatedAt = date(
      preferences.updatedAt,
      "preferences.updatedAt",
    );
  return {
    ...root,
    exportedAt: date(root.exportedAt, "exportedAt"),
    projects,
    tasks,
    focusRefs,
    reports,
    preferences: normalizePreferences(preferences as Partial<Preferences>),
  } as AppSnapshot;
}

export function validateSnapshot(snapshot: unknown): snapshot is AppSnapshot {
  try {
    parseSnapshot(structuredClone(snapshot));
    return true;
  } catch {
    return false;
  }
}

export async function importSnapshot(snapshot: unknown) {
  const parsed = parseSnapshot(structuredClone(snapshot));
  if (parsed.credentialsIncluded === false) {
    const current = await preferenceRepository.load();
    parsed.preferences.aiProfiles = parsed.preferences.aiProfiles.map(
      (profile) => {
        const existing = current.aiProfiles.find(
          (item) =>
            item.id === profile.id && item.endpoint === profile.endpoint,
        );
        return { ...profile, apiKey: existing?.apiKey ?? "" };
      },
    );
    parsed.preferences = normalizePreferences(parsed.preferences);
  }
  await getStorageAdapter().replaceSnapshot(parsed);
  return parsed;
}
