import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../platform/runtime";
import { recordDesktopError } from "../desktop/errorLog";

export type ChatMessage = {
  content: string;
  role: "system" | "user";
};

export type ChatCompletionRequestInput = {
  extraBodyJson?: string;
  messages: ChatMessage[];
  model: string;
  temperature?: number;
};

export type ChatCompletionRequest = {
  messages: ChatMessage[];
  model: string;
  temperature: number;
} & Record<string, unknown>;

export type ChatCompletionOptions = ChatCompletionRequestInput & {
  apiKey?: string;
  endpoint: string;
  signal?: AbortSignal;
};

export type ApiTestResult =
  | {
      content: string;
      elapsedMs: number;
      ok: true;
      status: number;
    }
  | {
      elapsedMs: number;
      error: string;
      ok: false;
      status: number;
    };

export type ModelListResult =
  | {
      models: string[];
      ok: true;
      status: number;
      url: string;
    }
  | {
      error: string;
      ok: false;
      status: number;
      url?: string;
    };

function collectModelIds(payload: unknown) {
  const modelIds = new Set<string>();

  function addModelId(candidate: unknown) {
    if (typeof candidate !== "string") {
      return;
    }
    const trimmedCandidate = candidate.trim();
    if (trimmedCandidate) {
      modelIds.add(trimmedCandidate);
    }
  }

  function visit(candidate: unknown) {
    if (typeof candidate === "string") {
      addModelId(candidate);
      return;
    }

    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }

    if (!candidate || typeof candidate !== "object") {
      return;
    }

    const id = "id" in candidate ? candidate.id : undefined;
    const name = "name" in candidate ? candidate.name : undefined;
    const model = "model" in candidate ? candidate.model : undefined;
    addModelId(id);
    addModelId(name);
    addModelId(model);
  }

  if (Array.isArray(payload)) {
    visit(payload);
  } else if (payload && typeof payload === "object") {
    const data = "data" in payload ? payload.data : undefined;
    const models = "models" in payload ? payload.models : undefined;
    visit(data);
    visit(models);
  } else {
    visit(payload);
  }

  return [...modelIds];
}

function getNetworkErrorMessage(error: unknown) {
  if (typeof error === "string") {
    return error;
  }
  if (!(error instanceof TypeError) || error.message !== "Failed to fetch") {
    return error instanceof Error ? error.message : "Unknown network error";
  }

  return "Cannot reach this API from the browser. Check the endpoint, network, and whether the service allows browser requests.";
}

export function normalizeChatCompletionsEndpoint(endpoint: string) {
  const trimmedEndpoint = endpoint.trim().replace(/\/+$/, "");

  if (trimmedEndpoint.endsWith("/chat/completions")) {
    return trimmedEndpoint;
  }

  return `${trimmedEndpoint}/chat/completions`;
}

export function getCandidateChatCompletionsEndpoints(endpoint: string) {
  const trimmedEndpoint = endpoint.trim().replace(/\/+$/, "");
  if (!trimmedEndpoint) {
    return [];
  }

  if (trimmedEndpoint.endsWith("/chat/completions")) {
    return [trimmedEndpoint];
  }

  const candidates = trimmedEndpoint.endsWith("/v1")
    ? [`${trimmedEndpoint}/chat/completions`]
    : [
        normalizeChatCompletionsEndpoint(trimmedEndpoint),
        `${trimmedEndpoint}/v1/chat/completions`,
      ];

  return candidates.filter(
    (candidate, index, allCandidates) =>
      allCandidates.indexOf(candidate) === index,
  );
}

export function normalizeModelsEndpoint(endpoint: string) {
  const trimmedEndpoint = endpoint.trim().replace(/\/+$/, "");

  if (trimmedEndpoint.endsWith("/models")) {
    return trimmedEndpoint;
  }

  if (trimmedEndpoint.endsWith("/chat/completions")) {
    return `${trimmedEndpoint.slice(0, -"/chat/completions".length)}/models`;
  }

  return `${trimmedEndpoint}/models`;
}

export function getCandidateModelsEndpoints(
  endpoint: string,
  modelsEndpoint?: string,
) {
  const trimmedModelsEndpoint = modelsEndpoint?.trim().replace(/\/+$/, "");
  if (trimmedModelsEndpoint) {
    return [trimmedModelsEndpoint];
  }

  const trimmedEndpoint = endpoint.trim().replace(/\/+$/, "");
  if (!trimmedEndpoint) {
    return [];
  }

  const candidates = trimmedEndpoint.endsWith("/v1")
    ? [`${trimmedEndpoint}/models`]
    : [
        `${trimmedEndpoint}/v1/models`,
        normalizeModelsEndpoint(trimmedEndpoint),
      ];

  return candidates.filter(
    (candidate, index, allCandidates) =>
      allCandidates.indexOf(candidate) === index,
  );
}

export function parseExtraBodyJson(extraBodyJson?: string) {
  const trimmedJson = extraBodyJson?.trim();
  if (!trimmedJson) {
    return {};
  }

  const parsed = JSON.parse(trimmedJson) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Advanced JSON must be an object.");
  }

  return parsed as Record<string, unknown>;
}

