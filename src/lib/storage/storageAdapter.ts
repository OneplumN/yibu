import type { FocusReference } from "../../types/focus";
import type { Preferences } from "../../types/preferences";
import type { Project } from "../../types/project";
import type { SavedReport } from "../../types/report";
import type { Task } from "../../types/task";

export type StorageSnapshot = {
  projects: Project[];
  tasks: Task[];
  focusRefs: FocusReference[];
  reports: SavedReport[];
  preferences: Preferences;
};

export type StorageAdapter = {
  readSnapshot: () => Promise<
    Omit<StorageSnapshot, "preferences"> & { preferences?: Preferences }
  >;
  replaceSnapshot: (snapshot: StorageSnapshot) => Promise<void>;
  focusRefs: {
    add: (reference: FocusReference) => Promise<FocusReference>;
    clear: () => Promise<void>;
    list: () => Promise<FocusReference[]>;
    remove: (taskId: string) => Promise<void>;
    replaceAll: (
      references: FocusReference[],
      expected?: FocusReference[],
    ) => Promise<FocusReference[]>;
  };
  preferences: {
    load: () => Promise<Preferences | undefined>;
    save: (preferences: Preferences) => Promise<Preferences>;
  };
  projects: {
    saveIfUnchanged: (
      projects: Project[],
      expected: Project[],
    ) => Promise<boolean>;
    delete: (projectId: string) => Promise<void>;
    get: (projectId: string) => Promise<Project | undefined>;
    list: () => Promise<Project[]>;
    save: (project: Project) => Promise<Project>;
  };
  reports: {
    delete: (reportId: string) => Promise<void>;
    get: (reportId: string) => Promise<SavedReport | undefined>;
    list: () => Promise<SavedReport[]>;
    save: (report: SavedReport) => Promise<SavedReport>;
  };
  reset: () => Promise<void>;
  tasks: {
    saveIfUnchanged: (task: Task, expected: Task) => Promise<boolean>;
    delete: (taskId: string) => Promise<void>;
    get: (taskId: string) => Promise<Task | undefined>;
    listAll: () => Promise<Task[]>;
    listByIds: (taskIds: string[]) => Promise<Task[]>;
    listByProject: (projectId: string) => Promise<Task[]>;
    save: (task: Task) => Promise<Task>;
  };
};

export function sortByCreatedAtDesc<T extends { createdAt: string }>(
  items: T[],
) {
  return [...items].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );
}

export function sortByUpdatedAtDesc<T extends { updatedAt: string }>(
  items: T[],
) {
  return [...items].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
}

export function sortFocusRefs(items: FocusReference[]) {
  return [...items].sort((left, right) => {
    if (left.order !== undefined && right.order !== undefined) {
      return left.order - right.order;
    }
    return left.addedAt.localeCompare(right.addedAt);
  });
}
