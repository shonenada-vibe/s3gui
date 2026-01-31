use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use thiserror::Error;
use uuid::Uuid;

#[derive(Error, Debug)]
pub enum ConfigError {
    #[error("Failed to read config file: {0}")]
    ReadError(#[from] std::io::Error),
    #[error("Failed to parse config: {0}")]
    ParseError(#[from] serde_json::Error),
    #[error("Profile not found: {0}")]
    ProfileNotFound(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Provider {
    AwsS3,
    GoogleCloudStorage,
    AzureBlob,
    MinIO,
    RustFS,
    VolcengineTOS,
    TencentCOS,
    BaiduBOS,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AddressingStyle {
    Path,
    VirtualHosted,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum SignatureVersion {
    V2,
    V4,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub provider: Provider,
    pub endpoint: Option<String>,
    pub region: String,
    pub access_key_id: String,
    pub secret_access_key: String,
    pub addressing_style: AddressingStyle,
    pub signature_version: SignatureVersion,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Config {
    pub profiles: Vec<Profile>,
}

pub fn get_config_path() -> PathBuf {
    let home = dirs::home_dir().expect("Failed to get home directory");
    home.join(".s3gui").join("config.json")
}

pub fn load_config() -> Result<Config, ConfigError> {
    let config_path = get_config_path();

    if !config_path.exists() {
        return Ok(Config::default());
    }

    let content = fs::read_to_string(&config_path)?;
    let config: Config = serde_json::from_str(&content)?;
    Ok(config)
}

pub fn save_config(config: &Config) -> Result<(), ConfigError> {
    let config_path = get_config_path();

    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent)?;
    }

    let content = serde_json::to_string_pretty(config)?;
    fs::write(&config_path, content)?;
    Ok(())
}

pub fn create_profile(
    config: &mut Config,
    name: String,
    provider: Provider,
    endpoint: Option<String>,
    region: String,
    access_key_id: String,
    secret_access_key: String,
    addressing_style: AddressingStyle,
    signature_version: SignatureVersion,
) -> Profile {
    let profile = Profile {
        id: Uuid::new_v4().to_string(),
        name,
        provider,
        endpoint,
        region,
        access_key_id,
        secret_access_key,
        addressing_style,
        signature_version,
    };
    config.profiles.push(profile.clone());
    profile
}

pub fn update_profile(config: &mut Config, profile: Profile) -> Result<(), ConfigError> {
    let index = config
        .profiles
        .iter()
        .position(|p| p.id == profile.id)
        .ok_or_else(|| ConfigError::ProfileNotFound(profile.id.clone()))?;

    config.profiles[index] = profile;
    Ok(())
}

pub fn delete_profile(config: &mut Config, profile_id: &str) -> Result<(), ConfigError> {
    let index = config
        .profiles
        .iter()
        .position(|p| p.id == profile_id)
        .ok_or_else(|| ConfigError::ProfileNotFound(profile_id.to_string()))?;

    config.profiles.remove(index);
    Ok(())
}
