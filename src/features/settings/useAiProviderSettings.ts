import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { AI_PROVIDER_PRESETS } from "../../lib/constants";
import {
  fetchAvailableModels,
  testChatCompletion,
  type ApiTestResult,
  type ModelListResult,
} from "../../lib/ai/llmClient";
import type {
  AiProfile,
  AiProviderPreset,
  Preferences,
} from "../../types/preferences";
import type {
  ConfirmingDelete,
  PendingAiProfile,
  SavePreferences,
} from "./settingsTypes";

type UseAiProviderSettingsOptions = {
  confirmingDelete: ConfirmingDelete | null;
  draft: Preferences;
  savePreferences: SavePreferences;
  setConfirmingDelete: Dispatch<SetStateAction<ConfirmingDelete | null>>;
  setDraft: Dispatch<SetStateAction<Preferences>>;
  showToast: (toast: { message: string }) => void;
};

function mergeAiModels(models: string[], nextModel: string) {
  const trimmedModel = nextModel.trim();
  if (!trimmedModel) {
    return models;
  }

  return [...models, trimmedModel].filter(
    (model, index, allModels) => allModels.indexOf(model) === index,
  );
}

function getFallbackAiProfile(): AiProfile {
  return {
    apiKey: "",
    endpoint: "",
    extraBodyJson: "",
    id: "",
    model: "",
    models: [],
    modelsEndpoint: "",
    name: "服务商 1",
    preset: "custom",
  };
}

