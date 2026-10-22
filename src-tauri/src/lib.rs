use tauri_plugin_sql::{Migration, MigrationKind};
mod database;
mod error_log;

#[derive(Default)]
struct AiRequests(
    std::sync::Mutex<std::collections::HashMap<String, tokio::sync::watch::Sender<bool>>>,
);

#[tauri::command]
fn ai_prepare_request(
    request_id: String,
    requests: tauri::State<'_, AiRequests>,
) -> Result<(), String> {
    let mut pending = requests
        .0
        .lock()
        .map_err(|_| "请求状态不可用。".to_string())?;
    if request_id.len() > 64 || pending.len() >= 100 || pending.contains_key(&request_id) {
        return Err("AI 请求过多，请稍后重试。".into());
    }
    let (sender, _) = tokio::sync::watch::channel(false);
    pending.insert(request_id, sender);
    Ok(())
}

#[tauri::command]
fn ai_cancel_request(request_id: String, requests: tauri::State<'_, AiRequests>) {
    if let Ok(mut pending) = requests.0.lock() {
        if let Some(sender) = pending.remove(&request_id) {
            let _ = sender.send(true);
        }
    }
}

#[derive(serde::Serialize)]
struct AiHttpResponse {
    status: u16,
    body: String,
    content_type: String,
}

#[tauri::command]
async fn ai_http_request(
    request_id: String,
    url: String,
    api_key: Option<String>,
    body: Option<serde_json::Value>,
    requests: tauri::State<'_, AiRequests>,
) -> Result<AiHttpResponse, String> {
    let cancelled = requests
        .0
        .lock()
        .map_err(|_| "请求状态不可用。".to_string())?
        .get(&request_id)
        .map(|sender| sender.subscribe())
        .ok_or_else(|| "请求已取消。".to_string())?;
    let result = run_ai_request(cancelled, url, api_key, body).await;
    if let Ok(mut pending) = requests.0.lock() {
        pending.remove(&request_id);
    }
    result
}

async fn run_ai_request(
    mut cancelled: tokio::sync::watch::Receiver<bool>,
    url: String,
    api_key: Option<String>,
    body: Option<serde_json::Value>,
) -> Result<AiHttpResponse, String> {
    if *cancelled.borrow() {
        return Err("请求已取消。".to_string());
    }
    tokio::select! {
        biased;
        _ = cancelled.changed() => Err("请求已取消。".to_string()),
        response = send_ai_request(url,api_key,body) => response,
    }
}

async fn send_ai_request(
    url: String,
    api_key: Option<String>,
    body: Option<serde_json::Value>,
) -> Result<AiHttpResponse, String> {
    let target = reqwest::Url::parse(&url).map_err(|_| "服务地址格式无效。".to_string())?;
    if !matches!(target.scheme(), "http" | "https")
        || !target.username().is_empty()
        || target.password().is_some()
    {
        return Err("服务地址必须是 HTTP 或 HTTPS 地址，且不能包含登录信息。".to_string());
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "无法初始化网络请求。".to_string())?;
    let mut request = if let Some(payload) = body {
        client.post(target).json(&payload)
    } else {
        client.get(target)
    };
    if let Some(key) = api_key.filter(|key| !key.trim().is_empty()) {
        request = request.bearer_auth(key.trim());
    }
    let response = request.send().await.map_err(|error| {
        if error.is_timeout() {
            "请求超时，请检查网络和服务地址。".to_string()
        } else if error.is_connect() {
            "无法连接 AI 服务，请检查网络、代理和服务地址。".to_string()
        } else {
            "AI 服务网络请求失败，请检查网络或 TLS 证书。".to_string()
        }
    })?;
    let status = response.status().as_u16();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_string();
    let body = response
        .text()
        .await
        .map_err(|_| "读取 AI 服务响应失败。".to_string())?;
    Ok(AiHttpResponse {
        status,
        body,
        content_type,
    })
}

