import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { exportSnapshot } from "../../lib/export/exportSnapshot";
import { openTextFile, saveTextFile } from "../../lib/desktop/desktopFiles";
import { importSnapshot } from "../../lib/import/importSnapshot";
import { isTauriRuntime } from "../../lib/platform/runtime";
import { persistLocalSnapshotNow } from "../../lib/localPersistence/localSnapshotApi";
import { useToast } from "../../components/common/ToastProvider";
import { useFocusStore } from "../focus/focusStore";
import { usePreferenceStore } from "../preferences/preferenceStore";
import { useProjectStore } from "../projects/projectStore";
import { useReportStore } from "../reports/reportStore";
import { useTaskStore } from "../tasks/taskStore";
import { AiProviderSettings } from "./AiProviderSettings";
import { AiRoleSettings } from "./AiRoleSettings";
import { SettingsExportIcon } from "./settingsIcons";
import { useAiProviderSettings } from "./useAiProviderSettings";
import { useAiRoleSettings } from "./useAiRoleSettings";
import { formatKeyboardShortcut } from "../../lib/desktop/shortcutKeys";
import type { ConfirmingDelete } from "./settingsTypes";
import type {
  AiProfile,
  AiRoleTemplate,
} from "../../types/preferences";

const LANE_COLOR_FIELDS = [
  { key: "task", label: "待办", ariaName: "Task" },
  { key: "doing", label: "进行中", ariaName: "Doing" },
  { key: "done", label: "已完成", ariaName: "Done" },
] as const;

const COLOR_PRESETS = [
  "#FFB347",
  "#F97316",
  "#EF4444",
  "#F472B6",
  "#7D8AFF",
  "#5AC8FA",
  "#34D399",
  "#A3E635",
] as const;

type SettingsDomain = "ai" | "aiRoles" | "appearance" | "data";

const SETTINGS_DOMAINS: Array<{
  id: SettingsDomain;
  label: string;
  summary: string;
}> = [
  { id: "ai", label: "大模型", summary: "服务商与模型" },
  { id: "aiRoles", label: "提示词库", summary: "角色与模板" },
  { id: "appearance", label: "外观", summary: "主题与颜色" },
  { id: "data", label: "数据", summary: "备份与数据库" },
];

function getPreferenceDraftSnapshot(preferences: {
  activeAiProfileId: string;
  activeAiRoleTemplateId: string;
  aiEndpoint: string;
  aiKey: string;
  aiProfiles: AiProfile[];
  aiRole: string;
  aiRolePresets: unknown[];
  aiRoleTemplates: AiRoleTemplate[];
  laneColors: unknown;
  todayStepDocked: boolean;
  todayStepHandlePosition: unknown;
  todayStepPinned: boolean;
  todayStepShortcut: string;
  theme: string;
}) {
  return JSON.stringify({
    activeAiProfileId: preferences.activeAiProfileId,
    activeAiRoleTemplateId: preferences.activeAiRoleTemplateId,
    aiEndpoint: preferences.aiEndpoint,
    aiKey: preferences.aiKey,
    aiProfiles: preferences.aiProfiles,
    aiRole: preferences.aiRole,
    aiRolePresets: preferences.aiRolePresets,
    aiRoleTemplates: preferences.aiRoleTemplates,
    laneColors: preferences.laneColors,
    todayStepDocked: preferences.todayStepDocked,
    todayStepHandlePosition: preferences.todayStepHandlePosition,
    todayStepPinned: preferences.todayStepPinned,
    todayStepShortcut: preferences.todayStepShortcut,
    theme: preferences.theme,
  });
}

function readBrowserFileText(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("error", () => {
      reject(reader.error ?? new Error("读取备份文件失败"));
    });
    reader.addEventListener("load", () => {
      resolve(typeof reader.result === "string" ? reader.result : "");
    });
    reader.readAsText(file);
  });
}