export function buildChatCompletionRequest({
  extraBodyJson,
  messages,
  model,
  temperature = 0.3,
}: ChatCompletionRequestInput): ChatCompletionRequest {
  const trimmedModel = model.trim();
  if (!trimmedModel) {
    throw new Error("Model is required.");
  }

  return {
    messages,
    model: trimmedModel,
    temperature,
    ...parseExtraBodyJson(extraBodyJson),
  };
}

export function buildRequestPreview(options: ChatCompletionOptions) {
  return {
    body: buildChatCompletionRequest(options),
    headers: {
      Authorization: options.apiKey?.trim() ? "Bearer sk-****" : "",
      "Content-Type": "application/json",
    },
    url: normalizeChatCompletionsEndpoint(options.endpoint),
  };
}

function buildProxyPayload(options: ChatCompletionOptions) {
  return {
    apiKey: options.apiKey,
    body: buildChatCompletionRequest(options),
    endpoint: options.endpoint,
  };
}

async function fetchJsonThroughProxy(
  path: "/api/ai/chat-completions" | "/api/ai/models",
  payload: unknown,
) {
  return fetch(path, {
    body: JSON.stringify(payload),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });
}

async function fetchChatCompletion(
  options: ChatCompletionOptions,
  chatEndpoint?: string,
) {
  if (isTauriRuntime()) {
    return fetchDesktopAi(
      chatEndpoint ?? normalizeChatCompletionsEndpoint(options.endpoint),
      options.apiKey,
      buildChatCompletionRequest(options),
      options.signal,
    );
  }
  if (import.meta.env.DEV) {
    return fetchJsonThroughProxy("/api/ai/chat-completions", {
      ...buildProxyPayload(options),
      chatEndpoint,
    });
  }

  return fetch(
    chatEndpoint ?? normalizeChatCompletionsEndpoint(options.endpoint),
    {
      body: JSON.stringify(buildChatCompletionRequest(options)),
      headers: {
        ...(options.apiKey?.trim()
          ? { Authorization: `Bearer ${options.apiKey.trim()}` }
          : {}),
        "Content-Type": "application/json",
      },
      method: "POST",
    },
  );
}

async function readJsonPayload(response: Response) {
  if (
    typeof response.text !== "function" &&
    typeof response.json === "function"
  ) {
    return (await response.json()) as unknown;
  }

  const text = await response.text();
  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    const contentType =
      response.headers.get("Content-Type") || "unknown content-type";
    const preview = text.replace(/\s+/g, " ").trim().slice(0, 160);
    throw new Error(
      `AI 服务返回的不是 JSON（${response.status} ${contentType}）。请检查服务地址是否指向 OpenAI 兼容接口；返回内容预览：${preview}`,
    );
  }
}

function getResponseErrorMessage(payload: unknown, response: Response) {
  if (payload && typeof payload === "object" && "error" in payload) {
    const error = payload.error;
    if (typeof error === "string") {
      return error;
    }
    if (error && typeof error === "object" && "message" in error) {
      const message = error.message;
      if (typeof message === "string") {
        return message;
      }
    }
  }

  return JSON.stringify(payload ?? { error: response.statusText }, null, 2);
}

async function fetchModels(options: {
  apiKey?: string;
  endpoint: string;
  url: string;
  signal?: AbortSignal;
}) {
  if (isTauriRuntime()) {
    return fetchDesktopAi(
      options.url,
      options.apiKey,
      undefined,
      options.signal,
    );
  }
  if (import.meta.env.DEV) {
    return fetchJsonThroughProxy("/api/ai/models", {
      apiKey: options.apiKey,
      endpoint: options.endpoint,
      modelsEndpoint: options.url,
    });
  }

  return fetch(options.url, {
    headers: {
      ...(options.apiKey?.trim()
        ? { Authorization: `Bearer ${options.apiKey.trim()}` }
        : {}),
    },
    method: "GET",
  });
}

async function fetchDesktopAi(
  url: string,
  apiKey?: string,
  body?: ChatCompletionRequest,
  signal?: AbortSignal,
) {
  const requestId = crypto.randomUUID();
  await invoke("ai_prepare_request", { requestId });
  const cancel = () => {
    void invoke("ai_cancel_request", { requestId }).catch(() => {});
  };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    if (signal?.aborted) throw new Error("请求已取消。");
    const result = await invoke<{
      status: number;
      body: string;
      content_type: string;
    }>("ai_http_request", {
      requestId,
      url,
      apiKey,
      body: body ?? null,
    });
    return new Response(
      [204, 205, 304].includes(result.status) ? null : result.body,
      {
        status: result.status,
        headers: { "Content-Type": result.content_type },
      },
    );
  } catch (error) {
    if (!signal?.aborted) recordDesktopError("ai_request_failed");
    throw error;
  } finally {
    signal?.removeEventListener("abort", cancel);
    await invoke("ai_cancel_request", { requestId }).catch(() => {});
  }
}

