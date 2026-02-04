use std::path::Path;
use std::time::Duration;

use anyhow::{Context, Result};
use aws_config::BehaviorVersion;
use aws_credential_types::Credentials;
use aws_sdk_s3::config::Region;
use aws_sdk_s3::presigning::PresigningConfig;
use aws_sdk_s3::primitives::ByteStream;
use aws_sdk_s3::types::{BucketCannedAcl, ObjectCannedAcl};
use chrono::{DateTime, Utc};
use md5::{Digest, Md5};
use serde::{Deserialize, Serialize};
use tokio::fs::File;
use tokio::io::AsyncReadExt;
use walkdir::WalkDir;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Profile {
    pub name: String,
    pub access_key_id: String,
    pub secret_access_key: String,
    pub region: String,
    pub endpoint: Option<String>,
    pub path_style: bool,
    pub signature_version: SignatureVersion,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SignatureVersion {
    V2,
    V4,
}

impl Default for SignatureVersion {
    fn default() -> Self {
        SignatureVersion::V4
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BucketInfo {
    pub name: String,
    pub creation_date: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ObjectInfo {
    pub key: String,
    pub size: i64,
    pub last_modified: Option<DateTime<Utc>>,
    pub etag: Option<String>,
    pub is_folder: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListObjectsResult {
    pub objects: Vec<ObjectInfo>,
    pub common_prefixes: Vec<String>,
    pub next_continuation_token: Option<String>,
    pub is_truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ObjectMetadata {
    pub content_type: Option<String>,
    pub content_length: i64,
    pub etag: Option<String>,
    pub last_modified: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SyncDirection {
    LocalToRemote,
    RemoteToLocal,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SyncResult {
    pub uploaded: u64,
    pub downloaded: u64,
    pub deleted: u64,
    pub skipped: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeleteError {
    pub key: String,
    pub message: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DeleteObjectsResult {
    pub deleted: u64,
    pub errors: Vec<DeleteError>,
}

pub struct S3Client {
    client: aws_sdk_s3::Client,
    region: String,
}

pub struct S3ClientBuilder {
    profile: Profile,
}

impl S3ClientBuilder {
    pub fn new(profile: Profile) -> Self {
        Self { profile }
    }

    pub async fn build(self) -> Result<S3Client> {
        let credentials = Credentials::new(
            &self.profile.access_key_id,
            &self.profile.secret_access_key,
            None,
            None,
            "s3gui",
        );

        let region = Region::new(self.profile.region.clone());

        let mut config_builder = aws_sdk_s3::Config::builder()
            .behavior_version(BehaviorVersion::latest())
            .credentials_provider(credentials)
            .region(region)
            .force_path_style(self.profile.path_style);

        if let Some(endpoint) = &self.profile.endpoint {
            config_builder = config_builder.endpoint_url(endpoint);
        }

        let config = config_builder.build();
        let client = aws_sdk_s3::Client::from_conf(config);

        Ok(S3Client {
            client,
            region: self.profile.region,
        })
    }
}

impl S3Client {
    pub async fn list_buckets(&self) -> Result<Vec<BucketInfo>> {
        let resp = self
            .client
            .list_buckets()
            .send()
            .await
            .context("Failed to list buckets")?;

        let buckets = resp
            .buckets()
            .iter()
            .map(|b| BucketInfo {
                name: b.name().unwrap_or_default().to_string(),
                creation_date: b.creation_date().and_then(|dt| {
                    DateTime::from_timestamp(dt.secs(), dt.subsec_nanos())
                }),
            })
            .collect();

        Ok(buckets)
    }

    pub async fn create_bucket(&self, name: &str, public: bool) -> Result<()> {
        let mut req = self.client.create_bucket().bucket(name);

        if self.region != "us-east-1" {
            let constraint = aws_sdk_s3::types::CreateBucketConfiguration::builder()
                .location_constraint(aws_sdk_s3::types::BucketLocationConstraint::from(
                    self.region.as_str(),
                ))
                .build();
            req = req.create_bucket_configuration(constraint);
        }

        if public {
            req = req.acl(BucketCannedAcl::PublicRead);
        }

        req.send().await.context("Failed to create bucket")?;

        Ok(())
    }

    pub async fn list_objects(
        &self,
        bucket: &str,
        prefix: Option<&str>,
        continuation_token: Option<&str>,
        max_keys: i32,
    ) -> Result<ListObjectsResult> {
        let mut req = self
            .client
            .list_objects_v2()
            .bucket(bucket)
            .max_keys(max_keys)
            .delimiter("/");

        if let Some(p) = prefix {
            req = req.prefix(p);
        }

        if let Some(token) = continuation_token {
            req = req.continuation_token(token);
        }

        let resp = req.send().await.context("Failed to list objects")?;

        let objects = resp
            .contents()
            .iter()
            .map(|obj| {
                let key = obj.key().unwrap_or_default().to_string();
                let is_folder = key.ends_with('/');
                ObjectInfo {
                    key,
                    size: obj.size().unwrap_or(0),
                    last_modified: obj.last_modified().and_then(|dt| {
                        DateTime::from_timestamp(dt.secs(), dt.subsec_nanos())
                    }),
                    etag: obj.e_tag().map(|s| s.to_string()),
                    is_folder,
                }
            })
            .collect();

        let common_prefixes = resp
            .common_prefixes()
            .iter()
            .filter_map(|cp| cp.prefix().map(|s| s.to_string()))
            .collect();

        Ok(ListObjectsResult {
            objects,
            common_prefixes,
            next_continuation_token: resp.next_continuation_token().map(|s| s.to_string()),
            is_truncated: resp.is_truncated().unwrap_or(false),
        })
    }

    pub async fn download_object(
        &self,
        bucket: &str,
        key: &str,
        local_path: &str,
    ) -> Result<()> {
        let resp = self
            .client
            .get_object()
            .bucket(bucket)
            .key(key)
            .send()
            .await
            .context("Failed to get object")?;

        let body = resp.body.collect().await.context("Failed to read body")?;
        let bytes = body.into_bytes();

        let path = Path::new(local_path);
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .context("Failed to create parent directories")?;
        }

        tokio::fs::write(local_path, bytes)
            .await
            .context("Failed to write file")?;

        Ok(())
    }

    pub async fn get_object_bytes(
        &self,
        bucket: &str,
        key: &str,
    ) -> Result<(Vec<u8>, Option<String>)> {
        let resp = self
            .client
            .get_object()
            .bucket(bucket)
            .key(key)
            .send()
            .await
            .context("Failed to get object")?;

        let content_type = resp.content_type().map(|s| s.to_string());
        let body = resp.body.collect().await.context("Failed to read body")?;
        let bytes = body.into_bytes().to_vec();

        Ok((bytes, content_type))
    }

    pub async fn upload_file(
        &self,
        bucket: &str,
        key: &str,
        local_path: &str,
    ) -> Result<()> {
        let body = ByteStream::from_path(Path::new(local_path))
            .await
            .context("Failed to read file")?;

        self.client
            .put_object()
            .bucket(bucket)
            .key(key)
            .body(body)
            .send()
            .await
            .context("Failed to upload object")?;

        Ok(())
    }

    pub async fn create_folder(&self, bucket: &str, key: &str) -> Result<()> {
        let folder_key = if key.ends_with('/') {
            key.to_string()
        } else {
            format!("{}/", key)
        };

        self.client
            .put_object()
            .bucket(bucket)
            .key(&folder_key)
            .body(ByteStream::from(vec![]))
            .send()
            .await
            .context("Failed to create folder")?;

        Ok(())
    }

    pub async fn upload_folder(
        &self,
        bucket: &str,
        prefix: &str,
        local_folder: &str,
    ) -> Result<()> {
        let local_path = Path::new(local_folder);

        for entry in WalkDir::new(local_folder).into_iter().filter_map(|e| e.ok()) {
            if entry.file_type().is_file() {
                let relative_path = entry
                    .path()
                    .strip_prefix(local_path)
                    .context("Failed to get relative path")?;

                let key = if prefix.is_empty() {
                    relative_path.to_string_lossy().to_string()
                } else {
                    format!(
                        "{}/{}",
                        prefix.trim_end_matches('/'),
                        relative_path.to_string_lossy()
                    )
                };

                self.upload_file(bucket, &key, entry.path().to_str().unwrap())
                    .await?;
            }
        }

        Ok(())
    }

    pub async fn delete_object(&self, bucket: &str, key: &str) -> Result<()> {
        self.client
            .delete_object()
            .bucket(bucket)
            .key(key)
            .send()
            .await
            .context("Failed to delete object")?;

        Ok(())
    }

    pub async fn delete_objects(&self, bucket: &str, keys: &[String]) -> Result<DeleteObjectsResult> {
        use aws_sdk_s3::types::{Delete, ObjectIdentifier};

        if keys.is_empty() {
            return Ok(DeleteObjectsResult {
                deleted: 0,
                errors: vec![],
            });
        }

        let objects: Vec<ObjectIdentifier> = keys
            .iter()
            .filter_map(|key| ObjectIdentifier::builder().key(key).build().ok())
            .collect();

        let delete = Delete::builder()
            .set_objects(Some(objects))
            .build()
            .context("Failed to build delete request")?;

        let resp = self
            .client
            .delete_objects()
            .bucket(bucket)
            .delete(delete)
            .send()
            .await
            .context("Failed to delete objects")?;

        let deleted = resp.deleted().len() as u64;
        let errors: Vec<DeleteError> = resp
            .errors()
            .iter()
            .map(|e| DeleteError {
                key: e.key().unwrap_or_default().to_string(),
                message: e.message().unwrap_or_default().to_string(),
            })
            .collect();

        Ok(DeleteObjectsResult { deleted, errors })
    }

    pub async fn presign_get_url(
        &self,
        bucket: &str,
        key: &str,
        expires_in_secs: u64,
    ) -> Result<String> {
        let presigning_config = PresigningConfig::expires_in(Duration::from_secs(expires_in_secs))
            .context("Invalid expiration duration")?;

        let presigned = self
            .client
            .get_object()
            .bucket(bucket)
            .key(key)
            .presigned(presigning_config)
            .await
            .context("Failed to generate presigned URL")?;

        Ok(presigned.uri().to_string())
    }

    pub async fn sync_folder(
        &self,
        bucket: &str,
        prefix: &str,
        local_folder: &str,
        direction: SyncDirection,
    ) -> Result<SyncResult> {
        let mut result = SyncResult::default();

        match direction {
            SyncDirection::LocalToRemote => {
                self.sync_local_to_remote(bucket, prefix, local_folder, &mut result)
                    .await?;
            }
            SyncDirection::RemoteToLocal => {
                self.sync_remote_to_local(bucket, prefix, local_folder, &mut result)
                    .await?;
            }
        }

        Ok(result)
    }

    async fn sync_local_to_remote(
        &self,
        bucket: &str,
        prefix: &str,
        local_folder: &str,
        result: &mut SyncResult,
    ) -> Result<()> {
        let local_path = Path::new(local_folder);
        let remote_objects = self.list_all_objects(bucket, Some(prefix)).await?;

        let remote_map: std::collections::HashMap<String, ObjectInfo> = remote_objects
            .into_iter()
            .map(|o| (o.key.clone(), o))
            .collect();

        for entry in WalkDir::new(local_folder).into_iter().filter_map(|e| e.ok()) {
            if entry.file_type().is_file() {
                let relative_path = entry
                    .path()
                    .strip_prefix(local_path)
                    .context("Failed to get relative path")?;

                let key = if prefix.is_empty() {
                    relative_path.to_string_lossy().to_string()
                } else {
                    format!(
                        "{}/{}",
                        prefix.trim_end_matches('/'),
                        relative_path.to_string_lossy()
                    )
                };

                let local_etag = self.compute_local_etag(entry.path()).await?;

                if let Some(remote_obj) = remote_map.get(&key) {
                    let remote_etag = remote_obj
                        .etag
                        .as_ref()
                        .map(|e| e.trim_matches('"').to_string());

                    if Some(local_etag.clone()) == remote_etag {
                        result.skipped += 1;
                        continue;
                    }
                }

                self.upload_file(bucket, &key, entry.path().to_str().unwrap())
                    .await?;
                result.uploaded += 1;
            }
        }

        Ok(())
    }

    async fn sync_remote_to_local(
        &self,
        bucket: &str,
        prefix: &str,
        local_folder: &str,
        result: &mut SyncResult,
    ) -> Result<()> {
        let local_path = Path::new(local_folder);
        tokio::fs::create_dir_all(local_path)
            .await
            .context("Failed to create local folder")?;

        let remote_objects = self.list_all_objects(bucket, Some(prefix)).await?;

        for obj in remote_objects {
            if obj.is_folder {
                continue;
            }

            let relative_key = if prefix.is_empty() {
                obj.key.clone()
            } else {
                obj.key
                    .strip_prefix(prefix.trim_end_matches('/'))
                    .unwrap_or(&obj.key)
                    .trim_start_matches('/')
                    .to_string()
            };

            let local_file_path = local_path.join(&relative_key);

            if local_file_path.exists() {
                let local_etag = self.compute_local_etag(&local_file_path).await?;
                let remote_etag = obj.etag.as_ref().map(|e| e.trim_matches('"').to_string());

                if Some(local_etag) == remote_etag {
                    result.skipped += 1;
                    continue;
                }
            }

            self.download_object(bucket, &obj.key, local_file_path.to_str().unwrap())
                .await?;
            result.downloaded += 1;
        }

        Ok(())
    }

    async fn list_all_objects(
        &self,
        bucket: &str,
        prefix: Option<&str>,
    ) -> Result<Vec<ObjectInfo>> {
        let mut all_objects = Vec::new();
        let mut continuation_token: Option<String> = None;

        loop {
            let result = self
                .list_objects(bucket, prefix, continuation_token.as_deref(), 1000)
                .await?;

            all_objects.extend(result.objects);

            if !result.is_truncated {
                break;
            }

            continuation_token = result.next_continuation_token;
        }

        Ok(all_objects)
    }

    async fn compute_local_etag(&self, path: &Path) -> Result<String> {
        let mut file = File::open(path).await.context("Failed to open file")?;
        let mut hasher = Md5::new();
        let mut buffer = vec![0u8; 8192];

        loop {
            let bytes_read = file.read(&mut buffer).await.context("Failed to read file")?;
            if bytes_read == 0 {
                break;
            }
            hasher.update(&buffer[..bytes_read]);
        }

        let hash = hasher.finalize();
        Ok(format!("{:x}", hash))
    }

    pub async fn get_object_metadata(
        &self,
        bucket: &str,
        key: &str,
    ) -> Result<ObjectMetadata> {
        let resp = self
            .client
            .head_object()
            .bucket(bucket)
            .key(key)
            .send()
            .await
            .context("Failed to get object metadata")?;

        Ok(ObjectMetadata {
            content_type: resp.content_type().map(|s| s.to_string()),
            content_length: resp.content_length().unwrap_or(0),
            etag: resp.e_tag().map(|s| s.to_string()),
            last_modified: resp.last_modified().and_then(|dt| {
                DateTime::from_timestamp(dt.secs(), dt.subsec_nanos())
            }),
        })
    }
}
