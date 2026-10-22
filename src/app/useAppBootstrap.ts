import { useEffect, useRef, useState } from "react";
import { useFocusStore } from "../features/focus/focusStore";
import { usePreferenceStore } from "../features/preferences/preferenceStore";
import { useProjectStore } from "../features/projects/projectStore";
import { useReportStore } from "../features/reports/reportStore";
import { useTaskStore } from "../features/tasks/taskStore";
import { restoreLocalSnapshot } from "../lib/localPersistence/localSnapshotSync";

export function useAppBootstrap() {
  const isProjectsLoaded = useProjectStore((state) => state.isLoaded);
  const loadProjects = useProjectStore((state) => state.loadProjects);
  const isTasksLoaded = useTaskStore((state) => state.isLoaded);
  const loadTasks = useTaskStore((state) => state.loadTasks);
  const isFocusLoaded = useFocusStore((state) => state.isLoaded);
  const loadFocus = useFocusStore((state) => state.loadFocus);
  const isReportsLoaded = useReportStore((state) => state.isLoaded);
  const loadReports = useReportStore((state) => state.loadReports);
  const isPreferencesLoaded = usePreferenceStore((state) => state.isLoaded);
  const loadPreferences = usePreferenceStore((state) => state.loadPreferences);
  const bootstrapStartedRef = useRef(false);
  const [loadError, setLoadError] = useState<Error | null>(null);

  useEffect(() => {
    const failed = () =>
      setLoadError(new Error("工作区数据加载失败，请重新加载。"));
    if (import.meta.env.DEV && import.meta.env.MODE !== "test") {
      if (bootstrapStartedRef.current) {
        return;
      }

      bootstrapStartedRef.current = true;

      void (async () => {
        await restoreLocalSnapshot();
        await Promise.all([
          loadProjects(),
          loadTasks(),
          loadFocus(),
          loadReports(),
          loadPreferences(),
        ]);
      })().catch(failed);
      return;
    }

    if (!isProjectsLoaded) {
      void loadProjects().catch(failed);
    }
    if (!isTasksLoaded) {
      void loadTasks().catch(failed);
    }
    if (!isFocusLoaded) {
      void loadFocus().catch(failed);
    }
    if (!isReportsLoaded) {
      void loadReports().catch(failed);
    }
    if (!isPreferencesLoaded) {
      void loadPreferences().catch(failed);
    }
  }, [
    isFocusLoaded,
    isPreferencesLoaded,
    isProjectsLoaded,
    isReportsLoaded,
    isTasksLoaded,
    loadFocus,
    loadPreferences,
    loadProjects,
    loadReports,
    loadTasks,
  ]);

  if (loadError) throw loadError;

  return {
    ready:
      isProjectsLoaded &&
      isTasksLoaded &&
      isFocusLoaded &&
      isReportsLoaded &&
      isPreferencesLoaded,
  };
}
