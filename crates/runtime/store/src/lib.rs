use libra_runtime_proto::runtime::{
    ListMessagesResponse, RuntimeMessageRecord, RuntimePreviewRecord, RuntimeSandboxRecord,
    RuntimeSessionRecord,
};
use rusqlite::{params, Connection, OptionalExtension};
use std::fmt::{Display, Formatter};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use time::format_description::well_known::Rfc3339;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

const DEFAULT_ACTIVE_STATUS: i32 = 1;

/// 描述：运行时持久化错误，统一包装 SQLite 与状态转换失败。
#[derive(Debug)]
pub struct RuntimeStoreError {
    message: String,
}

impl RuntimeStoreError {
    /// 描述：基于错误消息创建存储错误。
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl Display for RuntimeStoreError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for RuntimeStoreError {}

impl From<rusqlite::Error> for RuntimeStoreError {
    fn from(value: rusqlite::Error) -> Self {
        Self::new(value.to_string())
    }
}

impl From<std::io::Error> for RuntimeStoreError {
    fn from(value: std::io::Error) -> Self {
        Self::new(value.to_string())
    }
}

/// 描述：运行时 SQLite 存储，负责会话、消息、运行记录、Sandbox 与 Preview 的唯一持久化。
#[derive(Clone)]
pub struct RuntimeStore {
    conn: Arc<Mutex<Connection>>,
    db_path: PathBuf,
}

impl RuntimeStore {
    /// 描述：打开运行时数据目录中的 SQLite 数据库，并在首次打开时完成建表。
    ///
    /// Params:
    ///
    ///   - data_dir: runtime 数据根目录。
    ///
    /// Returns:
    ///
    ///   - 0: 可复用的运行时存储实例。
    pub fn open(data_dir: &Path) -> Result<Self, RuntimeStoreError> {
        std::fs::create_dir_all(data_dir)?;
        let db_path = data_dir.join("runtime.db");
        let conn = Connection::open(&db_path)?;
        let store = Self {
            conn: Arc::new(Mutex::new(conn)),
            db_path,
        };
        store.init_schema()?;
        Ok(store)
    }

    /// 描述：返回当前 SQLite 文件路径，供客户端与测试做观测。
    pub fn db_path(&self) -> &Path {
        &self.db_path
    }

    /// 描述：创建新会话，并返回刚写入的最新会话记录。
    ///
    /// Params:
    ///
    ///   - tenant_id: 租户 ID。
    ///   - user_id: 用户 ID。
    ///   - project_id: 项目 ID。
    ///   - agent_code: 智能体代码。
    ///   - status: 会话状态；未传或小于等于 0 时回退到激活状态。
    ///
    /// Returns:
    ///
    ///   - 0: 新建后的会话记录。
    pub fn create_session(
        &self,
        tenant_id: &str,
        user_id: &str,
        project_id: &str,
        agent_code: &str,
        status: i32,
    ) -> Result<RuntimeSessionRecord, RuntimeStoreError> {
        self.insert_session(
            new_id().as_str(),
            tenant_id,
            user_id,
            project_id,
            agent_code,
            normalize_create_status(status),
        )
    }

