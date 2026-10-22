import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { App } from "../app/App";
import { DEFAULT_PREFERENCES } from "../lib/constants";
import { resetDatabase } from "../lib/storage/db";
import { preferenceRepository } from "../lib/storage/preferenceRepository";
import { projectRepository } from "../lib/storage/projectRepository";
import { taskRepository } from "../lib/storage/taskRepository";
import { useFocusStore } from "../features/focus/focusStore";
import { usePreferenceStore } from "../features/preferences/preferenceStore";
import { useProjectStore } from "../features/projects/projectStore";
import { useReportStore } from "../features/reports/reportStore";
import { useTaskStore } from "../features/tasks/taskStore";
import { createProject } from "../types/project";
import { createTask } from "../types/task";
import { renderWithRouter } from "./test-utils";

const desktopFileMocks = vi.hoisted(() => ({
  openTextFile: vi.fn(),
  saveTextFile: vi.fn(),
}));

vi.mock("../lib/desktop/desktopFiles", () => desktopFileMocks);

describe("preferences store", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(async () => {
    await resetDatabase();
    desktopFileMocks.openTextFile.mockResolvedValue({ status: "unsupported" });
    desktopFileMocks.saveTextFile.mockResolvedValue("unsupported");
    usePreferenceStore.setState({
      isLoaded: false,
      preferences: DEFAULT_PREFERENCES,
    });
    useProjectStore.setState({ isLoaded: false, projects: [] });
    useTaskStore.setState({ isLoaded: false, tasks: [] });
    useFocusStore.setState({ focusRefs: [], isLoaded: false });
    useReportStore.setState({ isLoaded: false, reports: [] });
  });

  test("loads defaults and persists theme and ai settings", async () => {
    const loaded = await usePreferenceStore.getState().loadPreferences();
    expect(loaded.theme).toBe("light");

    const saved = await usePreferenceStore.getState().savePreferences({
      aiEndpoint: "https://api.example.com",
      aiRole: "请输出日报",
      theme: "dark",
    });

    expect(saved.theme).toBe("dark");
    expect(saved.aiEndpoint).toBe("https://api.example.com");
    expect(saved.aiRole).toBe("请输出日报");
  });

  test("opens settings as a page and supports close interactions", async () => {
    const user = userEvent.setup();
    renderWithRouter(<App />);

    await user.click(screen.getByRole("link", { name: "Settings" }));
    expect(await screen.findByRole("heading", { name: "设置" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "主题" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("AI Provider")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "DeepSeek 未配置" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Request Preview")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Advanced JSON")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "测试连接" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Account 个人信息" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Desktop 窗口与快捷键" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "大模型 服务商与模型" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await user.click(screen.getByRole("button", { name: "数据 备份与数据库" }));
    expect(screen.getByRole("button", { name: "创建备份" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "恢复数据" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "关闭设置" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "关闭" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "关闭" }));
    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "设置" })).not.toBeInTheDocument();
    });
  });

  test("does not show exported feedback when desktop export is canceled", async () => {
    desktopFileMocks.saveTextFile.mockResolvedValue("canceled");
    const user = userEvent.setup();
    renderWithRouter(<App />);

    await user.click(screen.getByRole("link", { name: "Settings" }));
    await user.click(await screen.findByRole("button", { name: "数据 备份与数据库" }));
    await user.click(screen.getByRole("button", { name: "创建备份" }));

    await waitFor(() => {
      expect(desktopFileMocks.saveTextFile).toHaveBeenCalled();
    });
    expect(screen.queryByText("已导出")).not.toBeInTheDocument();
  });

  test("shows an export failure when desktop export cannot be written", async () => {
    desktopFileMocks.saveTextFile.mockRejectedValue(new Error("导出校验失败"));
    const user = userEvent.setup();
    renderWithRouter(<App />);

    await user.click(screen.getByRole("link", { name: "Settings" }));
    await user.click(await screen.findByRole("button", { name: "数据 备份与数据库" }));
    await user.click(screen.getByRole("button", { name: "创建备份" }));

    await waitFor(() => {
      expect(screen.getByText("导出失败：导出校验失败")).toBeInTheDocument();
    });
  });

  test("imports a snapshot from settings after confirmation", async () => {
    const oldProject = createProject({ name: "Old Project" });
    const oldTask = createTask({ projectId: oldProject.id, title: "Old Task" });
    await projectRepository.save(oldProject);
    await taskRepository.save(oldTask);

    const importedSnapshot = {
      exportedAt: "2026-05-11T10:00:00.000Z",
      focusRefs: [],
      preferences: {
        ...DEFAULT_PREFERENCES,
        theme: "dark" as const,
        updatedAt: "2026-05-11T10:00:00.000Z",
      },
      projects: [
        {
          createdAt: "2026-05-11T10:00:00.000Z",
          description: "",
          id: "project-imported-settings",
          manualProgressNote: "",
          manualProgressOverride: null,
          name: "Imported Settings Project",
          updatedAt: "2026-05-11T10:00:00.000Z",
        },
      ],
      reports: [],
      tasks: [
        {
          body: "",
          checklist: [],
          completionWrapUp: null,
          createdAt: "2026-05-11T10:00:00.000Z",
          id: "task-imported-settings",
          notes: "",
          priority: "normal" as const,
          progressLog: [],
          projectId: "project-imported-settings",
          status: "todo" as const,
          title: "Imported Settings Task",
          updatedAt: "2026-05-11T10:00:00.000Z",
        },
      ],
      version: 1 as const,
    };
    const user = userEvent.setup();
    renderWithRouter(<App />);

    await user.click(screen.getByRole("link", { name: "Settings" }));
    await user.click(await screen.findByRole("button", { name: "数据 备份与数据库" }));
    await user.click(screen.getByRole("button", { name: "恢复数据" }));
    expect(screen.getByRole("button", { name: "确认恢复数据" })).toBeInTheDocument();

    await user.upload(
      screen.getByLabelText("选择备份文件"),
      new File([JSON.stringify(importedSnapshot)], "snapshot.json", {
        type: "application/json",
      }),
    );

    await waitFor(() => {
      expect(screen.getByText("已恢复 1 个项目 / 1 个任务 / 0 个报告")).toBeInTheDocument();
      expect(useProjectStore.getState().projects[0]?.name).toBe("Imported Settings Project");
      expect(useTaskStore.getState().tasks[0]?.title).toBe("Imported Settings Task");
      expect(usePreferenceStore.getState().preferences.theme).toBe("dark");
    });
    await waitFor(() => {
      expect(screen.getByText("Imported Settings Task")).toBeInTheDocument();
    });
    expect(useProjectStore.getState().projects.some((project) => project.name === "Old Project")).toBe(
      false,
    );
  });

  test("toggles theme from the app navigation", async () => {
    const user = userEvent.setup();
    renderWithRouter(<App />);

    await user.click(screen.getByRole("button", { name: "深色" }));

    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe("dark");
      expect(screen.getByRole("button", { name: "浅色" })).toBeInTheDocument();
    });
  });

  test("edits a lane color from settings", async () => {
    const user = userEvent.setup();
    renderWithRouter(<App />);

    await user.click(screen.getByRole("link", { name: "Settings" }));
    await screen.findByRole("heading", { name: "设置" });
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "外观 主题与颜色" }));
    await user.clear(await screen.findByLabelText("Doing color"));
    await user.type(screen.getByLabelText("Doing color"), "#123456");
    expect(screen.getByRole("button", { name: "保存" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(usePreferenceStore.getState().preferences.laneColors.doing).toBe("#123456");
    });
  });

  test("records a custom today step shortcut from settings", async () => {
    const user = userEvent.setup();
    renderWithRouter(<App />);

    await user.click(screen.getByRole("link", { name: "Settings" }));
    await screen.findByRole("heading", { name: "设置" });
    await user.click(screen.getByRole("button", { name: "外观 主题与颜色" }));

    const shortcutInput = screen.getByLabelText("今日执行快捷键");
    expect(shortcutInput).toHaveValue("Alt+Space");
    await user.click(shortcutInput);
    await user.keyboard("{Control>}{Shift>}k{/Shift}{/Control}");
    expect(shortcutInput).toHaveValue("Ctrl+Shift+K");
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(usePreferenceStore.getState().preferences.todayStepShortcut).toBe("Ctrl+Shift+K");
    });
  });

  test("saves and switches user AI roles from settings", async () => {
    const user = userEvent.setup();
    renderWithRouter(<App />);

    await user.click(screen.getByRole("link", { name: "Settings" }));
    await screen.findByRole("heading", { name: "设置" });
    await user.click(screen.getByRole("button", { name: /提示词库/ }));
    expect(screen.queryByRole("button", { name: "极简执行" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "新增提示词" }));
    await user.clear(await screen.findByLabelText("提示词名称"));
    await user.type(screen.getByLabelText("提示词名称"), "写日报");
    await user.type(screen.getByLabelText("提示词"), "写日报");
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "创建提示词" }));
    await waitFor(() => {
      expect(screen.getByText("角色已创建并保存。")).toBeInTheDocument();
      expect(usePreferenceStore.getState().preferences.aiRolePresets[0]?.label).toBe(
        "写日报",
      );
    });

    await user.click(screen.getByRole("button", { name: "新增提示词" }));
    await user.clear(screen.getByLabelText("提示词名称"));
    await user.type(screen.getByLabelText("提示词名称"), "拆任务");
    await user.type(screen.getByLabelText("提示词"), "拆任务");
    await user.click(screen.getByRole("button", { name: "创建提示词" }));

    await user.click(screen.getByRole("button", { name: "写日报 使用" }));
    await waitFor(() => {
      expect(screen.getByLabelText("提示词")).toHaveValue("写日报");
    });
    await user.click(screen.getByRole("button", { name: "拆任务 使用" }));
    await waitFor(() => {
      expect(screen.getByLabelText("提示词")).toHaveValue("拆任务");
    });

    await waitFor(() => {
      expect(usePreferenceStore.getState().preferences.aiRolePresets).toHaveLength(2);
    });
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
  });

  test("saves custom AI role presets from settings", async () => {
    const user = userEvent.setup();
    renderWithRouter(<App />);

    await user.click(screen.getByRole("link", { name: "Settings" }));
    await user.click(await screen.findByRole("button", { name: "DeepSeek 未配置" }));
    expect(screen.getByLabelText("AI 服务地址")).toHaveValue("https://api.deepseek.com");
    expect(screen.getByLabelText("AI 模型列表地址")).toHaveValue(
      "https://api.deepseek.com/models",
    );
    await user.click(screen.getByRole("button", { name: "MiniMax 未配置" }));
    expect(screen.getByLabelText("AI 服务地址")).toHaveValue("https://api.minimaxi.com/v1");
    expect(screen.getByLabelText("AI 模型列表地址")).toHaveValue(
      "https://api.minimaxi.com/v1/models",
    );
    await user.click(screen.getByRole("button", { name: "千问 未配置" }));
    expect(screen.getByLabelText("AI 服务地址")).toHaveValue(
      "https://dashscope.aliyuncs.com/compatible-mode/v1",
    );
    expect(screen.getByLabelText("AI 模型列表地址")).toHaveValue(
      "https://dashscope.aliyuncs.com/compatible-mode/v1/models",
    );
    await user.click(screen.getByRole("button", { name: "DeepSeek 已配置" }));
    expect(screen.queryByRole("button", { name: "deepseek-chat" })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("AI 模型"), "deepseek-chat");
    await user.click(screen.getByRole("button", { name: "添加模型" }));
    expect(screen.getByRole("button", { name: "deepseek-chat" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.click(screen.getByRole("button", { name: "新增服务商" }));
    await user.clear(screen.getByLabelText("AI 服务地址"));
    await user.type(await screen.findByLabelText("AI 服务地址"), "https://draft.example.com");
    await user.type(
      screen.getByLabelText("AI 模型列表地址"),
      "https://draft.example.com/v1/models",
    );
    await user.click(screen.getByRole("button", { name: "创建服务商" }));
    await waitFor(() => {
      expect(screen.getByText("服务商已创建并保存。")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /提示词库/ }));
    await user.click(screen.getByRole("button", { name: "新增提示词" }));
    await user.clear(await screen.findByLabelText("提示词名称"));
    await user.type(screen.getByLabelText("提示词名称"), "写周报");
    await user.type(screen.getByLabelText("提示词"), "写周报");
    await user.click(screen.getByRole("button", { name: "创建提示词" }));
    await waitFor(() => {
      expect(screen.getByText("角色已创建并保存。")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(usePreferenceStore.getState().preferences.aiRolePresets[0]?.prompt).toBe(
        "写周报",
      );
    });
    expect(screen.getByRole("button", { name: "写周报 当前" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "大模型 服务商与模型" }));
    expect(screen.getByLabelText("AI 服务地址")).toHaveValue("https://draft.example.com");
    expect(screen.getByLabelText("AI 模型列表地址")).toHaveValue(
      "https://draft.example.com/v1/models",
    );

    await user.click(screen.getByRole("button", { name: /提示词库/ }));
    await user.click(screen.getByRole("button", { name: "删除提示词 写周报" }));
    expect(screen.getByRole("button", { name: "写周报 再次点击删除" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "删除提示词 写周报" }));

    await waitFor(() => {
      expect(usePreferenceStore.getState().preferences.aiRolePresets).toHaveLength(0);
    });
  });

  test("cancels pending AI model and role additions from settings", async () => {
    const user = userEvent.setup();
    renderWithRouter(<App />);

    await user.click(screen.getByRole("link", { name: "Settings" }));

    await user.click(screen.getByRole("button", { name: "新增服务商" }));
    await user.clear(await screen.findByLabelText("AI 配置名称"));
    await user.type(screen.getByLabelText("AI 配置名称"), "临时服务商");
    await user.click(screen.getByRole("button", { name: "取消服务商" }));
    expect(screen.queryByRole("button", { name: "临时服务商" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /提示词库/ }));
    await user.click(screen.getByRole("button", { name: "新增提示词" }));
    await user.clear(await screen.findByLabelText("提示词名称"));
    await user.type(screen.getByLabelText("提示词名称"), "临时角色");
    await user.click(screen.getByRole("button", { name: "取消提示词" }));
    expect(screen.queryByRole("button", { name: /临时角色/ })).not.toBeInTheDocument();
  });

  test("switches AI API profiles with separate keys", async () => {
    const user = userEvent.setup();
    renderWithRouter(<App />);

    await user.click(screen.getByRole("link", { name: "Settings" }));
    await user.type(await screen.findByLabelText("AI 密钥"), "default-key");
    await user.click(screen.getByRole("button", { name: "新增服务商" }));
    await user.clear(screen.getByLabelText("AI 配置名称"));
    await user.type(screen.getByLabelText("AI 配置名称"), "Backup");
    await user.type(screen.getByLabelText("AI 模型"), "backup-model");
    await user.click(screen.getByRole("button", { name: "添加模型" }));
    await user.type(screen.getByLabelText("AI 服务地址"), "https://backup.example.com/v1");
    await user.type(
      screen.getByLabelText("AI 模型列表地址"),
      "https://backup.example.com/v1/models",
    );
    await user.type(screen.getByLabelText("AI 密钥"), "backup-key");
    await user.click(screen.getByRole("button", { name: "创建服务商" }));

    await waitFor(() => {
      expect(usePreferenceStore.getState().preferences.aiProfiles).toHaveLength(2);
    });
    const persistedAfterConfirm = await preferenceRepository.load();
    const persistedBackup = persistedAfterConfirm.aiProfiles.find(
      (profile) => profile.name === "Backup",
    );
    expect(persistedBackup?.endpoint).toBe("https://backup.example.com/v1");
    expect(persistedBackup?.modelsEndpoint).toBe("https://backup.example.com/v1/models");
    expect(persistedBackup?.apiKey).toBe("backup-key");
    expect(persistedAfterConfirm.activeAiProfileId).toBe(persistedBackup?.id);

    await user.click(screen.getByRole("button", { name: "服务商 1" }));
    expect(screen.getByLabelText("AI 密钥")).toHaveValue("default-key");

    await user.click(screen.getByRole("button", { name: "Backup" }));
    expect(screen.getByLabelText("AI 密钥")).toHaveValue("backup-key");
    expect(screen.getByLabelText("AI 服务地址")).toHaveValue(
      "https://backup.example.com/v1",
    );
    expect(screen.getByLabelText("AI 模型列表地址")).toHaveValue(
      "https://backup.example.com/v1/models",
    );
    expect(screen.getByRole("button", { name: "backup-model" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.queryByLabelText("Advanced JSON")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Request Preview")).not.toBeInTheDocument();

    await waitFor(() => {
      const preferences = usePreferenceStore.getState().preferences;
      expect(preferences.aiProfiles).toHaveLength(2);
      expect(preferences.aiKey).toBe("backup-key");
      expect("provider" in preferences.aiProfiles[0]).toBe(false);
      expect(preferences.aiProfiles[1]?.model).toBe("backup-model");
      expect(preferences.aiProfiles[1]?.models).toContain("backup-model");
      expect(preferences.aiProfiles[1]?.apiKey).toBe("backup-key");
    });
  });

  test("hides the AI key by default and can reveal it", async () => {
    const user = userEvent.setup();
    renderWithRouter(<App />);

    await user.click(screen.getByRole("link", { name: "Settings" }));

    expect(await screen.findByLabelText("AI 密钥")).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: "显示 AI 密钥" }));
    expect(screen.getByLabelText("AI 密钥")).toHaveAttribute("type", "text");
    await user.click(screen.getByRole("button", { name: "隐藏 AI 密钥" }));
    expect(screen.getByLabelText("AI 密钥")).toHaveAttribute("type", "password");
  });

  test("tests an AI API profile from settings", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({
        choices: [{ message: { content: "OK" } }],
      }),
      ok: true,
      status: 200,
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderWithRouter(<App />);

    await user.click(screen.getByRole("link", { name: "Settings" }));
    await user.click(await screen.findByRole("button", { name: "DeepSeek 未配置" }));
    await user.type(screen.getByLabelText("AI 模型"), "deepseek-chat");
    await user.click(screen.getByRole("button", { name: "测试连接" }));

    await waitFor(() => {
      expect(screen.getByText(/200 OK/)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "deepseek-chat" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/ai/chat-completions",
      expect.any(Object),
    );
  });

  test("ignores an old model list after switching providers", async () => {
    let resolveRequest!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => new Promise<Response>((resolve) => {
      resolveRequest = resolve;
    })));
    const user = userEvent.setup();
    renderWithRouter(<App />);
    await user.click(screen.getByRole("link", { name: "Settings" }));
    await user.click(await screen.findByRole("button", { name: "Kimi 未配置" }));
    await user.click(screen.getByRole("button", { name: "获取模型" }));
    await user.click(screen.getByRole("button", { name: "DeepSeek 未配置" }));
    await act(async () => resolveRequest(new Response(JSON.stringify({data:[{id:"old-provider-model"}]}))));
    expect(screen.queryByText("old-provider-model")).not.toBeInTheDocument();
    expect(screen.queryByText("模型已更新")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "获取模型" })).toBeEnabled();
  });

  test("fetches models and lets the user add one from settings", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({
        data: [{ id: "moonshot-v1-8k" }, { id: "moonshot-v1-32k" }],
      }),
      ok: true,
      status: 200,
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderWithRouter(<App />);

    await user.click(screen.getByRole("link", { name: "Settings" }));
    await user.click(await screen.findByRole("button", { name: "Kimi 未配置" }));
    await user.click(screen.getByRole("button", { name: "获取模型" }));
    expect(await screen.findByText("来源：https://api.moonshot.cn/v1/models")).toBeInTheDocument();
    await user.click(
      await screen.findByRole("button", { name: "添加获取到的模型 moonshot-v1-8k" }),
    );

    expect(screen.getByRole("button", { name: "moonshot-v1-8k" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/ai/models",
      expect.any(Object),
    );
  });

  test("applies the stored dark theme to the document color scheme", async () => {
    await preferenceRepository.save({
      ...DEFAULT_PREFERENCES,
      theme: "dark",
      updatedAt: "2026-04-24T10:15:00.000Z",
    });

    renderWithRouter(<App />);

    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe("dark");
      expect(document.documentElement.style.colorScheme).toBe("dark");
    });
  });
});
