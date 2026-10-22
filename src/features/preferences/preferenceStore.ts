import { create } from "zustand";
import { DEFAULT_PREFERENCES } from "../../lib/constants";
import { queueLocalSnapshotSync } from "../../lib/localPersistence/localSnapshotApi";
import { preferenceRepository } from "../../lib/storage/preferenceRepository";
import { createWriteQueue } from "../../lib/storage/writeQueue";
import type { Preferences } from "../../types/preferences";

type PreferenceState = {
  isLoaded: boolean;
  loadPreferences: () => Promise<Preferences>;
  preferences: Preferences;
  savePreferences: (
    update: Partial<
      Pick<
        Preferences,
        | "activeAiProfileId"
        | "activeAiRoleTemplateId"
        | "aiEndpoint"
        | "aiKey"
        | "aiProfiles"
        | "aiRole"
        | "aiRolePresets"
        | "aiRoleTemplates"
        | "laneColors"
        | "todayStepDocked"
        | "todayStepHandlePosition"
        | "todayStepPinned"
        | "todayStepShortcut"
        | "theme"
      >
    >,
  ) => Promise<Preferences>;
};

const writePreferences = createWriteQueue();

export const usePreferenceStore = create<PreferenceState>((set, get) => ({
  isLoaded: false,
  async loadPreferences() {
    const preferences = await preferenceRepository.load();
    set({ isLoaded: true, preferences });
    return preferences;
  },
  preferences: DEFAULT_PREFERENCES,
  async savePreferences(update) {
    return writePreferences(async () => {
      const currentPreferences = get().preferences;
      const activeAiProfileId =
        update.activeAiProfileId ?? currentPreferences.activeAiProfileId;
      const aiProfiles = (
        update.aiProfiles ?? currentPreferences.aiProfiles
      ).map((profile) =>
        profile.id === activeAiProfileId
          ? {
              ...profile,
              apiKey: update.aiKey ?? profile.apiKey,
              endpoint: update.aiEndpoint ?? profile.endpoint,
            }
          : profile,
      );
      const nextPreferences: Preferences = {
        ...currentPreferences,
        ...update,
        activeAiProfileId,
        aiProfiles,
        aiRolePresets: update.aiRoleTemplates
          ? update.aiRoleTemplates
              .filter((template) => !template.builtIn)
              .map((template) => ({
                id: template.id,
                label: template.name,
                prompt: template.prompt,
              }))
          : (update.aiRolePresets ?? currentPreferences.aiRolePresets),
        laneColors: {
          ...currentPreferences.laneColors,
          ...update.laneColors,
        },
        updatedAt: new Date().toISOString(),
      };
      const savedPreferences = await preferenceRepository.save(nextPreferences);
      set({ preferences: savedPreferences });
      queueLocalSnapshotSync();
      return savedPreferences;
    });
  },
}));