    /// 描述：按上下文创建或复用会话，并刷新最后活跃时间。
    ///
    /// Params:
    ///
    ///   - tenant_id: 租户 ID。
    ///   - user_id: 用户 ID。
    ///   - project_id: 项目 ID。
    ///   - session_id: 调用方传入的会话 ID；为空时自动生成。
    ///   - agent_code: 智能体代码。
    ///
    /// Returns:
    ///
    ///   - 0: 最新会话记录。
    pub fn ensure_session(
        &self,
        tenant_id: &str,
        user_id: &str,
        project_id: &str,
        session_id: &str,
        agent_code: &str,
    ) -> Result<RuntimeSessionRecord, RuntimeStoreError> {
        let normalized_session_id = if session_id.trim().is_empty() {
            new_id()
        } else {
            session_id.trim().to_string()
        };
        let now = now_rfc3339();
        let guard = self.lock_conn()?;
        let existing = Self::query_session_locked(&guard, normalized_session_id.as_str())?;
        if existing.is_some() {
            guard.execute(
                "UPDATE sessions SET last_at = ?2 WHERE id = ?1",
                params![normalized_session_id.as_str(), now.as_str()],
            )?;
        } else {
            drop(guard);
            return self.insert_session(
                normalized_session_id.as_str(),
                tenant_id,
                user_id,
                project_id,
                agent_code,
                DEFAULT_ACTIVE_STATUS,
            );
        }
        drop(guard);
        let guard = self.lock_conn()?;
        Self::query_session_locked(&guard, normalized_session_id.as_str())?
            .ok_or_else(|| RuntimeStoreError::new("会话写入后读取失败"))
    }

    /// 描述：更新指定会话状态，并刷新最后活跃时间。
    ///
    /// Params:
    ///
    ///   - session_id: 会话 ID。
    ///   - status: 目标状态。
    ///
    /// Returns:
    ///
    ///   - 0: 更新后的会话记录。
    pub fn update_session_status(
        &self,
        session_id: &str,
        status: i32,
    ) -> Result<RuntimeSessionRecord, RuntimeStoreError> {
        let now = now_rfc3339();
        let guard = self.lock_conn()?;
        let updated = guard.execute(
            "UPDATE sessions SET status = ?2, last_at = ?3 WHERE id = ?1 AND deleted_at = ''",
            params![session_id.trim(), status, now.as_str()],
        )?;
        if updated == 0 {
            return Err(RuntimeStoreError::new("session not found"));
        }
        Self::query_session_locked(&guard, session_id.trim())?
            .ok_or_else(|| RuntimeStoreError::new("会话更新后读取失败"))
    }

    /// 描述：为会话追加一条消息，并同步刷新会话最后活跃时间。
    ///
    /// Params:
    ///
    ///   - session_id: 会话 ID。
    ///   - user_id: 用户 ID。
    ///   - role: 消息角色。
    ///   - content: 消息正文。
    ///
    /// Returns:
    ///
    ///   - 0: 新增后的消息记录。
    pub fn append_message(
        &self,
        session_id: &str,
        user_id: &str,
        role: &str,
        content: &str,
    ) -> Result<RuntimeMessageRecord, RuntimeStoreError> {
        let now = now_rfc3339();
        let guard = self.lock_conn()?;
        if Self::query_session_locked(&guard, session_id.trim())?.is_none() {
            return Err(RuntimeStoreError::new("session not found"));
        }
        guard.execute(
            r#"INSERT INTO messages (
  session_id, user_id, role, content, created_at
) VALUES (?1, ?2, ?3, ?4, ?5)"#,
            params![
                session_id.trim(),
                user_id.trim(),
                role.trim(),
                content,
                now.as_str()
            ],
        )?;
        guard.execute(
            "UPDATE sessions SET last_at = ?2 WHERE id = ?1",
            params![session_id.trim(), now.as_str()],
        )?;
        let row_id = guard.last_insert_rowid();
        Self::query_message_locked(&guard, row_id)?
            .ok_or_else(|| RuntimeStoreError::new("消息写入后读取失败"))
    }

