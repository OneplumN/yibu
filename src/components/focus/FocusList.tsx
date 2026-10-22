import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  TASK_PRIORITY_LABELS,
  TASK_PRIORITY_ORDER,
  TASK_STATUS_LABELS,
} from "../../lib/constants";
import type { Project } from "../../types/project";
import type { Task, TaskPriority } from "../../types/task";
import { getReorderedIds, useSortableCards, type DropPosition } from "../../lib/interaction/useSortableCards";

export type FocusListItem = {
  project: Project;
  task: Task;
};

const FOCUS_GLASS_PALETTE = [
  {
    border: "rgba(216, 162, 74, 0.22)",
    shadow: "rgba(216, 162, 74, 0.08)",
    surface: "rgba(255, 248, 236, 0.92)",
  },
  {
    border: "rgba(90, 200, 250, 0.2)",
    shadow: "rgba(90, 200, 250, 0.08)",
    surface: "rgba(241, 248, 253, 0.92)",
  },
  {
    border: "rgba(52, 211, 153, 0.2)",
    shadow: "rgba(52, 211, 153, 0.08)",
    surface: "rgba(242, 250, 245, 0.92)",
  },
  {
    border: "rgba(125, 138, 255, 0.18)",
    shadow: "rgba(125, 138, 255, 0.08)",
    surface: "rgba(245, 246, 252, 0.92)",
  },
] as const;

function getGlassTone(taskId: string) {
  const hash = Array.from(taskId).reduce(
    (value, character) => value + character.charCodeAt(0),
    0,
  );
  return FOCUS_GLASS_PALETTE[hash % FOCUS_GLASS_PALETTE.length];
}

function FocusIcon({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <span aria-hidden="true" className="focus-card__icon">
      {children}
    </span>
  );
}