export function useAiProviderSettings({
  confirmingDelete,
  draft,
  savePreferences,
  setConfirmingDelete,
  setDraft,
  showToast,
}: UseAiProviderSettingsOptions) {
  const [isAiKeyVisible, setIsAiKeyVisible] = useState(false);
  const [apiTestResult, setApiTestResult] = useState<ApiTestResult | null>(
    null,
  );
  const [modelListResult, setModelListResult] =
    useState<ModelListResult | null>(null);
  const [draftModelName, setDraftModelName] = useState("");
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [isTestingApi, setIsTestingApi] = useState(false);
  const [pendingAiProfile, setPendingAiProfile] =
    useState<PendingAiProfile | null>(null);
  const requestGeneration = useRef(0);
  const controllers = useRef(new Set<AbortController>());

  useEffect(
    () => () => {
      requestGeneration.current += 1;
      controllers.current.forEach((controller) => controller.abort());
      controllers.current.clear();
    },
    [],
  );

  function invalidateRequests() {
    controllers.current.forEach((controller) => controller.abort());
    controllers.current.clear();
    requestGeneration.current += 1;
    setIsFetchingModels(false);
    setIsTestingApi(false);
    setApiTestResult(null);
    setModelListResult(null);
  }

  const activeAiProfile =
    draft.aiProfiles.find(
      (profile) => profile.id === draft.activeAiProfileId,
    ) ??
    draft.aiProfiles[0] ??
    getFallbackAiProfile();
  const fetchedAiModels = modelListResult?.ok
    ? modelListResult.models.filter(
        (model) => !activeAiProfile.models.includes(model),
      )
    : [];

  function handleSelectAiProfile(profileId: string) {
    if (pendingAiProfile && profileId !== pendingAiProfile.id) {
      return;
    }

    invalidateRequests();
    setDraft((current) => {
      const profile =
        current.aiProfiles.find((candidate) => candidate.id === profileId) ??
        current.aiProfiles[0];
      return {
        ...current,
        activeAiProfileId: profile.id,
        aiEndpoint: profile.endpoint,
        aiKey: profile.apiKey,
      };
    });
    setIsAiKeyVisible(false);
    setApiTestResult(null);
    setModelListResult(null);
    setDraftModelName("");
    setConfirmingDelete(null);
  }

  function handleSelectBuiltinAiProvider(
    preset: Exclude<AiProviderPreset, "custom">,
  ) {
    if (pendingAiProfile) {
      return;
    }

    invalidateRequests();
    const presetConfig = AI_PROVIDER_PRESETS[preset];
    setDraft((current) => {
      const existingProfile = current.aiProfiles.find(
        (candidate) => candidate.preset === preset,
      );
      if (existingProfile) {
        return {
          ...current,
          activeAiProfileId: existingProfile.id,
          aiEndpoint: existingProfile.endpoint,
          aiKey: existingProfile.apiKey,
        };
      }

      const nextProfile: AiProfile = {
        apiKey: "",
        endpoint: presetConfig.endpoint,
        extraBodyJson: "",
        id: crypto.randomUUID(),
        model: "",
        models: [],
        modelsEndpoint: presetConfig.modelsEndpoint,
        name: presetConfig.label,
        preset,
      };
      return {
        ...current,
        activeAiProfileId: nextProfile.id,
        aiEndpoint: nextProfile.endpoint,
        aiKey: nextProfile.apiKey,
        aiProfiles: [...current.aiProfiles, nextProfile],
      };
    });
    setIsAiKeyVisible(false);
    setApiTestResult(null);
    setModelListResult(null);
    setDraftModelName("");
    setConfirmingDelete(null);
  }

  function handleUpdateActiveAiProfile(update: Partial<AiProfile>) {
    invalidateRequests();
    setDraft((current) => {
      const profiles = current.aiProfiles.map((profile) =>
        profile.id === current.activeAiProfileId
          ? { ...profile, ...update }
          : profile,
      );
      const activeProfile =
        profiles.find((profile) => profile.id === current.activeAiProfileId) ??
        profiles[0];
      return {
        ...current,
        aiEndpoint: activeProfile.endpoint,
        aiKey: activeProfile.apiKey,
        aiProfiles: profiles,
      };
    });
    setApiTestResult(null);
  }

  function handleResetActiveAiEndpoint() {
    handleUpdateActiveAiProfile({
      endpoint: AI_PROVIDER_PRESETS[activeAiProfile.preset].endpoint,
      modelsEndpoint:
        AI_PROVIDER_PRESETS[activeAiProfile.preset].modelsEndpoint,
    });
    setModelListResult(null);
  }

  function handleSelectAiModel(model: string) {
    handleUpdateActiveAiProfile({
      model,
      models: mergeAiModels(activeAiProfile.models, model),
    });
  }

  function handleAddAiModel(model: string) {
    const trimmedModel = model.trim();
    if (!trimmedModel) {
      return;
    }

    handleSelectAiModel(trimmedModel);
    setDraftModelName("");
  }

  function handleDeleteAiModel(model: string) {
    const nextModels = activeAiProfile.models.filter(
      (candidate) => candidate !== model,
    );
    handleUpdateActiveAiProfile({
      model:
        activeAiProfile.model === model
          ? (nextModels[0] ?? "")
          : activeAiProfile.model,
      models: nextModels,
    });
  }

  async function handleFetchAiModels() {
    if (!activeAiProfile.endpoint.trim()) {
      setModelListResult({
        error: "请先填写服务地址。",
        ok: false,
        status: 0,
      });
      return;
    }

    setIsFetchingModels(true);
    setModelListResult(null);
    const generation = requestGeneration.current;
    const controller = new AbortController();
    controllers.current.add(controller);
    const result = await fetchAvailableModels({
      apiKey: activeAiProfile.apiKey,
      endpoint: activeAiProfile.endpoint,
      modelsEndpoint: activeAiProfile.modelsEndpoint,
      signal: controller.signal,
    });
    controllers.current.delete(controller);
    if (generation !== requestGeneration.current) return;
    setModelListResult(result);
    setIsFetchingModels(false);
    if (result.ok) {
      showToast({ message: "模型已更新" });
    }
  }

  async function handleTestActiveApi() {
    const modelToTest = draftModelName.trim() || activeAiProfile.model.trim();

    if (!activeAiProfile.endpoint.trim() || !modelToTest) {
      setApiTestResult({
        elapsedMs: 0,
        error: "请先配置服务地址和模型 ID。",
        ok: false,
        status: 0,
      });
      return;
    }

    if (draftModelName.trim()) {
      handleSelectAiModel(draftModelName.trim());
      setDraftModelName("");
    }

    setIsTestingApi(true);
    setApiTestResult(null);
    const generation = requestGeneration.current;
    const controller = new AbortController();
    controllers.current.add(controller);
    const result = await testChatCompletion({
      apiKey: activeAiProfile.apiKey,
      endpoint: activeAiProfile.endpoint,
      extraBodyJson: activeAiProfile.extraBodyJson,
      model: modelToTest,
      signal: controller.signal,
    });
    controllers.current.delete(controller);
    if (generation !== requestGeneration.current) return;
    setApiTestResult(result);
    setIsTestingApi(false);
    if (result.ok) {
      showToast({ message: "API 可用" });
    }
  }

  function handleAddAiProfile() {
    if (pendingAiProfile) {
      return;
    }

    invalidateRequests();
    const nextProfile: AiProfile = {
      apiKey: "",
      endpoint: "",
      extraBodyJson: "",
      id: crypto.randomUUID(),
      model: "",
      models: [],
      modelsEndpoint: "",
      name: `服务商 ${draft.aiProfiles.length + 1}`,
      preset: "custom",
    };
    setDraft((current) => ({
      ...current,
      activeAiProfileId: nextProfile.id,
      aiEndpoint: "",
      aiKey: "",
      aiProfiles: [...current.aiProfiles, nextProfile],
    }));
    setPendingAiProfile({
      id: nextProfile.id,
      previousActiveId: draft.activeAiProfileId,
    });
    setIsAiKeyVisible(false);
    setModelListResult(null);
    setDraftModelName("");
  }

  async function handleConfirmAiProfile() {
    if (!pendingAiProfile) {
      return;
    }

    const nextProfiles = draft.aiProfiles.map((profile) =>
      profile.id === pendingAiProfile.id && !profile.name.trim()
        ? { ...profile, name: `服务商 ${draft.aiProfiles.length}` }
        : profile,
    );
    const nextActiveProfile =
      nextProfiles.find((profile) => profile.id === pendingAiProfile.id) ??
      nextProfiles[0];
    const savedPreferences = await savePreferences({
      activeAiProfileId: nextActiveProfile.id,
      aiEndpoint: nextActiveProfile.endpoint,
      aiKey: nextActiveProfile.apiKey,
      aiProfiles: nextProfiles,
    });
    setDraft((current) => ({
      ...current,
      activeAiProfileId: savedPreferences.activeAiProfileId,
      aiEndpoint: savedPreferences.aiEndpoint,
      aiKey: savedPreferences.aiKey,
      aiProfiles: savedPreferences.aiProfiles,
    }));
    setPendingAiProfile(null);
    showToast({ message: "服务商已创建并保存。" });
  }

  function handleCancelAiProfile() {
    if (!pendingAiProfile) {
      return;
    }

    invalidateRequests();
    setDraft((current) => {
      const profiles = current.aiProfiles.filter(
        (profile) => profile.id !== pendingAiProfile.id,
      );
      const nextActiveProfile =
        profiles.find(
          (profile) => profile.id === pendingAiProfile.previousActiveId,
        ) ?? profiles[0];
      return {
        ...current,
        activeAiProfileId: nextActiveProfile.id,
        aiEndpoint: nextActiveProfile.endpoint,
        aiKey: nextActiveProfile.apiKey,
        aiProfiles: profiles,
      };
    });
    setPendingAiProfile(null);
    setIsAiKeyVisible(false);
    setApiTestResult(null);
  }

  function handleDeleteAiProfile(profileId: string) {
    if (pendingAiProfile) {
      return;
    }

    if (draft.aiProfiles.length <= 1) {
      showToast({ message: "至少保留一个 API" });
      return;
    }

    invalidateRequests();
    setDraft((current) => {
      const profiles = current.aiProfiles.filter(
        (profile) => profile.id !== profileId,
      );
      const nextActiveProfile =
        current.activeAiProfileId === profileId
          ? profiles[0]
          : (current.aiProfiles.find(
              (profile) => profile.id === current.activeAiProfileId,
            ) ?? profiles[0]);
      return {
        ...current,
        activeAiProfileId: nextActiveProfile.id,
        aiEndpoint: nextActiveProfile.endpoint,
        aiKey: nextActiveProfile.apiKey,
        aiProfiles: profiles,
      };
    });
    setIsAiKeyVisible(false);
    setConfirmingDelete(null);
  }

  function handleRequestDeleteAiProfile(profileId: string) {
    if (
      confirmingDelete?.type === "aiProfile" &&
      confirmingDelete.id === profileId
    ) {
      handleDeleteAiProfile(profileId);
      return;
    }

    setConfirmingDelete({ id: profileId, type: "aiProfile" });
  }

  return {
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
  };
}