    /// 描述：写入运行开始状态，供后续异常恢复与观测使用。
    pub fn mark_run_started(
        &self,
        run_id: &str,
        session_id: &str,
        tenant_id: &str,
        user_id: &str,
        project_id: &str,
        trace_id: &str,
    ) -> Result<(), RuntimeStoreError> {
        let now = now_rfc3339();
        let guard = self.lock_conn()?;
        guard.execute(
            r#"INSERT OR REPLACE INTO runs (
  id, session_id, tenant_id, user_id, project_id, trace_id, status, created_at, updated_at, last_error_code, last_error_message
) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'running', ?7, ?7, '', '')"#,
            params![
                run_id.trim(),
                session_id.trim(),
                tenant_id.trim(),
                user_id.trim(),
                project_id.trim(),
                trace_id.trim(),
                now.as_str(),
            ],
        )?;
        Ok(())
    }

    /// 描述：将运行状态更新为成功、取消或失败，并记录最后错误详情。
    pub fn mark_run_finished(
        &self,
        run_id: &str,
        status: &str,
        error_code: Option<&str>,
        error_message: Option<&str>,
    ) -> Result<(), RuntimeStoreError> {
        let now = now_rfc3339();
        let guard = self.lock_conn()?;
        guard.execute(
            r#"UPDATE runs
SET status = ?2, updated_at = ?3, last_error_code = ?4, last_error_message = ?5
WHERE id = ?1"#,
            params![
                run_id.trim(),
                status.trim(),
                now.as_str(),
                error_code.unwrap_or(""),
                error_message.unwrap_or(""),
            ],
        )?;
        Ok(())
    }

    /// 描述：查询会话列表，并按最近活跃时间倒序返回。
    ///
    /// Params:
    ///
    ///   - tenant_id: 可选租户过滤。
    ///   - user_id: 可选用户过滤。
    ///   - project_id: 可选项目过滤。
    ///   - agent_code: 可选智能体过滤。
    ///   - status: 可选状态过滤；未传或小于等于 0 时忽略。
    ///
    /// Returns:
    ///
    ///   - 0: 符合条件的会话列表。
    pub fn list_sessions(
        &self,
        tenant_id: Option<&str>,
        user_id: Option<&str>,
        project_id: Option<&str>,
        agent_code: Option<&str>,
        status: Option<i32>,
    ) -> Result<Vec<RuntimeSessionRecord>, RuntimeStoreError> {
        let guard = self.lock_conn()?;
        let mut stmt = guard.prepare(
            r#"SELECT id, tenant_id, user_id, project_id, agent_code, status, created_at, last_at, deleted_at
FROM sessions
WHERE (?1 = '' OR tenant_id = ?1)
  AND (?2 = '' OR user_id = ?2)
  AND (?3 = '' OR project_id = ?3)
  AND (?4 = '' OR agent_code = ?4)
  AND (?5 <= 0 OR status = ?5)
  AND deleted_at = ''
ORDER BY last_at DESC"#,
        )?;
        let rows = stmt.query_map(
            params![
                tenant_id.unwrap_or("").trim(),
                user_id.unwrap_or("").trim(),
                project_id.unwrap_or("").trim(),
                agent_code.unwrap_or("").trim(),
                status.unwrap_or_default(),
            ],
            map_session_row,
        )?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    /// 描述：按 ID 查询单个会话详情。
    pub fn get_session(
        &self,
        session_id: &str,
    ) -> Result<Option<RuntimeSessionRecord>, RuntimeStoreError> {
        let guard = self.lock_conn()?;
        Self::query_session_locked(&guard, session_id.trim())
    }

    /// 描述：分页查询会话消息，并返回总量。
    pub fn list_messages(
        &self,
        session_id: &str,
        page: i32,
        page_size: i32,
    ) -> Result<ListMessagesResponse, RuntimeStoreError> {
        let normalized_page = page.max(1);
        let normalized_page_size = page_size.clamp(1, 200);
        let offset = (normalized_page - 1) * normalized_page_size;
        let guard = self.lock_conn()?;

        let total: i32 = guard.query_row(
            "SELECT COUNT(*) FROM messages WHERE session_id = ?1",
            params![session_id.trim()],
            |row| row.get(0),
        )?;
        let mut stmt = guard.prepare(
            r#"SELECT message_id, session_id, user_id, role, content, created_at
FROM messages
WHERE session_id = ?1
ORDER BY message_id ASC
LIMIT ?2 OFFSET ?3"#,
        )?;
        let rows = stmt.query_map(
            params![session_id.trim(), normalized_page_size, offset],
            map_message_row,
        )?;
        let list = rows.collect::<Result<Vec<_>, _>>()?;
        Ok(ListMessagesResponse {
            list,
            total,
            page: normalized_page,
            page_size: normalized_page_size,
        })
    }

    /// 描述：查询 Sandbox 列表，并按创建时间升序返回当前有效数据。
    pub fn list_sandboxes(
        &self,
        sandbox_id: Option<&str>,
        session_id: Option<&str>,
    ) -> Result<Vec<RuntimeSandboxRecord>, RuntimeStoreError> {
        let guard = self.lock_conn()?;
        let mut stmt = guard.prepare(
            r#"SELECT id, session_id, container_id, preview_url, status, created_at, last_at, deleted_at
FROM sandboxes
WHERE (?1 = '' OR id = ?1)
  AND (?2 = '' OR session_id = ?2)
  AND deleted_at = ''
ORDER BY created_at ASC"#,
        )?;
        let rows = stmt.query_map(
            params![
                sandbox_id.unwrap_or("").trim(),
                session_id.unwrap_or("").trim()
            ],
            map_sandbox_row,
        )?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    /// 描述：创建 Sandbox 记录，并要求目标会话已经存在。
    pub fn create_sandbox(
        &self,
        session_id: &str,
        container_id: &str,
        preview_url: &str,
        status: i32,
    ) -> Result<RuntimeSandboxRecord, RuntimeStoreError> {
        let now = now_rfc3339();
        let id = new_id();
        let guard = self.lock_conn()?;
        if Self::query_session_locked(&guard, session_id.trim())?.is_none() {
            return Err(RuntimeStoreError::new("session not found"));
        }
        guard.execute(
            r#"INSERT INTO sandboxes (
  id, session_id, container_id, preview_url, status, created_at, last_at, deleted_at
) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, '')"#,
            params![
                id.as_str(),
                session_id.trim(),
                container_id.trim(),
                preview_url.trim(),
                normalize_create_status(status),
                now.as_str(),
            ],
        )?;
        Self::query_sandbox_locked(&guard, id.as_str())?
            .ok_or_else(|| RuntimeStoreError::new("sandbox 写入后读取失败"))
    }

    /// 描述：回收 Sandbox 记录，并级联使其预览地址失效。
    pub fn recycle_sandboxes(
        &self,
        sandbox_id: Option<&str>,
        session_id: Option<&str>,
    ) -> Result<u32, RuntimeStoreError> {
        let sandbox_key = sandbox_id.unwrap_or("").trim().to_string();
        let session_key = session_id.unwrap_or("").trim().to_string();
        let now = now_rfc3339();
        let mut guard = self.lock_conn()?;
        let tx = guard.transaction()?;
        let target_ids = collect_ids(
            &tx,
            r#"SELECT id FROM sandboxes
WHERE (?1 = '' OR id = ?1)
  AND (?2 = '' OR session_id = ?2)
  AND deleted_at = ''"#,
            params![sandbox_key.as_str(), session_key.as_str()],
        )?;
        for target_id in target_ids.iter() {
            tx.execute(
                "UPDATE sandboxes SET status = 0, last_at = ?1, deleted_at = ?1 WHERE id = ?2",
                params![now.as_str(), target_id.as_str()],
            )?;
            tx.execute(
                "UPDATE previews SET status = 0, last_at = ?1, deleted_at = ?1 WHERE sandbox_id = ?2 AND deleted_at = ''",
                params![now.as_str(), target_id.as_str()],
            )?;
        }
        tx.commit()?;
        Ok(target_ids.len() as u32)
    }

    /// 描述：查询 Preview 列表，并按创建时间升序返回当前有效数据。
    pub fn list_previews(
        &self,
        preview_id: Option<&str>,
        sandbox_id: Option<&str>,
    ) -> Result<Vec<RuntimePreviewRecord>, RuntimeStoreError> {
        let guard = self.lock_conn()?;
        let mut stmt = guard.prepare(
            r#"SELECT id, sandbox_id, url, status, expires_at, created_at, last_at, deleted_at
FROM previews
WHERE (?1 = '' OR id = ?1)
  AND (?2 = '' OR sandbox_id = ?2)
  AND deleted_at = ''
ORDER BY created_at ASC"#,
        )?;
        let rows = stmt.query_map(
            params![
                preview_id.unwrap_or("").trim(),
                sandbox_id.unwrap_or("").trim()
            ],
            map_preview_row,
        )?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    /// 描述：创建 Preview 记录，并按过期秒数写入到期时间。
    pub fn create_preview(
        &self,
        sandbox_id: &str,
        url: &str,
        status: i32,
        expiration_secs: i64,
    ) -> Result<RuntimePreviewRecord, RuntimeStoreError> {
        let now = now_rfc3339();
        let id = new_id();
        let expires_at = resolve_expires_at(expiration_secs);
        let guard = self.lock_conn()?;
        if Self::query_sandbox_locked(&guard, sandbox_id.trim())?.is_none() {
            return Err(RuntimeStoreError::new("sandbox not found"));
        }
        guard.execute(
            r#"INSERT INTO previews (
  id, sandbox_id, url, status, expires_at, created_at, last_at, deleted_at
) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, '')"#,
            params![
                id.as_str(),
                sandbox_id.trim(),
                url.trim(),
                normalize_create_status(status),
                expires_at.as_str(),
                now.as_str(),
            ],
        )?;
        Self::query_preview_locked(&guard, id.as_str())?
            .ok_or_else(|| RuntimeStoreError::new("preview 写入后读取失败"))
    }

    /// 描述：使一个或多个 Preview 失效，并返回实际失效数量。
    pub fn expire_previews(
        &self,
        preview_id: Option<&str>,
        sandbox_id: Option<&str>,
    ) -> Result<u32, RuntimeStoreError> {
        let preview_key = preview_id.unwrap_or("").trim().to_string();
        let sandbox_key = sandbox_id.unwrap_or("").trim().to_string();
        let now = now_rfc3339();
        let mut guard = self.lock_conn()?;
        let tx = guard.transaction()?;
        let target_ids = collect_ids(
            &tx,
            r#"SELECT id FROM previews
WHERE (?1 = '' OR id = ?1)
  AND (?2 = '' OR sandbox_id = ?2)
  AND deleted_at = ''"#,
            params![preview_key.as_str(), sandbox_key.as_str()],
        )?;
        for target_id in target_ids.iter() {
            tx.execute(
                "UPDATE previews SET status = 0, last_at = ?1, deleted_at = ?1 WHERE id = ?2",
                params![now.as_str(), target_id.as_str()],
            )?;
        }
        tx.commit()?;
        Ok(target_ids.len() as u32)
    }

    /// 描述：确保表结构存在，并为后续查询准备索引。
    fn init_schema(&self) -> Result<(), RuntimeStoreError> {
        let guard = self.lock_conn()?;
        guard.execute_batch(
            r#"
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  agent_code TEXT NOT NULL,
  status INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  last_at TEXT NOT NULL,
  deleted_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_last_at ON sessions(user_id, last_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  message_id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_session_created_at ON messages(session_id, message_id DESC);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_error_code TEXT NOT NULL DEFAULT '',
  last_error_message TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_runs_session_updated_at ON runs(session_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS sandboxes (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  container_id TEXT NOT NULL DEFAULT '',
  preview_url TEXT NOT NULL DEFAULT '',
  status INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  last_at TEXT NOT NULL,
  deleted_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_sandboxes_session_created_at ON sandboxes(session_id, created_at ASC);

CREATE TABLE IF NOT EXISTS previews (
  id TEXT PRIMARY KEY,
  sandbox_id TEXT NOT NULL,
  url TEXT NOT NULL,
  status INTEGER NOT NULL,
  expires_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  last_at TEXT NOT NULL,
  deleted_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_previews_sandbox_created_at ON previews(sandbox_id, created_at ASC);
"#,
        )?;
        Ok(())
    }

    /// 描述：插入会话记录，并在写入后立即回读，保证返回值始终来自数据库。
    fn insert_session(
        &self,
        session_id: &str,
        tenant_id: &str,
        user_id: &str,
        project_id: &str,
        agent_code: &str,
        status: i32,
    ) -> Result<RuntimeSessionRecord, RuntimeStoreError> {
        let now = now_rfc3339();
        let guard = self.lock_conn()?;
        guard.execute(
            r#"INSERT INTO sessions (
  id, tenant_id, user_id, project_id, agent_code, status, created_at, last_at, deleted_at
) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, '')"#,
            params![
                session_id.trim(),
                tenant_id.trim(),
                user_id.trim(),
                project_id.trim(),
                agent_code.trim(),
                status,
                now.as_str(),
            ],
        )?;
        Self::query_session_locked(&guard, session_id.trim())?
            .ok_or_else(|| RuntimeStoreError::new("会话写入后读取失败"))
    }

    /// 描述：在持有数据库锁的前提下查询单条会话，避免重复准备语句。
    fn query_session_locked(
        conn: &Connection,
        session_id: &str,
    ) -> Result<Option<RuntimeSessionRecord>, RuntimeStoreError> {
        conn.query_row(
            r#"SELECT id, tenant_id, user_id, project_id, agent_code, status, created_at, last_at, deleted_at
FROM sessions WHERE id = ?1"#,
            params![session_id],
            map_session_row,
        )
        .optional()
        .map_err(Into::into)
    }

    /// 描述：在持有数据库锁的前提下查询单条消息，供写入后回读使用。
    fn query_message_locked(
        conn: &Connection,
        row_id: i64,
    ) -> Result<Option<RuntimeMessageRecord>, RuntimeStoreError> {
        conn.query_row(
            r#"SELECT message_id, session_id, user_id, role, content, created_at
FROM messages WHERE message_id = ?1"#,
            params![row_id],
            map_message_row,
        )
        .optional()
        .map_err(Into::into)
    }

    /// 描述：在持有数据库锁的前提下查询单条 Sandbox，供写入后回读使用。
    fn query_sandbox_locked(
        conn: &Connection,
        sandbox_id: &str,
    ) -> Result<Option<RuntimeSandboxRecord>, RuntimeStoreError> {
        conn.query_row(
            r#"SELECT id, session_id, container_id, preview_url, status, created_at, last_at, deleted_at
FROM sandboxes WHERE id = ?1"#,
            params![sandbox_id],
            map_sandbox_row,
        )
        .optional()
        .map_err(Into::into)
    }

    /// 描述：在持有数据库锁的前提下查询单条 Preview，供写入后回读使用。
    fn query_preview_locked(
        conn: &Connection,
        preview_id: &str,
    ) -> Result<Option<RuntimePreviewRecord>, RuntimeStoreError> {
        conn.query_row(
            r#"SELECT id, sandbox_id, url, status, expires_at, created_at, last_at, deleted_at
FROM previews WHERE id = ?1"#,
            params![preview_id],
            map_preview_row,
        )
        .optional()
        .map_err(Into::into)
    }

    /// 描述：获取 SQLite 连接锁，并把锁失败转换为统一存储错误。
    fn lock_conn(&self) -> Result<std::sync::MutexGuard<'_, Connection>, RuntimeStoreError> {
        self.conn
            .lock()
            .map_err(|_| RuntimeStoreError::new("runtime store lock poisoned"))
    }
}

