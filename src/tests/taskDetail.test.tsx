import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { TaskDetailPanel } from "../components/tasks/TaskDetailPanel";
import { resetDatabase } from "../lib/storage/db";
import { projectRepository } from "../lib/storage/projectRepository";
import { taskRepository } from "../lib/storage/taskRepository";
import { useFocusStore } from "../features/focus/focusStore";
import { useProjectStore } from "../features/projects/projectStore";
import { useTaskStore } from "../features/tasks/taskStore";
import { createProject } from "../types/project";
import { createChecklistItem, createTask } from "../types/task";
import { renderWithRouter } from "./test-utils";

describe("Task detail", () => {
  beforeEach(async () => {
    await resetDatabase();
    useProjectStore.setState({ isLoaded: true, projects: [] });
    useTaskStore.setState({ isLoaded: true, tasks: [] });
    useFocusStore.setState({ focusRefs: [], isLoaded: true });
  });

  test("renders a checklist-first modal and supports compact checklist editing", async () => {
    const project = createProject({ name: "Project Gamma" });
    const task = createTask({ projectId: project.id, title: "编写日报素材" });

    await projectRepository.save(project);
    await taskRepository.save(task);
    useProjectStore.setState({ isLoaded: true, projects: [project] });
    useTaskStore.setState({ isLoaded: true, tasks: [task] });

    const user = userEvent.setup();
    const onClose = vi.fn();
    const { container } = renderWithRouter(
      <TaskDetailPanel onClose={onClose} project={project} taskId={task.id} />,
    );

    expect(screen.getByRole("dialog", { name: "任务详情" })).toBeInTheDocument();
    expect(screen.getByText("清单")).toBeInTheDocument();
    expect(screen.getByText("Project Gamma")).toBeInTheDocument();
    expect(screen.getByDisplayValue("编写日报素材")).toBeInTheDocument();
    expect(screen.getByLabelText("标题")).toHaveAttribute("title", "编辑任务标题");
    expect(container.querySelector(".task-detail-modal__title-edit-icon")).not.toBeNull();
    expect(screen.getByRole("button", { name: "修改优先级：普通" })).toHaveAttribute(
      "title",
      "修改优先级",
    );
    expect(screen.getByRole("button", { name: "修改状态：待做" })).toHaveAttribute(
      "title",
      "修改状态",
    );
    expect(screen.getByRole("button", { name: "加入焦点" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "加入焦点" })).toHaveAttribute(
      "title",
      "加入今日焦点",
    );

    fireEvent.click(container.querySelector(".task-detail-backdrop") as HTMLElement);
    expect(onClose).not.toHaveBeenCalled();

    expect(screen.queryByPlaceholderText("添加子任务")).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText("标题"));
    await user.type(screen.getByLabelText("标题"), "编写日报与周报素材");
    await user.click(screen.getByRole("button", { name: "添加子任务" }));
    expect(screen.getByPlaceholderText("添加子任务")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "取消添加子任务" }));
    expect(screen.queryByPlaceholderText("添加子任务")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "添加子任务" }));
    await user.type(screen.getByPlaceholderText("添加子任务"), "补充完成说明{Enter}");
    await user.click(await screen.findByRole("button", { name: "补充完成说明" }));
    await user.clear(screen.getByLabelText("编辑子项"));
    await user.type(screen.getByLabelText("编辑子项"), "补充完成说明-已编辑");
    await user.click(screen.getByRole("button", { name: "添加子任务" }));
    await user.type(screen.getByPlaceholderText("添加子任务"), "同步周报提纲{Enter}");

    const firstRow = (await screen.findByText("补充完成说明-已编辑")).closest(".checklist-row");
    const secondRow = (await screen.findByText("同步周报提纲")).closest(".checklist-row");
    expect(firstRow).not.toBeNull();
    expect(secondRow).not.toBeNull();

    const secondDragHandle = (secondRow as HTMLElement).querySelector(".checklist-row__drag-handle");
    expect(secondDragHandle).not.toBeNull();

    fireEvent.dragStart(secondDragHandle as HTMLElement);
    fireEvent.dragOver(firstRow as HTMLElement);
    fireEvent.drop(firstRow as HTMLElement);
    fireEvent.dragEnd(secondRow as HTMLElement);

    await waitFor(() => {
      expect(useTaskStore.getState().tasks[0]?.checklist.map((item) => item.text)).toEqual([
        "同步周报提纲",
        "补充完成说明-已编辑",
      ]);
    });

    await user.click(within(firstRow as HTMLElement).getByRole("button", { name: "删除子项" }));

    await user.type(screen.getByLabelText("正文"), "完成了结构化草稿整理");
    await user.type(screen.getByLabelText("备注"), "日报可直接使用。");
    await user.click(screen.getByRole("button", { name: "保存并关闭" }));

    await waitFor(() => {
      const nextTask = useTaskStore.getState().tasks[0];
      expect(nextTask.title).toBe("编写日报与周报素材");
      expect(nextTask.body).toContain("完成了结构化草稿整理");
      expect(nextTask.notes).toContain("日报可直接使用。");
      expect(nextTask.checklist).toHaveLength(1);
    });
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    onClose.mockClear();

    await user.click(screen.getByRole("button", { name: "修改状态：待做" }));
    await user.click(screen.getByRole("button", { name: "已完成" }));
    await user.click(screen.getByRole("button", { name: "保存并关闭" }));

    await waitFor(() => {
      expect(useTaskStore.getState().tasks[0]?.status).toBe("done");
    });
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  test("shows completed checklist items inline with strike-through", async () => {
    const project = createProject({ name: "Project Folded" });
    const completedItem = { ...createChecklistItem("已经完成的长清单"), done: true };
    const pendingItem = createChecklistItem("仍需处理的清单");
    const task = {
      ...createTask({ projectId: project.id, title: "整理清单显示" }),
      checklist: [completedItem, pendingItem],
    };

    await projectRepository.save(project);
    await taskRepository.save(task);
    useProjectStore.setState({ isLoaded: true, projects: [project] });
    useTaskStore.setState({ isLoaded: true, tasks: [task] });

    renderWithRouter(<TaskDetailPanel onClose={vi.fn()} project={project} taskId={task.id} />);

    expect(screen.getByText("仍需处理的清单")).toBeInTheDocument();
    const completedText = screen.getByText("已经完成的长清单");
    expect(completedText).toBeInTheDocument();
    expect(completedText).toHaveClass("checklist-row__text--done");
    expect(screen.queryByRole("button", { name: "已完成 1 项" })).not.toBeInTheDocument();
  });
});
