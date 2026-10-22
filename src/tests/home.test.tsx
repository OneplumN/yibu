import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { App } from "../app/App";
import { focusRepository } from "../lib/storage/focusRepository";
import { resetDatabase } from "../lib/storage/db";
import { projectRepository } from "../lib/storage/projectRepository";
import { taskRepository } from "../lib/storage/taskRepository";
import { useFocusStore } from "../features/focus/focusStore";
import { useProjectStore } from "../features/projects/projectStore";
import { useReportStore } from "../features/reports/reportStore";
import { useTaskStore } from "../features/tasks/taskStore";
import { createProject } from "../types/project";
import { completeTask, createChecklistItem, createTask } from "../types/task";
import { renderWithRouter } from "./test-utils";

function dispatchPointerWindowEvent(
  type: "pointerdown" | "pointermove" | "pointerup",
  init: { clientX: number; clientY: number; pointerId: number },
  target: EventTarget = window,
) {
  const event = new Event(type, {
    bubbles: true,
    cancelable: true,
  });

  Object.defineProperties(event, {
    clientX: { value: init.clientX },
    clientY: { value: init.clientY },
    button: { value: 0 },
    pointerId: { value: init.pointerId },
  });

  target.dispatchEvent(event);
}

describe("Home dashboard", () => {
  beforeEach(async () => {
    await resetDatabase();
    useProjectStore.setState({ isLoaded: false, projects: [] });
    useTaskStore.setState({ isLoaded: false, tasks: [] });
    useFocusStore.setState({ focusRefs: [], isLoaded: false });
    useReportStore.setState({ isLoaded: false, reports: [] });
  });

  test("renders Today Focus as a compact execution list", async () => {
    const project = createProject({ name: "Project Alpha" }, "2026-04-23T08:00:00.000Z");
    const longTitle =
      "设计首页摘要任务标题特别长特别长特别长特别长特别长，用来验证方卡在长标题下仍保持固定高度和稳定分区";
    const task = createTask(
      { projectId: project.id, title: longTitle },
      "2026-04-23T08:05:00.000Z",
    );
    const blockedTask = {
      ...createTask(
        { projectId: project.id, title: "等待接口确认" },
        "2026-04-23T08:07:00.000Z",
      ),
      status: "blocked" as const,
    };
    const completed = completeTask(
      createTask(
        { projectId: project.id, title: "完成接口梳理" },
        "2026-04-23T08:10:00.000Z",
      ),
      {
        keyChanges: "整理字段",
        notes: "",
        summary: "接口梳理完成",
      },
      "2026-04-23T09:00:00.000Z",
    );

    await projectRepository.save(project);
    const taskWithTasklist = {
      ...task,
      checklist: [
        createChecklistItem("收敛视觉层级"),
        createChecklistItem("补充焦点交互"),
        createChecklistItem("确认任务详情结构"),
        createChecklistItem("补充回归测试"),
      ],
      priority: "important" as const,
      status: "in_progress" as const,
    };

    await taskRepository.save(taskWithTasklist);
    await taskRepository.save(blockedTask);
    await taskRepository.save(completed);
    await focusRepository.add({
      addedAt: "2026-04-23T08:15:00.000Z",
      taskId: task.id,
    });
    await focusRepository.add({
      addedAt: "2026-04-23T08:16:00.000Z",
      taskId: blockedTask.id,
    });
    await focusRepository.add({
      addedAt: "2026-04-23T08:17:00.000Z",
      taskId: completed.id,
    });

    const user = userEvent.setup();
    const { container } = renderWithRouter(<App />);

    await screen.findByRole("heading", { level: 2, name: "Today" });
    const focusCard = screen.getByRole("group", { name: `焦点任务：${longTitle}` }).closest(".focus-card");
    expect(focusCard).not.toBeNull();
    const focusWithin = within(focusCard as HTMLElement);
    expect(focusWithin.getByText("重要")).toBeInTheDocument();
    expect(
      focusWithin.getByText(/设计首页摘要任务标题特别长特别长特别长特别长特别长/),
    ).toBeInTheDocument();
    expect(focusWithin.getByText("清单")).toBeInTheDocument();
    expect(focusWithin.getByText("收敛视觉层级")).toBeInTheDocument();
    expect(focusWithin.getByText("补充焦点交互")).toBeInTheDocument();
    expect(focusWithin.getByText("确认任务详情结构")).toBeInTheDocument();
    expect(focusWithin.queryByText("补充回归测试")).not.toBeInTheDocument();
    expect(focusWithin.getByText("0/4")).toBeInTheDocument();
    expect(focusWithin.queryByText("+1")).not.toBeInTheDocument();
    const priorityButton = focusWithin.getByRole("button", { name: "修改优先级：重要" });
    expect(priorityButton).toBeInTheDocument();
    await user.click(priorityButton);
    expect(focusWithin.getAllByRole("menuitemradio")).toHaveLength(3);
    await user.keyboard("{Escape}");
    expect(focusWithin.queryByRole("menu")).not.toBeInTheDocument();
    expect(priorityButton).toHaveFocus();
    await user.click(priorityButton);
    await user.click(screen.getByRole("heading", { name: "Today" }));
    expect(focusWithin.queryByRole("menu")).not.toBeInTheDocument();
    const editButton = focusWithin.getByRole("button", { name: "编辑" });
    expect(editButton).toBeInTheDocument();
    expect(focusWithin.getByRole("button", { name: "完成" })).toBeInTheDocument();
    expect(focusWithin.getByRole("button", { name: "移出" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "焦点任务：完成接口梳理" })).not.toBeInTheDocument();

    const blockedCard = screen.getByRole("group", { name: "焦点任务：等待接口确认" }).closest(".focus-card");
    expect(blockedCard).not.toBeNull();
    expect(within(blockedCard as HTMLElement).getByText("阻塞")).toBeInTheDocument();
    const elementFromPoint = vi.fn(() => focusCard as HTMLElement);
    Object.defineProperty(focusCard as HTMLElement, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        bottom: 420,
        height: 240,
        left: 80,
        right: 240,
        top: 180,
        width: 160,
        x: 80,
        y: 180,
        toJSON: () => ({}),
      }),
    });
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: elementFromPoint,
    });
    dispatchPointerWindowEvent("pointerdown", {
      clientX: 300,
      clientY: 300,
      pointerId: 1,
    }, blockedCard as HTMLElement);
    dispatchPointerWindowEvent("pointermove", {
      clientX: 120,
      clientY: 200,
      pointerId: 1,
    });
    dispatchPointerWindowEvent("pointerup", {
      clientX: 120,
      clientY: 200,
      pointerId: 1,
    });
    elementFromPoint.mockReset();

    await waitFor(() => {
      expect(useFocusStore.getState().focusRefs[0]?.taskId).toBe(blockedTask.id);
      const cards = Array.from(container.querySelectorAll(".focus-card"));
      expect(cards[0]).toHaveTextContent("等待接口确认");
    });

    const orderBeforeButtonDrag = useFocusStore.getState().focusRefs.map((ref) => ref.taskId);
    const ignoredElementFromPoint = vi.fn(() => blockedCard as HTMLElement);
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: ignoredElementFromPoint,
    });
    dispatchPointerWindowEvent("pointerdown", {
      clientX: 120,
      clientY: 300,
      pointerId: 2,
    }, editButton);
    dispatchPointerWindowEvent("pointermove", {
      clientX: 320,
      clientY: 300,
      pointerId: 2,
    });
    dispatchPointerWindowEvent("pointerup", {
      clientX: 320,
      clientY: 300,
      pointerId: 2,
    });
    ignoredElementFromPoint.mockReset();
    expect(useFocusStore.getState().focusRefs.map((ref) => ref.taskId)).toEqual(
      orderBeforeButtonDrag,
    );

    await user.click(editButton);
    expect(await screen.findByRole("dialog", { name: "任务详情" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "关闭任务详情" }));

    await user.click(priorityButton);
    await user.click(screen.getByRole("menuitemradio", { name: "紧急" }));
    await waitFor(() => {
      expect(useTaskStore.getState().tasks.find((item) => item.id === task.id)?.priority).toBe("urgent");
      expect(within(focusCard as HTMLElement).getByText("紧急")).toBeInTheDocument();
    });

    await user.click(focusWithin.getByRole("button", { name: "完成" }));
    await waitFor(() => {
      expect(useFocusStore.getState().focusRefs.some((ref) => ref.taskId === task.id)).toBe(false);
      expect(useTaskStore.getState().tasks.find((item) => item.id === task.id)?.status).toBe("done");
      expect(screen.queryByRole("group", { name: `焦点任务：${longTitle}` })).not.toBeInTheDocument();
      expect(screen.getByText("任务已完成")).toBeInTheDocument();
    });

    await user.click(within(blockedCard as HTMLElement).getByRole("button", { name: "移出" }));
    await waitFor(() => {
      expect(screen.queryByText("等待接口确认")).not.toBeInTheDocument();
      expect(screen.getByText("任务已移出今日焦点")).toBeInTheDocument();
    });
  });

  test("edits project metadata from overview and opens unified project progress", async () => {
    const project = createProject(
      {
        description: "旧项目笔记",
        name: "Project Editable",
      },
      "2026-04-23T08:00:00.000Z",
    );

    await projectRepository.save(project);

    const user = userEvent.setup();
    renderWithRouter(<App />);

    await screen.findByRole("heading", { level: 2, name: "Projects" });
    await user.click(screen.getByRole("button", { name: "编辑" }));
    expect(await screen.findByRole("dialog", { name: "编辑项目" })).toBeInTheDocument();

    await user.clear(screen.getByLabelText("项目名称"));
    await user.type(screen.getByLabelText("项目名称"), "Project Edited");
    await user.clear(screen.getByLabelText("项目笔记"));
    await user.type(screen.getByLabelText("项目笔记"), "更新后的项目笔记");
    await user.click(screen.getByRole("button", { name: "保存项目" }));

    await waitFor(() => {
      expect(useProjectStore.getState().projects[0]?.name).toBe("Project Edited");
      expect(useProjectStore.getState().projects[0]?.description).toBe("更新后的项目笔记");
      expect(screen.getByText("Project Edited")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "进入" }));
    const projectNav = await screen.findByRole("navigation", { name: "项目" });
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(within(projectNav).getByRole("button", { name: "Project Edited" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "TASK" })).toBeInTheDocument();
    expect(screen.queryByText("更新后的项目笔记")).not.toBeInTheDocument();
  });

  test("closes project creation modal with Escape", async () => {
    const user = userEvent.setup();
    renderWithRouter(<App />);

    await screen.findByRole("heading", { level: 2, name: "Projects" });
    await user.click(screen.getByRole("button", { name: "新建项目" }));
    expect(screen.getByRole("dialog", { name: "新建项目" })).toBeInTheDocument();

    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "新建项目" })).not.toBeInTheDocument();
    });
  });

  test("reorders project overview cards by dragging the card body", async () => {
    const firstProject = createProject(
      {
        name: "Project First",
      },
      "2026-04-23T08:00:00.000Z",
    );
    const secondProject = createProject(
      {
        name: "Project Second",
      },
      "2026-04-23T09:00:00.000Z",
    );

    await projectRepository.save(firstProject);
    await projectRepository.save(secondProject);

    const { container } = renderWithRouter(<App />);
    await screen.findByRole("heading", { level: 2, name: "Projects" });

    const projectCards = () => Array.from(container.querySelectorAll<HTMLElement>(".project-card"));
    const firstCard = projectCards().find((card) => card.textContent?.includes("Project First"));
    const secondCard = projectCards().find((card) => card.textContent?.includes("Project Second"));
    expect(firstCard).toBeDefined();
    expect(secondCard).toBeDefined();

    Object.defineProperty(secondCard, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        bottom: 220,
        height: 140,
        left: 0,
        right: 360,
        top: 80,
        width: 360,
        x: 0,
        y: 80,
        toJSON: () => ({}),
      }),
    });
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => secondCard as HTMLElement),
    });

    dispatchPointerWindowEvent("pointerdown", {
      clientX: 120,
      clientY: 120,
      pointerId: 10,
    }, firstCard as HTMLElement);
    dispatchPointerWindowEvent("pointermove", {
      clientX: 120,
      clientY: 100,
      pointerId: 10,
    });
    dispatchPointerWindowEvent("pointerup", {
      clientX: 120,
      clientY: 100,
      pointerId: 10,
    });

    await waitFor(() => {
      expect(useProjectStore.getState().projects[0]?.id).toBe(firstProject.id);
    });

    const orderedProjects = await projectRepository.list();
    expect(orderedProjects[0]?.id).toBe(firstProject.id);
  });
});