/// 描述：把 SQLite 会话行转换为 gRPC 可复用的协议结构。
fn map_session_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RuntimeSessionRecord> {
    Ok(RuntimeSessionRecord {
        id: row.get(0)?,
        tenant_id: row.get(1)?,
        user_id: row.get(2)?,
        project_id: row.get(3)?,
        agent_code: row.get(4)?,
        status: row.get(5)?,
        created_at: row.get(6)?,
        last_at: row.get(7)?,
        deleted_at: row.get(8)?,
    })
}

/// 描述：把 SQLite 消息行转换为 gRPC 可复用的协议结构。
fn map_message_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RuntimeMessageRecord> {
    Ok(RuntimeMessageRecord {
        message_id: row.get::<_, i64>(0)?.to_string(),
        session_id: row.get(1)?,
        user_id: row.get(2)?,
        role: row.get(3)?,
        content: row.get(4)?,
        created_at: row.get(5)?,
    })
}

/// 描述：把 SQLite Sandbox 行转换为 gRPC 可复用的协议结构。
fn map_sandbox_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RuntimeSandboxRecord> {
    Ok(RuntimeSandboxRecord {
        id: row.get(0)?,
        session_id: row.get(1)?,
        container_id: row.get(2)?,
        preview_url: row.get(3)?,
        status: row.get(4)?,
        created_at: row.get(5)?,
        last_at: row.get(6)?,
        deleted_at: row.get(7)?,
    })
}