function PencilIcon() {
  return (
    <svg fill="none" height="18" viewBox="0 0 24 24" width="18">
      <path
        d="M12 20h9"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path
        d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg fill="none" height="18" viewBox="0 0 24 24" width="18">
      <path
        d="m5 12 5 5L20 7"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function RemoveIcon() {
  return (
    <svg fill="none" height="18" viewBox="0 0 24 24" width="18">
      <path
        d="m18 6-12 12"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path
        d="m6 6 12 12"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function FocusPriorityControl({
  onChangePriority,
  priority,
  taskId,
}: {
  onChangePriority: (taskId: string, priority: TaskPriority) => void;
  priority: TaskPriority;
  taskId: string;
}) {
  const [open, setOpen] = useState(false);
  const controlRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !controlRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
        controlRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [open]);

  return (
    <div
      className="focus-priority"
      ref={controlRef}
      data-focus-control="true"
      data-no-drag="true"
    >
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`修改优先级：${TASK_PRIORITY_LABELS[priority]}`}
        className={`priority-pill priority-pill--${priority} focus-priority__trigger`}
        title="修改优先级"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        {TASK_PRIORITY_LABELS[priority]}
      </button>

      {open ? (
        <div className="focus-priority__menu" role="menu">
          {TASK_PRIORITY_ORDER.map((nextPriority) => (
            <button
              role="menuitemradio"
              aria-checked={nextPriority === priority}
              className={
                nextPriority === priority
                  ? `focus-priority__option focus-priority__option--${nextPriority} focus-priority__option--active`
                  : `focus-priority__option focus-priority__option--${nextPriority}`
              }
              key={nextPriority}
              onClick={() => {
                onChangePriority(taskId, nextPriority);
                setOpen(false);
              }}
              type="button"
            >
              {TASK_PRIORITY_LABELS[nextPriority]}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FocusCard({
  dragMode,
  dropPosition,
  index,
  item,
  onBeginDrag,
  onChangePriority,
  onOpenTask,
  onRemoveTask,
  onUpdateStatus,
  previewLimit,
}: {
  dragMode: "dragging" | "idle" | "target";
  dropPosition: DropPosition;
  index: number;
  item: FocusListItem;
  onBeginDrag: (event: React.PointerEvent<HTMLElement>, taskId: string) => void;
  onChangePriority: (taskId: string, priority: TaskPriority) => void;
  onOpenTask: (taskId: string) => void;
  onRemoveTask: (taskId: string) => void;
  onUpdateStatus: (taskId: string, status: "done") => void;
  previewLimit: number;
}) {
  const { task } = item;
  const glassTone = getGlassTone(task.id);
  const pendingTasklist = task.checklist.filter((checklistItem) => !checklistItem.done);
  const tasklistPreview = pendingTasklist.slice(0, previewLimit);
  const completedTaskCount = task.checklist.length - pendingTasklist.length;
  const footerLabel =
    task.status === "blocked"
      ? TASK_STATUS_LABELS[task.status]
      : task.checklist.length > 0
        ? `${completedTaskCount}/${task.checklist.length}`
        : task.status === "todo"
          ? "待开始"
          : "";

  return (
    <article
      className={
        dragMode === "dragging"
          ? "focus-card focus-card--dragging"
        : dragMode === "target"
            ? `focus-card focus-card--target focus-card--drop-${dropPosition}`
            : "focus-card"
      }
      data-sortable-id={task.id}
      style={
        {
          "--focus-card-border": glassTone.border,
          "--focus-card-shadow": glassTone.shadow,
          "--focus-card-surface": glassTone.surface,
        } as CSSProperties
      }
      onPointerDown={(event) => onBeginDrag(event, task.id)}
    >
      <div className="focus-card__top">
        <div className="focus-card__title" role="group" aria-label={`焦点任务：${task.title}`}>
          <span className="focus-card__title-line">
            <FocusPriorityControl
              onChangePriority={onChangePriority}
              priority={task.priority}
              taskId={task.id}
            />
            <span className="focus-card__title-static">
              <span className="focus-card__title-text">{task.title}</span>
            </span>
          </span>
        </div>
        <button
          aria-label="移出"
          className="icon-button focus-card__remove"
          data-no-drag="true"
          data-tooltip="移出"
          onClick={() => onRemoveTask(task.id)}
          title="移出"
          type="button"
        >
          <FocusIcon>
            <RemoveIcon />
          </FocusIcon>
        </button>
      </div>

      {task.checklist.length > 0 ? (
        <div className="focus-card__tasklist">
          <p className="eyebrow">清单</p>
          {tasklistPreview.length > 0 ? (
            <>
              <ol className="focus-card__tasklist-items">
                {tasklistPreview.map((itemPreview, previewIndex) => (
                  <li key={itemPreview.id}>
                    <span className="focus-card__tasklist-index">{previewIndex + 1}.</span>
                    <span className="focus-card__tasklist-text">{itemPreview.text}</span>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <div className="focus-card__tasklist-empty">
              <strong>清单已完成</strong>
            </div>
          )}
        </div>
      ) : null}

      <div className="focus-card__footer">
        <div className="focus-card__footer-meta">
          {footerLabel ? (
            task.status === "blocked" ? (
              <span className={`status-pill status-pill--${task.status}`}>{footerLabel}</span>
            ) : (
              <span className="focus-card__progress">{footerLabel}</span>
            )
          ) : null}
        </div>
        <div className="focus-card__actions">
          <button
            aria-label="编辑"
            className="icon-button focus-card__action focus-card__action--edit"
            data-tooltip="编辑"
            data-no-drag="true"
            onClick={() => onOpenTask(task.id)}
            title="编辑"
            type="button"
          >
            <FocusIcon>
              <PencilIcon />
            </FocusIcon>
          </button>
          {task.status !== "done" ? (
            <button
              aria-label="完成"
              className="icon-button focus-card__action focus-card__action--complete"
              data-tooltip="完成"
              data-no-drag="true"
              onClick={() => onUpdateStatus(task.id, "done")}
              title="完成"
              type="button"
            >
              <FocusIcon>
                <CheckIcon />
              </FocusIcon>
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export function FocusList({
  items,
  onChangePriority,
  onOpenTask,
  onRemoveTask,
  onReorder,
  onUpdateStatus,
  previewLimit = 3,
}: {
  items: FocusListItem[];
  onChangePriority: (taskId: string, priority: TaskPriority) => void;
  onOpenTask: (taskId: string) => void;
  onRemoveTask: (taskId: string) => void;
  onReorder: (taskId: string, toIndex: number) => void;
  onUpdateStatus: (taskId: string, status: "done") => void;
  previewLimit?: number;
}) {
  const { beginDrag, dragState } = useSortableCards({
    onReorder: (draggedId, targetId, position) => {
      const orderedIds = getReorderedIds(
        items.map((item) => item.task.id),
        draggedId,
        targetId,
        position,
      );
      onReorder(draggedId, orderedIds.indexOf(draggedId));
    },
    selector: ".focus-card[data-sortable-id]",
  });

  if (items.length === 0) {
    return (
      <div className="empty-state">
        <h3>今天还没有焦点任务</h3>
      </div>
    );
  }

  return (
    <div className="focus-list focus-list--cards">
      {items.map((item, index) => (
        <FocusCard
          dragMode={
            dragState.draggedId === item.task.id
              ? "dragging"
              : dragState.overId === item.task.id
                ? "target"
                : "idle"
          }
          dropPosition={dragState.dropPosition}
          index={index}
          item={item}
          key={item.task.id}
          onBeginDrag={beginDrag}
          onChangePriority={onChangePriority}
          onOpenTask={onOpenTask}
          onRemoveTask={onRemoveTask}
          onUpdateStatus={onUpdateStatus}
          previewLimit={previewLimit}
        />
      ))}
    </div>
  );
}
