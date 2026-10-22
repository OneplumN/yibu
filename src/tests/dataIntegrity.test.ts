import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { resetDatabase } from "../lib/storage/db";
import { exportSnapshot } from "../lib/export/exportSnapshot";
import { importSnapshot } from "../lib/import/importSnapshot";
import { projectRepository } from "../lib/storage/projectRepository";
import { taskRepository } from "../lib/storage/taskRepository";
import { focusRepository } from "../lib/storage/focusRepository";
import { preferenceRepository } from "../lib/storage/preferenceRepository";
import { useProjectStore } from "../features/projects/projectStore";
import { useFocusStore } from "../features/focus/focusStore";
import { useTaskStore } from "../features/tasks/taskStore";
import { indexedDbStorageAdapter } from "../lib/storage/indexedDbStorageAdapter";
import { createTask } from "../types/task";

beforeEach(async () => {
  await resetDatabase();
  useProjectStore.setState({ projects: [], isLoaded: true });
  useTaskStore.setState({ tasks: [], isLoaded: true });
  useFocusStore.setState({ focusRefs: [], isLoaded: true });
});
afterEach(() => vi.restoreAllMocks());

test.each([
  "orphanTask",
  "orphanFocus",
  "invalidDate",
  "duplicateId",
  "invalidChecklist",
  "invalidPreferences",
])("rejects %s before replacing any stored data", async (invalid) => {
  const project = await useProjectStore
    .getState()
    .createProject({ name: "original" });
  const task = await useTaskStore
    .getState()
    .createTask({ projectId: project.id, title: "original task" });
  const snapshot = await exportSnapshot();
  if (invalid === "orphanTask") snapshot.tasks[0].projectId = "missing";
  if (invalid === "orphanFocus")
    snapshot.focusRefs = [{ taskId: "missing", addedAt: task.createdAt }];
  if (invalid === "invalidDate") snapshot.projects[0].updatedAt = "invalid";
  if (invalid === "duplicateId")
    snapshot.projects.push({ ...snapshot.projects[0] });
  if (invalid === "invalidChecklist")
    snapshot.tasks[0].checklist = [
      { id: "bad", text: "bad", done: "yes" as never },
    ];
  if (invalid === "invalidPreferences")
    snapshot.preferences.theme = "bad" as never;
  await expect(importSnapshot(snapshot)).rejects.toThrow();
  expect((await projectRepository.list())[0].name).toBe("original");
  expect((await taskRepository.listAll())[0].projectId).toBe(project.id);
});

test("preserves project edits made concurrently", async () => {
  const project = await useProjectStore
    .getState()
    .createProject({ name: "original" });
  await Promise.all([
    useProjectStore.getState().updateProject(project.id, { name: "new" }),
    useProjectStore
      .getState()
      .updateProject(project.id, { description: "description" }),
  ]);
  expect(await projectRepository.get(project.id)).toMatchObject({
    name: "new",
    description: "description",
  });
});

test("deduplicates concurrent focus additions and serializes removal with additions", async () => {
  const project = await useProjectStore
    .getState()
    .createProject({ name: "focus" });
  const first = await useTaskStore
    .getState()
    .createTask({ projectId: project.id, title: "first" });
  const second = await useTaskStore
    .getState()
    .createTask({ projectId: project.id, title: "second" });
  await Promise.all([
    useFocusStore.getState().addTask(first.id),
    useFocusStore.getState().addTask(first.id),
  ]);
  expect(useFocusStore.getState().focusRefs).toHaveLength(1);
  await Promise.all([
    useFocusStore.getState().removeTask(first.id),
    useFocusStore.getState().addTask(second.id),
  ]);
  expect((await focusRepository.list()).map((ref) => ref.taskId)).toEqual([
    second.id,
  ]);
});

test("retries a task update after a conflicting persisted edit", async () => {
  const project = await useProjectStore
    .getState()
    .createProject({ name: "conflict" });
  const task = await useTaskStore
    .getState()
    .createTask({ projectId: project.id, title: "before" });
  const original = taskRepository.saveIfUnchanged.bind(taskRepository);
  vi.spyOn(taskRepository, "saveIfUnchanged").mockImplementationOnce(
    async (next, expected) => {
      await taskRepository.save({
        ...expected,
        body: "edit from another window",
      });
      return original(next, expected);
    },
  );
  await useTaskStore.getState().updateTask(task.id, { title: "after" });
  expect(await taskRepository.get(task.id)).toMatchObject({
    title: "after",
    body: "edit from another window",
  });
});

test("deletes a project together with associated tasks and focus", async () => {
  const project = await useProjectStore
    .getState()
    .createProject({ name: "delete" });
  const task = await useTaskStore
    .getState()
    .createTask({ projectId: project.id, title: "child" });
  await useFocusStore.getState().addTask(task.id);
  await projectRepository.delete(project.id);
  expect(await projectRepository.get(project.id)).toBeUndefined();
  expect(await taskRepository.listAll()).toHaveLength(0);
  expect(await focusRepository.list()).toHaveLength(0);
});

test("rolls back a synchronous focus replacement error", async () => {
  const original = { taskId: "original", addedAt: new Date().toISOString() };
  await focusRepository.add(original);
  await expect(
    indexedDbStorageAdapter.focusRefs.replaceAll([
      { taskId: "new", addedAt: original.addedAt },
      null,
    ] as never),
  ).rejects.toThrow();
  expect(await focusRepository.list()).toEqual([original]);
});

test("rejects stale conditional updates", async () => {
  const project = await useProjectStore
    .getState()
    .createProject({ name: "cas" });
  const task = createTask({ projectId: project.id, title: "old" });
  await taskRepository.save(task);
  expect(
    await taskRepository.saveIfUnchanged({ ...task, title: "first" }, task),
  ).toBe(true);
  expect(
    await taskRepository.saveIfUnchanged({ ...task, title: "stale" }, task),
  ).toBe(false);
  expect((await taskRepository.get(task.id))?.title).toBe("first");
});

test("export excludes API keys and same-device restore preserves matching local credentials", async () => {
  const preferences = await preferenceRepository.load();
  preferences.aiProfiles[0].apiKey = "private-test-key";
  await preferenceRepository.save(preferences);
  const snapshot = await exportSnapshot();
  expect(JSON.stringify(snapshot)).not.toContain("private-test-key");
  expect(snapshot.credentialsIncluded).toBe(false);
  await importSnapshot(snapshot);
  expect((await preferenceRepository.load()).aiProfiles[0].apiKey).toBe(
    "private-test-key",
  );
  expect(
    JSON.stringify(await exportSnapshot({ includeSecrets: true })),
  ).toContain("private-test-key");
});
