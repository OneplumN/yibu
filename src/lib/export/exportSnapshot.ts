import type { FocusReference } from "../../types/focus";
import type { Preferences } from "../../types/preferences";
import type { Project } from "../../types/project";
import type { SavedReport } from "../../types/report";
import type { Task } from "../../types/task";
import { getStorageAdapter } from "../storage/getStorageAdapter";
import { normalizePreferences } from "../storage/preferenceRepository";

export type AppSnapshot = {
  exportedAt: string;
  focusRefs: FocusReference[];
  preferences: Preferences;
  projects: Project[];
  reports: SavedReport[];
  tasks: Task[];
  version: 1;
  credentialsIncluded?: boolean;
};

export async function exportSnapshot({
  includeSecrets = false,
} = {}): Promise<AppSnapshot> {
  const {
    projects,
    tasks,
    focusRefs,
    reports,
    preferences: storedPreferences,
  } = await getStorageAdapter().readSnapshot();
  const preferences = normalizePreferences(storedPreferences);
  if (!includeSecrets) {
    preferences.aiKey = "";
    preferences.aiProfiles = preferences.aiProfiles.map((profile) => ({
      ...profile,
      apiKey: "",
    }));
  }

  return {
    exportedAt: new Date().toISOString(),
    credentialsIncluded: includeSecrets,
    focusRefs,
    preferences,
    projects,
    reports,
    tasks,
    version: 1,
  };
}
