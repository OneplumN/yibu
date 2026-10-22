import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

type AiProxyPayload = {
  apiKey?: string;
  body?: unknown;
  chatEndpoint?: string;
  endpoint?: string;
  modelsEndpoint?: string;
};

const LOCAL_SNAPSHOT_PATH = path.resolve(
  process.env.YIBU_LOCAL_SNAPSHOT_PATH ?? ".local-data/app-snapshot.json",
);
let snapshotWriteTail = Promise.resolve();

function sendJson(response: ServerResponse, status: number, payload: unknown) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(payload));
}

function readRequestJson(request: IncomingMessage) {
  return new Promise<unknown>((resolve, reject) => {
    let body = "";

    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      try {
        resolve(body ? (JSON.parse(body) as AiProxyPayload) : {});
      } catch (error) {
        reject(error instanceof Error ? error : new Error("Invalid JSON"));
      }
    });
    request.on("error", reject);
  });
}

function normalizeProxyEndpoint(
  endpoint: string,
  suffix: "chat/completions" | "models",
) {
  const trimmedEndpoint = endpoint.trim().replace(/\/+$/, "");

  if (trimmedEndpoint.endsWith(`/${suffix}`)) {
    return trimmedEndpoint;
  }

  if (suffix === "models" && trimmedEndpoint.endsWith("/chat/completions")) {
    return `${trimmedEndpoint.slice(0, -"/chat/completions".length)}/models`;
  }

  return `${trimmedEndpoint}/${suffix}`;
}

function getProxyTargetEndpoint(
  payload: AiProxyPayload,
  suffix: "chat/completions" | "models",
) {
  if (suffix === "chat/completions" && payload.chatEndpoint?.trim()) {
    return payload.chatEndpoint.trim().replace(/\/+$/, "");
  }

  if (suffix === "models" && payload.modelsEndpoint?.trim()) {
    return payload.modelsEndpoint.trim().replace(/\/+$/, "");
  }

  return normalizeProxyEndpoint(payload.endpoint ?? "", suffix);
}

async function proxyAiRequest(
  request: IncomingMessage,
  response: ServerResponse,
  suffix: "chat/completions" | "models",
) {
  try {
    const payload = (await readRequestJson(request)) as AiProxyPayload;
    const endpoint = payload.endpoint?.trim();

    if (!endpoint) {
      sendJson(response, 400, { error: "Endpoint is required." });
      return;
    }

    const upstreamResponse = await fetch(
      getProxyTargetEndpoint(payload, suffix),
      {
        body:
          suffix === "chat/completions"
            ? JSON.stringify(payload.body ?? {})
            : undefined,
        headers: {
          ...(suffix === "chat/completions"
            ? { "Content-Type": "application/json" }
            : {}),
          ...(payload.apiKey?.trim()
            ? { Authorization: `Bearer ${payload.apiKey.trim()}` }
            : {}),
        },
        method: suffix === "chat/completions" ? "POST" : "GET",
        signal: AbortSignal.timeout(120_000),
      },
    );
    const text = await upstreamResponse.text();

    response.statusCode = upstreamResponse.status;
    response.setHeader(
      "Content-Type",
      upstreamResponse.headers.get("Content-Type") || "application/json",
    );
    response.end(text);
  } catch (error) {
    sendJson(response, 502, {
      error:
        error instanceof Error ? error.message : "AI proxy request failed.",
    });
  }
}

async function handleLocalSnapshotRequest(
  request: IncomingMessage,
  response: ServerResponse,
) {
  if (request.method === "GET") {
    try {
      const snapshot = await readFile(LOCAL_SNAPSHOT_PATH, "utf8");
      response.statusCode = 200;
      response.setHeader("Content-Type", "application/json");
      response.end(snapshot);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        sendJson(response, 404, { error: "Local snapshot does not exist." });
        return;
      }
      sendJson(response, 500, {
        error:
          error instanceof Error
            ? error.message
            : "Local snapshot read failed.",
      });
    }
    return;
  }

  if (request.method === "PUT") {
    try {
      const snapshot = await readRequestJson(request);
      const write = snapshotWriteTail.then(async () => {
        await mkdir(path.dirname(LOCAL_SNAPSHOT_PATH), { recursive: true });
        const temporary = `${LOCAL_SNAPSHOT_PATH}.${randomUUID()}.tmp`;
        try {
          await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, {
            encoding: "utf8",
            mode: 0o600,
          });
          await rename(temporary, LOCAL_SNAPSHOT_PATH);
        } finally {
          await rm(temporary, { force: true });
        }
      });
      snapshotWriteTail = write.catch(() => {});
      await write;
      sendJson(response, 200, { ok: true });
    } catch (error) {
      sendJson(response, 500, {
        error:
          error instanceof Error
            ? error.message
            : "Local snapshot write failed.",
      });
    }
    return;
  }

  sendJson(response, 405, { error: "Method not allowed." });
}

export default defineConfig({
  plugins: [
    react(),
    {
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          if (request.url === "/api/local-snapshot") {
            void handleLocalSnapshotRequest(request, response);
            return;
          }

          if (
            request.method === "POST" &&
            request.url === "/api/ai/chat-completions"
          ) {
            void proxyAiRequest(request, response, "chat/completions");
            return;
          }

          if (request.method === "POST" && request.url === "/api/ai/models") {
            void proxyAiRequest(request, response, "models");
            return;
          }

          next();
        });
      },
      name: "personal-todo-ai-proxy",
    },
  ],
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "**/._*"],
    environment: "jsdom",
    hookTimeout: 30000,
    setupFiles: ["./src/tests/setup.ts"],
    css: true,
  },
});
