import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../platform/runtime";

export function recordDesktopError(
  code: "render_error" | "storage_write_failed" | "ai_request_failed",
) {
  if (isTauriRuntime())
    void invoke("record_app_error", { code }).catch(() => {});
}
