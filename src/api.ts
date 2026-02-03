import { invoke } from "@tauri-apps/api/core";
import type {
  Profile,
  BucketInfo,
  ListObjectsResult,
  ObjectMetadata,
  SyncResult,
  SyncState,
} from "./types";

// Profile functions
export async function getProfiles(): Promise<Profile[]> {
  return invoke("get_profiles");
}

export async function createProfile(profile: Omit<Profile, "id"> & { id?: string }): Promise<Profile> {
  return invoke("create_profile", { profile: { ...profile, id: profile.id || "" } });
}

export async function updateProfile(profile: Profile): Promise<Profile> {
  return invoke("update_profile", { profile });
}

export async function deleteProfile(id: string): Promise<void> {
  return invoke("delete_profile", { id });
}

// S3 functions
export async function listBuckets(profileId: string): Promise<BucketInfo[]> {
  return invoke("list_buckets", { profileId });
}

export async function createBucket(
  profileId: string,
  name: string,
  isPublic: boolean
): Promise<void> {
  return invoke("create_bucket", { profileId, name, public: isPublic });
}

export async function listObjects(
  profileId: string,
  bucket: string,
  prefix?: string,
  continuationToken?: string,
  maxKeys: number = 50
): Promise<ListObjectsResult> {
  return invoke("list_objects", {
    profileId,
    bucket,
    prefix: prefix || null,
    continuationToken: continuationToken || null,
    maxKeys,
  });
}

export async function createFolder(
  profileId: string,
  bucket: string,
  key: string
): Promise<void> {
  return invoke("create_folder", { profileId, bucket, key });
}

export async function downloadObject(
  profileId: string,
  bucket: string,
  key: string,
  localPath: string
): Promise<void> {
  return invoke("download_object", { profileId, bucket, key, localPath });
}

export async function uploadFile(
  profileId: string,
  bucket: string,
  prefix: string,
  filePath: string
): Promise<void> {
  return invoke("upload_files", { profileId, bucket, prefix, filePaths: [filePath] });
}

export async function uploadFiles(
  profileId: string,
  bucket: string,
  prefix: string,
  filePaths: string[]
): Promise<void> {
  return invoke("upload_files", { profileId, bucket, prefix, filePaths });
}

export async function uploadFolder(
  profileId: string,
  bucket: string,
  prefix: string,
  folderPath: string
): Promise<void> {
  return invoke("upload_folder", { profileId, bucket, prefix, folderPath });
}

export async function deleteObject(
  profileId: string,
  bucket: string,
  key: string
): Promise<void> {
  return invoke("delete_object", { profileId, bucket, key });
}

export async function presignUrl(
  profileId: string,
  bucket: string,
  key: string,
  expiresSecs: number = 3600
): Promise<string> {
  return invoke("presign_url", { profileId, bucket, key, expiresSecs });
}

export async function syncFolder(
  profileId: string,
  bucket: string,
  prefix: string,
  localPath: string,
  direction: string
): Promise<SyncResult> {
  return invoke("sync_folder", {
    profileId,
    bucket,
    prefix,
    localPath,
    direction,
  });
}

export async function getObjectContentType(
  profileId: string,
  bucket: string,
  key: string
): Promise<ObjectMetadata> {
  return invoke("get_object_content_type", { profileId, bucket, key });
}

export interface PreviewData {
  data: string;
  content_type: string;
}

export async function getObjectPreview(
  profileId: string,
  bucket: string,
  key: string
): Promise<PreviewData> {
  return invoke("get_object_preview", { profileId, bucket, key });
}

// KeepSync functions
export async function startKeepSync(
  profileId: string,
  bucket: string,
  prefix: string,
  localPath: string
): Promise<string> {
  return invoke("start_keep_sync", {
    profileId,
    bucket,
    prefix,
    localPath,
  });
}

export async function stopKeepSync(syncId: string): Promise<void> {
  return invoke("stop_keep_sync", { syncId });
}

export async function getActiveSyncs(): Promise<SyncState[]> {
  return invoke("get_active_syncs");
}
