use std::collections::HashMap;
use std::fs::File;
use std::io::Read;
use std::path::Path;
use std::sync::Arc;

use chrono::{DateTime, Utc};
use md5::{Digest, Md5};
use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use thiserror::Error;
use tokio::sync::{mpsc, RwLock};
use uuid::Uuid;

#[derive(Error, Debug)]
pub enum SyncError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Watch error: {0}")]
    Watch(#[from] notify::Error),
    #[error("Sync not found: {0}")]
    NotFound(String),
    #[error("Sync already exists for this path")]
    AlreadyExists,
}

pub type Result<T> = std::result::Result<T, SyncError>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncState {
    pub sync_id: String,
    pub profile_id: String,
    pub bucket: String,
    pub remote_prefix: String,
    pub local_path: String,
    pub is_active: bool,
    pub last_sync: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncEntry {
    pub path: String,
    pub local_md5: Option<String>,
    pub remote_etag: Option<String>,
    pub needs_upload: bool,
    pub needs_download: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncStartedPayload {
    pub sync_id: String,
    pub local_path: String,
    pub bucket: String,
    pub prefix: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncProgressPayload {
    pub sync_id: String,
    pub current: u64,
    pub total: u64,
    pub current_file: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncCompletedPayload {
    pub sync_id: String,
    pub files_uploaded: u64,
    pub files_downloaded: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncErrorPayload {
    pub sync_id: String,
    pub error: String,
}

struct WatcherHandle {
    _watcher: RecommendedWatcher,
    shutdown_tx: mpsc::Sender<()>,
}

pub struct SyncManager {
    active_syncs: Arc<RwLock<HashMap<String, SyncState>>>,
    watcher_handles: Arc<RwLock<HashMap<String, WatcherHandle>>>,
    app_handle: AppHandle,
}

impl SyncManager {
    pub fn new(app_handle: AppHandle) -> Self {
        Self {
            active_syncs: Arc::new(RwLock::new(HashMap::new())),
            watcher_handles: Arc::new(RwLock::new(HashMap::new())),
            app_handle,
        }
    }

    pub async fn start_keep_sync(
        &self,
        profile_id: &str,
        bucket: &str,
        prefix: &str,
        local_path: &str,
    ) -> Result<String> {
        let path = Path::new(local_path);
        if !path.exists() {
            std::fs::create_dir_all(path)?;
        }

        let sync_id = Uuid::new_v4().to_string();

        let state = SyncState {
            sync_id: sync_id.clone(),
            profile_id: profile_id.to_string(),
            bucket: bucket.to_string(),
            remote_prefix: prefix.to_string(),
            local_path: local_path.to_string(),
            is_active: true,
            last_sync: None,
        };

        {
            let syncs = self.active_syncs.read().await;
            for existing in syncs.values() {
                if existing.local_path == local_path && existing.is_active {
                    return Err(SyncError::AlreadyExists);
                }
            }
        }

        let (shutdown_tx, mut shutdown_rx) = mpsc::channel::<()>(1);
        let (event_tx, mut event_rx) = mpsc::channel::<notify::Result<Event>>(100);

        let mut watcher = RecommendedWatcher::new(
            move |res| {
                let _ = event_tx.blocking_send(res);
            },
            Config::default(),
        )?;

        watcher.watch(path, RecursiveMode::Recursive)?;

        let app_handle = self.app_handle.clone();
        let sync_id_clone = sync_id.clone();
        let local_path_clone = local_path.to_string();

        tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = shutdown_rx.recv() => {
                        break;
                    }
                    Some(event_result) = event_rx.recv() => {
                        if let Ok(event) = event_result {
                            Self::handle_file_event(&app_handle, &sync_id_clone, &local_path_clone, event).await;
                        }
                    }
                }
            }
        });

        let watcher_handle = WatcherHandle {
            _watcher: watcher,
            shutdown_tx,
        };

        self.active_syncs
            .write()
            .await
            .insert(sync_id.clone(), state);
        self.watcher_handles
            .write()
            .await
            .insert(sync_id.clone(), watcher_handle);

        let _ = self.app_handle.emit(
            "sync-started",
            SyncStartedPayload {
                sync_id: sync_id.clone(),
                local_path: local_path.to_string(),
                bucket: bucket.to_string(),
                prefix: prefix.to_string(),
            },
        );

        Ok(sync_id)
    }

    pub async fn stop_keep_sync(&self, sync_id: &str) -> Result<()> {
        let mut syncs = self.active_syncs.write().await;
        let mut handles = self.watcher_handles.write().await;

        if let Some(state) = syncs.get_mut(sync_id) {
            state.is_active = false;
        } else {
            return Err(SyncError::NotFound(sync_id.to_string()));
        }

        if let Some(handle) = handles.remove(sync_id) {
            let _ = handle.shutdown_tx.send(()).await;
        }

        syncs.remove(sync_id);

        let _ = self.app_handle.emit(
            "sync-completed",
            SyncCompletedPayload {
                sync_id: sync_id.to_string(),
                files_uploaded: 0,
                files_downloaded: 0,
            },
        );

        Ok(())
    }

    pub async fn get_active_syncs(&self) -> Vec<SyncState> {
        self.active_syncs
            .read()
            .await
            .values()
            .filter(|s| s.is_active)
            .cloned()
            .collect()
    }

    async fn handle_file_event(
        app_handle: &AppHandle,
        sync_id: &str,
        _local_path: &str,
        event: Event,
    ) {
        use notify::EventKind;

        match event.kind {
            EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_) => {
                for path in &event.paths {
                    let _ = app_handle.emit(
                        "sync-progress",
                        SyncProgressPayload {
                            sync_id: sync_id.to_string(),
                            current: 0,
                            total: 1,
                            current_file: path.display().to_string(),
                        },
                    );
                }
            }
            _ => {}
        }
    }

    pub fn emit_sync_error(&self, sync_id: &str, error: &str) {
        let _ = self.app_handle.emit(
            "sync-error",
            SyncErrorPayload {
                sync_id: sync_id.to_string(),
                error: error.to_string(),
            },
        );
    }

    pub fn emit_sync_progress(&self, sync_id: &str, current: u64, total: u64, current_file: &str) {
        let _ = self.app_handle.emit(
            "sync-progress",
            SyncProgressPayload {
                sync_id: sync_id.to_string(),
                current,
                total,
                current_file: current_file.to_string(),
            },
        );
    }

    pub fn emit_sync_completed(
        &self,
        sync_id: &str,
        files_uploaded: u64,
        files_downloaded: u64,
    ) {
        let _ = self.app_handle.emit(
            "sync-completed",
            SyncCompletedPayload {
                sync_id: sync_id.to_string(),
                files_uploaded,
                files_downloaded,
            },
        );
    }
}

