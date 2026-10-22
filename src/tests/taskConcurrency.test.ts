import { beforeEach, expect, test, vi } from "vitest";
import { resetDatabase } from "../lib/storage/db";
import { useTaskStore } from "../features/tasks/taskStore";
import { useProjectStore } from "../features/projects/projectStore";
import { taskRepository } from "../lib/storage/taskRepository";

beforeEach(async () => {
  await resetDatabase();
  useTaskStore.setState({ tasks: [], isLoaded: true });
  useProjectStore.setState({ projects: [], isLoaded: true });
});

test("preserves concurrent checklist changes in memory and storage", async () => {
  const project = await useProjectStore
    .getState()
    .createProject({ name: "audit" });
  const task = await useTaskStore
    .getState()
    .createTask({ projectId: project.id, title: "audit" });
  await useTaskStore.getState().addChecklistItem(task.id, "one");
  await useTaskStore.getState().addChecklistItem(task.id, "two");
  const items = useTaskStore.getState().tasks[0].checklist;
  await Promise.all(
    items.map((item) =>
      useTaskStore.getState().toggleChecklistItem(task.id, item.id),
    ),
  );
  expect(
    useTaskStore.getState().tasks[0].checklist.filter((item) => item.done),
  ).toHaveLength(2);
  expect(
    (await taskRepository.listAll())[0].checklist.filter((item) => item.done),
  ).toHaveLength(2);
});

test("allows another edit after a failed write", async () => {
  const project = await useProjectStore
    .getState()
    .createProject({ name: "audit" });
  const task = await useTaskStore
    .getState()
    .createTask({ projectId: project.id, title: "audit" });
  const save = vi
    .spyOn(taskRepository, "saveIfUnchanged")
    .mockRejectedValueOnce(new Error("write failed"));
  try {
    await expect(
      useTaskStore.getState().setPriority(task.id, "urgent"),
    ).rejects.toThrow("write failed");
    await useTaskStore
      .getState()
      .updateTask(task.id, { title: "saved after failure" });
    expect(useTaskStore.getState().tasks[0].title).toBe("saved after failure");
  } finally {
    save.mockRestore();
  }
});