fn sqlite_migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "create personal to-do tables",
            sql: "
            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY NOT NULL,
                updated_at TEXT NOT NULL,
                payload_json TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY NOT NULL,
                project_id TEXT NOT NULL,
                status TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                completed_at TEXT,
                payload_json TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);
            CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
            CREATE INDEX IF NOT EXISTS idx_tasks_updated_at ON tasks(updated_at);
            CREATE TABLE IF NOT EXISTS focus_refs (
                task_id TEXT PRIMARY KEY NOT NULL,
                added_at TEXT NOT NULL,
                order_value INTEGER,
                payload_json TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS reports (
                id TEXT PRIMARY KEY NOT NULL,
                type TEXT NOT NULL,
                created_at TEXT NOT NULL,
                payload_json TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_reports_created_at ON reports(created_at);
            CREATE INDEX IF NOT EXISTS idx_reports_type ON reports(type);
            CREATE TABLE IF NOT EXISTS preferences (
                id TEXT PRIMARY KEY NOT NULL,
                updated_at TEXT NOT NULL,
                payload_json TEXT NOT NULL
            );
        ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "remove accidentally bundled demo data",
            sql: "
            DELETE FROM focus_refs
            WHERE task_id IN (
                'task-long-title',
                'task-blocked',
                'task-complete',
                'task-polish-focus-card',
                'task-data-storage-consistency'
            );

            DELETE FROM reports
            WHERE id IN (
                'report-daily-2026-04-29',
                'report-daily-2026-04-28',
                'report-daily-2026-04-27',
                'report-weekly-2026-w18',
                'report-monthly-2026-04'
            );

            DELETE FROM tasks
            WHERE id IN (
                'task-long-title',
                'task-blocked',
                'task-complete',
                'task-polish-home-density',
                'task-polish-focus-card',
                'task-polish-modal-actions',
                'task-report-source',
                'task-report-center-state',
                'task-data-storage-consistency',
                'task-data-import-guard',
                'task-mobile-home-review',
                'task-mobile-project-review'
            )
            OR project_id IN (
                'project-qa-demo',
                'project-product-polish',
                'project-report-automation',
                'project-data-safety',
                'project-mobile-review'
            );

            DELETE FROM projects
            WHERE id IN (
                'project-qa-demo',
                'project-product-polish',
                'project-report-automation',
                'project-data-safety',
                'project-mobile-review'
            );
        ",
            kind: MigrationKind::Up,
        },
    ]
}

#[cfg(test)]
mod ai_tests {
    use super::*;
    #[test]
    fn cancelled_request_stops_before_connecting() {
        tauri::async_runtime::block_on(async {
            let (sender, receiver) = tokio::sync::watch::channel(false);
            sender.send(true).unwrap();
            let result =
                run_ai_request(receiver, "http://127.0.0.1:9/v1/models".into(), None, None).await;
            assert!(matches!(result,Err(error) if error=="请求已取消。"));
        });
    }

    #[test]
    fn cancels_an_in_flight_native_connection() {
        tauri::async_runtime::block_on(async {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            let (sender, receiver) = tokio::sync::watch::channel(false);
            let canceller = tauri::async_runtime::spawn(async move {
                let (_socket, _) = listener.accept().await.unwrap();
                sender.send(true).unwrap();
            });
            let result = tokio::time::timeout(
                std::time::Duration::from_secs(5),
                run_ai_request(receiver, format!("http://{address}/v1/models"), None, None),
            )
            .await
            .unwrap();
            canceller.await.unwrap();
            assert!(matches!(result,Err(error) if error=="请求已取消。"));
        });
    }

    #[test]
    fn native_http_preserves_status_and_json() {
        use std::io::{Read, Write};
        let server = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        server.set_nonblocking(true).unwrap();
        let address = server.local_addr().unwrap();
        let worker = std::thread::spawn(move || {
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
            let (mut stream, _) = loop {
                match server.accept() {
                    Ok(client) => break client,
                    Err(error)
                        if error.kind() == std::io::ErrorKind::WouldBlock
                            && std::time::Instant::now() < deadline =>
                    {
                        std::thread::sleep(std::time::Duration::from_millis(10))
                    }
                    Err(error) => panic!("local server: {error}"),
                }
            };
            stream
                .set_read_timeout(Some(std::time::Duration::from_secs(2)))
                .unwrap();
            let mut bytes = Vec::new();
            let mut chunk = [0u8; 1024];
            while !bytes.windows(4).any(|window| window == b"\r\n\r\n") {
                let length = stream.read(&mut chunk).unwrap();
                assert!(length > 0);
                bytes.extend_from_slice(&chunk[..length]);
            }
            let request = String::from_utf8(bytes).unwrap();
            assert!(request.starts_with("GET /v1/models "));
            assert!(request
                .to_lowercase()
                .contains("authorization: bearer test-key"));
            let body = r#"{"data":[{"id":"local-model"}]}"#;
            write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body).unwrap();
        });
        let result = tauri::async_runtime::block_on(send_ai_request(
            format!("http://{address}/v1/models"),
            Some("test-key".into()),
            None,
        ));
        worker.join().unwrap();
        let response = result.unwrap();
        assert_eq!(response.status, 200);
        assert_eq!(response.content_type, "application/json");
        assert!(response.body.contains("local-model"));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AiRequests::default())
        .invoke_handler(tauri::generate_handler![
            ai_prepare_request,
            ai_cancel_request,
            ai_http_request,
            database::sqlite_atomic_write,
            database::sqlite_read_snapshot,
            error_log::record_app_error
        ])
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:yibu.db", sqlite_migrations())
                .build(),
        )
        .run(tauri::generate_context!())
        .expect("error while running 一步");
}