pub fn calculate_file_md5(path: &Path) -> Result<String> {
    let mut file = File::open(path)?;
    let mut hasher = Md5::new();
    let mut buffer = [0u8; 8192];

    loop {
        let bytes_read = file.read(&mut buffer)?;
        if bytes_read == 0 {
            break;
        }
        hasher.update(&buffer[..bytes_read]);
    }

    let result = hasher.finalize();
    Ok(format!("{:x}", result))
}

pub fn compare_checksums(local_md5: &str, etag: &str) -> bool {
    let etag_clean = etag.trim_matches('"');

    if etag_clean.contains('-') {
        return false;
    }

    local_md5.eq_ignore_ascii_case(etag_clean)
}

impl SyncEntry {
    pub fn new(path: String) -> Self {
        Self {
            path,
            local_md5: None,
            remote_etag: None,
            needs_upload: false,
            needs_download: false,
        }
    }

    pub fn with_local_md5(mut self, md5: String) -> Self {
        self.local_md5 = Some(md5);
        self
    }

    pub fn with_remote_etag(mut self, etag: String) -> Self {
        self.remote_etag = Some(etag);
        self
    }

    pub fn determine_sync_action(&mut self) {
        match (&self.local_md5, &self.remote_etag) {
            (Some(local), Some(remote)) => {
                if !compare_checksums(local, remote) {
                    self.needs_upload = true;
                }
            }
            (Some(_), None) => {
                self.needs_upload = true;
            }
            (None, Some(_)) => {
                self.needs_download = true;
            }
            (None, None) => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compare_checksums_matching() {
        let md5 = "d41d8cd98f00b204e9800998ecf8427e";
        let etag = "\"d41d8cd98f00b204e9800998ecf8427e\"";
        assert!(compare_checksums(md5, etag));
    }

    #[test]
    fn test_compare_checksums_not_matching() {
        let md5 = "d41d8cd98f00b204e9800998ecf8427e";
        let etag = "\"a41d8cd98f00b204e9800998ecf8427e\"";
        assert!(!compare_checksums(md5, etag));
    }

    #[test]
    fn test_compare_checksums_multipart() {
        let md5 = "d41d8cd98f00b204e9800998ecf8427e";
        let etag = "\"d41d8cd98f00b204e9800998ecf8427e-5\"";
        assert!(!compare_checksums(md5, etag));
    }

    #[test]
    fn test_sync_entry_needs_upload() {
        let mut entry = SyncEntry::new("test.txt".to_string())
            .with_local_md5("abc123".to_string());
        entry.determine_sync_action();
        assert!(entry.needs_upload);
        assert!(!entry.needs_download);
    }

    #[test]
    fn test_sync_entry_needs_download() {
        let mut entry = SyncEntry::new("test.txt".to_string())
            .with_remote_etag("\"abc123\"".to_string());
        entry.determine_sync_action();
        assert!(!entry.needs_upload);
        assert!(entry.needs_download);
    }
}
