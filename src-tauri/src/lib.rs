mod commands;
mod config;
mod s3_client;
mod sync;

use commands::*;
use sync::SyncManager;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let sync_manager = SyncManager::new(app.handle().clone());
            app.manage(sync_manager);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_profiles,
            create_profile,
            update_profile,
            delete_profile,
            list_buckets,
            create_bucket,
            list_objects,
            create_folder,
            download_object,
            upload_files,
            upload_folder,
            delete_object,
            presign_url,
            sync_folder,
            get_object_content_type,
            get_object_preview,
            start_keep_sync,
            stop_keep_sync,
            get_active_syncs,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