export function parseChatCompletionContent(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const outputText = "output_text" in payload ? payload.output_text : undefined;
  if (typeof outputText === "string" && outputText.trim()) {
    return outputText.trim();
  }

  const choices = "choices" in payload ? payload.choices : undefined;
  if (!Array.isArray(choices)) {
    return "";
  }

  const firstChoice = choices[0];
  if (!firstChoice || typeof firstChoice !== "object") {
    return "";
  }

  const message = "message" in firstChoice ? firstChoice.message : undefined;
  if (message && typeof message === "object") {
    const content = "content" in message ? message.content : undefined;
    if (typeof content === "string" && content.trim()) {
      return content.trim();
    }
    if (Array.isArray(content)) {
      return content
        .map((part) => {
          if (!part || typeof part !== "object") {
            return "";
          }
          const text = "text" in part ? part.text : undefined;
          return typeof text === "string" ? text : "";
        })
        .filter(Boolean)
        .join("\n")
        .trim();
    }
  }

  const text = "text" in firstChoice ? firstChoice.text : undefined;
  return typeof text === "string" ? text.trim() : "";
}

class ChatCompletionError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function requestChatCompletionResult(options: ChatCompletionOptions) {
  const chatEndpoints = getCandidateChatCompletionsEndpoints(options.endpoint);
  let lastError: Error | null = null;

  for (const chatEndpoint of chatEndpoints) {
    if (options.signal?.aborted) throw new Error("请求已取消。");
    let retryPath = false;
    try {
      const response = await fetchChatCompletion(options, chatEndpoint);
      retryPath = response.status === 404 || response.status === 405;
      let payload: unknown;
      try {
        payload = await readJsonPayload(response);
      } catch (error) {
        // A successful HTML page can be a provider's website rather than its API.
        retryPath ||= response.ok;
        throw new ChatCompletionError(
          getNetworkErrorMessage(error),
          response.status,
        );
      }

      if (!response.ok) {
        throw new ChatCompletionError(
          `AI request failed (${response.status}): ${getResponseErrorMessage(payload, response)}`,
          response.status,
        );
      }

      const content = parseChatCompletionContent(payload);

      if (!content) {
        throw new ChatCompletionError(
          "AI 服务未返回有效的回复内容。",
          response.status,
        );
      }

      return { content, status: response.status };
    } catch (error) {
      lastError =
        error instanceof Error
          ? error
          : new Error(getNetworkErrorMessage(error));
      if (!retryPath || options.signal?.aborted) {
        break;
      }
    }
  }

  throw lastError ?? new Error("AI endpoint is required.");
}

export async function requestChatCompletion(options: ChatCompletionOptions) {
  return (await requestChatCompletionResult(options)).content;
}

export async function testChatCompletion(options: {
  apiKey?: string;
  endpoint: string;
  extraBodyJson?: string;
  model: string;
  signal?: AbortSignal;
}): Promise<ApiTestResult> {
  const startedAt = performance.now();

  try {
    const result = await requestChatCompletionResult({
      apiKey: options.apiKey,
      endpoint: options.endpoint,
      extraBodyJson: options.extraBodyJson,
      messages: [{ content: "请只回复 OK", role: "user" }],
      model: options.model,
      temperature: 0,
      signal: options.signal,
    });
    return {
      ...result,
      elapsedMs: Math.round(performance.now() - startedAt),
      ok: true,
    };
  } catch (error) {
    return {
      elapsedMs: Math.round(performance.now() - startedAt),
      error: getNetworkErrorMessage(error),
      ok: false,
      status: error instanceof ChatCompletionError ? error.status : 0,
    };
  }
}

export async function fetchAvailableModels(options: {
  apiKey?: string;
  endpoint: string;
  modelsEndpoint?: string;
  signal?: AbortSignal;
}): Promise<ModelListResult> {
  const urls = getCandidateModelsEndpoints(
    options.endpoint,
    options.modelsEndpoint,
  );
  if (urls.length === 0) {
    return {
      error: "请先填写服务地址或模型列表地址。",
      ok: false,
      status: 0,
    };
  }

  let lastError: ModelListResult | null = null;

  for (const url of urls) {
    if (options.signal?.aborted)
      return { ok: false, status: 0, error: "请求已取消。", url };
    try {
      const response = await fetchModels({
        apiKey: options.apiKey,
        endpoint: options.endpoint,
        url,
        signal: options.signal,
      });
      const payload = await readJsonPayload(response);

      if (!response.ok) {
        lastError = {
          error: getResponseErrorMessage(payload, response),
          ok: false,
          status: response.status,
          url,
        };
        continue;
      }

      const models = collectModelIds(payload);
      return {
        models,
        ok: true,
        status: response.status,
        url,
      };
    } catch (error) {
      lastError = {
        error: getNetworkErrorMessage(error),
        ok: false,
        status: 0,
        url,
      };
    }
  }

  return (
    lastError ?? {
      error: "没有可用的模型列表地址。",
      ok: false,
      status: 0,
    }
  );
}