/// 描述：把 SQLite Preview 行转换为 gRPC 可复用的协议结构。
fn map_preview_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RuntimePreviewRecord> {
    Ok(RuntimePreviewRecord {
        id: row.get(0)?,
        sandbox_id: row.get(1)?,
        url: row.get(2)?,
        status: row.get(3)?,
        expires_at: row.get(4)?,
        created_at: row.get(5)?,
        last_at: row.get(6)?,
        deleted_at: row.get(7)?,
    })
}

/// 描述：收集单列主键查询结果，供批量失效与回收逻辑复用。
fn collect_ids<P>(conn: &Connection, sql: &str, params: P) -> Result<Vec<String>, RuntimeStoreError>
where
    P: rusqlite::Params,
{
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(params, |row| row.get::<_, String>(0))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

/// 描述：返回统一的 RFC3339 当前时间文本，供会话、消息与运行记录复用。
fn now_rfc3339() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

/// 描述：根据过期秒数解析 Preview 到期时间；未传或非法时返回空字符串。
fn resolve_expires_at(expiration_secs: i64) -> String {
    if expiration_secs <= 0 {
        return String::new();
    }
    (OffsetDateTime::now_utc() + Duration::seconds(expiration_secs))
        .format(&Rfc3339)
        .unwrap_or_default()
}

/// 描述：归一化创建类接口的状态字段，保证未显式传值时回退到默认激活态。
fn normalize_create_status(status: i32) -> i32 {
    if status <= 0 {
        DEFAULT_ACTIVE_STATUS
    } else {
        status
    }
}

/// 描述：生成稳定的随机 ID，供 session、sandbox、preview 与 run 主键复用。
fn new_id() -> String {
    Uuid::new_v4().simple().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    /// 描述：验证存储初始化时会自动创建 SQLite 数据库文件。
    #[test]
    fn should_create_sqlite_db_on_open() {
        let dir = tempdir().expect("tempdir");
        let store = RuntimeStore::open(dir.path()).expect("open store");
        assert!(store.db_path().exists());
    }

    /// 描述：验证冷启动只会创建 SQLite，并且不会读取或导入 legacy runtime-state.json。
    #[test]
    fn should_ignore_legacy_json_file_on_open() {
        let dir = tempdir().expect("tempdir");
        fs::write(
            dir.path().join("runtime-state.json"),
            r#"{"sessions":{"legacy":{"id":"legacy","user_id":"u-legacy","agent_code":"agent"}}}"#,
        )
        .expect("write legacy json");
        let store = RuntimeStore::open(dir.path()).expect("open store");
        let sessions = store
            .list_sessions(None, None, None, None, None)
            .expect("list sessions");
        assert!(sessions.is_empty());
        assert!(store.db_path().exists());
    }

    /// 描述：验证消息分页查询会保留写入顺序，并在会话不存在时拒绝写入。
    #[test]
    fn should_append_and_list_messages_in_write_order() {
        let dir = tempdir().expect("tempdir");
        let store = RuntimeStore::open(dir.path()).expect("open store");
        let session = store
            .create_session("tenant-1", "user-1", "project-1", "agent-a", 1)
            .expect("create session");
        store
            .append_message(session.id.as_str(), "user-1", "user", "hello")
            .expect("append first message");
        store
            .append_message(session.id.as_str(), "user-1", "assistant", "world")
            .expect("append second message");

        let page1 = store
            .list_messages(session.id.as_str(), 1, 1)
            .expect("list page 1");
        let page2 = store
            .list_messages(session.id.as_str(), 2, 1)
            .expect("list page 2");

        assert_eq!(page1.total, 2);
        assert_eq!(page1.list.len(), 1);
        assert_eq!(page1.list[0].content, "hello");
        assert_eq!(page2.list.len(), 1);
        assert_eq!(page2.list[0].content, "world");

        let err = store
            .append_message("missing-session", "user-1", "user", "ignored")
            .expect_err("missing session should fail");
        assert!(err.to_string().contains("session not found"));
    }

    /// 描述：验证同一个 session_id 重复执行 ensure_session 时不会因为重复获取 SQLite 连接锁而自锁。
    #[test]
    fn should_reuse_existing_session_without_deadlock() {
        let dir = tempdir().expect("tempdir");
        let store = RuntimeStore::open(dir.path()).expect("open store");

        let first = store
            .ensure_session(
                "tenant-1",
                "user-1",
                "project-1",
                "session-fixed",
                "agent-a",
            )
            .expect("create ensured session");
        let second = store
            .ensure_session(
                "tenant-1",
                "user-1",
                "project-1",
                "session-fixed",
                "agent-a",
            )
            .expect("reuse ensured session");

        assert_eq!(first.id, "session-fixed");
        assert_eq!(second.id, "session-fixed");
        assert_eq!(first.id, second.id);

        let sessions = store
            .list_sessions(None, None, None, None, None)
            .expect("list sessions");
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].id, "session-fixed");
    }

    /// 描述：验证 Sandbox 与 Preview 的创建、查询、失效和回收都只落在 SQLite 中。
    #[test]
    fn should_manage_sandbox_and_preview_lifecycle() {
        let dir = tempdir().expect("tempdir");
        let store = RuntimeStore::open(dir.path()).expect("open store");
        let session = store
            .create_session("tenant-1", "user-1", "project-1", "agent-a", 1)
            .expect("create session");
        let sandbox = store
            .create_sandbox(
                session.id.as_str(),
                "container-1",
                "http://preview.local",
                1,
            )
            .expect("create sandbox");
        let preview = store
            .create_preview(sandbox.id.as_str(), "http://preview.local/app", 1, 300)
            .expect("create preview");

        let sandboxes = store
            .list_sandboxes(None, Some(session.id.as_str()))
            .expect("list sandboxes");
        let previews = store
            .list_previews(None, Some(sandbox.id.as_str()))
            .expect("list previews");
        assert_eq!(sandboxes.len(), 1);
        assert_eq!(previews.len(), 1);
        assert_eq!(preview.url, "http://preview.local/app");
        assert!(!preview.expires_at.is_empty());

        let expired = store
            .expire_previews(Some(preview.id.as_str()), None)
            .expect("expire preview");
        assert_eq!(expired, 1);
        let previews_after_expire = store
            .list_previews(None, Some(sandbox.id.as_str()))
            .expect("list previews after expire");
        assert!(previews_after_expire.is_empty());

        let recycled = store
            .recycle_sandboxes(Some(sandbox.id.as_str()), None)
            .expect("recycle sandbox");
        assert_eq!(recycled, 1);
        let sandboxes_after_recycle = store
            .list_sandboxes(None, Some(session.id.as_str()))
            .expect("list sandboxes after recycle");
        assert!(sandboxes_after_recycle.is_empty());
    }
}
