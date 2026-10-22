use serde::Deserialize;
use serde_json::Value;
use sqlx::{Sqlite, SqlitePool, Transaction};

#[derive(Deserialize)]
pub struct Snapshot {
    projects: Vec<Value>,
    tasks: Vec<Value>,
    #[serde(rename = "focusRefs")]
    focus_refs: Vec<Value>,
    reports: Vec<Value>,
    preferences: Value,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Write {
    Clear,
    Snapshot {
        snapshot: Snapshot,
    },
    Focus {
        references: Vec<Value>,
        expected: Option<Vec<Value>>,
    },
    Projects {
        projects: Vec<Value>,
        expected: Vec<Value>,
    },
    DeleteProject {
        project_id: String,
    },
}

fn field<'a>(value: &'a Value, key: &str) -> Result<&'a str, sqlx::Error> {
    value
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| sqlx::Error::Protocol(format!("无效的数据字段：{key}")))
}

async fn insert(
    tx: &mut Transaction<'_, Sqlite>,
    table: &str,
    items: &[Value],
) -> Result<(), sqlx::Error> {
    for item in items {
        let json = item.to_string();
        match table {
            "projects" => {
                sqlx::query("INSERT INTO projects (id,updated_at,payload_json) VALUES (?,?,?)")
                    .bind(field(item, "id")?)
                    .bind(field(item, "updatedAt")?)
                    .bind(json)
                    .execute(&mut **tx)
                    .await?;
            }
            "tasks" => {
                sqlx::query("INSERT INTO tasks (id,project_id,status,updated_at,completed_at,payload_json) VALUES (?,?,?,?,?,?)")
                    .bind(field(item,"id")?).bind(field(item,"projectId")?).bind(field(item,"status")?)
                    .bind(field(item,"updatedAt")?).bind(item.pointer("/completionWrapUp/completedAt").and_then(Value::as_str))
                    .bind(json).execute(&mut **tx).await?;
            }
            "focus_refs" => {
                sqlx::query("INSERT INTO focus_refs (task_id,added_at,order_value,payload_json) VALUES (?,?,?,?)")
                    .bind(field(item,"taskId")?).bind(field(item,"addedAt")?).bind(item.get("order").and_then(Value::as_i64))
                    .bind(json).execute(&mut **tx).await?;
            }
            "reports" => {
                sqlx::query(
                    "INSERT INTO reports (id,type,created_at,payload_json) VALUES (?,?,?,?)",
                )
                .bind(field(item, "id")?)
                .bind(field(item, "type")?)
                .bind(field(item, "createdAt")?)
                .bind(json)
                .execute(&mut **tx)
                .await?;
            }
            "preferences" => {
                sqlx::query("INSERT INTO preferences (id,updated_at,payload_json) VALUES (?,?,?)")
                    .bind(field(item, "id")?)
                    .bind(field(item, "updatedAt")?)
                    .bind(json)
                    .execute(&mut **tx)
                    .await?;
            }
            _ => return Err(sqlx::Error::Protocol("不支持的数据表。".into())),
        }
    }
    Ok(())
}

