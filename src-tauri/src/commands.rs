use tauri::State;

use crate::config::{self, AddressingStyle, Profile};
use crate::s3_client::{
    BucketInfo, DeleteObjectsResult, ListObjectsResult, ObjectMetadata, S3Client, S3ClientBuilder,
    SyncDirection, SyncResult,
};
use crate::sync::{SyncManager, SyncState};

async fn get_client_for_profile(profile_id: &str) -> Result<S3Client, String> {
    let config = config::load_config().map_err(|e| e.to_string())?;

    let profile = config
        .profiles
        .iter()
        .find(|p| p.id == profile_id)
        .ok_or_else(|| format!("Profile not found: {}", profile_id))?;

    let s3_profile = crate::s3_client::Profile {
        name: profile.name.clone(),
        access_key_id: profile.access_key_id.clone(),
        secret_access_key: profile.secret_access_key.clone(),
        region: profile.region.clone(),
        endpoint: profile.endpoint.clone(),
        path_style: profile.addressing_style == AddressingStyle::Path,
        signature_version: match profile.signature_version {
            config::SignatureVersion::V2 => crate::s3_client::SignatureVersion::V2,
            config::SignatureVersion::V4 => crate::s3_client::SignatureVersion::V4,
        },
    };

    S3ClientBuilder::new(s3_profile)
        .build()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_profiles() -> Result<Vec<Profile>, String> {
    let config = config::load_config().map_err(|e| e.to_string())?;
    Ok(config.profiles)
}

#[tauri::command]
pub fn create_profile(profile: Profile) -> Result<Profile, String> {
    let mut config = config::load_config().map_err(|e| e.to_string())?;

    let new_profile = config::create_profile(
        &mut config,
        profile.name,
        profile.provider,
        profile.endpoint,
        profile.region,
        profile.access_key_id,
        profile.secret_access_key,
        profile.addressing_style,
        profile.signature_version,
    );

    config::save_config(&config).map_err(|e| e.to_string())?;
    Ok(new_profile)
}

#[tauri::command]
pub fn update_profile(profile: Profile) -> Result<Profile, String> {
    let mut config = config::load_config().map_err(|e| e.to_string())?;
    config::update_profile(&mut config, profile.clone()).map_err(|e| e.to_string())?;
    config::save_config(&config).map_err(|e| e.to_string())?;
    Ok(profile)
}

#[tauri::command]
pub fn delete_profile(id: String) -> Result<(), String> {
    let mut config = config::load_config().map_err(|e| e.to_string())?;
    config::delete_profile(&mut config, &id).map_err(|e| e.to_string())?;
    config::save_config(&config).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn list_buckets(profile_id: String) -> Result<Vec<BucketInfo>, String> {
    let client = get_client_for_profile(&profile_id).await?;
    client.list_buckets().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_bucket(
    profile_id: String,
    name: String,
    public: bool,
) -> Result<(), String> {
    let client = get_client_for_profile(&profile_id).await?;
    client
        .create_bucket(&name, public)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_objects(
    profile_id: String,
    bucket: String,
    prefix: Option<String>,
    continuation_token: Option<String>,
    max_keys: i32,
) -> Result<ListObjectsResult, String> {
    let client = get_client_for_profile(&profile_id).await?;
    client
        .list_objects(
            &bucket,
            prefix.as_deref(),
            continuation_token.as_deref(),
            max_keys,
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn download_object(
    profile_id: String,
    bucket: String,
    key: String,
    local_path: String,
) -> Result<(), String> {
    let client = get_client_for_profile(&profile_id).await?;
    client
        .download_object(&bucket, &key, &local_path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_folder(
    profile_id: String,
    bucket: String,
    key: String,
) -> Result<(), String> {
    let client = get_client_for_profile(&profile_id).await?;
    client
        .create_folder(&bucket, &key)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn upload_files(
    profile_id: String,
    bucket: String,
    prefix: String,
    file_paths: Vec<String>,
) -> Result<(), String> {
    let client = get_client_for_profile(&profile_id).await?;

    for file_path in file_paths {
        let file_name = std::path::Path::new(&file_path)
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or_else(|| format!("Invalid file path: {}", file_path))?;

        let key = if prefix.is_empty() {
            file_name.to_string()
        } else {
            format!("{}/{}", prefix.trim_end_matches('/'), file_name)
        };

        client
            .upload_file(&bucket, &key, &file_path)
            .await
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub async fn upload_folder(
    profile_id: String,
    bucket: String,
    prefix: String,
    folder_path: String,
) -> Result<(), String> {
    let client = get_client_for_profile(&profile_id).await?;
    client
        .upload_folder(&bucket, &prefix, &folder_path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_object(
    profile_id: String,
    bucket: String,
    key: String,
) -> Result<(), String> {
    let client = get_client_for_profile(&profile_id).await?;
    client
        .delete_object(&bucket, &key)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_objects(
    profile_id: String,
    bucket: String,
    keys: Vec<String>,
) -> Result<DeleteObjectsResult, String> {
    let client = get_client_for_profile(&profile_id).await?;
    client
        .delete_objects(&bucket, &keys)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn presign_url(
    profile_id: String,
    bucket: String,
    key: String,
    expires_secs: u64,
) -> Result<String, String> {
    let client = get_client_for_profile(&profile_id).await?;
    client
        .presign_get_url(&bucket, &key, expires_secs)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sync_folder(
    profile_id: String,
    bucket: String,
    prefix: String,
    local_path: String,
    direction: String,
) -> Result<SyncResult, String> {
    let client = get_client_for_profile(&profile_id).await?;

    let sync_direction = match direction.as_str() {
        "local_to_remote" => SyncDirection::LocalToRemote,
        "remote_to_local" => SyncDirection::RemoteToLocal,
        _ => return Err(format!("Invalid sync direction: {}", direction)),
    };

    client
        .sync_folder(&bucket, &prefix, &local_path, sync_direction)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_object_content_type(
    profile_id: String,
    bucket: String,
    key: String,
) -> Result<ObjectMetadata, String> {
    let client = get_client_for_profile(&profile_id).await?;
    client
        .get_object_metadata(&bucket, &key)
        .await
        .map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
pub struct PreviewData {
    pub data: String,
    pub content_type: String,
}

#[tauri::command]
pub async fn get_object_preview(
    profile_id: String,
    bucket: String,
    key: String,
) -> Result<PreviewData, String> {
    let client = get_client_for_profile(&profile_id).await?;
    let (bytes, content_type) = client
        .get_object_bytes(&bucket, &key)
        .await
        .map_err(|e| e.to_string())?;
    
    use base64::Engine;
    let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
    
    let ct = content_type.unwrap_or_else(|| {
        // Guess content type from extension
        let ext = key.rsplit('.').next().unwrap_or("").to_lowercase();
        match ext.as_str() {
            "jpg" | "jpeg" => "image/jpeg",
            "png" => "image/png",
            "gif" => "image/gif",
            "webp" => "image/webp",
            "svg" => "image/svg+xml",
            "bmp" => "image/bmp",
            "ico" => "image/x-icon",
            "mp4" => "video/mp4",
            "webm" => "video/webm",
            "ogg" => "video/ogg",
            "mov" => "video/quicktime",
            _ => "application/octet-stream",
        }.to_string()
    });
    
    Ok(PreviewData {
        data: encoded,
        content_type: ct,
    })
}

#[tauri::command]
pub async fn start_keep_sync(
    sync_manager: State<'_, SyncManager>,
    profile_id: String,
    bucket: String,
    prefix: String,
    local_path: String,
) -> Result<String, String> {
    sync_manager
        .start_keep_sync(&profile_id, &bucket, &prefix, &local_path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn stop_keep_sync(
    sync_manager: State<'_, SyncManager>,
    sync_id: String,
) -> Result<(), String> {
    sync_manager
        .stop_keep_sync(&sync_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_active_syncs(
    sync_manager: State<'_, SyncManager>,
) -> Result<Vec<SyncState>, String> {
    Ok(sync_manager.get_active_syncs().await)
}
