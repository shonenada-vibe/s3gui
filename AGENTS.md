# S3GUI - Object Storage Manager

## Build Commands

```bash
# Install dependencies
npm install

# Development mode (starts both frontend and Tauri)
npm run tauri dev

# Build for production
npm run tauri build

# Type check
npx tsc --noEmit

# Rust check
cd src-tauri && cargo check
```

## Project Structure

- `/src` - Frontend TypeScript code
- `/styles` - CSS styles
- `/src-tauri` - Rust backend
  - `/src/commands.rs` - Tauri commands (API endpoints)
  - `/src/config.rs` - Profile configuration management
  - `/src/s3_client.rs` - S3 client implementation
  - `/src/sync.rs` - KeepSync file watching and sync logic

## Supported Providers

- AWS S3 (default)
- Google Cloud Storage
- Azure Blob
- MinIO
- RustFS
- Volcengine TOS
- Tencent COS
- Baidu BOS

## Key Features

- Profile management (create/edit/delete)
- Bucket operations (list/create)
- Object operations (list/upload/download/delete)
- Presigned URL generation
- Folder sync (bidirectional)
- KeepSync (continuous file watching)
- Image/video preview
- Path-style and virtual-hosted addressing
- Signature V2 and V4 support