async fn apply(tx: &mut Transaction<'_, Sqlite>, write: Write) -> Result<bool, sqlx::Error> {
    match write {
        Write::Clear => {
            for sql in [
                "DELETE FROM focus_refs",
                "DELETE FROM reports",
                "DELETE FROM tasks",
                "DELETE FROM projects",
                "DELETE FROM preferences",
            ] {
                sqlx::query(sql).execute(&mut **tx).await?;
            }
        }
        Write::Snapshot { snapshot } => {
            for sql in [
                "DELETE FROM focus_refs",
                "DELETE FROM reports",
                "DELETE FROM tasks",
                "DELETE FROM projects",
                "DELETE FROM preferences",
            ] {
                sqlx::query(sql).execute(&mut **tx).await?;
            }
            insert(tx, "projects", &snapshot.projects).await?;
            insert(tx, "tasks", &snapshot.tasks).await?;
            insert(tx, "focus_refs", &snapshot.focus_refs).await?;
            insert(tx, "reports", &snapshot.reports).await?;
            insert(tx, "preferences", &[snapshot.preferences]).await?;
        }
        Write::Focus {
            references,
            expected,
        } => {
            if let Some(mut expected) = expected {
                let rows: Vec<String> = sqlx::query_scalar("SELECT payload_json FROM focus_refs")
                    .fetch_all(&mut **tx)
                    .await?;
                let mut current: Vec<Value> = rows
                    .iter()
                    .map(|row| serde_json::from_str(row))
                    .collect::<Result<_, _>>()
                    .map_err(|error| sqlx::Error::Protocol(error.to_string()))?;
                expected.sort_by_key(|item| item["taskId"].as_str().unwrap_or("").to_owned());
                current.sort_by_key(|item| item["taskId"].as_str().unwrap_or("").to_owned());
                if current != expected {
                    return Ok(false);
                }
            }
            sqlx::query("DELETE FROM focus_refs")
                .execute(&mut **tx)
                .await?;
            insert(tx, "focus_refs", &references).await?;
        }
        Write::Projects { projects, expected } => {
            for item in expected {
                let current: Option<String> =
                    sqlx::query_scalar("SELECT payload_json FROM projects WHERE id=?")
                        .bind(field(&item, "id")?)
                        .fetch_optional(&mut **tx)
                        .await?;
                let current: Option<Value> = current
                    .map(|json| serde_json::from_str(&json))
                    .transpose()
                    .map_err(|error| sqlx::Error::Protocol(error.to_string()))?;
                if current.as_ref() != Some(&item) {
                    return Ok(false);
                }
            }
            for item in &projects {
                sqlx::query("UPDATE projects SET updated_at=?,payload_json=? WHERE id=?")
                    .bind(field(item, "updatedAt")?)
                    .bind(item.to_string())
                    .bind(field(item, "id")?)
                    .execute(&mut **tx)
                    .await?;
            }
        }
        Write::DeleteProject { project_id } => {
            sqlx::query(
                "DELETE FROM focus_refs WHERE task_id IN (SELECT id FROM tasks WHERE project_id=?)",
            )
            .bind(&project_id)
            .execute(&mut **tx)
            .await?;
            sqlx::query("DELETE FROM tasks WHERE project_id=?")
                .bind(&project_id)
                .execute(&mut **tx)
                .await?;
            sqlx::query("DELETE FROM projects WHERE id=?")
                .bind(&project_id)
                .execute(&mut **tx)
                .await?;
        }
    }
    Ok(true)
}

pub async fn atomic_write(pool: &SqlitePool, write: Write) -> Result<bool, sqlx::Error> {
    let retryable = matches!(&write, Write::Focus { .. } | Write::Projects { .. });
    let mut tx = pool.begin().await?;
    match apply(&mut tx, write).await {
        Ok(true) => {
            tx.commit().await?;
            Ok(true)
        }
        Ok(false) => {
            tx.rollback().await?;
            Ok(false)
        }
        Err(error) => {
            tx.rollback().await?;
            if retryable
                && error
                    .as_database_error()
                    .and_then(|error| error.code())
                    .is_some_and(|code| matches!(code.as_ref(), "5" | "6" | "517"))
            {
                Ok(false)
            } else {
                Err(error)
            }
        }
    }
}

#[tauri::command]
pub async fn sqlite_atomic_write(
    databases: tauri::State<'_, tauri_plugin_sql::DbInstances>,
    write: Write,
) -> Result<bool, String> {
    let instances = databases.0.read().await;
    let pool = instances
        .get("sqlite:yibu.db")
        .map(|db| match db {
            tauri_plugin_sql::DbPool::Sqlite(pool) => pool.clone(),
        })
        .ok_or_else(|| "数据库尚未初始化。".to_string())?;
    drop(instances);
    atomic_write(&pool, write)
        .await
        .map_err(|error| format!("数据保存失败，原数据已保留：{error}"))
}

