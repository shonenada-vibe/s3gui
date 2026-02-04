export type Provider =
  | "aws_s3"
  | "google_cloud_storage"
  | "azure_blob"
  | "min_i_o"
  | "rust_f_s"
  | "volcengine_t_o_s"
  | "tencent_c_o_s"
  | "baidu_b_o_s";

export type AddressingStyle = "path" | "virtual_hosted";

export type SignatureVersion = "v2" | "v4";

export interface Profile {
  id: string;
  name: string;
  provider: Provider;
  endpoint?: string;
  region: string;
  access_key_id: string;
  secret_access_key: string;
  addressing_style: AddressingStyle;
  signature_version: SignatureVersion;
}

export interface BucketInfo {
  name: string;
  creation_date?: string;
}

export interface ObjectInfo {
  key: string;
  size: number;
  last_modified?: string;
  etag?: string;
  is_folder: boolean;
}

export interface ListObjectsResult {
  objects: ObjectInfo[];
  common_prefixes: string[];
  next_continuation_token?: string;
  is_truncated: boolean;
}

export interface ObjectMetadata {
  content_type?: string;
  content_length: number;
  etag?: string;
  last_modified?: string;
}

export type SyncDirection = "local_to_remote" | "remote_to_local";

export interface SyncResult {
  uploaded: number;
  downloaded: number;
  deleted: number;
  skipped: number;
}

export interface DeleteError {
  key: string;
  message: string;
}

export interface DeleteObjectsResult {
  deleted: number;
  errors: DeleteError[];
}

export interface SyncState {
  sync_id: string;
  profile_id: string;
  bucket: string;
  remote_prefix: string;
  local_path: string;
  is_active: boolean;
  last_sync?: string;
}

export interface SyncProgressPayload {
  sync_id: string;
  current: number;
  total: number;
  current_file: string;
}

export interface SyncCompletedPayload {
  sync_id: string;
  files_uploaded: number;
  files_downloaded: number;
}

export interface SyncErrorPayload {
  sync_id: string;
  error: string;
}

export type TaskType = "upload" | "delete" | "sync" | "keepsync";
export type TaskStatus = "pending" | "running" | "completed" | "failed";

export interface Task {
  id: string;
  type: TaskType;
  fileName: string;
  status: TaskStatus;
  error?: string;
  syncId?: string;
}
