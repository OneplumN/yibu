import { useEffect, useMemo, useRef, useState } from "react";
import { usePreferenceStore } from "../preferences/preferenceStore";
import { useProjectStore } from "../projects/projectStore";
import { useTaskStore } from "../tasks/taskStore";
import type { AiProfile } from "../../types/preferences";
import type { Task } from "../../types/task";
import type { SavedReport } from "../../types/report";
import { Modal } from "../../components/common/Modal";
import { TaskDetailPanel } from "../../components/tasks/TaskDetailPanel";
import { useToast } from "../../components/common/ToastProvider";
import { createReportRecord } from "./reportGeneration";

const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];
const MAX_REPORT_COMPARE_MODELS = 2;

function CalendarChevronIcon({ direction }: { direction: "left" | "right" }) {
  const path = direction === "left" ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6";

  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <path
        d={path}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function ReportEditIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <path
        d="M12 20h8"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path
        d="M15.5 4.5a2.12 2.12 0 1 1 3 3L8 18l-4 1 1-4 10.5-10.5Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function ReportGenerateIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <path
        d="M5 12h14m0 0-5-5m5 5-5 5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

type ReportRange = {
  label: string;
  rangeEnd: string;
  rangeStart: string;
};

type ReportComparison = {
  error?: string;
  profileId: string;
  profileName: string;
  report: SavedReport | null;
};

function ReportComparisonCard({
  comparison,
  isRegenerating,
  onCopy,
  onRegenerate,
}: {
  comparison: ReportComparison;
  isRegenerating: boolean;
  onCopy: (content: string) => Promise<void>;
  onRegenerate: () => Promise<void>;
}) {
  const [polishedContent, setPolishedContent] = useState(
    comparison.report?.polishedContent ?? "",
  );

  useEffect(() => {
    setPolishedContent(comparison.report?.polishedContent ?? "");
  }, [comparison.report?.id, comparison.report?.polishedContent]);

  if (!comparison.report) {
    return (
      <article className="report-compare-card report-compare-card--error">
        <header>
          <div>
            <p>模型</p>
            <h3>{comparison.profileName}</h3>
          </div>
          <span>{isRegenerating ? "生成中" : "失败"}</span>
        </header>
        <div className="report-compare-error" role="alert">
          {comparison.error ?? "This model failed to generate a report."}
        </div>
        <footer>
          <button
            disabled={isRegenerating}
            onClick={() => void onRegenerate()}
            type="button"
          >
            {isRegenerating ? "生成中..." : "重试"}
          </button>
        </footer>
      </article>
    );
  }

  return (
    <article className="report-compare-card">
      <header>
        <div>
          <p>模型</p>
          <h3>{comparison.profileName}</h3>
        </div>
        <span>{isRegenerating ? "生成中" : "已生成"}</span>
      </header>
      <section
        aria-label={`Polished Content ${comparison.profileName}`}
        className="report-compare-preview"
      >
        {polishedContent}
      </section>
      <footer>
        <button
          disabled={isRegenerating}
          onClick={() => void onRegenerate()}
          type="button"
        >
          {isRegenerating ? "生成中..." : "重新生成"}
        </button>
        <button
          disabled={isRegenerating}
          onClick={() => void onCopy(polishedContent)}
          type="button"
        >
          复制
        </button>
      </footer>
    </article>
  );
}

function ReportComparisonSkeleton({ profileName }: { profileName: string }) {
  return (
    <article className="report-compare-card report-compare-card--loading">
      <header>
        <div>
          <p>模型</p>
          <h3>{profileName}</h3>
        </div>
        <span>生成中</span>
      </header>
      <div className="report-compare-skeleton" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </div>
    </article>
  );
}

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function formatDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

function formatDateInput(date: Date) {
  return formatDateKey(date);
}

function formatFullDateLabel(value: string) {
  const date = parseDateInput(value);
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

function formatMonthLabel(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatDateLabel(date: Date) {
  return `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`;
}

function formatRangeLabel(start: Date, end: Date) {
  if (formatDateKey(start) === formatDateKey(end)) {
    return formatDateLabel(start);
  }

  return `${formatDateLabel(start)} - ${formatDateLabel(end)}`;
}

function formatTaskTime(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function getWeekStart(date: Date) {
  const start = startOfDay(date);
  const day = start.getDay() || 7;
  start.setDate(start.getDate() - day + 1);
  return start;
}

function parseDateInput(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function getReportRangeFromInputs(
  startValue: string,
  endValue: string,
): ReportRange {
  const startInput = parseDateInput(startValue);
  const endInput = parseDateInput(endValue);
  const [start, end] =
    startInput.getTime() <= endInput.getTime()
      ? [startInput, endInput]
      : [endInput, startInput];

  return {
    label: formatRangeLabel(start, end),
    rangeEnd: endOfDay(end).toISOString(),
    rangeStart: startOfDay(start).toISOString(),
  };
}

function isInRange(date: Date, range: ReportRange) {
  const value = startOfDay(date).getTime();
  return (
    value >= new Date(range.rangeStart).getTime() &&
    value <= new Date(range.rangeEnd).getTime()
  );
}

function getCompletedAt(task: Task) {
  return task.completionWrapUp?.completedAt ?? "";
}

function getCompactText(value?: string) {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function getTaskReportPreview(task: Task) {
  return (
    getCompactText(task.body) ||
    getCompactText(task.completionWrapUp?.summary) ||
    getCompactText(task.notes) ||
    getCompactText(task.completionWrapUp?.notes) ||
    getCompactText(task.completionWrapUp?.keyChanges)
  );
}

function getCompletedTasksInRange(tasks: Task[], range: ReportRange) {
  return tasks
    .filter((task) => {
      const completedAt = getCompletedAt(task);

      return (
        task.status === "done" &&
        completedAt >= range.rangeStart &&
        completedAt <= range.rangeEnd
      );
    })
    .sort((left, right) =>
      getCompletedAt(left).localeCompare(getCompletedAt(right)),
    );
}

function getCompletedTaskGroups(tasks: Task[]) {
  return tasks.reduce<Array<{ dateKey: string; label: string; tasks: Task[] }>>(
    (groups, task) => {
      const completedAt = new Date(getCompletedAt(task));
      const dateKey = formatDateKey(completedAt);
      const currentGroup = groups.find((group) => group.dateKey === dateKey);

      if (currentGroup) {
        currentGroup.tasks.push(task);
        return groups;
      }

      groups.push({
        dateKey,
        label: formatDateLabel(completedAt),
        tasks: [task],
      });
      return groups;
    },
    [],
  );
}

function getCalendarDates(visibleMonth: Date) {
  const firstDay = new Date(
    visibleMonth.getFullYear(),
    visibleMonth.getMonth(),
    1,
  );
  const start = getWeekStart(firstDay);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}

export function ReportCenterPage() {
  const projects = useProjectStore((state) => state.projects);
  const preferences = usePreferenceStore((state) => state.preferences);
  const tasks = useTaskStore((state) => state.tasks);
  const { showToast } = useToast();

  const [hasPickedDate, setHasPickedDate] = useState(false);
  const [isGeneratingCompare, setIsGeneratingCompare] = useState(false);
  const [isDateModalOpen, setIsDateModalOpen] = useState(false);
  const [isGenerateModalOpen, setIsGenerateModalOpen] = useState(false);
  const [modelPickerValue, setModelPickerValue] = useState("");
  const [rangeAnchorDate, setRangeAnchorDate] = useState<string | null>(null);
  const [regeneratingProfileIds, setRegeneratingProfileIds] = useState<
    string[]
  >([]);
  const [reportComparisons, setReportComparisons] = useState<
    ReportComparison[]
  >([]);
  const [selectedAiProfileIds, setSelectedAiProfileIds] = useState<string[]>(
    [],
  );
  const [selectedAiRoleTemplateId, setSelectedAiRoleTemplateId] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedStartDate, setSelectedStartDate] = useState(() =>
    formatDateInput(new Date()),
  );
  const [selectedEndDate, setSelectedEndDate] = useState(() =>
    formatDateInput(new Date()),
  );
  const [visibleMonth, setVisibleMonth] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );
  const generationRunRef = useRef(0);
  const requestControllers = useRef(new Set<AbortController>());
  useEffect(
    () => () => {
      requestControllers.current.forEach((controller) => controller.abort());
      requestControllers.current.clear();
    },
    [],
  );

  const latestCompletedAt = useMemo(() => {
    return tasks
      .filter(
        (task) => task.status === "done" && task.completionWrapUp?.completedAt,
      )
      .map((task) => task.completionWrapUp?.completedAt ?? "")
      .sort((left, right) => right.localeCompare(left))[0];
  }, [tasks]);
  const selectedRange = useMemo(
    () => getReportRangeFromInputs(selectedStartDate, selectedEndDate),
    [selectedEndDate, selectedStartDate],
  );
  const completedTasks = useMemo(
    () => getCompletedTasksInRange(tasks, selectedRange),
    [selectedRange, tasks],
  );
  const completedTaskGroups = useMemo(
    () => getCompletedTaskGroups(completedTasks),
    [completedTasks],
  );
  const isSingleDayRange = useMemo(
    () =>
      formatDateKey(new Date(selectedRange.rangeStart)) ===
      formatDateKey(new Date(selectedRange.rangeEnd)),
    [selectedRange.rangeEnd, selectedRange.rangeStart],
  );
  const selectedAiProfiles = useMemo(
    () =>
      selectedAiProfileIds
        .map((profileId) =>
          preferences.aiProfiles.find((profile) => profile.id === profileId),
        )
        .filter((profile): profile is AiProfile => Boolean(profile)),
    [preferences.aiProfiles, selectedAiProfileIds],
  );
  const availableAiProfiles = useMemo(
    () =>
      selectedAiProfileIds.length >= MAX_REPORT_COMPARE_MODELS
        ? []
        : preferences.aiProfiles.filter(
            (profile) => !selectedAiProfileIds.includes(profile.id),
          ),
    [preferences.aiProfiles, selectedAiProfileIds],
  );
  const selectedAiRoleTemplate = useMemo(
    () =>
      preferences.aiRoleTemplates.find(
        (template) => template.id === selectedAiRoleTemplateId,
      ) ??
      preferences.aiRoleTemplates.find(
        (template) => template.id === preferences.activeAiRoleTemplateId,
      ) ??
      null,
    [
      preferences.activeAiRoleTemplateId,
      preferences.aiRoleTemplates,
      selectedAiRoleTemplateId,
    ],
  );
  const calendarDates = useMemo(
    () => getCalendarDates(visibleMonth),
    [visibleMonth],
  );
  const completedCountByDay = useMemo(() => {
    const countByDay = new Map<string, number>();

    tasks.forEach((task) => {
      const completedAt = task.completionWrapUp?.completedAt;
      if (task.status !== "done" || !completedAt) {
        return;
      }

      const key = formatDateKey(new Date(completedAt));
      countByDay.set(key, (countByDay.get(key) ?? 0) + 1);
    });

    return countByDay;
  }, [tasks]);
  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) ?? null,
    [selectedTaskId, tasks],
  );
  const selectedTaskProject = useMemo(
    () =>
      projects.find((project) => project.id === selectedTask?.projectId) ??
      null,
    [projects, selectedTask?.projectId],
  );
  const reportInputSignature = useMemo(
    () =>
      JSON.stringify({
        modelIds: selectedAiProfileIds,
        rangeEnd: selectedRange.rangeEnd,
        rangeStart: selectedRange.rangeStart,
        roleId: selectedAiRoleTemplate?.id ?? "",
        rolePrompt: selectedAiRoleTemplate?.prompt ?? preferences.aiRole,
        tasks: completedTasks.map((task) => ({
          body: task.body,
          checklist: task.checklist.map((item) => ({
            done: item.done,
            id: item.id,
            text: item.text,
          })),
          completionWrapUp: task.completionWrapUp,
          id: task.id,
          notes: task.notes,
          progressLog: task.progressLog,
          title: task.title,
          updatedAt: task.updatedAt,
        })),
      }),
    [
      completedTasks,
      preferences.aiRole,
      selectedAiProfileIds,
      selectedAiRoleTemplate?.id,
      selectedAiRoleTemplate?.prompt,
      selectedRange.rangeEnd,
      selectedRange.rangeStart,
    ],
  );
  const comparisonColumnCount =
    reportComparisons.length > 0
      ? reportComparisons.length
      : selectedAiProfiles.length;
  const generateActionLabel =
    reportComparisons.length > 0
      ? selectedAiProfiles.length > 1
        ? "重新对比"
        : "重新生成"
      : selectedAiProfiles.length > 1
        ? "对比"
        : "生成";

  useEffect(() => {
    if (hasPickedDate || !latestCompletedAt) {
      return;
    }

    const latestDate = new Date(latestCompletedAt);
    const latestDateInput = formatDateInput(latestDate);
    setSelectedStartDate(latestDateInput);
    setSelectedEndDate(latestDateInput);
    setVisibleMonth(
      new Date(latestDate.getFullYear(), latestDate.getMonth(), 1),
    );
  }, [hasPickedDate, latestCompletedAt]);

  useEffect(() => {
    setSelectedAiProfileIds((currentProfileIds) => {
      const validProfileIds = currentProfileIds.filter((profileId) =>
        preferences.aiProfiles.some((profile) => profile.id === profileId),
      );
      if (validProfileIds.length > 0) {
        return validProfileIds.length === currentProfileIds.length
          ? currentProfileIds
          : validProfileIds;
      }

      const fallbackProfile =
        preferences.aiProfiles.find(
          (profile) => profile.id === preferences.activeAiProfileId,
        ) ??
        preferences.aiProfiles[0] ??
        null;

      return fallbackProfile ? [fallbackProfile.id] : [];
    });

    if (
      preferences.aiRoleTemplates.length > 0 &&
      !preferences.aiRoleTemplates.some(
        (template) => template.id === selectedAiRoleTemplateId,
      )
    ) {
      setSelectedAiRoleTemplateId(
        preferences.activeAiRoleTemplateId || preferences.aiRoleTemplates[0].id,
      );
    }
  }, [
    preferences.activeAiProfileId,
    preferences.activeAiRoleTemplateId,
    preferences.aiProfiles,
    preferences.aiRoleTemplates,
    selectedAiRoleTemplateId,
  ]);

  useEffect(() => {
    setRegeneratingProfileIds([]);
    setReportComparisons([]);
  }, [reportInputSignature]);

  async function createComparisonReport(profile: AiProfile) {
    const controller = new AbortController();
    requestControllers.current.add(controller);
    try {
      return await createReportRecord({
        generation: {
          signal: controller.signal,
          apiKey: profile.apiKey,
          endpoint: profile.endpoint,
          extraBodyJson: profile.extraBodyJson,
          modelName: profile.model,
          roleName:
            selectedAiRoleTemplate?.name ??
            (preferences.aiRole ? "Current Role" : ""),
          rolePrompt: selectedAiRoleTemplate?.prompt ?? preferences.aiRole,
        },
        now: new Date(),
        projects,
        range: selectedRange,
        scopeLabel: selectedRange.label,
        tasks,
        type: "custom",
      });
    } finally {
      requestControllers.current.delete(controller);
    }
  }

  async function handleGenerateCompare() {
    if (
      selectedAiProfiles.length === 0 ||
      completedTasks.length === 0 ||
      isGeneratingCompare
    ) {
      return;
    }

    const runId = generationRunRef.current + 1;
    generationRunRef.current = runId;
    setIsGeneratingCompare(true);
    try {
      const nextComparisons = await Promise.all(
        selectedAiProfiles.map(async (profile) => {
          try {
            return {
              profileId: profile.id,
              profileName: profile.name,
              report: await createComparisonReport(profile),
            };
          } catch (error) {
            return {
              error:
                error instanceof Error
                  ? error.message
                  : "This model failed to generate a report.",
              profileId: profile.id,
              profileName: profile.name,
              report: null,
            };
          }
        }),
      );

      if (generationRunRef.current === runId) {
        setReportComparisons(nextComparisons);
      }
    } finally {
      if (generationRunRef.current === runId) {
        setIsGeneratingCompare(false);
      }
    }
  }

  async function handleRegenerateComparison(profileId: string) {
    const profile = preferences.aiProfiles.find(
      (item) => item.id === profileId,
    );
    if (!profile || regeneratingProfileIds.includes(profileId)) {
      return;
    }

    const runId = generationRunRef.current;
    setRegeneratingProfileIds((currentProfileIds) => [
      ...currentProfileIds,
      profileId,
    ]);
    showToast({ message: `正在重新生成：${profile.name}` });
    try {
      const report = await createComparisonReport(profile);
      if (generationRunRef.current !== runId) {
        return;
      }
      setReportComparisons((currentComparisons) =>
        currentComparisons.map((comparison) =>
          comparison.profileId === profileId
            ? {
                profileId: profile.id,
                profileName: profile.name,
                report,
              }
            : comparison,
        ),
      );
      showToast({ message: `已重新生成：${profile.name}` });
    } catch (error) {
      if (generationRunRef.current !== runId) {
        return;
      }
      setReportComparisons((currentComparisons) =>
        currentComparisons.map((comparison) =>
          comparison.profileId === profileId
            ? {
                error:
                  error instanceof Error
                    ? error.message
                    : "This model failed to generate a report.",
                profileId: profile.id,
                profileName: profile.name,
                report: null,
              }
            : comparison,
        ),
      );
      showToast({ message: `重新生成失败：${profile.name}` });
    } finally {
      if (generationRunRef.current === runId) {
        setRegeneratingProfileIds((currentProfileIds) =>
          currentProfileIds.filter(
            (currentProfileId) => currentProfileId !== profileId,
          ),
        );
      }
    }
  }

  async function handleCopyReport(content: string) {
    const text = content.trim();
    if (!text) {
      showToast({ message: "没有可复制的报告内容" });
      return;
    }

    try {
      if (navigator.clipboard?.writeText && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        showToast({ message: "报告已复制" });
        return;
      }

      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.left = "-9999px";
      textarea.style.opacity = "0";
      textarea.style.position = "fixed";
      textarea.style.top = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      textarea.setSelectionRange(0, textarea.value.length);
      const didCopy = document.execCommand("copy");
      document.body.removeChild(textarea);

      if (!didCopy) {
        throw new Error("Copy command was not accepted.");
      }

      showToast({ message: "报告已复制" });
    } catch {
      showToast({ message: "复制失败，请手动选中文本复制" });
    }
  }

  function handleCloseGenerateModal() {
    requestControllers.current.forEach((controller) => controller.abort());
    requestControllers.current.clear();
    generationRunRef.current += 1;
    setIsGenerateModalOpen(false);
    setIsGeneratingCompare(false);
    setRegeneratingProfileIds([]);
    setReportComparisons([]);
  }

  function handleAddComparisonModel(profileId: string) {
    if (
      !profileId ||
      selectedAiProfileIds.includes(profileId) ||
      selectedAiProfileIds.length >= MAX_REPORT_COMPARE_MODELS
    ) {
      return;
    }

    setSelectedAiProfileIds((currentProfileIds) => [
      ...currentProfileIds,
      profileId,
    ]);
    setModelPickerValue("");
    setReportComparisons([]);
  }

  function handleRemoveComparisonModel(profileId: string) {
    if (selectedAiProfileIds.length <= 1) {
      return;
    }

    setSelectedAiProfileIds((currentProfileIds) =>
      currentProfileIds.filter(
        (currentProfileId) => currentProfileId !== profileId,
      ),
    );
    setReportComparisons((currentComparisons) =>
      currentComparisons.filter(
        (comparison) => comparison.profileId !== profileId,
      ),
    );
  }

  function handleSelectDate(date: Date) {
    const nextDate = formatDateInput(date);
    setHasPickedDate(true);
    setVisibleMonth(new Date(date.getFullYear(), date.getMonth(), 1));
    setReportComparisons([]);

    if (!rangeAnchorDate) {
      setRangeAnchorDate(nextDate);
      setSelectedStartDate(nextDate);
      setSelectedEndDate(nextDate);
      return;
    }

    const anchor = parseDateInput(rangeAnchorDate);
    const next = parseDateInput(nextDate);
    const [start, end] =
      anchor.getTime() <= next.getTime()
        ? [rangeAnchorDate, nextDate]
        : [nextDate, rangeAnchorDate];
    setRangeAnchorDate(null);
    setSelectedStartDate(start);
    setSelectedEndDate(end);
  }

  function handleMonthChange(direction: -1 | 1) {
    setVisibleMonth(
      (current) =>
        new Date(current.getFullYear(), current.getMonth() + direction, 1),
    );
  }

  return (
    <div className="report-center report-center--workflow">
      <h2 className="sr-only">报告中心</h2>

      <section className="report-command-bar" aria-label="报告操作">
        <button
          className="report-range-trigger"
          onClick={() => setIsDateModalOpen(true)}
          type="button"
        >
          <span>TIME RANGE</span>
          <strong>{selectedRange.label}</strong>
        </button>

        <button
          className="report-generate-button"
          disabled={completedTasks.length === 0}
          onClick={() => setIsGenerateModalOpen(true)}
          title={
            completedTasks.length === 0
              ? "暂无已完成任务，无法生成报告"
              : "Generate AI Report"
          }
          type="button"
        >
          <span>Generate AI Report</span>
          <ReportGenerateIcon />
        </button>
      </section>

      <section
        className="report-workflow-panel report-completed-workflow report-completed-workflow--primary"
        aria-label="已完成任务"
      >
        <header className="report-workflow-header">
          <div>
            <p className="report-workspace__section-label">COMPLETED TASKS</p>
          </div>
          {isSingleDayRange ? null : <span>{selectedRange.label}</span>}
        </header>

        {completedTasks.length === 0 ? (
          <div className="empty-state report-completed-panel__empty">
            <h3>当前时间范围暂无已完成任务</h3>
            <p>完成任务后，可在这里生成 AI 报告。</p>
          </div>
        ) : (
          <div className="report-completed-list">
            {completedTaskGroups.map((group) => (
              <section className="report-completed-group" key={group.dateKey}>
                {isSingleDayRange ? null : (
                  <header className="report-completed-group__header">
                    <span>{group.label}</span>
                    <small>
                      {group.tasks.length}{" "}
                      {group.tasks.length === 1 ? "task" : "tasks"}
                    </small>
                  </header>
                )}
                {group.tasks.map((task) => {
                  const completedAt = new Date(getCompletedAt(task));
                  const preview = getTaskReportPreview(task);
                  return (
                    <article className="report-completed-item" key={task.id}>
                      <time dateTime={getCompletedAt(task)}>
                        {formatTaskTime(completedAt)}
                      </time>
                      <div className="report-completed-item__content">
                        <strong title={task.title}>{task.title}</strong>
                        {preview ? <p title={preview}>{preview}</p> : null}
                      </div>
                      <button
                        aria-label="编辑"
                        className="icon-button icon-action icon-action--neutral report-completed-edit"
                        data-tooltip="编辑"
                        onClick={() => setSelectedTaskId(task.id)}
                        title="编辑"
                        type="button"
                      >
                        <ReportEditIcon />
                      </button>
                    </article>
                  );
                })}
              </section>
            ))}
          </div>
        )}
        <footer className="report-completed-summary">
          {completedTasks.length}{" "}
          {completedTasks.length === 1 ? "completed task" : "completed tasks"}
        </footer>
      </section>

      {isDateModalOpen ? (
        <Modal
          className="report-time-modal"
          onClose={() => {
            setRangeAnchorDate(null);
            setIsDateModalOpen(false);
          }}
          title="选择时间"
        >
          <div className="report-time-modal__body">
            <div className="report-date-range-fields">
              <div className="field">
                <span>开始</span>
                <button
                  aria-label="查看开始日期"
                  className="report-date-display"
                  onClick={() => {
                    setRangeAnchorDate(null);
                    setVisibleMonth(parseDateInput(selectedStartDate));
                  }}
                  type="button"
                >
                  {formatFullDateLabel(selectedStartDate)}
                </button>
              </div>
              <div className="field">
                <span>结束</span>
                <button
                  aria-label="查看结束日期"
                  className="report-date-display"
                  onClick={() => {
                    setRangeAnchorDate(selectedStartDate);
                    setVisibleMonth(parseDateInput(selectedEndDate));
                  }}
                  type="button"
                >
                  {formatFullDateLabel(selectedEndDate)}
                </button>
              </div>
            </div>

            <section className="report-calendar-card">
              <div className="report-calendar-card__header">
                <button
                  aria-label="上个月"
                  className="icon-button report-calendar-card__nav"
                  onClick={() => handleMonthChange(-1)}
                  type="button"
                >
                  <CalendarChevronIcon direction="left" />
                </button>
                <div>
                  <span>日历</span>
                  <strong>{formatMonthLabel(visibleMonth)}</strong>
                </div>
                <button
                  aria-label="下个月"
                  className="icon-button report-calendar-card__nav"
                  onClick={() => handleMonthChange(1)}
                  type="button"
                >
                  <CalendarChevronIcon direction="right" />
                </button>
              </div>

              <div
                className="report-calendar-grid report-calendar-grid--weekdays"
                aria-hidden="true"
              >
                {WEEKDAY_LABELS.map((weekday) => (
                  <span key={weekday}>{weekday}</span>
                ))}
              </div>

              <div className="report-calendar-grid" role="grid">
                {calendarDates.map((date) => {
                  const dateKey = formatDateKey(date);
                  const rangeStartKey = formatDateKey(
                    new Date(selectedRange.rangeStart),
                  );
                  const rangeEndKey = formatDateKey(
                    new Date(selectedRange.rangeEnd),
                  );
                  const isCurrentMonth =
                    date.getMonth() === visibleMonth.getMonth();
                  const isSelected =
                    dateKey === rangeStartKey || dateKey === rangeEndKey;
                  const inRange = isInRange(date, selectedRange);
                  const taskCount = completedCountByDay.get(dateKey) ?? 0;

                  return (
                    <button
                      className={[
                        "report-calendar-day",
                        isCurrentMonth ? "" : "report-calendar-day--muted",
                        isSelected ? "report-calendar-day--selected" : "",
                        inRange ? "report-calendar-day--in-range" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      key={dateKey}
                      onClick={() => handleSelectDate(date)}
                      type="button"
                    >
                      <span>{date.getDate()}</span>
                      {taskCount > 0 ? (
                        <i aria-label={`${taskCount} 个已完成任务`} />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </section>
          </div>

          <footer className="report-time-modal__footer">
            <div>
              <span>已选范围</span>
              <strong>
                {rangeAnchorDate
                  ? `${selectedRange.label} · 选择结束日`
                  : selectedRange.label}
              </strong>
            </div>
            <button
              onClick={() => {
                setRangeAnchorDate(null);
                setIsDateModalOpen(false);
              }}
              type="button"
            >
              完成
            </button>
          </footer>
        </Modal>
      ) : null}

      {isGenerateModalOpen ? (
        <Modal
          className="report-generate-modal"
          onClose={handleCloseGenerateModal}
          title="生成报告"
        >
          <div className="report-generate-flow">
            <section
              className="report-generate-setup"
              aria-label="模型对比配置"
            >
              <p className="report-generate-setup-title">生成参数</p>
              <div className="report-generate-section">
                <p className="report-generate-section__label">日期</p>
                <button
                  aria-label="选择报告时间范围"
                  className="report-generate-time-choice"
                  onClick={() => {
                    setRangeAnchorDate(null);
                    setIsDateModalOpen(true);
                  }}
                  type="button"
                >
                  <span>{selectedRange.label}</span>
                  <small>{completedTasks.length} 个已完成</small>
                </button>
              </div>

              <div className="report-generate-section">
                <div className="report-generate-setup__header">
                  <div>
                    <p>模型</p>
                    <span className="report-generate-model-count">
                      已选 {selectedAiProfiles.length}/
                      {MAX_REPORT_COMPARE_MODELS}
                    </span>
                  </div>
                </div>

                <div className="report-generate-model-bar">
                  {selectedAiProfiles.map((profile, index) => (
                    <div
                      className="report-generate-model-card"
                      key={profile.id}
                    >
                      <span>API {index + 1}</span>
                      <strong>{profile.name}</strong>
                      {selectedAiProfiles.length > 1 ? (
                        <button
                          aria-label={`Remove model ${profile.name}`}
                          className="report-generate-model-remove"
                          onClick={() =>
                            handleRemoveComparisonModel(profile.id)
                          }
                          type="button"
                        >
                          x
                        </button>
                      ) : null}
                    </div>
                  ))}

                  {selectedAiProfiles.length < MAX_REPORT_COMPARE_MODELS ? (
                    availableAiProfiles.length > 0 ? (
                      <label className="report-generate-model-add">
                        <span className="sr-only">Add API</span>
                        <select
                          aria-label="Add API"
                          title="添加模型"
                          onChange={(event) =>
                            handleAddComparisonModel(event.target.value)
                          }
                          value={modelPickerValue}
                        >
                          <option value="">+</option>
                          {availableAiProfiles.map((profile) => (
                            <option key={profile.id} value={profile.id}>
                              {profile.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : (
                      <button
                        aria-label="在设置中添加模型"
                        className="report-generate-model-add report-generate-model-add--disabled"
                        disabled
                        type="button"
                      >
                        <span className="sr-only">Add API</span>
                      </button>
                    )
                  ) : null}
                </div>
              </div>

              <div className="report-generate-section report-generate-controls">
                <section className="report-generate-role" aria-label="角色">
                  <span className="report-generate-section__label">角色</span>
                  {preferences.aiRoleTemplates.length === 0 ? (
                    <div className="report-generate-role__empty">
                      暂无角色模板
                    </div>
                  ) : (
                    <div className="report-generate-role__list">
                      {preferences.aiRoleTemplates.map((template) => {
                        const isSelected =
                          selectedAiRoleTemplate?.id === template.id;
                        return (
                          <button
                            aria-pressed={isSelected}
                            className={
                              isSelected
                                ? "report-generate-role__item report-generate-role__item--active"
                                : "report-generate-role__item"
                            }
                            key={template.id}
                            onClick={() => {
                              setSelectedAiRoleTemplateId(template.id);
                              setReportComparisons([]);
                            }}
                            type="button"
                          >
                            <span>
                              <strong>{template.name}</strong>
                            </span>
                            {isSelected ? <b>当前</b> : null}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </section>
                <button
                  className={[
                    "report-generate-modal__action",
                    reportComparisons.length > 0
                      ? "report-generate-modal__action--secondary"
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  disabled={
                    selectedAiProfiles.length === 0 ||
                    completedTasks.length === 0 ||
                    isGeneratingCompare
                  }
                  onClick={() => void handleGenerateCompare()}
                  type="button"
                >
                  <span>{generateActionLabel}</span>
                  <ReportGenerateIcon />
                </button>
              </div>
            </section>

            <section className="report-generate-output" aria-label="生成结果">
              <header className="report-generate-output__header">
                <div>
                  <strong>
                    {reportComparisons.length > 0
                      ? `${reportComparisons.length} 版草稿`
                      : "报告内容"}
                  </strong>
                </div>
              </header>

              {reportComparisons.length > 0 ||
              (isGeneratingCompare && selectedAiProfiles.length > 0) ? (
                <div
                  className={[
                    "report-compare-grid",
                    comparisonColumnCount <= 1
                      ? "report-compare-grid--single"
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {reportComparisons.length > 0
                    ? reportComparisons.map((comparison) => (
                        <ReportComparisonCard
                          comparison={comparison}
                          isRegenerating={regeneratingProfileIds.includes(
                            comparison.profileId,
                          )}
                          key={comparison.profileId}
                          onCopy={handleCopyReport}
                          onRegenerate={() =>
                            handleRegenerateComparison(comparison.profileId)
                          }
                        />
                      ))
                    : selectedAiProfiles.map((profile) => (
                        <ReportComparisonSkeleton
                          key={profile.id}
                          profileName={profile.name}
                        />
                      ))}
                </div>
              ) : (
                <div className="report-compare-empty">
                  <span>暂无报告内容</span>
                  <p>选择模型和角色后，点击生成。</p>
                </div>
              )}
            </section>
          </div>
        </Modal>
      ) : null}

      {selectedTaskId && selectedTaskProject ? (
        <TaskDetailPanel
          onClose={() => setSelectedTaskId(null)}
          onDeleted={() => setSelectedTaskId(null)}
          onSaved={() => setSelectedTaskId(null)}
          project={selectedTaskProject}
          taskId={selectedTaskId}
        />
      ) : null}
    </div>
  );
}