#[tauri::command]
pub async fn sqlite_read_snapshot(
    databases: tauri::State<'_, tauri_plugin_sql::DbInstances>,
) -> Result<Value, String> {
    let instances = databases.0.read().await;
    let pool = instances
        .get("sqlite:yibu.db")
        .map(|db| match db {
            tauri_plugin_sql::DbPool::Sqlite(pool) => pool.clone(),
        })
        .ok_or_else(|| "数据库尚未初始化。".to_string())?;
    drop(instances);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let mut snapshot = serde_json::Map::new();
    for (key, sql) in [
        ("projects", "SELECT payload_json FROM projects"),
        ("tasks", "SELECT payload_json FROM tasks"),
        ("focusRefs", "SELECT payload_json FROM focus_refs"),
        ("reports", "SELECT payload_json FROM reports"),
        (
            "preferences",
            "SELECT payload_json FROM preferences WHERE id='preferences'",
        ),
    ] {
        let rows: Vec<String> = sqlx::query_scalar(sql)
            .fetch_all(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
        let items: Vec<Value> = rows
            .iter()
            .map(|row| serde_json::from_str(row))
            .collect::<Result<_, _>>()
            .map_err(|_| "数据库含有损坏的数据，无法导出。".to_string())?;
        snapshot.insert(
            key.into(),
            if key == "preferences" {
                items.into_iter().next().unwrap_or(Value::Null)
            } else {
                Value::Array(items)
            },
        );
    }
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(Value::Object(snapshot))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn database() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::raw_sql(crate::sqlite_migrations()[0].sql)
            .execute(&pool)
            .await
            .unwrap();
        pool
    }
    fn project(name: &str) -> Value {
        json!({"id":"p","name":name,"updatedAt":"2026-10-22T00:00:00Z"})
    }
    fn snapshot(projects: Vec<Value>) -> Write {
        Write::Snapshot {
            snapshot: Snapshot {
                projects,
                tasks: vec![],
                focus_refs: vec![],
                reports: vec![],
                preferences: json!({"id":"preferences","updatedAt":"2026-10-22T00:00:00Z"}),
            },
        }
    }
    async fn saved_project(pool: &SqlitePool) -> Value {
        let raw: String = sqlx::query_scalar("SELECT payload_json FROM projects WHERE id='p'")
            .fetch_one(pool)
            .await
            .unwrap();
        serde_json::from_str(&raw).unwrap()
    }

    #[test]
    fn failed_import_rolls_back_every_table() {
        tauri::async_runtime::block_on(async {
            let pool = database().await;
            atomic_write(&pool, snapshot(vec![project("original")]))
                .await
                .unwrap();
            // Duplicate IDs fail after DELETE and a successful first INSERT.
            assert!(atomic_write(
                &pool,
                snapshot(vec![project("replacement"), project("duplicate")])
            )
            .await
            .is_err());
            assert_eq!(saved_project(&pool).await["name"], "original");
            let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM preferences")
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(count, 1);
            pool.close().await;
        });
    }

    #[test]
    fn failed_focus_replace_preserves_original_rows() {
        tauri::async_runtime::block_on(async {
            let pool = database().await;
            let original = json!({"taskId":"original","addedAt":"2026-10-22T00:00:00Z","order":0});
            atomic_write(
                &pool,
                Write::Focus {
                    references: vec![original.clone()],
                    expected: None,
                },
            )
            .await
            .unwrap();
            assert!(atomic_write(
                &pool,
                Write::Focus {
                    references: vec![json!({"taskId":"new"})],
                    expected: None
                }
            )
            .await
            .is_err());
            let raw: String = sqlx::query_scalar("SELECT payload_json FROM focus_refs")
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(serde_json::from_str::<Value>(&raw).unwrap(), original);
            pool.close().await;
        });
    }

    #[test]
    fn stale_project_update_and_stale_focus_replace_are_rejected() {
        tauri::async_runtime::block_on(async {
            let pool = database().await;
            atomic_write(&pool, snapshot(vec![project("original")]))
                .await
                .unwrap();
            assert!(atomic_write(
                &pool,
                Write::Projects {
                    projects: vec![project("first")],
                    expected: vec![project("original")]
                }
            )
            .await
            .unwrap());
            assert!(!atomic_write(
                &pool,
                Write::Projects {
                    projects: vec![project("stale")],
                    expected: vec![project("original")]
                }
            )
            .await
            .unwrap());
            assert_eq!(saved_project(&pool).await["name"], "first");
            let original = json!({"taskId":"t","addedAt":"2026-10-22T00:00:00Z"});
            atomic_write(
                &pool,
                Write::Focus {
                    references: vec![original],
                    expected: Some(vec![]),
                },
            )
            .await
            .unwrap();
            assert!(!atomic_write(
                &pool,
                Write::Focus {
                    references: vec![],
                    expected: Some(vec![])
                }
            )
            .await
            .unwrap());
            pool.close().await;
        });
    }

    #[test]
    fn project_delete_removes_tasks_and_focus_in_one_transaction() {
        tauri::async_runtime::block_on(async {
            let pool = database().await;
            atomic_write(&pool, snapshot(vec![project("parent")]))
                .await
                .unwrap();
            sqlx::query("INSERT INTO tasks (id,project_id,status,updated_at,payload_json) VALUES ('t','p','todo','now','{}')").execute(&pool).await.unwrap();
            sqlx::query(
                "INSERT INTO focus_refs (task_id,added_at,payload_json) VALUES ('t','now','{}')",
            )
            .execute(&pool)
            .await
            .unwrap();
            atomic_write(
                &pool,
                Write::DeleteProject {
                    project_id: "p".into(),
                },
            )
            .await
            .unwrap();
            for table in ["projects", "tasks", "focus_refs"] {
                let count: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table}"))
                    .fetch_one(&pool)
                    .await
                    .unwrap();
                assert_eq!(count, 0);
            }
            pool.close().await;
        });
    }
}
