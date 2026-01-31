# S3GUI - Object Storage Manager

A modern, cross-platform GUI application for managing S3-compatible object storage services, built with Rust and Tauri.

![S3GUI](https://img.shields.io/badge/Built%20with-Tauri%202.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## Features

### Multi-Provider Support
- **AWS S3** - Native AWS S3 support
- **Google Cloud Storage** - GCS with S3-compatible API
- **Azure Blob** - Azure Blob Storage
- **MinIO** - Self-hosted S3-compatible storage
- **RustFS** - Rust-based file system
- **Volcengine TOS** - ByteDance object storage
- **Tencent COS** - Tencent Cloud Object Storage
- **Baidu BOS** - Baidu Object Storage

### Core Operations
- **Bucket Management**: List, create public/private buckets
- **Object Operations**: List, upload, download, delete objects
- **Folder Navigation**: Browse nested folder structures with pagination
- **Multi-file Upload**: Upload multiple files at once
- **Folder Upload**: Upload entire folder structures (like rsync)
- **Presigned URLs**: Generate temporary access URLs

### Sync Features
- **Sync**: One-time folder synchronization (local ↔ remote)
- **KeepSync**: Continuous file watching with automatic sync
- **Checksum Verification**: MD5-based file integrity checks

### Preview & UI
- **Image Preview**: View JPG, PNG, GIF, WebP, SVG directly
- **Video Preview**: Play MP4, WebM, OGG files
- **Dark Theme**: Modern dark interface
- **Keyboard Shortcuts**: Efficient navigation and operations

### Advanced Options
- **Path-style Addressing**: For MinIO and legacy systems
- **Virtual-hosted Addressing**: For AWS S3 (default)
- **Signature V2/V4**: Support for older and newer S3 APIs

## Installation

### Prerequisites
- [Node.js](https://nodejs.org/) (v18+)
- [Rust](https://rustup.rs/) (latest stable)
- Platform-specific dependencies for [Tauri](https://v2.tauri.app/start/prerequisites/)

### Build from Source

```bash
# Clone the repository
git clone https://github.com/yourusername/s3gui.git
cd s3gui

# Install dependencies
npm install

# Run in development mode
npm run tauri dev

# Build for production
npm run tauri build
```

## Usage

### Setting Up a Profile

1. Click the **+** button in the sidebar to add a new profile
2. Enter your credentials:
   - **Profile Name**: A friendly name for this configuration
   - **Provider**: Select your storage provider
   - **Endpoint**: Custom endpoint URL (leave empty for AWS S3)
   - **Region**: AWS region (e.g., `us-east-1`)
   - **Access Key ID**: Your access key
   - **Secret Access Key**: Your secret key
   - **Addressing Style**: Path or Virtual-hosted
   - **Signature Version**: V2 or V4

### Managing Objects

1. Select a profile from the sidebar
2. Choose a bucket from the dropdown
3. Navigate folders by clicking on them
4. Use toolbar buttons:
   - **Upload Files**: Select multiple files to upload
   - **Upload Folder**: Upload an entire directory
   - **Create Bucket**: Create a new bucket
   - **Sync**: Sync local folder with remote prefix
   - **KeepSync**: Start continuous sync watching

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Escape` | Clear errors / Close modals |
| `Ctrl/Cmd + C` | Copy presigned URL (when focused) |
| `↑` / `k` | Scroll errors up |
| `↓` / `j` | Scroll errors down |

## Configuration

Profiles are stored in `~/.s3gui/config.json`.

## Architecture

```
s3gui/
├── src/                    # Frontend TypeScript
│   ├── main.ts            # Application logic
│   ├── api.ts             # Tauri API bindings
│   └── types.ts           # TypeScript types
├── styles/
│   └── main.css           # Application styles
├── src-tauri/             # Rust backend
│   ├── src/
│   │   ├── lib.rs         # Tauri app setup
│   │   ├── commands.rs    # Tauri commands
│   │   ├── config.rs      # Profile management
│   │   ├── s3_client.rs   # AWS SDK S3 wrapper
│   │   └── sync.rs        # KeepSync implementation
│   └── Cargo.toml         # Rust dependencies
└── package.json           # Node dependencies
```

## Dependencies

### Frontend
- Tauri API (core, dialog, clipboard, fs plugins)
- TypeScript
- Vite

### Backend (Rust)
- [tauri](https://crates.io/crates/tauri) - Application framework
- [aws-sdk-s3](https://crates.io/crates/aws-sdk-s3) - AWS S3 SDK
- [notify](https://crates.io/crates/notify) - File system watching
- [tokio](https://crates.io/crates/tokio) - Async runtime
- [serde](https://crates.io/crates/serde) - Serialization

## License

MIT License - see [LICENSE](LICENSE) for details.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.