export function SettingsPage() {
  const navigate = useNavigate();
  const preferences = usePreferenceStore((state) => state.preferences);
  const loadPreferences = usePreferenceStore((state) => state.loadPreferences);
  const savePreferences = usePreferenceStore((state) => state.savePreferences);
  const loadFocus = useFocusStore((state) => state.loadFocus);
  const loadProjects = useProjectStore((state) => state.loadProjects);
  const loadReports = useReportStore((state) => state.loadReports);
  const loadTasks = useTaskStore((state) => state.loadTasks);
  const { showToast } = useToast();

  const bodyRef = useRef<HTMLDivElement | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [draft, setDraft] = useState(preferences);
  const [activeSettingsDomain, setActiveSettingsDomain] =
    useState<SettingsDomain>("ai");
  const [confirmingDelete, setConfirmingDelete] = useState<ConfirmingDelete | null>(null);
  const [isConfirmingImport, setIsConfirmingImport] = useState(false);

  const prettyExportName = useMemo(
    () => `yibu-snapshot-${new Date().toISOString().slice(0, 10)}.json`,
    [],
  );
  const aiProviderSettings = useAiProviderSettings({
    confirmingDelete,
    draft,
    savePreferences,
    setConfirmingDelete,
    setDraft,
    showToast,
  });
  const {
    activeAiProfile,
    apiTestResult,
    draftModelName,
    fetchedAiModels,
    handleAddAiModel,
    handleAddAiProfile,
    handleCancelAiProfile,
    handleConfirmAiProfile,
    handleDeleteAiModel,
    handleFetchAiModels,
    handleRequestDeleteAiProfile,
    handleResetActiveAiEndpoint,
    handleSelectAiModel,
    handleSelectAiProfile,
    handleSelectBuiltinAiProvider,
    handleTestActiveApi,
    handleUpdateActiveAiProfile,
    isAiKeyVisible,
    isFetchingModels,
    isTestingApi,
    modelListResult,
    pendingAiProfile,
    setDraftModelName,
    setIsAiKeyVisible,
  } = aiProviderSettings;
  const aiRoleSettings = useAiRoleSettings({
    confirmingDelete,
    draft,
    savePreferences,
    setConfirmingDelete,
    setDraft,
    showToast,
  });
  const {
    activeAiRoleTemplate,
    draftRoleName,
    handleAddAiRoleTemplate,
    handleCancelAiRoleTemplate,
    handleConfirmAiRoleTemplate,
    handleRequestDeleteAiRoleTemplate,
    handleSelectAiRoleTemplate,
    handleUpdateAiRole,
    handleUpdateAiRoleName,
    pendingAiRoleTemplate,
    syncRoleName,
  } = aiRoleSettings;
  const hasPendingAiItem = Boolean(pendingAiProfile || pendingAiRoleTemplate);
  const hasUnsavedChanges = useMemo(
    () => getPreferenceDraftSnapshot(draft) !== getPreferenceDraftSnapshot(preferences),
    [draft, preferences],
  );
  const isGlobalSaveDisabled = hasPendingAiItem || !hasUnsavedChanges;
  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = 0;
    }
  }, []);

  async function handleSave() {
    if (hasPendingAiItem) {
      showToast({ message: "请先确认或取消正在编辑的 AI 项" });
      return;
    }

    const savedPreferences = await savePreferences({
      activeAiProfileId: draft.activeAiProfileId,
      activeAiRoleTemplateId: draft.activeAiRoleTemplateId,
      aiEndpoint: draft.aiEndpoint,
      aiKey: draft.aiKey,
      aiProfiles: draft.aiProfiles,
      aiRole: draft.aiRole,
      aiRolePresets: draft.aiRolePresets,
      aiRoleTemplates: draft.aiRoleTemplates,
      laneColors: draft.laneColors,
      todayStepDocked: draft.todayStepDocked,
      todayStepHandlePosition: draft.todayStepHandlePosition,
      todayStepPinned: draft.todayStepPinned,
      todayStepShortcut: draft.todayStepShortcut,
      theme: draft.theme,
    });
    setDraft(savedPreferences);
    syncRoleName(savedPreferences);
    showToast({ message: "已保存" });
  }

  async function handleExport() {
    try {
      const snapshot = await exportSnapshot();
      const contents = JSON.stringify(snapshot, null, 2);
      const desktopSaveResult = await saveTextFile({
        contents,
        defaultPath: prettyExportName,
      });
      if (desktopSaveResult === "saved") {
        showToast({
          message: `已导出 ${snapshot.projects.length} 个项目 / ${snapshot.tasks.length} 个任务 / ${snapshot.reports.length} 个报告（不含 API 密钥）`,
        });
        return;
      }
      if (desktopSaveResult === "canceled") {
        return;
      }

      const blob = new Blob([contents], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = prettyExportName;
      anchor.click();
      URL.revokeObjectURL(url);
      showToast({
        message: `已导出 ${snapshot.projects.length} 个项目 / ${snapshot.tasks.length} 个任务 / ${snapshot.reports.length} 个报告（不含 API 密钥）`,
      });
    } catch (error) {
      showToast({
        message: error instanceof Error ? `导出失败：${error.message}` : "导出失败",
      });
    }
  }

  async function reloadAppDataAfterImport() {
    const [projects, tasks, focusRefs, reports, nextPreferences] = await Promise.all([
      loadProjects(),
      loadTasks(),
      loadFocus(),
      loadReports(),
      loadPreferences(),
    ]);
    setDraft(nextPreferences);
    syncRoleName(nextPreferences);
    return { focusRefs, preferences: nextPreferences, projects, reports, tasks };
  }

  async function importSnapshotFromText(contents: string) {
    const snapshot = JSON.parse(contents) as unknown;
    await importSnapshot(snapshot);
    const importedData = await reloadAppDataAfterImport();
    await persistLocalSnapshotNow();
    setIsConfirmingImport(false);
    showToast({
      message: `已恢复 ${importedData.projects.length} 个项目 / ${importedData.tasks.length} 个任务 / ${importedData.reports.length} 个报告`,
    });
    const firstProjectId = importedData.projects[0]?.id;
    void navigate(firstProjectId ? `/projects?project=${firstProjectId}` : "/");
  }

  async function handleImportFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    try {
      await importSnapshotFromText(await readBrowserFileText(file));
    } catch (error) {
      showToast({
        message: error instanceof Error ? error.message : "导入失败",
      });
    }
  }

  async function handleImport() {
    if (!isConfirmingImport) {
      setIsConfirmingImport(true);
      showToast({ message: "再次点击恢复数据以覆盖当前数据" });
      return;
    }

    try {
      if (!isTauriRuntime()) {
        importInputRef.current?.click();
        return;
      }

      const desktopOpenResult = await openTextFile();
      if (desktopOpenResult.status === "opened") {
        await importSnapshotFromText(desktopOpenResult.contents);
        return;
      }
      if (desktopOpenResult.status === "canceled") {
        return;
      }

      importInputRef.current?.click();
    } catch (error) {
      showToast({
        message: error instanceof Error ? error.message : "导入失败",
      });
    }
  }

  function updateLaneColor(key: keyof typeof draft.laneColors, value: string) {
    setDraft((current) => ({
      ...current,
      laneColors: { ...current.laneColors, [key]: value },
    }));
  }

  return (
    <div className="settings-page">
      <section
        aria-label="设置"
        className="settings-modal"
      >
        <header className="settings-modal__header">
          <div className="settings-header__title">
            <h3>设置</h3>
          </div>
        </header>
        <div className="settings-modal__body settings-dialog" ref={bodyRef}>
          <div className="settings-workbench">
            <aside className="settings-sidebar" aria-label="设置分类">
              {SETTINGS_DOMAINS.map((domain) => (
                <button
                  aria-current={activeSettingsDomain === domain.id ? "page" : undefined}
                  className={
                    activeSettingsDomain === domain.id
                      ? "settings-domain settings-domain--active"
                      : "settings-domain"
                  }
                  key={domain.id}
                  onClick={() => {
                    setActiveSettingsDomain(domain.id);
                    if (bodyRef.current) {
                      bodyRef.current.scrollTop = 0;
                    }
                  }}
                  type="button"
                >
                  <strong>{domain.label}</strong>
                  <span>{domain.summary}</span>
                </button>
              ))}
            </aside>
            <div className="settings-panel">
              {activeSettingsDomain === "appearance" ? (
                <section className="settings-section" id="settings-colors">
              <div className="detail-section__header">
                <h4>外观</h4>
              </div>
              <div className="settings-section-note">
                <strong>看板颜色</strong>
                <span>调整任务状态在首页和项目看板里的识别色。</span>
              </div>
              <div className="settings-color-panel">
                {LANE_COLOR_FIELDS.map((field) => {
                  const value = draft.laneColors[field.key];
                  return (
                    <div className="settings-color-card" key={field.key}>
                      <span
                        aria-hidden="true"
                        className="settings-color-card__swatch"
                        style={{ background: value }}
                      />
                      <label className="field settings-color-card__field">
                        <span>{field.label}</span>
                        <input
                          aria-label={`${field.ariaName} color`}
                          onChange={(event) => updateLaneColor(field.key, event.target.value)}
                          value={value}
                        />
                      </label>
                      <div
                        aria-label={`${field.label}颜色预设`}
                        className="settings-color-card__presets"
                      >
                        {COLOR_PRESETS.map((preset) => (
                          <button
                            aria-label={`${field.label}使用${preset}`}
                            aria-pressed={value.toLowerCase() === preset.toLowerCase()}
                            className={
                              value.toLowerCase() === preset.toLowerCase()
                                ? "settings-color-preset settings-color-preset--active"
                                : "settings-color-preset"
                            }
                            key={preset}
                            onClick={() => updateLaneColor(field.key, preset)}
                            style={{ background: preset }}
                            type="button"
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="settings-section-note settings-shortcut-note">
                <strong>今日执行快捷键</strong>
                <span>在桌面应用激活时打开或聚焦今日执行。</span>
              </div>
              <div className="settings-shortcut-panel">
                <label className="field settings-shortcut-field">
                  <span>今日执行</span>
                  <input
                    aria-label="今日执行快捷键"
                    onKeyDown={(event) => {
                      event.preventDefault();
                      const shortcut = formatKeyboardShortcut(event);
                      if (!shortcut) {
                        return;
                      }
                      setDraft((current) => ({
                        ...current,
                        todayStepShortcut: shortcut,
                      }));
                    }}
                    placeholder="Alt+Space"
                    readOnly
                    value={draft.todayStepShortcut}
                  />
                </label>
                <button
                  className="settings-action-card settings-action-card--button settings-shortcut-clear"
                  onClick={() => {
                    setDraft((current) => ({
                      ...current,
                      todayStepShortcut: "",
                    }));
                  }}
                  type="button"
                >
                  清除
                </button>
              </div>
                </section>
              ) : null}

              {activeSettingsDomain === "ai" ? (
                <AiProviderSettings
                  activeAiProfile={activeAiProfile}
                  apiTestResult={apiTestResult}
                  confirmingDelete={confirmingDelete}
                  draft={draft}
                  draftModelName={draftModelName}
                  fetchedAiModels={fetchedAiModels}
                  isAiKeyVisible={isAiKeyVisible}
                  isFetchingModels={isFetchingModels}
                  isTestingApi={isTestingApi}
                  modelListResult={modelListResult}
                  pendingAiProfile={pendingAiProfile}
                  onAddAiModel={handleAddAiModel}
                  onAddAiProfile={handleAddAiProfile}
                  onCancelAiProfile={handleCancelAiProfile}
                  onConfirmAiProfile={() => {
                    void handleConfirmAiProfile();
                  }}
                  onDeleteAiModel={handleDeleteAiModel}
                  onFetchAiModels={() => {
                    void handleFetchAiModels();
                  }}
                  onRequestDeleteAiProfile={handleRequestDeleteAiProfile}
                  onResetActiveAiEndpoint={handleResetActiveAiEndpoint}
                  onSelectAiModel={handleSelectAiModel}
                  onSelectAiProfile={handleSelectAiProfile}
                  onSelectBuiltinAiProvider={handleSelectBuiltinAiProvider}
                  onSetDraftModelName={setDraftModelName}
                  onTestActiveApi={() => {
                    void handleTestActiveApi();
                  }}
                  onToggleAiKeyVisibility={() =>
                    setIsAiKeyVisible((current) => !current)
                  }
                  onUpdateActiveAiProfile={handleUpdateActiveAiProfile}
                />
              ) : null}

              {activeSettingsDomain === "aiRoles" ? (
                <AiRoleSettings
                  activeAiRoleTemplate={activeAiRoleTemplate}
                  confirmingDelete={confirmingDelete}
                  draft={draft}
                  draftRoleName={draftRoleName}
                  pendingAiRoleTemplate={pendingAiRoleTemplate}
                  onAddAiRoleTemplate={handleAddAiRoleTemplate}
                  onCancelAiRoleTemplate={handleCancelAiRoleTemplate}
                  onConfirmAiRoleTemplate={() => {
                    void handleConfirmAiRoleTemplate();
                  }}
                  onRequestDeleteAiRoleTemplate={handleRequestDeleteAiRoleTemplate}
                  onSelectAiRoleTemplate={(templateId) => {
                    void handleSelectAiRoleTemplate(templateId);
                  }}
                  onUpdateAiRole={handleUpdateAiRole}
                  onUpdateAiRoleName={handleUpdateAiRoleName}
                />
              ) : null}

              {activeSettingsDomain === "data" ? (
                <section className="settings-section" id="settings-data">
              <div className="detail-section__header">
                <h4>数据</h4>
              </div>
              <div className="settings-data-panel">
                <div className="settings-data-row">
                  <span>
                    <strong>创建备份</strong>
                    <small>导出完整 JSON 快照，可用于迁移和人工留档。</small>
                  </span>
                  <button
                    aria-label="创建备份"
                    className="settings-action-card settings-action-card--button"
                    onClick={() => void handleExport()}
                    type="button"
                  >
                    <SettingsExportIcon />
                    <span>导出</span>
                  </button>
                </div>
                <div className="settings-data-row">
                  <span>
                    <strong>恢复数据</strong>
                    <small>
                      {isConfirmingImport
                        ? "再次点击会选择备份文件，并覆盖当前项目、任务、报告和设置。"
                        : "从快照恢复会覆盖当前本地数据。"}
                    </small>
                  </span>
                  <input
                    aria-label="选择备份文件"
                    accept="application/json,.json"
                    className="visually-hidden"
                    onChange={(event) => {
                      void handleImportFileChange(event);
                    }}
                    ref={importInputRef}
                    type="file"
                  />
                  <button
                    aria-label={isConfirmingImport ? "确认恢复数据" : "恢复数据"}
                    className="settings-action-card settings-action-card--button"
                    onClick={() => {
                      void handleImport();
                    }}
                    type="button"
                  >
                    {isConfirmingImport ? "确认恢复" : "导入"}
                  </button>
                </div>
                <div className="settings-data-row settings-data-row--quiet">
                  <span>
                    <strong>本地数据库</strong>
                    <small>桌面端使用本地存储，备份文件不会自动上传。</small>
                  </span>
                  <em>本机</em>
                </div>
              </div>
                </section>
              ) : null}

            </div>
          </div>
        </div>

        <footer className="settings-modal__footer settings-footer">
          <button
            aria-label="关闭"
            className="settings-footer__button settings-footer__button--secondary"
            onClick={() => {
              void navigate("/");
            }}
            title="返回首页"
            type="button"
          >
            取消
          </button>
          <button
            aria-label="保存"
            className="settings-footer__button settings-footer__button--primary"
            disabled={isGlobalSaveDisabled}
            onClick={() => {
              void handleSave();
            }}
            title="保存设置"
            type="button"
          >
            保存
          </button>
        </footer>
      </section>
    </div>
  );
}
