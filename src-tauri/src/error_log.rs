use std::io::Write;
use tauri::Manager;

#[derive(serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Code {
    RenderError,
    StorageWriteFailed,
    AiRequestFailed,
}

#[tauri::command]
pub fn record_app_error(app: tauri::AppHandle, code: Code) -> Result<(), String> {
    static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _guard = LOCK.lock().map_err(|_| "日志不可用。".to_string())?;
    let directory = app.path().app_log_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let file = directory.join("yibu-errors.log");
    if std::fs::metadata(&file)
        .map(|m| m.len() > 262144)
        .unwrap_or(false)
    {
        let previous = directory.join("yibu-errors.previous.log");
        if previous.exists() {
            std::fs::remove_file(&previous).map_err(|e| e.to_string())?;
        }
        std::fs::rename(&file, previous).map_err(|e| e.to_string())?;
    }
    let mut options = std::fs::OpenOptions::new();
    options.create(true).append(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut output = options.open(file).map_err(|e| e.to_string())?;
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();
    let code = match code {
        Code::RenderError => "render_error",
        Code::StorageWriteFailed => "storage_write_failed",
        Code::AiRequestFailed => "ai_request_failed",
    };
    writeln!(output, "{timestamp} {code}").map_err(|e| e.to_string())
}
