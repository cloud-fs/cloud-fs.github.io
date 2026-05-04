# CloudDrive2 gRPC API Developer's Guide

Version: 1.0.7

## Table of Contents

- [What's New in 1.0.7](#whats-new-in-107)
- [What's New in 1.0.6](#whats-new-in-106)
- [What's New in 1.0.5](#whats-new-in-105)
- [What's New in 1.0.1](#whats-new-in-101)
- [What's New in 1.0.0](#whats-new-in-100)
- [Overview](#overview)
- [Service Definition](#service-definition)
- [Download Proto File](#download-proto-file)
- [Authentication](#authentication)
- [Getting Started](#getting-started)
  - [C# Setup](#c-setup)
  - [Java Setup](#java-setup)
  - [Go Setup](#go-setup)
  - [Python Setup](#python-setup)
- [API Reference](#api-reference)
  - [Public Methods (No Authorization Required)](#public-methods-no-authorization-required)
  - [Authorized Methods](#authorized-methods)
  - [File Operations](#file-operations)
  - [Mount Point Management](#mount-point-management)
  - [Transfer Task Management](#transfer-task-management)
  - [Cloud API Management](#cloud-api-management)
  - [Backup Management](#backup-management)
  - [WebDAV Management](#webdav-management)
  - [Token Management](#token-management)
  - [Two-Factor Authentication (2FA)](#two-factor-authentication-2fa)
  - [Session Management](#session-management)
  - [Remote Upload Protocol](#remote-upload-protocol)
- [Data Types Reference](#data-types-reference)
- [Error Handling](#error-handling)
- [Best Practices](#best-practices)

---

## What's New in 1.0.7

### Client-Driven Cache Prefetch Hints

CloudDrive2 1.0.7 adds a client-driven prefetch system. Clients can hint at byte ranges they intend to read so the server can populate the read-ahead cache before the actual reads arrive, with a priority that also triages concurrent work. This is intended for clients with explicit knowledge of upcoming access patterns (media players seeking, batched thumbnail generation, archive browsers reading central directories, etc.).

**New RPCs:**
- **`PrefetchFileRanges`** — Tell the server to prefetch one or more byte ranges on a file. Returns a `hint_id` for later cancellation, plus accepted/rejected counts.
- **`CancelFilePrefetch`** — Cancel one or more hints previously registered on a path. An empty `hint_ids` list cancels all hints on that path.
- **`CloseFileReader`** — Signal "I will not read this file again." Drops the server-side `EntryReader` (download buffers + downloader threads) as soon as no open handles remain, skipping the default 2-second post-close retention window. Use for one-shot reads (web thumbnails, metadata probes).
- **`GetActivePrefetchHints`** — Diagnostic snapshot of currently-registered hints plus cumulative process-lifetime counters.

**New Enum:**
```protobuf
// HIGH is served before NORMAL, NORMAL before LOW. LOW is best-effort
// prefetch (e.g. thumbnail batches) that should not stall the main
// playback read stream.
enum HintPriority {
  HINT_PRIORITY_LOW = 0;
  HINT_PRIORITY_NORMAL = 1;
  HINT_PRIORITY_HIGH = 2;
}
```

**New Messages:**
```protobuf
message ByteRange {
  uint64 start = 1;  // inclusive
  uint64 length = 2; // bytes
}

message PrefetchFileRangesRequest {
  string path = 1;
  repeated ByteRange ranges = 2;
  HintPriority priority = 3;
  // 0 = server allocates and returns an id
  uint64 hint_id = 4;
  // 0 = server default (clamped to [1, PREFETCH_HINT_TTL_SEC])
  uint32 ttl_seconds = 5;
  // if true, cancel any prior hints on this path before adding
  bool replace_existing = 6;
}

message PrefetchFileRangesReply {
  uint64 hint_id = 1;
  uint32 accepted_range_count = 2;
  // ranges dropped for being out-of-bounds or already fully cached
  uint32 rejected_range_count = 3;
}

message CancelFilePrefetchRequest {
  string path = 1;
  // empty = cancel all hints on that path
  repeated uint64 hint_ids = 2;
}

message ActivePrefetchHint {
  string path = 1;
  uint64 hint_id = 2;
  HintPriority priority = 3;
  uint64 total_bytes = 4;
  uint32 seconds_since_created = 5;
  uint32 remaining_ttl_seconds = 6;
  uint32 event_count = 7;
}

message GetActivePrefetchHintsReply {
  repeated ActivePrefetchHint hints = 1;
  uint64 hints_created_total = 2;
  uint64 hints_cancelled_total = 3;
  uint64 hints_expired_total = 4;
  uint64 ranges_rejected_cache_hit_total = 5;
  uint64 scale_up_events_total = 6;
  uint64 preempt_events_total = 7;
}
```

### CloudAPIConfig: Server-Reported Caps

Three new read-only fields have been added to `CloudAPIConfig`. The server reports the effective per-cloud (and platform-clamped, where applicable) upper bound for each setting so clients can bound user input in configuration UI. Absent or zero means "no advertised cap; client should fall back to a sensible default". These fields are ignored on `SetCloudAPIConfig`.

**New fields on `CloudAPIConfig`:**
- `maxDownloadThreadsLimit` (field 18) — Effective upper bound for `maxDownloadThreads`.
- `maxBufferPoolSizeMBLimit` (field 19) — Effective upper bound for `maxBufferPoolSizeMB`.
- `maxQueriesPerSecondLimit` (field 20) — Effective upper bound for `maxQueriesPerSecond`.

Example: 115 cloud reports `maxDownloadThreadsLimit = 2` and `maxQueriesPerSecondLimit = 5.0`, so the client UI clamps the threads slider to 2 and the QPS slider to 5.0.

---

## What's New in 1.0.6

### Network File System Support (SFTP / FTP / SMB)

CloudDrive2 1.0.6 adds support for three network file system protocols. Each has a dedicated login RPC and request message.

**New RPCs:**
- **`APILoginSftp`** — Add an SFTP server. Supports password and private-key authentication.
- **`APILoginFtp`** — Add an FTP/FTPS server. Set `useTls = true` for FTPS.
- **`APILoginSmb`** — Add an SMB/CIFS share.
- **`DiscoverSmbServers`** — Discover SMB servers on the local network (returns `DiscoverSmbServersResult`).
- **`DiscoverSmbShares`** — List shares on a given SMB server (returns `DiscoverSmbSharesResult`).

**New Messages:**
```protobuf
message LoginSftpRequest {
  string host = 1;
  uint32 port = 2;                    // default 22
  string userName = 3;
  string password = 4;                // password authentication
  optional string privateKey = 5;     // PEM-encoded private key
  optional string passphrase = 6;     // passphrase for encrypted keys
  optional string rootPath = 7;       // remote root directory (default "/")
  bool doNotSyncToCloud = 8;
  optional ProxyInfo apiProxy = 9;
  optional ProxyInfo dataProxy = 10;
}

message LoginFtpRequest {
  string host = 1;
  uint32 port = 2;                    // default 21
  string userName = 3;
  string password = 4;
  bool useTls = 5;                    // enable FTPS (TLS)
  optional string rootPath = 6;       // remote root directory (default "/")
  bool doNotSyncToCloud = 7;
  optional ProxyInfo apiProxy = 8;
  optional ProxyInfo dataProxy = 9;
}

message LoginSmbRequest {
  string server = 1;                  // SMB server hostname or IP
  string share = 2;                   // share name (e.g. "SharedDocs")
  uint32 port = 3;                    // default 445
  string userName = 4;
  string password = 5;
  optional string workgroup = 6;      // domain/workgroup
  optional string rootPath = 7;       // path within share (default "/")
  bool doNotSyncToCloud = 8;
  optional ProxyInfo apiProxy = 9;
  optional ProxyInfo dataProxy = 10;
}

message SmbServerInfo {
  string name = 1;                    // server name (e.g. "MINIPC-Y10")
  string address = 2;                 // IP address or hostname
}
message DiscoverSmbServersResult {
  repeated SmbServerInfo servers = 1;
}

message DiscoverSmbSharesRequest {
  string server = 1;
  uint32 port = 2;                    // default 445
  string userName = 3;
  string password = 4;
  optional string workgroup = 5;
}
message DiscoverSmbSharesResult {
  repeated string shareNames = 1;
}
```

### Backup: Skip Initial Scan

A new optional field `dontStartScanAfterAdd` (field 15) has been added to the `Backup` message. When set to `true`, adding a backup will not immediately trigger a full scan. The default behavior (unset or `false`) remains unchanged — a full scan starts immediately after the backup is added.

---

## What's New in 1.0.5

### Device Power Type

A new `DevicePowerType` enum has been added to describe the power and storage characteristics of the host device. This is exposed via `GetSystemInfo` in the `CloudDriveSystemInfo` message.

**New Enum:**
```protobuf
enum DevicePowerType {
  // Desktop/server: constant power, fast storage — no restrictions (default)
  DESKTOP = 0;
  // TV set / set-top box: constant power, slow flash storage
  // → local caches disabled, web UI should hide cache-heavy features
  SLOW_STORAGE = 1;
  // Phone / tablet: battery-powered, fast storage
  // → web UI should offer power-saving options when on battery
  BATTERY = 2;
}
```

**New fields on `CloudDriveSystemInfo`:**
- `devicePowerType` (field 6) — Device power and storage profile. See `DevicePowerType` enum.
- `diskCacheDisabled` (field 7) — `true` when directory cache persistence and disk buffer are force-disabled (by platform config or `SLOW_STORAGE` device type).

---

## What's New in 1.0.1

### Log File Rotation Settings

`SystemSettings` now supports configurable log file rotation. Four new fields control how log files are rotated and retained:

**New fields on `SystemSettings`:**
- `maxFileLogSizeBytes` (field 27) — Max size in bytes for a single log file before rotation. Not set = no limit; 0 = disable logging to file; > 0 = rotate when the file exceeds this size.
- `maxBackupLogSizeBytes` (field 28) — Max size in bytes for a single backup log file before rotation, same semantics as above.
- `maxFileLogFiles` (field 29) — Max number of rotated log files to keep (default: 10).
- `maxBackupLogFiles` (field 30) — Max number of rotated backup log files to keep (default: 10).

> **Important:** All 4 fields must be sent together in `SetSystemSettings`. When any field is present the server updates all 4, so omitted size fields are interpreted as "no limit" rather than "don't change".

---

## What's New in 1.0.0

CloudDrive2 1.0.0 is a major release featuring per-folder disk cache control, content search, proxy support for cloud API logins, service capability queries, and local folder creation.

### Per-Folder Disk Cache Control

Disk cache settings have been moved from per-cloud API to per-folder granularity. The old `fileBufferDiskCacheEnabled` and `fileBufferDiskCacheMaxFileSize` fields on `CloudAPIConfig` have been removed (reserved 16, 17).

**New RPCs:**
- **`SetFolderDiskCache`** - Enable and configure disk cache rules for a specific folder
- **`RemoveFolderDiskCache`** - Disable disk cache for a folder
- **`ListDiskCacheFolders`** - List all folders with disk cache rules

**New Messages:**
```protobuf
enum ExtensionFilterMode {
  EXTENSION_FILTER_DISABLED = 0;
  EXTENSION_FILTER_INCLUDE = 1; // Only cache files with listed extensions
  EXTENSION_FILTER_EXCLUDE = 2; // Cache all files except listed extensions
}

message SetFolderDiskCacheRequest {
  string path = 1;
  uint64 maxFileSize = 2;      // 0 = no limit
  uint64 minFileSize = 3;      // 0 = no minimum
  ExtensionFilterMode extensionFilterMode = 4;
  repeated string extensions = 5; // without dot, lowercase (e.g. "mp4", "mkv")
  bool enabled = 6;            // true = enable, false = explicitly disable
}

message DiskCacheFolder {
  string path = 1;
  uint64 maxFileSize = 2;
  uint64 minFileSize = 3;
  ExtensionFilterMode extensionFilterMode = 4;
  repeated string extensions = 5;
  bool enabled = 6;
}

message ListDiskCacheFoldersReply {
  repeated DiskCacheFolder folders = 1;
}
```

**New fields on `CloudDriveFile`:**
- `fileBufferDiskCacheEnabled` (field 77) - Whether disk cache is enabled for this file/folder (resolved via ancestor)
- `fileBufferDiskCacheRules` (field 78) - Disk cache rules for this file/folder (resolved via ancestor, present only when enabled)

### Content Search

Files can now be searched by content (not just filename) on clouds that support it.

**New field in `SearchRequest`:**
- `contentSearch` (field 6) - If true, also search file content (requires `canContentSearch` on the cloud)

**New field on `CloudDriveFile`:**
- `canContentSearch` (field 79) - Whether the cloud supports content search

### Proxy Support for Cloud API Logins

All cloud API login requests now support optional `apiProxy` and `dataProxy` fields for routing connections through proxies. User login/register requests support `cloudfsProxy` for reaching the CloudFS account server.

**Updated Messages with proxy fields:**
- `UserLoginRequest`, `UserRegisterRequest`, `LoginWith2FARequest`, `LoginWithThirdPartyAccountRequest` - added `cloudfsProxy`
- `LoginAliyundriveOAuthRequest`, `LoginAliyundriveQRCodeRequest`, `LoginBaiduPanOAuthRequest`, `LoginOneDriveOAuthRequest`, `LoginGoogleDriveOAuthRequest`, `LoginGoogleDriveRefreshTokenRequest`, `LoginXunleiOAuthRequest`, `LoginXunleiOpenOAuthRequest`, `Login123panOAuthRequest`, `Login115OpenOAuthRequest`, `LoginWebDavRequest`, `LoginS3Request`, `LoginCloudDriveRequest` - added `apiProxy` and `dataProxy`
- `SystemSettings` - added `cloudfsProxy` (field 26)

**Changed RPCs:**
- `APILogin115OpenQRCode` - Now takes `Login115OpenQRCodeRequest` instead of `google.protobuf.Empty`
- `APILogin189QRCode` - Now takes `Login189QRCodeRequest` instead of `google.protobuf.Empty`

### Service Capabilities

**New RPC:**
- **`GetServiceCapabilities`** - Query whether the service supports restart and update

```protobuf
message ServiceCapabilities {
  bool canRestart = 1;
  bool canUpdate = 2;
}
```

### Local Folder Creation

**New RPC:**
- **`LocalCreateFolder`** - Create a folder on the local filesystem

```protobuf
message LocalCreateFolderRequest {
  string parentFolder = 1;
  string folderName = 2;
}
message LocalCreateFolderResult {
  bool success = 1;
  string errorMessage = 2;
  string createdPath = 3;
}
```

### Previous Release Highlights (0.9.22 - 0.9.24)

**0.9.24:**
- S3 signature version configuration for better compatibility with legacy S3 services

**0.9.23:**
- Support for fast copy from 115 Open and Aliyun Drive to 123 Pan
- Fixed high memory usage in certain scenarios when local cache is enabled
- Various bug fixes

**0.9.22:**
- Added Amazon S3 and S3-compatible object storage support
- New `APILoginS3` RPC for S3 integration

**New RPC:**
- **`APILoginS3`** - Add Amazon S3 or S3-compatible storage

**New Message:**
```protobuf
message LoginS3Request {
  string accessKeyId = 1;           // AWS Access Key ID
  string secretAccessKey = 2;       // AWS Secret Access Key
  string region = 3;                // AWS region (e.g., "us-east-1")
  string bucket = 4;                // S3 bucket name
  optional string endpoint = 5;     // Custom endpoint URL for S3-compatible services (e.g., MinIO, Wasabi)
  bool pathStyle = 6;               // Use path-style URLs instead of virtual-hosted style
  bool doNotSyncToCloud = 7;        // If true, do NOT sync this API config to cloud
}
```

**Key Features:**
- Full read/write access to S3 buckets
- Support for standard AWS S3 regions
- Custom endpoint configuration for S3-compatible services
- Path-style URL option for services that don't support virtual-hosted style
- Seamless integration with CloudDrive's unified file management interface

**Supported Services:**
- **Amazon S3** - AWS's object storage service
- **MinIO** - Self-hosted S3-compatible storage
- **Wasabi** - Cloud object storage
- **Backblaze B2** - Cloud storage with S3-compatible API
- **DigitalOcean Spaces** - Object storage for developers
- **Alibaba Cloud OSS** - With S3-compatible mode
- Any other service implementing the S3 API

**Usage Example:**
```csharp
// Add AWS S3 bucket
var s3Request = new LoginS3Request
{
    AccessKeyId = "AKIAIOSFODNN7EXAMPLE",
    SecretAccessKey = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    Region = "us-east-1",
    Bucket = "my-bucket",
    PathStyle = false,
    DoNotSyncToCloud = false
};

var result = await client.APILoginS3Async(s3Request);

// Add MinIO (S3-compatible)
var minioRequest = new LoginS3Request
{
    AccessKeyId = "minioadmin",
    SecretAccessKey = "minioadmin",
    Region = "us-east-1",  // Required but can be any value for MinIO
    Bucket = "test-bucket",
    Endpoint = "http://localhost:9000",
    PathStyle = true,  // MinIO requires path-style
    DoNotSyncToCloud = false
};

var result = await client.APILoginS3Async(minioRequest);
```

**Configuration Notes:**
- **region**: Required field. For AWS S3, use the actual region (e.g., "us-east-1", "eu-west-1"). For S3-compatible services, this field is still required but the value may not matter depending on the service.
- **endpoint**: Optional for AWS S3 (uses default endpoints). Required for S3-compatible services (e.g., "https://s3.wasabisys.com" for Wasabi, "http://localhost:9000" for MinIO).
- **pathStyle**: Set to `true` for services that require path-style URLs (`https://endpoint/bucket/key`) instead of virtual-hosted style (`https://bucket.endpoint/key`). MinIO and some other services require path-style.
- **doNotSyncToCloud**: If `true`, this S3 configuration will not be synced to other CloudDrive instances using the same account.

### Previous Release Highlights (0.9.19 - 0.9.21)

**0.9.21:**
- Fixed incorrect cache size statistics that could cause disk space to exceed the configured limit
- Various bug fixes

**0.9.20:**
- Fixed cache eviction strategy settings not persisting after restart
- Fixed some cached files requiring re-download after restart

**0.9.19:**

#### File Buffer Disk Cache

Version 0.9.18 introduced a powerful disk-based caching system that stores downloaded file content locally, significantly reducing cloud API calls and improving read performance for frequently accessed files.

**RPCs:**
- **`GetFileBufferDiskCacheStats`** - Get runtime statistics for the disk cache
- **`PurgeFileBufferDiskCache`** - Clear all cached file buffers to reclaim disk space

**System Settings:**
- `fileBufferDiskCacheLocation` - Root directory for storing cached segments
- `fileBufferDiskCacheMaxBytes` - Maximum bytes allowed for disk cache

**Per-Cloud Configuration (`CloudAPIConfig`):** *(Removed in 1.0.0 — disk cache is now per-folder via `SetFolderDiskCache`)*
- ~~`fileBufferDiskCacheEnabled`~~ - Removed in 1.0.0
- ~~`fileBufferDiskCacheMaxFileSize`~~ - Removed in 1.0.0

#### Photo Library Integration (iOS/Mobile)

- **`NotifyPhotoLibraryChanges`** - Notify CloudDrive about new photos available for backup

#### Third-Party Account Login

- **`LoginWithThirdPartyAccount`** - Login using OAuth tokens from supported third-party cloud providers

### Previous Release Highlights (0.9.16)

#### Backup Automation Enhancements

The `Backup` message exposes the `syncDeleteFromDest` flag. When enabled, CloudDrive removes destination files that disappeared from the source during a full walk-through, honoring your configured delete rule (`Keep`, `Recycle`, `MoveToVersionHistory`, etc.).

#### Configurable Startup Delay

`SystemSettings` adds `startDelaySecs`, allowing CloudDrive to pause during startup before mounting drives or starting backups—useful when waiting for VPNs, disks, or other services.

### API Token Push Permissions (0.9.15)

API tokens can be granted push-notification access via the `allow_push_message` flag on `TokenPermissions`. Grant it only to automations that need the `PushMessage`/`PushTaskChange` streaming RPCs.

### Security Enhancements (Introduced in 0.9.14)

Version 0.9.14 introduced mandatory upgrades for deployments that want Two-Factor Authentication (2FA) and session revocation. Those capabilities remain unchanged in 0.9.18 but are summarized below for quick reference.

#### Two-Factor Authentication (2FA)

CloudDrive2 supports industry-standard Time-based One-Time Password (TOTP) two-factor authentication, compatible with authenticator apps like Microsoft Authenticator, Google Authenticator, and Authy.

**2FA Methods:**
- **`Check2FAStatus`** - Check if 2FA is enabled for the current user
- **`Setup2FA`** - Generate TOTP secret and QR code for authenticator app setup
- **`Enable2FA`** - Enable 2FA by verifying TOTP code (returns recovery codes)
- **`Disable2FA`** - Disable 2FA with valid TOTP code
- **`GetRecoveryCodes`** - View remaining unused recovery codes
- **`RegenerateRecoveryCodes`** - Generate new recovery codes (invalidates old ones)
- **`LoginWith2FA`** - Public login method supporting TOTP codes and recovery codes

**Enhanced Existing Methods with 2FA Support:**
- `GetToken` - Accepts optional `totpCode` for 2FA-enabled accounts
- `ChangePassword` - Requires TOTP code when 2FA is enabled
- `ChangeEmail` - Requires TOTP code when 2FA is enabled

**Security Features:**
- TOTP-based authentication (RFC 6238 standard)
- Recovery codes for account access when authenticator is unavailable
- Each recovery code is single-use and automatically invalidated after use
- Recovery codes can be regenerated at any time

**Important Notes:**
- When 2FA is enabled, older CloudDrive2 clients (< 0.9.14) will be unable to login
- Ensure all devices are upgraded to 0.9.14+ before enabling 2FA
- Store recovery codes in a secure location - they are your backup access method

#### Session Management

Session management lets users view and control active refresh-token sessions across devices.

**Session Management Methods:**
- **`GetSessions`** - List all active refresh token sessions with device information
- **`RevokeSession`** - Revoke a specific session by ID (logs out that device)
- **`RevokeOtherSessions`** - Revoke all sessions except the current one

**Session Information Includes:**
- Session ID and device ID
- Device name and OS type
- Creation timestamp and last used timestamp
- Expiration timestamp
- Last known IP address

**Use Cases:**
- Review all devices with active access to your account
- Remotely log out forgotten sessions or lost devices
- Enhance security by clearing all other sessions after password change
- Monitor account access patterns

### Security Best Practices

1. **Enable 2FA** on all production accounts to prevent unauthorized access
2. **Regularly review sessions** using `GetSessions` to identify unknown devices
3. **Revoke unused sessions** to minimize attack surface
4. **Store recovery codes securely** - treat them like passwords
5. **Upgrade all clients to 0.9.14+** before enabling 2FA to avoid lockout

---

## Overview

CloudDrive2 provides a comprehensive gRPC API for managing cloud storage, file operations, and system administration. The API follows a client-server architecture where clients communicate with the CloudDrive server using Protocol Buffers over HTTP/2 (or gRPC-Web for browser clients).

**Key Features:**
- User authentication with JWT tokens
- File and folder operations (create, read, update, delete)
- Cloud storage integration (115, Aliyun Drive, Baidu Pan, OneDrive, Google Drive, etc.)
- Mount point management
- Transfer task monitoring (uploads/downloads)
- Backup and sync operations
- WebDAV server configuration
- Real-time push notifications via server streaming

**Proto File Location:** `clouddrive.proto`

**Service Name:** `CloudDriveFileSrv`

**Namespace:** `CloudDriveSrv.Protos` (C#)

---

## Service Definition

```protobuf
syntax = "proto3";
package clouddrive;
option csharp_namespace = "CloudDriveSrv.Protos";

service CloudDriveFileSrv {
  // 100+ RPC methods for comprehensive cloud drive management
}
```

---

## Download Proto File

The CloudDrive2 gRPC service is defined in a Protocol Buffers (.proto) file. You'll need this file to generate client code for your preferred programming language.

### Getting the Proto File

**Download from Official Website**

Download the proto file from the CloudDrive2 official website:

**Direct Download Link:** [clouddrive.proto](https://www.clouddrive2.com/api/clouddrive.proto)

**Or use curl:**

```bash
# Download proto file
curl https://www.clouddrive2.com/api/clouddrive.proto -o clouddrive.proto
```

**Or use wget:**

```bash
# Download proto file
wget https://www.clouddrive2.com/api/clouddrive.proto
```

Save the file as `clouddrive.proto` in your project directory.

### Using the Proto File

Once you have the proto file, generate client code for your language:

**C#:**
```bash
# Using protoc compiler
protoc --csharp_out=. --grpc_out=. --plugin=protoc-gen-grpc=grpc_csharp_plugin clouddrive.proto
```

**Java:**
```bash
# Using protoc with Java plugin
protoc --java_out=. --grpc-java_out=. clouddrive.proto
```

**Go:**
```bash
# Using protoc with Go plugins
protoc --go_out=. --go_opt=paths=source_relative \
       --go-grpc_out=. --go-grpc_opt=paths=source_relative \
       clouddrive.proto
```

**Python:**
```bash
# Using grpcio-tools
python -m grpc_tools.protoc -I. --python_out=. --grpc_python_out=. clouddrive.proto
```

### Proto File Structure

The `clouddrive.proto` file contains:
- **Service Definition**: `CloudDriveFileSrv` with 100+ RPC methods
- **Message Types**: Request and response messages for all operations
- **Enums**: Status codes, hash types, cloud provider types, etc.
- **Nested Types**: Complex data structures for files, folders, and metadata

### Version Compatibility

**Current Version:** 0.9.19

Always use the proto file from the same version as your CloudDrive2 server to ensure compatibility. You can check your server version using the `GetRuntimeInfo` method.

---

## Authentication

CloudDrive2 uses JWT (JSON Web Token) bearer authentication for most API endpoints.

### Authentication Flow

#### Method 1: Using GetToken (Username/Password)

1. **Get JWT Token**: Call `GetToken` with username and password
2. **Store Token**: Save the JWT token for subsequent requests
3. **Include in Requests**: Add the token to the `Authorization` metadata header
4. **Token Format**: `Authorization: Bearer <your-jwt-token>`

#### Method 2: Using API Token (Recommended for Applications)

**For better security and permission control, it's recommended to use API tokens created by users:**

1. **Create API Token**: User creates an API token via the CloudDrive UI or `CreateToken` API
   - Specify permissions (file operations, mount management, etc.)
   - Set root directory restrictions
   - Configure token expiration
   - Enable specific logging options

2. **Import Token**: Application uses the pre-created API token directly
   - No need to store username/password
   - Fine-grained permission control
   - Easy to revoke without changing user password
   - Better audit trail with token-specific logging

3. **Use Token**: Add the API token to the `Authorization` metadata header
   - Token Format: `Authorization: Bearer <api-token>`

**Example: Using API Token (C#)**
```csharp
// User creates token via UI or CreateToken API with specific permissions
// Then application uses the token directly
var apiToken = "eyJhbGc..."; // Pre-created API token

_client.SetJwtToken(apiToken);
var files = await _client.GetSubFilesAsync("/");
```

### Methods Not Requiring Authentication

The following methods are public and don't require a JWT token:
- `GetSystemInfo` - Check if server is logged in
- `GetToken` - Obtain JWT token
- `Login` - Login to CloudFS server
- `LoginWithThirdPartyAccount` - Login with third-party cloud account
- `Register` - Register new account
- `SendResetAccountEmail` - Request password reset
- `ResetAccount` - Reset account with code
- `GetApiTokenInfo` - Get API token information

All other methods require the `Authorization` header with a valid JWT token.

---

## Getting Started

### C# Setup

**Prerequisites:**
- .NET 6.0 or higher
- NuGet packages: `Grpc.Net.Client`, `Google.Protobuf`, `Grpc.Tools`

**1. Generate C# client from proto file:**

Add to your `.csproj`:
```xml
<ItemGroup>
  <PackageReference Include="Grpc.Net.Client" Version="2.52.0" />
  <PackageReference Include="Grpc.Tools" Version="2.52.0" PrivateAssets="All" />
  <PackageReference Include="Google.Protobuf" Version="3.22.0" />
</ItemGroup>

<ItemGroup>
  <Protobuf Include="Protos\clouddrive.proto" GrpcServices="Client" />
</ItemGroup>
```

**2. Basic Client Example:**

```csharp
using Grpc.Net.Client;
using Grpc.Core;
using CloudDriveSrv.Protos;

public class CloudDriveClient
{
    private readonly CloudDriveFileSrv.CloudDriveFileSrvClient _client;
    private readonly GrpcChannel _channel;
    private string? _jwtToken;

    public CloudDriveClient(string serverAddress)
    {
        _channel = GrpcChannel.ForAddress(serverAddress);
        _client = new CloudDriveFileSrv.CloudDriveFileSrvClient(_channel);
    }

    // Get JWT token
    public async Task<bool> AuthenticateAsync(string username, string password)
    {
        var request = new GetTokenRequest
        {
            UserName = username,
            Password = password
        };

        var response = await _client.GetTokenAsync(request);

        if (response.Success)
        {
            _jwtToken = response.Token;
            Console.WriteLine($"Authentication successful. Token expires: {response.Expiration}");
            return true;
        }

        Console.WriteLine($"Authentication failed: {response.ErrorMessage}");
        return false;
    }

    // Create authorized call options
    private CallOptions CreateAuthorizedCallOptions(CancellationToken ct = default)
    {
        if (string.IsNullOrEmpty(_jwtToken))
        {
            return new CallOptions(cancellationToken: ct);
        }

        var headers = new Metadata
        {
            { "Authorization", $"Bearer {_jwtToken}" }
        };

        return new CallOptions(headers, cancellationToken: ct);
    }

    // Get system info (no auth required)
    public async Task<CloudDriveSystemInfo> GetSystemInfoAsync()
    {
        return await _client.GetSystemInfoAsync(new Google.Protobuf.WellKnownTypes.Empty());
    }

    // List files in a directory (requires auth)
    public async Task<List<CloudDriveFile>> GetSubFilesAsync(string path, bool forceRefresh = false)
    {
        var request = new ListSubFileRequest
        {
            Path = path,
            ForceRefresh = forceRefresh
        };

        var files = new List<CloudDriveFile>();
        var callOptions = CreateAuthorizedCallOptions();

        using var call = _client.GetSubFiles(request, callOptions);

        await foreach (var response in call.ResponseStream.ReadAllAsync())
        {
            files.AddRange(response.SubFiles);
        }

        return files;
    }

    // Create a folder
    public async Task<CreateFolderResult> CreateFolderAsync(string parentPath, string folderName)
    {
        var request = new CreateFolderRequest
        {
            ParentPath = parentPath,
            FolderName = folderName
        };

        var callOptions = CreateAuthorizedCallOptions();
        return await _client.CreateFolderAsync(request, callOptions);
    }

    // Download file URL
    public async Task<DownloadUrlPathInfo> GetDownloadUrlAsync(string path, bool preview = false)
    {
        var request = new GetDownloadUrlPathRequest
        {
            Path = path,
            Preview = preview,
            LazyRead = false
        };

        var callOptions = CreateAuthorizedCallOptions();
        return await _client.GetDownloadUrlPathAsync(request, callOptions);
    }

    public void Dispose()
    {
        _channel?.Dispose();
    }
}

// Usage example
class Program
{
    static async Task Main(string[] args)
    {
        using var client = new CloudDriveClient("http://localhost:19798");

        // Check system info
        var sysInfo = await client.GetSystemInfoAsync();
        Console.WriteLine($"System ready: {sysInfo.SystemReady}, User: {sysInfo.UserName}");

        // Authenticate
        if (await client.AuthenticateAsync("your-username", "your-password"))
        {
            // List root directory files
            var files = await client.GetSubFilesAsync("/");
            Console.WriteLine($"Found {files.Count} files");

            foreach (var file in files)
            {
                Console.WriteLine($"{file.Name} ({file.Size} bytes) - {file.FileType}");
            }

            // Create a folder
            var result = await client.CreateFolderAsync("/", "MyNewFolder");
            if (result.Result.Success)
            {
                Console.WriteLine($"Folder created: {result.FolderCreated.FullPathName}");
            }
        }
    }
}
```

---

### Java Setup

**Prerequisites:**
- Java 11 or higher
- Maven or Gradle
- Dependencies: `grpc-netty`, `grpc-protobuf`, `grpc-stub`

**1. Add dependencies to `pom.xml`:**

```xml
<dependencies>
    <dependency>
        <groupId>io.grpc</groupId>
        <artifactId>grpc-netty-shaded</artifactId>
        <version>1.54.0</version>
    </dependency>
    <dependency>
        <groupId>io.grpc</groupId>
        <artifactId>grpc-protobuf</artifactId>
        <version>1.54.0</version>
    </dependency>
    <dependency>
        <groupId>io.grpc</groupId>
        <artifactId>grpc-stub</artifactId>
        <version>1.54.0</version>
    </dependency>
</dependencies>

<build>
    <extensions>
        <extension>
            <groupId>kr.motd.maven</groupId>
            <artifactId>os-maven-plugin</artifactId>
            <version>1.7.0</version>
        </extension>
    </extensions>
    <plugins>
        <plugin>
            <groupId>org.xolstice.maven.plugins</groupId>
            <artifactId>protobuf-maven-plugin</artifactId>
            <version>0.6.1</version>
            <configuration>
                <protocArtifact>com.google.protobuf:protoc:3.22.0:exe:${os.detected.classifier}</protocArtifact>
                <pluginId>grpc-java</pluginId>
                <pluginArtifact>io.grpc:protoc-gen-grpc-java:1.54.0:exe:${os.detected.classifier}</pluginArtifact>
            </configuration>
            <executions>
                <execution>
                    <goals>
                        <goal>compile</goal>
                        <goal>compile-custom</goal>
                    </goals>
                </execution>
            </executions>
        </plugin>
    </plugins>
</build>
```

**2. Basic Client Example:**

```java
import io.grpc.ManagedChannel;
import io.grpc.ManagedChannelBuilder;
import io.grpc.Metadata;
import io.grpc.stub.MetadataUtils;
import clouddrive.CloudDriveFileSrvGrpc;
import clouddrive.Clouddrive.*;
import com.google.protobuf.Empty;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.concurrent.TimeUnit;

public class CloudDriveClient {
    private final ManagedChannel channel;
    private final CloudDriveFileSrvGrpc.CloudDriveFileSrvBlockingStub blockingStub;
    private String jwtToken;

    public CloudDriveClient(String host, int port) {
        this.channel = ManagedChannelBuilder.forAddress(host, port)
                .usePlaintext()
                .build();
        this.blockingStub = CloudDriveFileSrvGrpc.newBlockingStub(channel);
    }

    public void shutdown() throws InterruptedException {
        channel.shutdown().awaitTermination(5, TimeUnit.SECONDS);
    }

    // Authenticate and get JWT token
    public boolean authenticate(String username, String password) {
        GetTokenRequest request = GetTokenRequest.newBuilder()
                .setUserName(username)
                .setPassword(password)
                .build();

        JWTToken response = blockingStub.getToken(request);

        if (response.getSuccess()) {
            this.jwtToken = response.getToken();
            System.out.println("Authentication successful");
            return true;
        }

        System.err.println("Authentication failed: " + response.getErrorMessage());
        return false;
    }

    // Create stub with authorization header
    private CloudDriveFileSrvGrpc.CloudDriveFileSrvBlockingStub createAuthorizedStub() {
        if (jwtToken == null || jwtToken.isEmpty()) {
            return blockingStub;
        }

        Metadata headers = new Metadata();
        Metadata.Key<String> authKey = Metadata.Key.of("Authorization", Metadata.ASCII_STRING_MARSHALLER);
        headers.put(authKey, "Bearer " + jwtToken);

        return MetadataUtils.attachHeaders(blockingStub, headers);
    }

    // Get system info (no auth required)
    public CloudDriveSystemInfo getSystemInfo() {
        return blockingStub.getSystemInfo(Empty.getDefaultInstance());
    }

    // List files in a directory
    public List<CloudDriveFile> getSubFiles(String path, boolean forceRefresh) {
        ListSubFileRequest request = ListSubFileRequest.newBuilder()
                .setPath(path)
                .setForceRefresh(forceRefresh)
                .build();

        List<CloudDriveFile> files = new ArrayList<>();
        CloudDriveFileSrvGrpc.CloudDriveFileSrvBlockingStub stub = createAuthorizedStub();

        Iterator<SubFilesReply> responses = stub.getSubFiles(request);
        while (responses.hasNext()) {
            SubFilesReply reply = responses.next();
            files.addAll(reply.getSubFilesList());
        }

        return files;
    }

    // Create a folder
    public CreateFolderResult createFolder(String parentPath, String folderName) {
        CreateFolderRequest request = CreateFolderRequest.newBuilder()
                .setParentPath(parentPath)
                .setFolderName(folderName)
                .build();

        CloudDriveFileSrvGrpc.CloudDriveFileSrvBlockingStub stub = createAuthorizedStub();
        return stub.createFolder(request);
    }

    // Delete a file
    public FileOperationResult deleteFile(String filePath) {
        FileRequest request = FileRequest.newBuilder()
                .setPath(filePath)
                .build();

        CloudDriveFileSrvGrpc.CloudDriveFileSrvBlockingStub stub = createAuthorizedStub();
        return stub.deleteFile(request);
    }

    // Rename a file
    public FileOperationResult renameFile(String filePath, String newName) {
        RenameFileRequest request = RenameFileRequest.newBuilder()
                .setTheFilePath(filePath)
                .setNewName(newName)
                .build();

        CloudDriveFileSrvGrpc.CloudDriveFileSrvBlockingStub stub = createAuthorizedStub();
        return stub.renameFile(request);
    }

    // Usage example
    public static void main(String[] args) throws Exception {
        CloudDriveClient client = new CloudDriveClient("localhost", 19798);

        try {
            // Check system info
            CloudDriveSystemInfo sysInfo = client.getSystemInfo();
            System.out.println("System ready: " + sysInfo.getSystemReady() +
                             ", User: " + sysInfo.getUserName());

            // Authenticate
            if (client.authenticate("your-username", "your-password")) {
                // List root directory
                List<CloudDriveFile> files = client.getSubFiles("/", false);
                System.out.println("Found " + files.size() + " files");

                for (CloudDriveFile file : files) {
                    System.out.println(file.getName() + " (" + file.getSize() + " bytes)");
                }

                // Create a folder
                CreateFolderResult result = client.createFolder("/", "MyNewFolder");
                if (result.getResult().getSuccess()) {
                    System.out.println("Folder created: " +
                        result.getFolderCreated().getFullPathName());
                }
            }
        } finally {
            client.shutdown();
        }
    }
}
```

---

### Go Setup

**Prerequisites:**
- Go 1.19 or higher
- Protocol Buffers compiler (`protoc`)
- Go plugins: `protoc-gen-go`, `protoc-gen-go-grpc`

**1. Install dependencies:**

```bash
go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest

# In your project directory
go mod init clouddrive-client
go get google.golang.org/grpc
go get google.golang.org/protobuf
```

**2. Generate Go code from proto:**

```bash
protoc --go_out=. --go_opt=paths=source_relative \
    --go-grpc_out=. --go-grpc_opt=paths=source_relative \
    clouddrive.proto
```

**3. Basic Client Example:**

```go
package main

import (
    "context"
    "fmt"
    "io"
    "log"
    "time"

    "google.golang.org/grpc"
    "google.golang.org/grpc/credentials/insecure"
    "google.golang.org/grpc/metadata"
    pb "your-module/clouddrive" // Adjust import path
)

type CloudDriveClient struct {
    conn     *grpc.ClientConn
    client   pb.CloudDriveFileSrvClient
    jwtToken string
}

// NewClient creates a new CloudDrive client
func NewClient(address string) (*CloudDriveClient, error) {
    conn, err := grpc.Dial(address, grpc.WithTransportCredentials(insecure.NewCredentials()))
    if err != nil {
        return nil, fmt.Errorf("failed to connect: %v", err)
    }

    return &CloudDriveClient{
        conn:   conn,
        client: pb.NewCloudDriveFileSrvClient(conn),
    }, nil
}

// Close closes the connection
func (c *CloudDriveClient) Close() error {
    return c.conn.Close()
}

// Authenticate gets a JWT token
func (c *CloudDriveClient) Authenticate(ctx context.Context, username, password string) error {
    req := &pb.GetTokenRequest{
        UserName: username,
        Password: password,
    }

    resp, err := c.client.GetToken(ctx, req)
    if err != nil {
        return fmt.Errorf("authentication failed: %v", err)
    }

    if !resp.Success {
        return fmt.Errorf("authentication failed: %s", resp.ErrorMessage)
    }

    c.jwtToken = resp.Token
    fmt.Printf("Authentication successful. Token expires: %v\n", resp.Expiration.AsTime())
    return nil
}

// createAuthorizedContext creates a context with authorization header
func (c *CloudDriveClient) createAuthorizedContext(ctx context.Context) context.Context {
    if c.jwtToken == "" {
        return ctx
    }

    md := metadata.Pairs("authorization", fmt.Sprintf("Bearer %s", c.jwtToken))
    return metadata.NewOutgoingContext(ctx, md)
}

// GetSystemInfo retrieves system information (no auth required)
func (c *CloudDriveClient) GetSystemInfo(ctx context.Context) (*pb.CloudDriveSystemInfo, error) {
    return c.client.GetSystemInfo(ctx, &pb.Empty{})
}

// GetSubFiles lists files in a directory
func (c *CloudDriveClient) GetSubFiles(ctx context.Context, path string, forceRefresh bool) ([]*pb.CloudDriveFile, error) {
    req := &pb.ListSubFileRequest{
        Path:         path,
        ForceRefresh: forceRefresh,
    }

    authCtx := c.createAuthorizedContext(ctx)
    stream, err := c.client.GetSubFiles(authCtx, req)
    if err != nil {
        return nil, fmt.Errorf("failed to get sub files: %v", err)
    }

    var files []*pb.CloudDriveFile
    for {
        resp, err := stream.Recv()
        if err == io.EOF {
            break
        }
        if err != nil {
            return nil, fmt.Errorf("error receiving stream: %v", err)
        }
        files = append(files, resp.SubFiles...)
    }

    return files, nil
}

// CreateFolder creates a new folder
func (c *CloudDriveClient) CreateFolder(ctx context.Context, parentPath, folderName string) (*pb.CreateFolderResult, error) {
    req := &pb.CreateFolderRequest{
        ParentPath: parentPath,
        FolderName: folderName,
    }

    authCtx := c.createAuthorizedContext(ctx)
    return c.client.CreateFolder(authCtx, req)
}

// DeleteFile deletes a file or folder
func (c *CloudDriveClient) DeleteFile(ctx context.Context, filePath string) (*pb.FileOperationResult, error) {
    req := &pb.FileRequest{
        Path: filePath,
    }

    authCtx := c.createAuthorizedContext(ctx)
    return c.client.DeleteFile(authCtx, req)
}

// RenameFile renames a file
func (c *CloudDriveClient) RenameFile(ctx context.Context, filePath, newName string) (*pb.FileOperationResult, error) {
    req := &pb.RenameFileRequest{
        TheFilePath: filePath,
        NewName:     newName,
    }

    authCtx := c.createAuthorizedContext(ctx)
    return c.client.RenameFile(authCtx, req)
}

// Usage example
func main() {
    client, err := NewClient("localhost:19798")
    if err != nil {
        log.Fatalf("Failed to create client: %v", err)
    }
    defer client.Close()

    ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
    defer cancel()

    // Get system info
    sysInfo, err := client.GetSystemInfo(ctx)
    if err != nil {
        log.Fatalf("Failed to get system info: %v", err)
    }
    fmt.Printf("System ready: %v, User: %s\n", sysInfo.SystemReady, sysInfo.UserName)

    // Authenticate
    err = client.Authenticate(ctx, "your-username", "your-password")
    if err != nil {
        log.Fatalf("Authentication failed: %v", err)
    }

    // List files in root directory
    files, err := client.GetSubFiles(ctx, "/", false)
    if err != nil {
        log.Fatalf("Failed to get files: %v", err)
    }

    fmt.Printf("Found %d files\n", len(files))
    for _, file := range files {
        fmt.Printf("%s (%d bytes) - Type: %v\n", file.Name, file.Size, file.FileType)
    }

    // Create a folder
    result, err := client.CreateFolder(ctx, "/", "MyNewFolder")
    if err != nil {
        log.Fatalf("Failed to create folder: %v", err)
    }

    if result.Result.Success {
        fmt.Printf("Folder created: %s\n", result.FolderCreated.FullPathName)
    } else {
        fmt.Printf("Failed to create folder: %s\n", result.Result.ErrorMessage)
    }
}
```

---

### Python Setup

**Prerequisites:**
- Python 3.7 or higher
- pip packages: `grpcio`, `grpcio-tools`

**1. Install dependencies:**

```bash
pip install grpcio grpcio-tools
```

**2. Generate Python code from proto:**

```bash
python -m grpc_tools.protoc -I. --python_out=. --grpc_python_out=. clouddrive.proto
```

**3. Basic Client Example:**

```python
import grpc
from google.protobuf import empty_pb2
import clouddrive_pb2
import clouddrive_pb2_grpc


class CloudDriveClient:
    def __init__(self, address):
        """Initialize the CloudDrive client

        Args:
            address: Server address (e.g., 'localhost:19798')
        """
        self.channel = grpc.insecure_channel(address)
        self.stub = clouddrive_pb2_grpc.CloudDriveFileSrvStub(self.channel)
        self.jwt_token = None

    def close(self):
        """Close the channel"""
        self.channel.close()

    def authenticate(self, username, password):
        """Authenticate and get JWT token

        Args:
            username: Username
            password: Password

        Returns:
            bool: True if authentication successful
        """
        request = clouddrive_pb2.GetTokenRequest(
            userName=username,
            password=password
        )

        response = self.stub.GetToken(request)

        if response.success:
            self.jwt_token = response.token
            print(f"Authentication successful. Token expires: {response.expiration}")
            return True
        else:
            print(f"Authentication failed: {response.errorMessage}")
            return False

    def _create_authorized_metadata(self):
        """Create metadata with authorization header"""
        if not self.jwt_token:
            return []
        return [('authorization', f'Bearer {self.jwt_token}')]

    def get_system_info(self):
        """Get system information (no auth required)

        Returns:
            CloudDriveSystemInfo: System information
        """
        return self.stub.GetSystemInfo(empty_pb2.Empty())

    def get_sub_files(self, path, force_refresh=False):
        """List files in a directory

        Args:
            path: Directory path
            force_refresh: Force refresh cache

        Returns:
            list: List of CloudDriveFile objects
        """
        request = clouddrive_pb2.ListSubFileRequest(
            path=path,
            forceRefresh=force_refresh
        )

        metadata = self._create_authorized_metadata()
        files = []

        for response in self.stub.GetSubFiles(request, metadata=metadata):
            files.extend(response.subFiles)

        return files

    def create_folder(self, parent_path, folder_name):
        """Create a new folder

        Args:
            parent_path: Parent directory path
            folder_name: New folder name

        Returns:
            CreateFolderResult: Result of the operation
        """
        request = clouddrive_pb2.CreateFolderRequest(
            parentPath=parent_path,
            folderName=folder_name
        )

        metadata = self._create_authorized_metadata()
        return self.stub.CreateFolder(request, metadata=metadata)

    def delete_file(self, file_path):
        """Delete a file or folder

        Args:
            file_path: Path to file or folder

        Returns:
            FileOperationResult: Result of the operation
        """
        request = clouddrive_pb2.FileRequest(path=file_path)
        metadata = self._create_authorized_metadata()
        return self.stub.DeleteFile(request, metadata=metadata)

    def rename_file(self, file_path, new_name):
        """Rename a file

        Args:
            file_path: Current file path
            new_name: New file name

        Returns:
            FileOperationResult: Result of the operation
        """
        request = clouddrive_pb2.RenameFileRequest(
            theFilePath=file_path,
            newName=new_name
        )

        metadata = self._create_authorized_metadata()
        return self.stub.RenameFile(request, metadata=metadata)

    def move_file(self, source_paths, dest_path, conflict_policy=0):
        """Move files to destination

        Args:
            source_paths: List of source file paths
            dest_path: Destination path
            conflict_policy: 0=Overwrite, 1=Rename, 2=Skip

        Returns:
            FileOperationResult: Result of the operation
        """
        request = clouddrive_pb2.MoveFileRequest(
            theFilePaths=source_paths,
            destPath=dest_path,
            conflictPolicy=conflict_policy
        )

        metadata = self._create_authorized_metadata()
        return self.stub.MoveFile(request, metadata=metadata)

    def search_files(self, search_term, path="/", force_refresh=False, fuzzy_match=False):
        """Search for files

        Args:
            search_term: Search query
            path: Search root path
            force_refresh: Force refresh cache
            fuzzy_match: Use fuzzy matching

        Returns:
            list: List of CloudDriveFile objects
        """
        request = clouddrive_pb2.SearchRequest(
            searchFor=search_term,
            path=path,
            forceRefresh=force_refresh,
            fuzzyMatch=fuzzy_match
        )

        metadata = self._create_authorized_metadata()
        files = []

        for response in self.stub.GetSearchResults(request, metadata=metadata):
            files.extend(response.subFiles)

        return files

    def get_account_status(self):
        """Get account status and plan information

        Returns:
            AccountStatusResult: Account status
        """
        metadata = self._create_authorized_metadata()
        return self.stub.GetAccountStatus(empty_pb2.Empty(), metadata=metadata)

    def get_download_url(self, path, preview=False, lazy_read=False):
        """Get download URL for a file

        Args:
            path: File path
            preview: Preview mode
            lazy_read: Lazy read mode

        Returns:
            DownloadUrlPathInfo: Download URL information
        """
        request = clouddrive_pb2.GetDownloadUrlPathRequest(
            path=path,
            preview=preview,
            lazy_read=lazy_read
        )

        metadata = self._create_authorized_metadata()
        return self.stub.GetDownloadUrlPath(request, metadata=metadata)


# Usage example
def main():
    client = CloudDriveClient('localhost:19798')

    try:
        # Get system info
        sys_info = client.get_system_info()
        print(f"System ready: {sys_info.SystemReady}, User: {sys_info.UserName}")

        # Authenticate
        if client.authenticate('your-username', 'your-password'):
            # List root directory
            files = client.get_sub_files('/')
            print(f"Found {len(files)} files")

            for file in files:
                file_type = "Directory" if file.isDirectory else "File"
                print(f"{file.name} ({file.size} bytes) - {file_type}")

            # Create a folder
            result = client.create_folder('/', 'MyNewFolder')
            if result.result.success:
                print(f"Folder created: {result.folderCreated.fullPathName}")
            else:
                print(f"Failed to create folder: {result.result.errorMessage}")

            # Search for files
            search_results = client.search_files('test', '/')
            print(f"Found {len(search_results)} matching files")

            # Get account status
            account = client.get_account_status()
            print(f"Account: {account.userName}, Balance: {account.accountBalance}")
            print(f"Plan: {account.accountPlan.planName}")

    finally:
        client.close()


if __name__ == '__main__':
    main()
```

---

## API Reference

### Public Methods (No Authorization Required)

#### GetSystemInfo

Returns system information including login status and username.

**Request:** `google.protobuf.Empty`

**Response:** `CloudDriveSystemInfo`
```protobuf
message CloudDriveSystemInfo {
  bool IsLogin = 1;
  string UserName = 2;
  bool SystemReady = 3;
  optional string SystemMessage = 4;
  optional bool hasError = 5;
  // device power and storage profile, see DevicePowerType
  DevicePowerType devicePowerType = 6;
  // true when dir cache persistence and disk buffer are force-disabled
  // (by platform config or SLOW_STORAGE device type)
  optional bool diskCacheDisabled = 7;
}
```

**Example (C#):**
```csharp
var systemInfo = await client.GetSystemInfoAsync(new Empty());
Console.WriteLine($"Logged in: {systemInfo.IsLogin}, User: {systemInfo.UserName}");
```

---

#### GetToken

Obtains a JWT token for authentication.

**Request:** `GetTokenRequest`
```protobuf
message GetTokenRequest {
  string userName = 1;
  string password = 2;
  optional string totpCode = 3; // Optional TOTP code for 2FA-enabled accounts
}
```

**Note:** If the account has Two-Factor Authentication (2FA) enabled, you must provide a valid 6-digit TOTP code or an 8-character recovery code in the `totpCode` field. For accounts without 2FA, this field can be omitted.

**Response:** `JWTToken`
```protobuf
message JWTToken {
  bool success = 1;
  string errorMessage = 2;
  string token = 3;
  google.protobuf.Timestamp expiration = 4;
}
```

**Example (Java):**
```java
GetTokenRequest request = GetTokenRequest.newBuilder()
    .setUserName("myusername")
    .setPassword("mypassword")
    .build();

JWTToken response = blockingStub.getToken(request);
if (response.getSuccess()) {
    String token = response.getToken();
    // Store token for future requests
}
```

---

#### Login

Logs in to the CloudFS server.

**Request:** `UserLoginRequest`
```protobuf
message UserLoginRequest {
  string userName = 1;
  string password = 2;
  bool synDataToCloud = 3;
  optional ProxyInfo cloudfsProxy = 4; // Optional proxy for reaching CloudFS account server
}
```

**Response:** `FileOperationResult`

**Example (Go):**
```go
req := &pb.UserLoginRequest{
    UserName:        "myusername",
    Password:        "mypassword",
    SynDataToCloud: false,
}

resp, err := client.Login(ctx, req)
if err != nil {
    log.Fatal(err)
}

if resp.Success {
    fmt.Println("Login successful")
}
```

---

#### LoginWithThirdPartyAccount

Logs in using a third-party cloud account (e.g., Xunlei). This is a public method that doesn't require prior authorization.

**Request:** `LoginWithThirdPartyAccountRequest`
```protobuf
message LoginWithThirdPartyAccountRequest {
  string cloudName = 1;       // Cloud provider name (e.g., "Xunlei")
  string refreshToken = 2;    // OAuth refresh token
  string accessToken = 3;     // OAuth access token
  uint64 expiresIn = 4;       // Token expiration time in seconds
  bool synDataToCloud = 5;    // Whether to sync data to cloud
}
```

**Response:** `JWTToken`

**New in 0.9.18**

---

#### Register

Registers a new user account.

**Request:** `UserRegisterRequest`
```protobuf
message UserRegisterRequest {
  string userName = 1;
  string password = 2;
}
```

**Response:** `FileOperationResult`

---

#### SendResetAccountEmail

Sends a password reset email.

**Request:** `SendResetAccountEmailRequest`
```protobuf
message SendResetAccountEmailRequest {
  string email = 1;
}
```

**Response:** `google.protobuf.Empty`

---

#### ResetAccount

Resets account password with reset code.

**Request:** `ResetAccountRequest`
```protobuf
message ResetAccountRequest {
  string resetCode = 1;
  string newPassword = 2;
}
```

**Response:** `google.protobuf.Empty`

---

#### GetApiTokenInfo

Gets API token information.

**Request:** `StringValue` (token string)

**Response:** `TokenInfo`

---

### Authorized Methods

All methods below require the `Authorization: Bearer <token>` header.

---

### File Operations

#### GetSubFiles (Server Streaming)

Lists all files and subdirectories in a path.

**Request:** `ListSubFileRequest`
```protobuf
message ListSubFileRequest {
  string path = 1;
  bool forceRefresh = 2;
  optional bool checkExpires = 3;
}
```

**Response Stream:** `SubFilesReply`
```protobuf
message SubFilesReply {
  repeated CloudDriveFile subFiles = 1;
}
```

**Example (Python):**
```python
request = clouddrive_pb2.ListSubFileRequest(
    path="/my/folder",
    forceRefresh=False
)

files = []
for response in stub.GetSubFiles(request, metadata=auth_metadata):
    files.extend(response.subFiles)

print(f"Found {len(files)} files")
```

---

#### FindFileByPath

Finds a specific file by path.

**Request:** `FindFileByPathRequest`
```protobuf
message FindFileByPathRequest {
  string parentPath = 1;
  string path = 2;
}
```

**Response:** `CloudDriveFile`

---

#### CreateFolder

Creates a new folder.

**Request:** `CreateFolderRequest`
```protobuf
message CreateFolderRequest {
  string parentPath = 1;
  string folderName = 2;
}
```

**Response:** `CreateFolderResult`
```protobuf
message CreateFolderResult {
  CloudDriveFile folderCreated = 1;
  FileOperationResult result = 2;
}
```

**Example (C#):**
```csharp
var request = new CreateFolderRequest
{
    ParentPath = "/Documents",
    FolderName = "NewFolder"
};

var result = await client.CreateFolderAsync(request, callOptions);
if (result.Result.Success)
{
    Console.WriteLine($"Created: {result.FolderCreated.FullPathName}");
}
```

---

#### CreateEncryptedFolder

Creates an encrypted folder with password protection.

**Request:** `CreateEncryptedFolderRequest`
```protobuf
message CreateEncryptedFolderRequest {
  string parentPath = 1;
  string folderName = 2;
  string password = 3;
  bool savePassword = 4; // if true, password will be saved to db
}
```

**Response:** `CreateFolderResult`

---

#### UnlockEncryptedFile

Unlocks an encrypted file or folder.

**Request:** `UnlockEncryptedFileRequest`
```protobuf
message UnlockEncryptedFileRequest {
  string path = 1;
  string password = 2;
  bool permanentUnlock = 3; // if true, password saved to db
}
```

**Response:** `FileOperationResult`

---

#### LockEncryptedFile

Locks an encrypted file or folder.

**Request:** `FileRequest`

**Response:** `FileOperationResult`

---

#### RenameFile

Renames a single file or folder.

**Request:** `RenameFileRequest`
```protobuf
message RenameFileRequest {
  string theFilePath = 1;
  string newName = 2;
}
```

**Response:** `FileOperationResult`

**Example (Java):**
```java
RenameFileRequest request = RenameFileRequest.newBuilder()
    .setTheFilePath("/Documents/oldname.txt")
    .setNewName("newname.txt")
    .build();

FileOperationResult result = stub.renameFile(request);
if (result.getSuccess()) {
    System.out.println("File renamed successfully");
}
```

---

#### RenameFiles

Batch renames multiple files.

**Request:** `RenameFilesRequest`
```protobuf
message RenameFilesRequest {
  repeated RenameFileRequest renameFiles = 1;
}
```

**Response:** `FileOperationResult`

---

#### MoveFile

Moves files to a destination folder.

**Request:** `MoveFileRequest`
```protobuf
message MoveFileRequest {
  enum ConflictPolicy {
    Overwrite = 0;
    Rename = 1;
    Skip = 2;
  }
  repeated string theFilePaths = 1;
  string destPath = 2;
  optional ConflictPolicy conflictPolicy = 3;
  optional bool moveAcrossClouds = 4;
  optional bool handleConflictRecursively = 5; // for folder conflicts
}
```

**Response:** `FileOperationResult`

**Example (Go):**
```go
req := &pb.MoveFileRequest{
    TheFilePaths: []string{"/source/file1.txt", "/source/file2.txt"},
    DestPath:     "/destination",
    ConflictPolicy: pb.MoveFileRequest_Rename.Enum(),
}

resp, err := client.MoveFile(authCtx, req)
```

---

#### CopyFile

Copies files to a destination folder.

**Request:** `CopyFileRequest`
```protobuf
message CopyFileRequest {
  enum ConflictPolicy {
    Overwrite = 0;
    Rename = 1;
    Skip = 2;
  }
  repeated string theFilePaths = 1;
  string destPath = 2;
  optional ConflictPolicy conflictPolicy = 3;
  optional bool handleConflictRecursively = 5;
}
```

**Response:** `FileOperationResult`

---

#### DeleteFile

Deletes a single file or folder.

**Request:** `FileRequest`
```protobuf
message FileRequest {
  string path = 1;
  optional bool forceRefresh = 2;
}
```

**Response:** `FileOperationResult`

---

#### DeleteFiles

Batch deletes multiple files.

**Request:** `MultiFileRequest`
```protobuf
message MultiFileRequest {
  repeated string path = 1;
}
```

**Response:** `FileOperationResult`

**Example (Python):**
```python
request = clouddrive_pb2.MultiFileRequest(
    path=["/file1.txt", "/file2.txt", "/folder1"]
)

result = stub.DeleteFiles(request, metadata=auth_metadata)
if result.success:
    print("Files deleted successfully")
```

---

#### DeleteFilePermanently

Permanently deletes a file (supported by some clouds like AliyunDrive).

**Request:** `FileRequest`

**Response:** `FileOperationResult`

---

#### DeleteFilesPermanently

Batch permanently deletes files.

**Request:** `MultiFileRequest`

**Response:** `FileOperationResult`

---

#### GetSearchResults (Server Streaming)

Searches for files matching criteria.

**Request:** `SearchRequest`
```protobuf
message SearchRequest {
  string path = 1;
  string searchFor = 2;
  bool forceRefresh = 3;
  bool fuzzyMatch = 4;
  optional bool addResultToMountedSearchFolder = 5; // Add search results to mounted search folder
  optional bool contentSearch = 6; // If true, also search file content (requires canContentSearch)
}
```

**Response Stream:** `SubFilesReply`

**Example (C#):**
```csharp
var request = new SearchRequest
{
    Path = "/",
    SearchFor = "report",
    ForceRefresh = false,
    FuzzyMatch = true
};

var files = new List<CloudDriveFile>();
using var call = client.GetSearchResults(request, callOptions);

await foreach (var response in call.ResponseStream.ReadAllAsync())
{
    files.AddRange(response.SubFiles);
}
```

---

#### GetFileDetailProperties

Gets detailed properties of a folder.

**Request:** `FileRequest`

**Response:** `FileDetailProperties`
```protobuf
message FileDetailProperties {
  int64 totalFileCount = 1;
  int64 totalFolderCount = 2;
  int64 totalSize = 3;
  bool isFaved = 4;
  bool isShared = 5;
  string originalPath = 6;
}
```

---

#### GetSpaceInfo

Gets total/free/used space information.

**Request:** `FileRequest`

**Response:** `SpaceInfo`
```protobuf
message SpaceInfo {
  int64 totalSpace = 1;
  int64 usedSpace = 2;
  int64 freeSpace = 3;
}
```

---

#### GetMetaData

Gets file metadata.

**Request:** `FileRequest`

**Response:** `FileMetaData`
```protobuf
message FileMetaData {
  map<string, string> metadata = 1;
}
```

---

#### GetOriginalPath

Gets the original path of a search result file.

**Request:** `FileRequest`

**Response:** `StringResult`

---

#### GetDownloadUrlPath

Gets a download URL for a file.

**Request:** `GetDownloadUrlPathRequest`
```protobuf
message GetDownloadUrlPathRequest {
  string path = 1;
  bool preview = 2;
  bool lazy_read = 3;
  bool get_direct_url = 4; // Request direct URL if available
}
```

**Response:** `DownloadUrlPathInfo`
```protobuf
message DownloadUrlPathInfo {
  string downloadUrlPath = 1; // URL with placeholders {SCHEME}, {HOST}, {PREVIEW}
  optional uint64 expiresIn = 2; // seconds until expiration
  optional string directUrl = 3; // direct URL if available
  optional string userAgent = 4; // User-Agent to use for direct downloads
  map<string, string> additionalHeaders = 5; // Additional headers for direct downloads
}
```

**Example (Java):**
```java
GetDownloadUrlPathRequest request = GetDownloadUrlPathRequest.newBuilder()
    .setPath("/Movies/video.mp4")
    .setPreview(false)
    .setLazyRead(false)
    .setGetDirectUrl(true)
    .build();

DownloadUrlPathInfo info = stub.getDownloadUrlPath(request);
System.out.println("Download URL: " + info.getDownloadUrlPath());
if (info.hasDirectUrl()) {
    System.out.println("Direct URL: " + info.getDirectUrl());
    if (info.hasUserAgent()) {
        System.out.println("User-Agent: " + info.getUserAgent());
    }
}
```

---

#### CreateFile

Creates a new file and opens it for writing.

**Request:** `CreateFileRequest`
```protobuf
message CreateFileRequest {
  string parentPath = 1;
  string fileName = 2;
}
```

**Response:** `CreateFileResult`
```protobuf
message CreateFileResult {
  uint64 fileHandle = 1;
}
```

---

#### WriteToFile

Writes data to an opened file.

**Request:** `WriteFileRequest`
```protobuf
message WriteFileRequest {
  uint64 fileHandle = 1;
  uint64 startPos = 2;
  uint64 length = 3;
  bytes buffer = 4;
  bool closeFile = 5;
}
```

**Response:** `WriteFileResult`
```protobuf
message WriteFileResult {
  uint64 bytesWritten = 1;
}
```

---

#### WriteToFileStream (Client Streaming)

Writes data to a file using client streaming.

**Request Stream:** `WriteFileRequest`

**Response:** `WriteFileResult`

---

#### CloseFile

Closes an opened file.

**Request:** `CloseFileRequest`
```protobuf
message CloseFileRequest {
  uint64 fileHandle = 1;
}
```

**Response:** `FileOperationResult`

---

### Offline Download Management

#### AddOfflineFiles

Adds offline download tasks (magnet links, etc.).

**Request:** `AddOfflineFileRequest`
```protobuf
message AddOfflineFileRequest {
  string urls = 1;
  string toFolder = 2;
  uint32 checkFolderAfterSecs = 3; // Check folder after specified seconds
}
```

**Response:** `FileOperationResult`

---

#### ListOfflineFilesByPath

Lists offline files in a specific path.

**Request:** `FileRequest`

**Response:** `OfflineFileListResult`
```protobuf
message OfflineFileListResult {
  repeated OfflineFile offlineFiles = 1;
  OfflineStatus status = 2;
}
```

---

#### ListAllOfflineFiles

Lists all offline files with pagination.

**Request:** `OfflineFileListAllRequest`
```protobuf
message OfflineFileListAllRequest {
  string cloudName = 1;
  string cloudAccountId = 2;
  uint32 page = 3;
  optional string path = 4;
}
```

**Response:** `OfflineFileListAllResult`

---

#### RemoveOfflineFiles

Removes offline download tasks.

**Request:** `RemoveOfflineFilesRequest`
```protobuf
message RemoveOfflineFilesRequest {
  string cloudName = 1;
  string cloudAccountId = 2;
  bool deleteFiles = 3;
  repeated string infoHashes = 4;
  optional string path = 5;
}
```

**Response:** `FileOperationResult`

---

#### GetOfflineQuotaInfo

Gets offline download quota information.

**Request:** `OfflineQuotaRequest`
```protobuf
message OfflineQuotaRequest {
  string cloudName = 1;
  string cloudAccountId = 2;
  optional string path = 3;
}
```

**Response:** `OfflineQuotaInfo`
```protobuf
message OfflineQuotaInfo {
  int32 total = 1;
  int32 used = 2;
  int32 left = 3;
}
```

---

#### ClearOfflineFiles

Clears offline downloads by filter type.

**Request:** `ClearOfflineFileRequest`
```protobuf
message ClearOfflineFileRequest {
  enum Filter {
    All = 0;
    Finished = 1;
    Error = 2;
    Downloading = 3;
  }
  string cloudName = 1;
  string cloudAccountId = 2;
  Filter filter = 3;
  bool deleteFiles = 4;
  optional string path = 5;
}
```

**Response:** `google.protobuf.Empty`

---

#### RestartOfflineTask

Restarts a failed offline download task.

**Request:** `RestartOfflineFileRequest`
```protobuf
message RestartOfflineFileRequest {
  string cloudName = 1;
  string cloudAccountId = 2;
  string infoHash = 3;
  string url = 4;
  string parentId = 5;
  optional string path = 6;
}
```

**Response:** `google.protobuf.Empty`

---

### Shared Links

#### AddSharedLink

Adds a shared link to a folder.

**Request:** `AddSharedLinkRequest`
```protobuf
message AddSharedLinkRequest {
  string sharedLinkUrl = 1;
  optional string sharedPassword = 2;
  string toFolder = 3;
}
```

**Response:** `google.protobuf.Empty`

---

### Mount Point Management

#### GetMountPoints

Gets all configured mount points.

**Request:** `google.protobuf.Empty`

**Response:** `GetMountPointsResult`
```protobuf
message GetMountPointsResult {
  repeated MountPoint mountPoints = 1;
}

message MountPoint {
  string mountPoint = 1;
  string sourceDir = 2;
  bool localMount = 3;
  bool readOnly = 4;
  bool autoMount = 5;
  uint32 uid = 6;
  uint32 gid = 7;
  string permissions = 8;
  bool isMounted = 9;
  string failReason = 10;
}
```

**Example (C#):**
```csharp
var result = await client.GetMountPointsAsync(new Empty(), callOptions);
foreach (var mp in result.MountPoints)
{
    Console.WriteLine($"Mount: {mp.MountPoint} -> {mp.SourceDir} (Mounted: {mp.IsMounted})");
}
```

---

#### AddMountPoint

Adds a new mount point.

**Request:** `MountOption`
```protobuf
message MountOption {
  string mountPoint = 1;
  string sourceDir = 2;
  bool localMount = 3;
  bool readOnly = 4;
  bool autoMount = 5;
  uint32 uid = 6;
  uint32 gid = 7;
  string permissions = 8;
  string name = 9;
}
```

**Response:** `MountPointResult`

---

#### RemoveMountPoint

Removes a mount point.

**Request:** `MountPointRequest`
```protobuf
message MountPointRequest {
  string MountPoint = 1;
}
```

**Response:** `MountPointResult`

---

#### Mount

Mounts a mount point.

**Request:** `MountPointRequest`

**Response:** `MountPointResult`

---

#### Unmount

Unmounts a mount point.

**Request:** `MountPointRequest`

**Response:** `MountPointResult`

---

#### UpdateMountPoint

Updates mount point settings.

**Request:** `UpdateMountPointRequest`
```protobuf
message UpdateMountPointRequest {
  string mountPoint = 1;
  MountOption newMountOption = 2;
}
```

**Response:** `MountPointResult`

---

#### GetAvailableDriveLetters

Gets unused drive letters (Windows only).

**Request:** `google.protobuf.Empty`

**Response:** `GetAvailableDriveLettersResult`

---

#### HasDriveLetters

Checks if system supports drive letters (Windows).

**Request:** `google.protobuf.Empty`

**Response:** `HasDriveLettersResult`

---

#### CanMountBothLocalAndCloud

Checks if server can mount both local and cloud drives.

**Request:** `google.protobuf.Empty`

**Response:** `BoolResult`

---

#### CanAddMoreMountPoints

Checks if current user can add more mount points.

**Request:** `google.protobuf.Empty`

**Response:** `FileOperationResult`

---

### Transfer Task Management

#### GetAllTasksCount

Gets counts of all transfer tasks.

**Request:** `google.protobuf.Empty`

**Response:** `GetAllTasksCountResult`
```protobuf
message GetAllTasksCountResult {
  uint32 downloadCount = 1;
  uint32 uploadCount = 2;
  uint32 copyTaskCount = 6;
  PushMessage pushMessage = 3;
  bool hasUpdate = 4;
  repeated UploadFileInfo uploadFileStatusChanges = 5;
}
```

---

#### GetDownloadFileCount

Gets count of active download tasks.

**Request:** `google.protobuf.Empty`

**Response:** `GetDownloadFileCountResult`

---

#### GetDownloadFileList

Gets list of all download tasks.

**Request:** `google.protobuf.Empty`

**Response:** `GetDownloadFileListResult`
```protobuf
message GetDownloadFileListResult {
  double globalBytesPerSecond = 1;
  repeated DownloadFileInfo downloadFiles = 4;
}

message DownloadFileInfo {
  string filePath = 1;
  uint64 fileLength = 2;
  uint64 totalBufferUsed = 3;
  uint32 downloadThreadCount = 4;
  repeated string process = 5;
  string detailDownloadInfo = 6;
  optional string lastDownloadError = 7;
  double bytesPerSecond = 8;
}
```

---

#### GetUploadFileCount

Gets count of upload tasks.

**Request:** `google.protobuf.Empty`

**Response:** `GetUploadFileCountResult`

---

#### GetUploadFileList

Gets paginated list of upload tasks.

**Request:** `GetUploadFileListRequest`
```protobuf
message GetUploadFileListRequest {
  bool getAll = 1;  // Note: Currently not supported, use pagination instead
  uint32 itemsPerPage = 2;
  uint32 pageNumber = 3;  // Page number starts from 0
  string filter = 4;
  optional UploadFileInfo.Status statusFilter = 5;
  optional UploadFileInfo.OperatorType operatorTypeFilter = 6;
}
```

**Response:** `GetUploadFileListResult`
```protobuf
message GetUploadFileListResult {
  uint32 totalCount = 1;
  repeated UploadFileInfo uploadFiles = 2;
  double globalBytesPerSecond = 3;
  uint64 totalBytes = 4;
  uint64 finishedBytes = 5;
}
```

**Example (Python):**
```python
request = clouddrive_pb2.GetUploadFileListRequest(
    getAll=False,  # Note: getAll is not currently supported
    itemsPerPage=50,
    pageNumber=0,  # Page number starts from 0 (first page)
    filter="",
    statusFilter=clouddrive_pb2.UploadFileInfo.Transfer
)

result = stub.GetUploadFileList(request, metadata=auth_metadata)
print(f"Total uploads: {result.totalCount}")
print(f"Upload speed: {result.globalBytesPerSecond / 1024 / 1024:.2f} MB/s")
```

---

#### CancelAllUploadFiles

Cancels all upload tasks.

**Request:** `google.protobuf.Empty`

**Response:** `google.protobuf.Empty`

---

#### CancelUploadFiles

Cancels selected upload tasks.

**Request:** `MultpleUploadFileKeyRequest`
```protobuf
message MultpleUploadFileKeyRequest {
  repeated string keys = 1;
}
```

**Response:** `google.protobuf.Empty`

---

#### PauseAllUploadFiles

Pauses all upload tasks.

**Request:** `google.protobuf.Empty`

**Response:** `google.protobuf.Empty`

---

#### PauseUploadFiles

Pauses selected upload tasks.

**Request:** `MultpleUploadFileKeyRequest`

**Response:** `google.protobuf.Empty`

---

#### ResumeAllUploadFiles

Resumes all paused upload tasks.

**Request:** `google.protobuf.Empty`

**Response:** `google.protobuf.Empty`

---

#### ResumeUploadFiles

Resumes selected paused upload tasks.

**Request:** `MultpleUploadFileKeyRequest`

**Response:** `google.protobuf.Empty`

---

#### GetCopyTasks

Gets all copy/move folder tasks.

**Request:** `google.protobuf.Empty`

**Response:** `GetCopyTaskResult`
```protobuf
message GetCopyTaskResult {
  repeated CopyTask copyTasks = 1;
}

message CopyTask {
  enum TaskMode {
    Copy = 0;
    Move = 1;
  }
  enum TaskStatus {
    Pending = 0;
    Scanning = 1;
    Scanned = 2;
    Completed = 3;
    Failed = 4;
  }
  TaskMode taskMode = 2;
  string sourcePath = 3;
  string destPath = 4;
  TaskStatus status = 5;
  uint64 totalFolders = 6;
  uint64 totalFiles = 7;
  uint64 failedFolders = 8;
  uint64 failedFiles = 9;
  uint64 uploadedFiles = 10;
  uint64 cancelledFiles = 11;
  uint64 skippedFiles = 16;
  uint64 totalBytes = 12;
  uint64 uploadedBytes = 13;
  bool paused = 14;
  repeated TaskError errors = 15;
  google.protobuf.Timestamp startTime = 17;
  optional google.protobuf.Timestamp endTime = 18;
}
```

---

#### GetMergeTasks

Gets all merge tasks (recursive folder merges).

**Request:** `google.protobuf.Empty`

**Response:** `GetMergeTasksResult`

---

#### CancelMergeTask

Cancels a merge task.

**Request:** `CancelMergeTaskRequest`
```protobuf
message CancelMergeTaskRequest {
  string sourcePath = 1;
  string destPath = 2;
}
```

**Response:** `google.protobuf.Empty`

---

#### CancelCopyTask

Cancels a copy folder task.

**Request:** `CopyTaskRequest`
```protobuf
message CopyTaskRequest {
  string sourcePath = 1;
  string destPath = 2;
}
```

**Response:** `google.protobuf.Empty`

---

#### PauseCopyTask

Pauses a copy task.

**Request:** `PauseCopyTaskRequest`

**Response:** `google.protobuf.Empty`

---

#### RestartCopyTask

Restarts a copy task.

**Request:** `CopyTaskRequest`

**Response:** `google.protobuf.Empty`

---

#### RemoveCompletedCopyTasks

Removes all completed copy tasks.

**Request:** `google.protobuf.Empty`

**Response:** `google.protobuf.Empty`

---

### Cloud API Management

#### OAuth Login Process

Many cloud storage providers use OAuth 2.0 for secure authentication. The OAuth flow allows users to authorize CloudDrive2 to access their cloud storage without sharing passwords.

**Supported OAuth Login Methods:**
- `APILoginOneDriveOAuth` - Microsoft OneDrive
- `ApiLoginGoogleDriveOAuth` - Google Drive
- `APILoginAliyundriveOAuth` - Aliyun Drive Open
- `APILoginBaiduPanOAuth` - Baidu Pan
- `ApiLoginXunleiOAuth` - Xunlei Drive
- `APILogin115OpenOAuth` - 115 Cloud Open
- `ApiLogin123panOAuth` - 123 Pan

**OAuth Flow Overview:**

```
User                    Your App              Cloud Provider       CloudDrive2 Server
 |                         |                         |                      |
 |-- Click Authorize ----->|                         |                      |
 |                         |                         |                      |
 |                         |-- Open OAuth URL ------>|                      |
 |                         |                         |                      |
 |<------- Login Page -----|-------------------------|                      |
 |                         |                         |                      |
 |-- Enter Credentials --->|------------------------>|                      |
 |                         |                         |                      |
 |<------- Grant Access ---|-------------------------|                      |
 |                         |                         |                      |
 |                         |<-- Authorization Code --|                      |
 |                         |                         |                      |
 |                         |-- Exchange Code for --> (OAuth Server)         |
 |                         |   Tokens (via your      |                      |
 |                         |   backend/redirect)     |                      |
 |                         |                         |                      |
 |                         |<-- Access Token +    ---|                      |
 |                         |    Refresh Token        |                      |
 |                         |                         |                      |
 |                         |-- Call APILoginXxxOAuth(refresh_token, ------->|
 |                         |   access_token, expires_in)                    |
 |                         |                         |                      |
 |                         |<----------------------- Success/Error ---------|
 |                         |                         |                      |
 |<-- Cloud Storage Added -|                         |                      |
```

**Step-by-Step OAuth Implementation:**

**1. Register Your Application**

Before using OAuth, register your application with the cloud provider to obtain:
- **Client ID**: Public identifier for your app
- **Client Secret**: Secret key (keep secure, use only server-side)
- **Redirect URI**: URL where OAuth provider sends authorization code

**2. Build OAuth Authorization URL**

```csharp
// Example OAuth URLs for each provider
public string GetOAuthUrl(string cloudType, string clientId, string redirectUri, string state)
{
    var encodedRedirect = Uri.EscapeDataString(redirectUri);
    var encodedState = Uri.EscapeDataString(state);

    return cloudType switch
    {
        "onedrive" =>
            $"https://login.microsoftonline.com/common/oauth2/v2.0/authorize" +
            $"?client_id={clientId}" +
            $"&response_type=code" +
            $"&redirect_uri={encodedRedirect}" +
            $"&response_mode=query" +
            $"&scope=Files.ReadWrite.All offline_access" +
            $"&state={encodedState}",

        "googledrive" =>
            $"https://accounts.google.com/o/oauth2/v2/auth" +
            $"?client_id={clientId}" +
            $"&response_type=code" +
            $"&redirect_uri={encodedRedirect}" +
            $"&scope=https://www.googleapis.com/auth/drive" +
            $"&state={encodedState}" +
            $"&access_type=offline" +
            $"&prompt=consent",

        "aliyundriveopen" =>
            $"https://open.aliyundrive.com/oauth/authorize" +
            $"?client_id={clientId}" +
            $"&redirect_uri={encodedRedirect}" +
            $"&scope=user:base,file:all:read,file:all:write" +
            $"&state={encodedState}",

        "baidupan" =>
            $"https://openapi.baidu.com/oauth/2.0/authorize" +
            $"?client_id={clientId}" +
            $"&response_type=code" +
            $"&redirect_uri={encodedRedirect}" +
            $"&scope=basic,netdisk" +
            $"&state={encodedState}",

        "xunlei" =>
            $"https://i.xunlei.com/center/account/personal/oauth/" +
            $"?response_type=code" +
            $"&client_id={clientId}" +
            $"&redirect_uri={encodedRedirect}" +
            $"&scope=user profile offline pan/*/share/restore sso pan/*/drive/get " +
            $"pan/*/file/get pan/*/file/create pan/*/file/delete pan/*/file/update" +
            $"&state={encodedState}",

        "cloud115open" =>
            $"https://passportapi.115.com/open/authorize" +
            $"?client_id={clientId}" +
            $"&redirect_uri={encodedRedirect}" +
            $"&response_type=code" +
            $"&state={encodedState}",

        "123pan" =>
            $"https://www.123pan.com/auth" +
            $"?client_id={clientId}" +
            $"&redirect_uri={encodedRedirect}" +
            $"&scope=user:base,file:all:read,file:all:write" +
            $"&state={encodedState}",

        _ => throw new NotSupportedException($"OAuth not supported for {cloudType}")
    };
}
```

**3. Handle OAuth Callback**

Your redirect URI endpoint must:
1. Receive authorization code from query parameter
2. Exchange code for tokens (server-side with client_secret)
3. Extract `access_token`, `refresh_token`, and `expires_in`
4. Call appropriate CloudDrive2 API

**Example (ASP.NET Core):**

```csharp
[HttpGet("oauth/callback")]
public async Task<IActionResult> OAuthCallback(
    [FromQuery] string code,
    [FromQuery] string state,
    [FromQuery] string cloud_type)
{
    try
    {
        // Exchange authorization code for tokens
        var tokenResponse = await ExchangeCodeForTokens(cloud_type, code);

        // Call CloudDrive2 API to add cloud storage
        var result = cloud_type switch
        {
            "onedrive" => await client.APILoginOneDriveOAuthAsync(
                new LoginOneDriveOAuthRequest
                {
                    RefreshToken = tokenResponse.RefreshToken,
                    AccessToken = tokenResponse.AccessToken,
                    ExpiresIn = tokenResponse.ExpiresIn
                }, callOptions),

            "googledrive" => await client.ApiLoginGoogleDriveOAuthAsync(
                new LoginGoogleDriveOAuthRequest
                {
                    RefreshToken = tokenResponse.RefreshToken,
                    AccessToken = tokenResponse.AccessToken,
                    ExpiresIn = tokenResponse.ExpiresIn
                }, callOptions),

            "aliyundriveopen" => await client.APILoginAliyundriveOAuthAsync(
                new LoginAliyundriveOAuthRequest
                {
                    RefreshToken = tokenResponse.RefreshToken,
                    AccessToken = tokenResponse.AccessToken,
                    ExpiresIn = tokenResponse.ExpiresIn
                }, callOptions),

            // ... other providers

            _ => throw new NotSupportedException($"Unknown cloud type: {cloud_type}")
        };

        if (result.Success)
        {
            return Redirect("/success");
        }
        else
        {
            return Redirect($"/error?message={Uri.EscapeDataString(result.ErrorMessage)}");
        }
    }
    catch (Exception ex)
    {
        return Redirect($"/error?message={Uri.EscapeDataString(ex.Message)}");
    }
}

// Token exchange helper (server-side only - requires client_secret)
private async Task<TokenResponse> ExchangeCodeForTokens(string cloudType, string code)
{
    using var httpClient = new HttpClient();

    var tokenEndpoint = cloudType switch
    {
        "onedrive" => "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        "googledrive" => "https://oauth2.googleapis.com/token",
        "aliyundriveopen" => "https://open.aliyundrive.com/oauth/access_token",
        "baidupan" => "https://openapi.baidu.com/oauth/2.0/token",
        // ... other providers
        _ => throw new NotSupportedException()
    };

    var parameters = new Dictionary<string, string>
    {
        ["grant_type"] = "authorization_code",
        ["code"] = code,
        ["client_id"] = GetClientId(cloudType),
        ["client_secret"] = GetClientSecret(cloudType), // Keep secret server-side!
        ["redirect_uri"] = GetRedirectUri(cloudType)
    };

    var response = await httpClient.PostAsync(tokenEndpoint,
        new FormUrlEncodedContent(parameters));
    response.EnsureSuccessStatusCode();

    var json = await response.Content.ReadAsStringAsync();
    return JsonSerializer.Deserialize<TokenResponse>(json);
}
```

**4. Complete Code Examples**

**Example (C#) - OneDrive OAuth:**

```csharp
// After successful OAuth flow and token exchange
var request = new LoginOneDriveOAuthRequest
{
    RefreshToken = "OAQABAAIAAAAm-06blBE1TpVMil8KPQ41...",
    AccessToken = "EwBwA8l6BAAUbDba3x2OMJElkF7gJ4z/VbCPEz0AA...",
    ExpiresIn = 3600 // seconds
};

var callOptions = CreateAuthorizedCallOptions();
var result = await client.APILoginOneDriveOAuthAsync(request, callOptions);

if (result.Success)
{
    Console.WriteLine("OneDrive added successfully!");
}
else
{
    Console.WriteLine($"Error: {result.ErrorMessage}");
}
```

**Example (Python) - Google Drive OAuth:**

```python
# After OAuth flow and token exchange
request = clouddrive_pb2.LoginGoogleDriveOAuthRequest(
    refresh_token="1//0gH_xxxxxxxxxxxxxxxxxxx",
    access_token="ya29.a0AfH6SMxxxxxxxxxxxxxxxxxx",
    expires_in=3599
)

result = stub.ApiLoginGoogleDriveOAuth(request, metadata=auth_metadata)

if result.success:
    print("Google Drive added successfully!")
else:
    print(f"Error: {result.errorMessage}")
```

**Example (Java) - Aliyun Drive Open OAuth:**

```java
// After OAuth flow and token exchange
LoginAliyundriveOAuthRequest request = LoginAliyundriveOAuthRequest.newBuilder()
    .setRefreshToken("xxxxxxxxxxxxxxxxxxxxx")
    .setAccessToken("eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...")
    .setExpiresIn(7200)
    .build();

APILoginResult result = blockingStub.apiLoginAliyundriveOAuth(request);

if (result.getSuccess()) {
    System.out.println("Aliyun Drive added successfully!");
} else {
    System.err.println("Error: " + result.getErrorMessage());
}
```

**Example (Go) - Baidu Pan OAuth:**

```go
// After OAuth flow and token exchange
req := &pb.LoginBaiduPanOAuthRequest{
    RefreshToken: "122.xxxxxxxxxxxxxxxxxxxxxxx",
    AccessToken:  "121.xxxxxxxxxxxxxxxxxxxxxxx",
    ExpiresIn:    2592000, // 30 days
}

result, err := client.APILoginBaiduPanOAuth(authCtx, req)
if err != nil {
    log.Fatalf("RPC error: %v", err)
}

if result.Success {
    fmt.Println("Baidu Pan added successfully!")
} else {
    fmt.Printf("Error: %s\n", result.ErrorMessage)
}
```

**OAuth Best Practices:**

1. **Security**:
   - NEVER expose `client_secret` in client-side code (browsers, mobile apps)
   - Always exchange authorization codes server-side
   - Use HTTPS for all OAuth redirects
   - Validate `state` parameter to prevent CSRF attacks

2. **Token Storage**:
   - Store refresh tokens securely (encrypted database)
   - Never log or expose tokens
   - CloudDrive2 handles token refresh automatically

3. **Scope Requests**:
   - Request minimum necessary permissions
   - Some providers require specific scopes for file operations

4. **Error Handling**:
   - Handle expired authorization codes (typically valid for 10 minutes)
   - Provide clear error messages to users
   - Implement retry logic for network failures

5. **User Experience**:
   - Open OAuth in popup window for better UX
   - Show loading state during token exchange
   - Provide cancel option

**Common OAuth Errors:**

| Error | Cause | Solution |
|-------|-------|----------|
| `invalid_client` | Wrong client_id or client_secret | Verify credentials from provider console |
| `invalid_grant` | Expired or used authorization code | Request new authorization |
| `redirect_uri_mismatch` | Redirect URI doesn't match registration | Update in provider console |
| `invalid_scope` | Requested unavailable permissions | Check provider documentation |
| `access_denied` | User denied authorization | Prompt user to retry |

---

#### QRCode Login Process

Several cloud providers support QR code-based authentication for a seamless login experience. The QR code login process follows a standard server streaming pattern where the server sends real-time updates about the authentication status.

**Supported QR Code Login Methods:**
- `APILogin115OpenQRCode` - 115 Cloud (Open API)
- `APILoginAliyunDriveQRCode` - Aliyun Drive
- `APILogin189QRCode` - 189 Cloud (天翼云盘)

**QR Code Message Types:**

```protobuf
enum QRCodeScanMessageType {
  SHOW_IMAGE = 0;          // Display QR code image from URL
  SHOW_IMAGE_CONTENT = 1;  // Message contains original text to encode as QR code
  CHANGE_STATUS = 2;       // Update status message (scanning, confirming, etc.)
  CLOSE = 3;               // Login successful, close QR code dialog
  ERROR = 4;               // Login failed with error message
}

message QRCodeScanMessage {
  QRCodeScanMessageType messageType = 1;
  string message = 2;  // URL, text to encode, status text, or error message
}
```

**General QR Code Login Flow:**

1. **Initiate QR Code Login**: Call the appropriate QRCode login method (returns server streaming RPC)
2. **Receive SHOW_IMAGE or SHOW_IMAGE_CONTENT**:
   - `SHOW_IMAGE`: `message` contains a URL to the QR code image
   - `SHOW_IMAGE_CONTENT`: `message` contains the original text that should be encoded into a QR code by the client
3. **Display QR Code**: Show the QR code to the user for scanning with their mobile app
4. **Receive CHANGE_STATUS**: Status updates as user scans/confirms
   - Example messages: "Waiting for scan", "Scanned, please confirm on mobile", "Confirming..."
5. **Receive CLOSE or ERROR**:
   - `CLOSE`: Login successful, cloud API added
   - `ERROR`: Login failed, `message` contains error details

**Complete Example (C#):**

```csharp
// Example: 115 Open QR Code Login
public async Task Login115OpenQRCodeAsync(CancellationToken cancellationToken = default)
{
    var callOptions = CreateAuthorizedCallOptions(cancellationToken);
    using var call = client.APILogin115OpenQRCode(new Login115OpenQRCodeRequest(), callOptions);

    try
    {
        await foreach (var message in call.ResponseStream.ReadAllAsync(cancellationToken))
        {
            switch (message.MessageType)
            {
                case QRCodeScanMessageType.ShowImage:
                    Console.WriteLine($"Please scan QR code at: {message.Message}");
                    // Display QR code from URL
                    await ShowQRCodeFromUrlAsync(message.Message);
                    break;

                case QRCodeScanMessageType.ShowImageContent:
                    Console.WriteLine("QR Code text received");
                    // Generate QR code from the original message text
                    await GenerateAndShowQRCodeAsync(message.Message);
                    break;

                case QRCodeScanMessageType.ChangeStatus:
                    Console.WriteLine($"Status: {message.Message}");
                    // Update UI with status message
                    await UpdateStatusAsync(message.Message);
                    break;

                case QRCodeScanMessageType.Close:
                    Console.WriteLine("Login successful!");
                    await CloseQRCodeDialogAsync();
                    await RefreshCloudApiListAsync();
                    return;

                case QRCodeScanMessageType.Error:
                    Console.WriteLine($"Login failed: {message.Message}");
                    await ShowErrorAsync(message.Message);
                    return;
            }
        }
    }
    catch (RpcException ex)
    {
        Console.WriteLine($"QR Code login error: {ex.Status}");
        throw;
    }
}
```

**Example (Java):**

```java
// AliyunDrive QR Code Login
public void loginAliyunDriveQRCode() {
    LoginAliyundriveQRCodeRequest request = LoginAliyundriveQRCodeRequest.newBuilder()
        .setUseOpenApi(true)  // Use AliyunDrive Open API
        .build();

    Iterator<QRCodeScanMessage> responses = blockingStub.apiLoginAliyunDriveQRCode(request);

    while (responses.hasNext()) {
        QRCodeScanMessage message = responses.next();

        switch (message.getMessageType()) {
            case SHOW_IMAGE:
                System.out.println("QR Code URL: " + message.getMessage());
                displayQRCodeFromUrl(message.getMessage());
                break;

            case SHOW_IMAGE_CONTENT:
                // Generate QR code from the original message text
                generateAndDisplayQRCode(message.getMessage());
                break;

            case CHANGE_STATUS:
                System.out.println("Status: " + message.getMessage());
                updateStatus(message.getMessage());
                break;

            case CLOSE:
                System.out.println("Login successful!");
                closeQRCodeDialog();
                refreshCloudApiList();
                return;

            case ERROR:
                System.err.println("Error: " + message.getMessage());
                showError(message.getMessage());
                return;
        }
    }
}
```

**Example (Python):**

```python
# 189 Cloud QR Code Login
def login_189_qrcode():
    responses = stub.APILogin189QRCode(Login189QRCodeRequest(), metadata=auth_metadata)

    for message in responses:
        if message.messageType == clouddrive_pb2.SHOW_IMAGE:
            print(f"Scan QR code at: {message.message}")
            display_qrcode_from_url(message.message)

        elif message.messageType == clouddrive_pb2.SHOW_IMAGE_CONTENT:
            # Generate QR code from the original message text
            generate_and_display_qrcode(message.message)

        elif message.messageType == clouddrive_pb2.CHANGE_STATUS:
            print(f"Status: {message.message}")
            update_status(message.message)

        elif message.messageType == clouddrive_pb2.CLOSE:
            print("Login successful!")
            close_qrcode_dialog()
            return True

        elif message.messageType == clouddrive_pb2.ERROR:
            print(f"Login failed: {message.message}")
            show_error(message.message)
            return False
```

**Example (Go):**

```go
// Generic QR Code Login Handler
func handleQRCodeLogin(stream grpc.ClientStream) error {
    for {
        var msg pb.QRCodeScanMessage
        if err := stream.RecvMsg(&msg); err == io.EOF {
            break
        } else if err != nil {
            return err
        }

        switch msg.MessageType {
        case pb.QRCodeScanMessageType_SHOW_IMAGE:
            fmt.Printf("Scan QR code at: %s\n", msg.Message)
            displayQRCodeFromURL(msg.Message)

        case pb.QRCodeScanMessageType_SHOW_IMAGE_CONTENT:
            // Generate QR code from the original message text
            generateAndDisplayQRCode(msg.Message)

        case pb.QRCodeScanMessageType_CHANGE_STATUS:
            fmt.Printf("Status: %s\n", msg.Message)
            updateStatus(msg.Message)

        case pb.QRCodeScanMessageType_CLOSE:
            fmt.Println("Login successful!")
            closeQRCodeDialog()
            return nil

        case pb.QRCodeScanMessageType_ERROR:
            return fmt.Errorf("login failed: %s", msg.Message)
        }
    }
    return nil
}
```

**Best Practices:**

1. **Timeout Handling**: Implement a timeout (typically 2-5 minutes) for QR code scanning
2. **User Cancellation**: Allow users to cancel the QR code login process
3. **QR Code Refresh**: Some providers may send new QR codes if the old one expires
4. **Status Updates**: Display real-time status messages to keep users informed
5. **Error Recovery**: Provide clear error messages and retry options
6. **Mobile App Requirement**: Inform users they need the corresponding mobile app installed

---

#### GetAllCloudApis

Gets all configured cloud API connections.

**Request:** `google.protobuf.Empty`

**Response:** `CloudAPIList`
```protobuf
message CloudAPIList {
  repeated CloudAPI apis = 1;
}

message CloudAPI {
  string name = 1;
  string userName = 2;
  string nickName = 3;
  bool isLocked = 4;
  bool supportMultiThreadUploading = 5;
  bool supportQpsLimit = 6;
  bool isCloudEventListenerRunning = 7;
  bool hasPromotions = 8;
  optional string promotionTitle = 9;
  optional string path = 10;
  bool supportHttpDownload = 11; // Supports HTTP download
}
```

---

#### CanAddMoreCloudApis

Checks if current user can add more cloud APIs.

**Request:** `google.protobuf.Empty`

**Response:** `FileOperationResult`

---

#### APILogin115OpenOAuth

Adds 115 Cloud (Open API) using OAuth tokens.

**Request:** `Login115OpenOAuthRequest`
```protobuf
message Login115OpenOAuthRequest {
  string refresh_token = 1;
  string access_token = 2;
  uint64 expires_in = 3;
  optional ProxyInfo apiProxy = 4;
  optional ProxyInfo dataProxy = 5;
}
```

**Response:** `APILoginResult`

---

#### APILogin115OpenQRCode (Server Streaming)

Adds 115 Cloud (Open API) via QR code scanning. See [QRCode Login Process](#qrcode-login-process) for detailed usage.

**Request:** `Login115OpenQRCodeRequest`
```protobuf
message Login115OpenQRCodeRequest {
  optional ProxyInfo apiProxy = 1;
  optional ProxyInfo dataProxy = 2;
}
```

**Response Stream:** `QRCodeScanMessage`

**Example (C#):**
```csharp
var callOptions = CreateAuthorizedCallOptions(cancellationToken);
using var call = client.APILogin115OpenQRCode(new Login115OpenQRCodeRequest(), callOptions);

await foreach (var message in call.ResponseStream.ReadAllAsync(cancellationToken))
{
    switch (message.MessageType)
    {
        case QRCodeScanMessageType.ShowImage:
            ShowQRCodeFromUrl(message.Message);
            break;
        case QRCodeScanMessageType.ChangeStatus:
            UpdateStatus(message.Message);
            break;
        case QRCodeScanMessageType.Close:
            Console.WriteLine("115 Cloud added successfully!");
            return;
        case QRCodeScanMessageType.Error:
            Console.WriteLine($"Error: {message.Message}");
            return;
    }
}
```

---

#### APILoginAliyundriveOAuth

Adds AliyunDrive using OAuth tokens.

**Request:** `LoginAliyundriveOAuthRequest`
```protobuf
message LoginAliyundriveOAuthRequest {
  string refresh_token = 1;
  string access_token = 2;
  uint64 expires_in = 3;
  optional ProxyInfo apiProxy = 4;
  optional ProxyInfo dataProxy = 5;
}
```

**Response:** `APILoginResult`

---

#### APILoginAliyundriveRefreshtoken

Adds AliyunDrive using refresh token.

**Request:** `LoginAliyundriveRefreshtokenRequest`
```protobuf
message LoginAliyundriveRefreshtokenRequest {
  string refreshToken = 1;
  bool useOpenAPI = 2;
}
```

**Response:** `APILoginResult`

**Example (C#):**
```csharp
var request = new LoginAliyundriveRefreshtokenRequest
{
    RefreshToken = "your-refresh-token",
    UseOpenAPI = true  // Use AliyunDrive Open API
};

var result = await client.APILoginAliyundriveRefreshtokenAsync(request, callOptions);
if (result.Success)
{
    Console.WriteLine("AliyunDrive added successfully");
}
```

---

#### APILoginAliyunDriveQRCode (Server Streaming)

Adds AliyunDrive via QR code scanning. See [QRCode Login Process](#qrcode-login-process) for detailed usage.

**Request:** `LoginAliyundriveQRCodeRequest`
```protobuf
message LoginAliyundriveQRCodeRequest {
  bool useOpenAPI = 1;  // Use AliyunDrive Open API
  optional ProxyInfo apiProxy = 2;
  optional ProxyInfo dataProxy = 3;
}
```

**Response Stream:** `QRCodeScanMessage`

---

#### APILoginBaiduPanOAuth

Adds Baidu Pan using OAuth tokens.

**Request:** `LoginBaiduPanOAuthRequest`
```protobuf
message LoginBaiduPanOAuthRequest {
  string refresh_token = 1;
  string access_token = 2;
  uint64 expires_in = 3;
  optional ProxyInfo apiProxy = 4;
  optional ProxyInfo dataProxy = 5;
}
```

**Response:** `APILoginResult`

---

#### APILoginOneDriveOAuth

Adds OneDrive using OAuth tokens.

**Request:** `LoginOneDriveOAuthRequest`
```protobuf
message LoginOneDriveOAuthRequest {
  string refresh_token = 1;
  string access_token = 2;
  uint64 expires_in = 3;
  optional ProxyInfo apiProxy = 4;
  optional ProxyInfo dataProxy = 5;
}
```

**Response:** `APILoginResult`

---

#### ApiLoginGoogleDriveOAuth

Adds Google Drive using OAuth tokens.

**Request:** `LoginGoogleDriveOAuthRequest`
```protobuf
message LoginGoogleDriveOAuthRequest {
  string refresh_token = 1;
  string access_token = 2;
  uint64 expires_in = 3;
  optional ProxyInfo apiProxy = 4;
  optional ProxyInfo dataProxy = 5;
}
```

**Response:** `APILoginResult`

---

#### ApiLoginGoogleDriveRefreshToken

Adds Google Drive using client credentials and refresh token.

**Request:** `LoginGoogleDriveRefreshTokenRequest`
```protobuf
message LoginGoogleDriveRefreshTokenRequest {
  string client_id = 1;
  string client_secret = 2;
  string refresh_token = 3;
}
```

**Response:** `APILoginResult`

**Example (Python):**
```python
request = clouddrive_pb2.LoginGoogleDriveRefreshTokenRequest(
    client_id="your-client-id",
    client_secret="your-client-secret",
    refresh_token="your-refresh-token"
)

result = stub.ApiLoginGoogleDriveRefreshToken(request, metadata=auth_metadata)
if result.success:
    print("Google Drive added successfully")
else:
    print(f"Error: {result.errorMessage}")
```

---

#### ApiLoginXunleiOAuth

Adds Xunlei Drive using OAuth tokens.

**Request:** `LoginXunleiOAuthRequest`
```protobuf
message LoginXunleiOAuthRequest {
  string refresh_token = 1;
  string access_token = 2;
  uint64 expires_in = 3;
  optional ProxyInfo apiProxy = 4;
  optional ProxyInfo dataProxy = 5;
}
```

**Response:** `APILoginResult`

---

#### ApiLoginXunleiOpenOAuth

Adds Xunlei Drive (Open API) using OAuth tokens.

**Request:** `LoginXunleiOpenOAuthRequest`
```protobuf
message LoginXunleiOpenOAuthRequest {
  string refresh_token = 1;
  string access_token = 2;
  uint64 expires_in = 3;
  optional ProxyInfo apiProxy = 4;
  optional ProxyInfo dataProxy = 5;
}
```

**Response:** `APILoginResult`

---

#### ApiLogin123panOAuth

Adds 123 Pan using client credentials.

**Request:** `Login123panOAuthRequest`
```protobuf
message Login123panOAuthRequest {
  string refresh_token = 1;
  string access_token = 2;
  uint64 expires_in = 3;
  optional ProxyInfo apiProxy = 4;
  optional ProxyInfo dataProxy = 5;
}
```

**Response:** `APILoginResult`

**Example (Java):**
```java
Login123panOAuthRequest request = Login123panOAuthRequest.newBuilder()
    .setClientId("your-client-id")
    .setClientSecret("your-client-secret")
    .build();

APILoginResult result = blockingStub.apiLogin123panOAuth(request);
if (result.getSuccess()) {
    System.out.println("123 Pan added successfully");
} else {
    System.err.println("Error: " + result.getErrorMessage());
}
```

---

#### APILogin189QRCode (Server Streaming)

Adds 189 Cloud (天翼云盘) via QR code scanning. See [QRCode Login Process](#qrcode-login-process) for detailed usage.

**Request:** `Login189QRCodeRequest`
```protobuf
message Login189QRCodeRequest {
  optional ProxyInfo apiProxy = 1;
  optional ProxyInfo dataProxy = 2;
}
```

**Response Stream:** `QRCodeScanMessage`

---

#### APILoginWebDav

Adds a WebDAV connection.

**Request:** `LoginWebDavRequest`
```protobuf
message LoginWebDavRequest {
  string serverUrl = 1;
  string userName = 2;
  string password = 3;
  bool doNotSyncToCloud = 4;
  optional ProxyInfo apiProxy = 5;
  optional ProxyInfo dataProxy = 6;
}
```

**Response:** `APILoginResult`

*Added in 0.9.8*

---

#### APILoginS3

Adds Amazon S3 or S3-compatible object storage.

**Request:** `LoginS3Request`
```protobuf
message LoginS3Request {
  string accessKeyId = 1;           // AWS Access Key ID
  string secretAccessKey = 2;       // AWS Secret Access Key
  string region = 3;                // AWS region (e.g., "us-east-1")
  string bucket = 4;                // S3 bucket name
  optional string endpoint = 5;     // Custom endpoint URL for S3-compatible services
  bool pathStyle = 6;               // Use path-style URLs instead of virtual-hosted style
  bool doNotSyncToCloud = 7;        // If true, do NOT sync this API config to cloud
  optional uint32 signatureVersion = 8; // S3 signature version: 2 or 4 (default 4)
  optional ProxyInfo apiProxy = 9;      // Optional API proxy
  optional ProxyInfo dataProxy = 10;    // Optional data proxy
}
```

**Response:** `APILoginResult`

**Field Descriptions:**
- `accessKeyId`: AWS Access Key ID or equivalent for S3-compatible services
- `secretAccessKey`: AWS Secret Access Key or equivalent credential
- `region`: AWS region (e.g., "us-east-1", "eu-west-1"). Required even for S3-compatible services.
- `bucket`: The S3 bucket name to access
- `endpoint`: Optional for AWS S3. Required for S3-compatible services (e.g., "http://localhost:9000" for MinIO, "https://s3.wasabisys.com" for Wasabi)
- `pathStyle`: Set to `true` for path-style URLs (`https://endpoint/bucket/key`), `false` for virtual-hosted style (`https://bucket.endpoint/key`). MinIO and some other services require `true`.
- `doNotSyncToCloud`: If `true`, this configuration will not sync to other devices
- `signatureVersion`: S3 signature version, `2` or `4` (default: `4`). Use `2` for legacy S3-compatible services that don't support signature v4.

**Example - AWS S3:**
```csharp
var request = new LoginS3Request
{
    AccessKeyId = "AKIAIOSFODNN7EXAMPLE",
    SecretAccessKey = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    Region = "us-east-1",
    Bucket = "my-bucket",
    PathStyle = false
};
var result = await client.APILoginS3Async(request);
```

**Example - MinIO:**
```csharp
var request = new LoginS3Request
{
    AccessKeyId = "minioadmin",
    SecretAccessKey = "minioadmin",
    Region = "us-east-1",  // Can be any value for MinIO
    Bucket = "test-bucket",
    Endpoint = "http://localhost:9000",
    PathStyle = true  // MinIO requires path-style
};
var result = await client.APILoginS3Async(request);
```

**Example - Wasabi:**
```csharp
var request = new LoginS3Request
{
    AccessKeyId = "YOUR_WASABI_ACCESS_KEY",
    SecretAccessKey = "YOUR_WASABI_SECRET_KEY",
    Region = "us-east-1",  // Wasabi region
    Bucket = "my-wasabi-bucket",
    Endpoint = "https://s3.wasabisys.com",
    PathStyle = false
};
var result = await client.APILoginS3Async(request);
```

*Added in 0.9.22*

---

#### APIAddLocalFolder

Adds a local folder as a cloud.

**Request:** `AddLocalFolderRequest`
```protobuf
message AddLocalFolderRequest {
  string localFolderPath = 1;
}
```

**Response:** `APILoginResult`

---

#### APILoginCloudDrive

Adds a remote CloudDrive server.

**Request:** `LoginCloudDriveRequest`
```protobuf
message LoginCloudDriveRequest {
  string grpcUrl = 1;
  string token = 2;
  bool insecureTls = 3; // for self-signed certs
  bool doNotSyncToCloud = 4;
  optional ProxyInfo apiProxy = 5;
  optional ProxyInfo dataProxy = 6;
}
```

**Response:** `APILoginResult`

---

#### APILoginSftp

Adds an SFTP server. Supports password and private-key authentication.

**Request:** `LoginSftpRequest`
```protobuf
message LoginSftpRequest {
  string host = 1;
  uint32 port = 2;                    // default 22
  string userName = 3;
  string password = 4;
  optional string privateKey = 5;     // PEM-encoded private key
  optional string passphrase = 6;     // passphrase for encrypted keys
  optional string rootPath = 7;       // remote root directory (default "/")
  bool doNotSyncToCloud = 8;
  optional ProxyInfo apiProxy = 9;
  optional ProxyInfo dataProxy = 10;
}
```

**Response:** `APILoginResult`

---

#### APILoginFtp

Adds an FTP/FTPS server. Set `useTls = true` for FTPS.

**Request:** `LoginFtpRequest`
```protobuf
message LoginFtpRequest {
  string host = 1;
  uint32 port = 2;                    // default 21
  string userName = 3;
  string password = 4;
  bool useTls = 5;                    // enable FTPS (TLS)
  optional string rootPath = 6;       // remote root directory (default "/")
  bool doNotSyncToCloud = 7;
  optional ProxyInfo apiProxy = 8;
  optional ProxyInfo dataProxy = 9;
}
```

**Response:** `APILoginResult`

---

#### APILoginSmb

Adds an SMB/CIFS share.

**Request:** `LoginSmbRequest`
```protobuf
message LoginSmbRequest {
  string server = 1;                  // SMB server hostname or IP
  string share = 2;                   // share name (e.g. "SharedDocs")
  uint32 port = 3;                    // default 445
  string userName = 4;
  string password = 5;
  optional string workgroup = 6;      // domain/workgroup
  optional string rootPath = 7;       // path within share (default "/")
  bool doNotSyncToCloud = 8;
  optional ProxyInfo apiProxy = 9;
  optional ProxyInfo dataProxy = 10;
}
```

**Response:** `APILoginResult`

---

#### DiscoverSmbServers

Discovers SMB servers on the local network.

**Request:** `google.protobuf.Empty`

**Response:** `DiscoverSmbServersResult`
```protobuf
message SmbServerInfo {
  string name = 1;                    // server name (e.g. "MINIPC-Y10")
  string address = 2;                 // IP address or hostname
}
message DiscoverSmbServersResult {
  repeated SmbServerInfo servers = 1;
}
```

---

#### DiscoverSmbShares

Lists shares on a given SMB server.

**Request:** `DiscoverSmbSharesRequest`
```protobuf
message DiscoverSmbSharesRequest {
  string server = 1;
  uint32 port = 2;                    // default 445
  string userName = 3;
  string password = 4;
  optional string workgroup = 5;
}
```

**Response:** `DiscoverSmbSharesResult`
```protobuf
message DiscoverSmbSharesResult {
  repeated string shareNames = 1;
}
```

---

#### RemoveCloudAPI

Removes a cloud API connection.

**Request:** `RemoveCloudAPIRequest`
```protobuf
message RemoveCloudAPIRequest {
  string cloudName = 1;
  string userName = 2;
  bool permanentRemove = 3;
}
```

**Response:** `FileOperationResult`

---

#### GetCloudAPIConfig

Gets configuration for a cloud API.

**Request:** `GetCloudAPIConfigRequest`
```protobuf
message GetCloudAPIConfigRequest {
  string cloudName = 1;
  string userName = 2;
}
```

**Response:** `CloudAPIConfig`
```protobuf
message CloudAPIConfig {
  uint32 maxDownloadThreads = 1;
  uint64 minReadLengthKB = 2;
  uint64 maxReadLengthKB = 3;
  uint64 defaultReadLengthKB = 4;
  uint64 maxBufferPoolSizeMB = 5;
  double maxQueriesPerSecond = 6;
  bool forceIpv4 = 7;
  optional ProxyInfo apiProxy = 8;
  optional ProxyInfo dataProxy = 9;
  optional string customUserAgent = 10;
  optional uint32 maxUploadThreads = 11;
  optional bool insecureTls = 12;
  optional bool useHttpDownload = 13; // Use HTTP for downloads
  optional bool supportDirectLink = 14; // Supports direct link downloads
  optional bool supportDirectDownloadUrl = 15; // Supports direct download URLs (read-only)
  // fields 16, 17 removed: disk cache settings moved to per-folder (SetFolderDiskCache)
  reserved 16, 17;
  // Read-only caps reported by the server so clients can bound user input.
  // Each is the effective per-cloud (and platform-clamped, where applicable)
  // upper bound. Absent / zero means "no advertised cap; client should fall
  // back to a sensible default". Ignored on SetCloudAPIConfig.
  optional uint32 maxDownloadThreadsLimit = 18;
  optional uint64 maxBufferPoolSizeMBLimit = 19;
  optional double maxQueriesPerSecondLimit = 20;
}
```

**Note:** Fields `fileBufferDiskCacheEnabled` (16) and `fileBufferDiskCacheMaxFileSize` (17) were removed in 1.0.0. Disk cache is now configured per-folder via `SetFolderDiskCache`.

**Server-reported caps (1.0.7):** Fields 18, 19, and 20 are read-only upper bounds reported by the server for each respective setting. Clients should clamp UI sliders/inputs to these values when present. They are ignored on `SetCloudAPIConfig`.

---

#### SetCloudAPIConfig

Sets configuration for a cloud API.

**Request:** `SetCloudAPIConfigRequest`
```protobuf
message SetCloudAPIConfigRequest {
  string cloudName = 1;
  string userName = 2;
  CloudAPIConfig config = 3;
}
```

**Response:** `google.protobuf.Empty`

---

### System Settings

#### GetSystemSettings

Gets all system settings.

**Request:** `google.protobuf.Empty`

**Response:** `SystemSettings`
```protobuf
message SystemSettings {
  optional uint64 dirCacheTimeToLiveSecs = 1;
  optional uint64 maxPreProcessTasks = 2;
  optional uint64 maxProcessTasks = 3;
  optional string tempFileLocation = 4;
  optional bool syncWithCloud = 5;
  optional uint64 readDownloaderTimeoutSecs = 6;
  optional uint64 uploadDelaySecs = 7;
  optional StringList processBlackList = 8;
  optional StringList uploadIgnoredExtensions = 9;
  optional UpdateChannel updateChannel = 10;
  optional double maxDownloadSpeedKBytesPerSecond = 11;
  optional double maxUploadSpeedKBytesPerSecond = 12;
  optional string deviceName = 13;
  optional bool dirCachePersistence = 14;
  optional string dirCacheDbLocation = 15;
  optional LogLevel fileLogLevel = 16;
  optional LogLevel terminalLogLevel = 17;
  optional LogLevel backupLogLevel = 18;
  optional bool EnableAutoRegisterDevice = 19;
  optional LogLevel realtimeLogLevel = 20;
  optional StringList operatorPriorityOrder = 21;
  optional ProxyInfo updateProxy = 22;
  optional uint64 startDelaySecs = 23;
  optional string fileBufferDiskCacheLocation = 24; // Root directory for cached segments
  optional uint64 fileBufferDiskCacheMaxBytes = 25; // Max bytes for disk cache; LRU eviction
  optional ProxyInfo cloudfsProxy = 26; // Proxy for reaching CloudFS account server
  optional uint64 maxFileLogSizeBytes = 27;   // Max log file size before rotation (None=no limit, 0=disable)
  optional uint64 maxBackupLogSizeBytes = 28; // Max backup log file size before rotation
  optional uint32 maxFileLogFiles = 29;       // Max rotated log files to keep (default: 10)
  optional uint32 maxBackupLogFiles = 30;     // Max rotated backup log files to keep (default: 10)
}
```

**New in 1.0.1:** `maxFileLogSizeBytes`, `maxBackupLogSizeBytes`, `maxFileLogFiles`, and `maxBackupLogFiles` configure log file rotation. All 4 fields must be sent together in `SetSystemSettings`.

**New in 0.9.18:** `fileBufferDiskCacheLocation` and `fileBufferDiskCacheMaxBytes` configure the global file buffer disk cache system.

---

#### SetSystemSettings

Updates system settings.

**Request:** `SystemSettings`

**Response:** `google.protobuf.Empty`

**Example (C#):**
```csharp
var settings = new SystemSettings
{
    DirCacheTimeToLiveSecs = 3600,
    MaxDownloadSpeedKBytesPerSecond = 10240, // 10 MB/s
    MaxUploadSpeedKBytesPerSecond = 5120,    // 5 MB/s
    DeviceName = "MyDevice"
};

await client.SetSystemSettingsAsync(settings, callOptions);
```

---

#### SetDirCacheTimeSecs

Sets cache time for a specific directory.

**Request:** `SetDirCacheTimeRequest`
```protobuf
message SetDirCacheTimeRequest {
  string path = 1;
  optional uint64 dirCachTimeToLiveSecs = 2; // if not present, delete to restore default
}
```

**Response:** `google.protobuf.Empty`

---

#### GetEffectiveDirCacheTimeSecs

Gets effective cache time for a path.

**Request:** `GetEffectiveDirCacheTimeRequest`

**Response:** `GetEffectiveDirCacheTimeResult`

---

#### ForceExpireDirCache

Forces directory cache expiration recursively.

**Request:** `FileRequest`

**Response:** `google.protobuf.Empty`

---

#### VacuumDirCache

Vacuums the directory cache database to reclaim space.

**Request:** `google.protobuf.Empty`

**Response:** `google.protobuf.Empty`

---

#### GetVacuumProgress

Gets the vacuum operation progress.

**Request:** `google.protobuf.Empty`

**Response:** `VacuumProgressResult`
```protobuf
enum VacuumStatus {
  VACUUM_IDLE = 0;
  VACUUM_RUNNING = 1;
  VACUUM_COMPLETED = 2;
  VACUUM_FAILED = 3;
}

message VacuumProgressResult {
  VacuumStatus status = 1;
  optional google.protobuf.Timestamp startTime = 2;
  optional google.protobuf.Timestamp endTime = 3;
  uint64 sizeBefore = 4;           // Database size before vacuum
  uint64 sizeAfter = 5;            // Database size after vacuum (only set when completed)
  optional string errorMessage = 6; // Error message if failed
}
```

**Enhanced in 0.9.18:** Now includes `startTime`, `endTime`, `sizeBefore`, `sizeAfter`, and `errorMessage` for detailed vacuum progress tracking.

---

#### GetDirCacheDbSize

Gets the directory cache database size.

**Request:** `google.protobuf.Empty`

**Response:** `GetDirCacheDbSizeResult`
```protobuf
message GetDirCacheDbSizeResult {
  uint64 totalSizeBytes = 1; // Total size including main db + WAL + SHM files
  bool isVacuuming = 2;      // Whether database is currently being vacuumed
}
```

---

### Runtime Information

#### GetRuntimeInfo

Gets server runtime information.

**Request:** `google.protobuf.Empty`

**Response:** `RuntimeInfo`
```protobuf
message RuntimeInfo {
  string productName = 1;
  string productVersion = 2;
  string CloudAPIVersion = 3;
  string osInfo = 4;
}
```

---

#### GetRunningInfo

Gets real-time server stats.

**Request:** `google.protobuf.Empty`

**Response:** `RunInfo`
```protobuf
message RunInfo {
  double cpuUsage = 1;
  uint64 memUsageKB = 2;
  double uptime = 3;
  uint64 fhTableCount = 4;
  uint64 dirCacheCount = 5;
  uint64 tempFileCount = 6;
  uint64 dbDirCacheCount = 7;
  double downloadBytesPerSecond = 8;
  double uploadBytesPerSecond = 9;
  uint64 totalMemoryKB = 10;
}
```

---

#### GetFileBufferDiskCacheStats

Gets runtime statistics for the file buffer disk cache.

**Request:** `google.protobuf.Empty`

**Response:** `FileBufferDiskCacheStats`
```protobuf
// Eviction strategy for disk cache
enum EvictionStrategy {
  LRU = 0;           // Least Recently Used - evict entries not accessed recently
  LARGEST_FIRST = 1; // Evict largest files first to free space quickly
  SMALLEST_FIRST = 2; // Evict smallest files first to keep large files cached
}

message FileBufferDiskCacheStats {
  bool enabled = 1;
  uint64 totalBytes = 2;               // Current total bytes cached
  uint64 maxBytes = 3;                 // Maximum allowed bytes
  uint64 entryCount = 4;               // Number of cached file entries
  uint64 segmentCount = 5;             // Number of cached segments
  string rootDir = 6;                  // Root directory for cache storage
  bool scanCompleted = 7;              // Whether initial disk scan has completed after restart
  EvictionStrategy evictionStrategy = 8; // Current active eviction strategy
}
```

**New in 0.9.18, Updated in 0.9.19** (added `scanCompleted` and `evictionStrategy` fields)

---

#### PurgeFileBufferDiskCache

Purges all disk-cached file buffers to reclaim disk space.

**Request:** `google.protobuf.Empty`

**Response:** `google.protobuf.Empty`

**New in 0.9.18**

---

#### SetDiskCacheEvictionStrategy

Sets the eviction strategy for the disk cache.

**Request:** `SetDiskCacheEvictionStrategyRequest`
```protobuf
message SetDiskCacheEvictionStrategyRequest {
  EvictionStrategy strategy = 1;
}
```

**Response:** `google.protobuf.Empty`

**Eviction Strategy Options:**
- `LRU` (0): Least Recently Used - evicts entries not accessed recently (default)
- `LARGEST_FIRST` (1): Evicts largest files first to free space quickly
- `SMALLEST_FIRST` (2): Evicts smallest files first to keep large files cached

**New in 0.9.19**

---

#### SetFolderDiskCache

Enables and configures disk cache rules for a specific folder.

**Request:** `SetFolderDiskCacheRequest`
```protobuf
message SetFolderDiskCacheRequest {
  string path = 1;
  uint64 maxFileSize = 2;      // 0 = no limit
  uint64 minFileSize = 3;      // 0 = no minimum
  ExtensionFilterMode extensionFilterMode = 4;
  repeated string extensions = 5; // without dot, lowercase (e.g. "mp4", "mkv")
  bool enabled = 6;            // true = enable, false = explicitly disable
}
```

**Response:** `google.protobuf.Empty`

**New in 1.0.0**

---

#### RemoveFolderDiskCache

Disables disk cache for a folder.

**Request:** `FileRequest`

**Response:** `google.protobuf.Empty`

**New in 1.0.0**

---

#### ListDiskCacheFolders

Lists all folders with disk cache rules.

**Request:** `google.protobuf.Empty`

**Response:** `ListDiskCacheFoldersReply`
```protobuf
message ListDiskCacheFoldersReply {
  repeated DiskCacheFolder folders = 1;
}

message DiskCacheFolder {
  string path = 1;
  uint64 maxFileSize = 2;
  uint64 minFileSize = 3;
  ExtensionFilterMode extensionFilterMode = 4;
  repeated string extensions = 5;
  bool enabled = 6;
}
```

**New in 1.0.0**

---

#### PrefetchFileRanges

Tells the server to prefetch one or more byte ranges on a file, with a priority that also triages concurrent work. Use for clients with explicit knowledge of upcoming access patterns (media seeks, batched thumbnail generation, archive central directory reads, etc.).

**Request:** `PrefetchFileRangesRequest`
```protobuf
message ByteRange {
  uint64 start = 1;  // inclusive
  uint64 length = 2; // bytes
}

message PrefetchFileRangesRequest {
  string path = 1;
  repeated ByteRange ranges = 2;
  HintPriority priority = 3;
  // 0 = server allocates and returns an id
  uint64 hint_id = 4;
  // 0 = server default (clamped to [1, PREFETCH_HINT_TTL_SEC])
  uint32 ttl_seconds = 5;
  // if true, cancel any prior hints on this path before adding
  bool replace_existing = 6;
}
```

**Response:** `PrefetchFileRangesReply`
```protobuf
message PrefetchFileRangesReply {
  uint64 hint_id = 1;
  uint32 accepted_range_count = 2;
  // ranges dropped for being out-of-bounds or already fully cached
  uint32 rejected_range_count = 3;
}
```

**New in 1.0.7**

---

#### CancelFilePrefetch

Cancels one or more hints previously registered via `PrefetchFileRanges`. An empty `hint_ids` list cancels all hints on the given path.

**Request:** `CancelFilePrefetchRequest`
```protobuf
message CancelFilePrefetchRequest {
  string path = 1;
  // empty = cancel all hints on that path
  repeated uint64 hint_ids = 2;
}
```

**Response:** `google.protobuf.Empty`

**New in 1.0.7**

---

#### CloseFileReader

Signals "I will not read this file again." Drops the server-side `EntryReader` (download buffers + downloader threads) as soon as no open handles remain, skipping the default 2-second post-close retention window that serves rapid close/reopen patterns from mounted filesystems. Use for one-shot reads such as web thumbnail generation or metadata probes — any client that can guarantee it won't re-open the file in the near future.

**Request:** `FileRequest` (path)

**Response:** `google.protobuf.Empty`

**New in 1.0.7**

---

#### GetActivePrefetchHints

Diagnostic snapshot of currently-registered prefetch hints plus cumulative process-lifetime counters.

**Request:** `google.protobuf.Empty`

**Response:** `GetActivePrefetchHintsReply`
```protobuf
message ActivePrefetchHint {
  string path = 1;
  uint64 hint_id = 2;
  HintPriority priority = 3;
  uint64 total_bytes = 4;
  uint32 seconds_since_created = 5;
  uint32 remaining_ttl_seconds = 6;
  uint32 event_count = 7;
}

message GetActivePrefetchHintsReply {
  repeated ActivePrefetchHint hints = 1;
  uint64 hints_created_total = 2;
  uint64 hints_cancelled_total = 3;
  uint64 hints_expired_total = 4;
  uint64 ranges_rejected_cache_hit_total = 5;
  uint64 scale_up_events_total = 6;
  uint64 preempt_events_total = 7;
}
```

**New in 1.0.7**

---

#### GetOpenFileHandles

Gets all opened file handles.

**Request:** `google.protobuf.Empty`

**Response:** `OpenFileHandleList`
```protobuf
message OpenFileHandleList {
  repeated OpenFileHandle openFileHandles = 1;
}

message OpenFileHandle {
  uint64 fileHandle = 1;
  uint64 processId = 2;
  string processPath = 3;
  string filePath = 4;
  bool isDirectory = 5;
  google.protobuf.Timestamp openTime = 6;
  optional string specialCommand = 7;
}
```

---

### Account Management

#### SendConfirmEmail

Sends account confirmation email.

**Request:** `google.protobuf.Empty`

**Response:** `google.protobuf.Empty`

---

#### ConfirmEmail

Confirms email with code.

**Request:** `ConfirmEmailRequest`
```protobuf
message ConfirmEmailRequest {
  string confirmCode = 1;
}
```

**Response:** `google.protobuf.Empty`

---

#### GetAccountStatus

Gets current account status and plan.

**Request:** `google.protobuf.Empty`

**Response:** `AccountStatusResult`
```protobuf
message AccountStatusResult {
  string userName = 1;
  string emailConfirmed = 2;
  double accountBalance = 3;
  AccountPlan accountPlan = 4;
  repeated AccountRole accountRoles = 5;
  optional AccountPlan secondPlan = 6;
  optional string partnerReferralCode = 7;
  optional bool trustedDevice = 8;
  optional bool userNameIsDeviceId = 9;
}

message AccountPlan {
  string planName = 1;
  string description = 2;
  string fontAwesomeIcon = 3;
  string durationDescription = 4;
  google.protobuf.Timestamp endTime = 5;
}
```

---

#### ChangePassword

Changes account password.

**Request:** `ChangePasswordRequest`
```protobuf
message ChangePasswordRequest {
  string oldPassword = 1;
  string newPassword = 2;
  optional string totpCode = 3;
}
```

**Note:** If Two-Factor Authentication (2FA) is enabled on your account, you must provide a valid TOTP code or recovery code in the `totpCode` field.

**Response:** `FileOperationResult`

---

#### ChangeEmail

Changes account email.

**Request:** `ChangeEmailRequest`
```protobuf
message ChangeEmailRequest {
  string newEmail = 1;
  string password = 2;
  optional string changeCode = 3;
  optional string totpCode = 4;
}
```

**Note:** If Two-Factor Authentication (2FA) is enabled on your account, you must provide a valid TOTP code or recovery code in the `totpCode` field.

**Response:** `google.protobuf.Empty`

---

#### TransferBalance

Transfers balance to another user.

**Request:** `TransferBalanceRequest`
```protobuf
message TransferBalanceRequest {
  string toUserName = 1;
  double amount = 2;
  string password = 3;
}
```

**Response:** `google.protobuf.Empty`

---

#### GetBalanceLog

Gets balance transaction history.

**Request:** `google.protobuf.Empty`

**Response:** `BalanceLogResult`

---

#### GetCloudDrivePlans

Gets available subscription plans.

**Request:** `google.protobuf.Empty`

**Response:** `GetCloudDrivePlansResult`

---

#### JoinPlan

Joins/purchases a plan.

**Request:** `JoinPlanRequest`
```protobuf
message JoinPlanRequest {
  string planId = 1;
  optional string couponCode = 2;
}
```

**Response:** `JoinPlanResult`

---

#### CheckActivationCode

Validates an activation code.

**Request:** `StringValue` (activation code)

**Response:** `CheckActivationCodeResult`

---

#### ActivatePlan

Activates a plan with activation code.

**Request:** `StringValue` (activation code)

**Response:** `JoinPlanResult`

---

#### GetReferralCode

Gets user's referral code.

**Request:** `google.protobuf.Empty`

**Response:** `StringValue`

---

### Two-Factor Authentication (2FA)

CloudDrive2 supports Time-based One-Time Password (TOTP) two-factor authentication for enhanced account security. This section documents all 2FA-related methods.

#### Check2FAStatus

Checks if 2FA is currently enabled for the authenticated user.

**Request:** `google.protobuf.Empty`

**Response:** `TwoFactorAuthStatusResult`
```protobuf
message TwoFactorAuthStatusResult {
  bool two_factor_enabled = 1;
}
```

**Example (C#):**
```csharp
var status = await client.Check2FAStatusAsync(new Empty(), callOptions);
if (status.TwoFactorEnabled)
{
    Console.WriteLine("2FA is enabled");
}
```

---

#### Setup2FA

Generates a TOTP secret and QR code for setting up 2FA. This is the first step in enabling 2FA.

**Request:** `Setup2FARequest`
```protobuf
message Setup2FARequest {
  string password = 1;
}
```

**Response:** `TwoFactorAuthSetupResult`
```protobuf
message TwoFactorAuthSetupResult {
  string secret = 1;
  string qr_code = 2;  // Base64-encoded PNG image (data URL format)
  string manual_entry_key = 3;
}
```

**Workflow:**
1. User provides their password
2. Server generates a TOTP secret
3. Server returns QR code (as base64 data URL) and manual entry key
4. User scans QR code with authenticator app (Microsoft Authenticator, Google Authenticator, Authy, etc.)
5. User proceeds to `Enable2FA` with a code from the app

**Example (C#):**
```csharp
var setupRequest = new Setup2FARequest { Password = "mypassword" };
var setup = await client.Setup2FAAsync(setupRequest, callOptions);

// Display QR code in UI (setup.QrCode is a data URL like "data:image/png;base64,...")
Console.WriteLine($"Secret: {setup.Secret}");
Console.WriteLine($"Manual Entry Key: {setup.ManualEntryKey}");
// Show setup.QrCode as an image in your UI for user to scan
```

---

#### Enable2FA

Enables 2FA by verifying a TOTP code from the user's authenticator app. Returns recovery codes that should be stored securely.

**Request:** `TwoFactorAuthCodeRequest`
```protobuf
message TwoFactorAuthCodeRequest {
  string totp_code = 1;  // 6-digit TOTP code or 8-character recovery code
}
```

**Response:** `TwoFactorAuthEnableResult`
```protobuf
message TwoFactorAuthEnableResult {
  repeated string recovery_codes = 1;
  string message = 2;
}
```

**Important:**
- Call this immediately after `Setup2FA` to verify the setup worked
- The TOTP code must be current (codes expire every 30 seconds)
- Recovery codes are generated and returned only once - store them securely!
- Each recovery code can be used only once

**Example (C#):**
```csharp
var enableRequest = new TwoFactorAuthCodeRequest { TotpCode = "123456" };
var result = await client.Enable2FAAsync(enableRequest, callOptions);

Console.WriteLine(result.Message);
Console.WriteLine("Recovery codes (store these securely!):");
foreach (var code in result.RecoveryCodes)
{
    Console.WriteLine($"  {code}");
}
```

---

#### Disable2FA

Disables 2FA for the account. Requires a valid TOTP code or recovery code.

**Request:** `TwoFactorAuthCodeRequest`
```protobuf
message TwoFactorAuthCodeRequest {
  string totp_code = 1;  // 6-digit TOTP code or 8-character recovery code
}
```

**Response:** `TwoFactorAuthMessageResult`
```protobuf
message TwoFactorAuthMessageResult {
  string message = 1;
}
```

**Example (C#):**
```csharp
var disableRequest = new TwoFactorAuthCodeRequest { TotpCode = "654321" };
var result = await client.Disable2FAAsync(disableRequest, callOptions);
Console.WriteLine(result.Message);
```

---

#### GetRecoveryCodes

Retrieves the list of unused recovery codes. Requires a valid TOTP code.

**Request:** `TwoFactorAuthCodeRequest`
```protobuf
message TwoFactorAuthCodeRequest {
  string totp_code = 1;  // 6-digit TOTP code
}
```

**Response:** `TwoFactorAuthRecoveryCodesResult`
```protobuf
message TwoFactorAuthRecoveryCodesResult {
  repeated string recovery_codes = 1;
  uint32 total = 2;
  string message = 3;
}
```

**Example (C#):**
```csharp
var request = new TwoFactorAuthCodeRequest { TotpCode = "123456" };
var result = await client.GetRecoveryCodesAsync(request, callOptions);

Console.WriteLine($"You have {result.Total} unused recovery codes:");
foreach (var code in result.RecoveryCodes)
{
    Console.WriteLine($"  {code}");
}
```

---

#### RegenerateRecoveryCodes

Generates a new set of recovery codes and invalidates all existing ones. Requires a valid TOTP code.

**Request:** `TwoFactorAuthCodeRequest`
```protobuf
message TwoFactorAuthCodeRequest {
  string totp_code = 1;  // 6-digit TOTP code
}
```

**Response:** `TwoFactorAuthRecoveryCodesResult`
```protobuf
message TwoFactorAuthRecoveryCodesResult {
  repeated string recovery_codes = 1;
  uint32 total = 2;
  string message = 3;
}
```

**Warning:** All old recovery codes will be invalidated immediately upon regeneration.

**Example (C#):**
```csharp
var request = new TwoFactorAuthCodeRequest { TotpCode = "123456" };
var result = await client.RegenerateRecoveryCodesAsync(request, callOptions);

Console.WriteLine("New recovery codes (old codes are now invalid!):");
foreach (var code in result.RecoveryCodes)
{
    Console.WriteLine($"  {code}");
}
```

---

#### LoginWith2FA

Public method for logging in with 2FA. Use this instead of `GetToken` when you know the account has 2FA enabled.

**Request:** `LoginWith2FARequest`
```protobuf
message LoginWith2FARequest {
  string userName = 1;
  string password = 2;
  string totp_code = 3;  // 6-digit TOTP code or 8-character recovery code
  bool synDataToCloud = 4;
}
```

**Response:** `JWTToken`

**Example (C#):**
```csharp
var loginRequest = new LoginWith2FARequest
{
    UserName = "myusername",
    Password = "mypassword",
    TotpCode = "123456",  // or use recovery code like "ABC12345"
    SynDataToCloud = true
};

var token = await client.LoginWith2FAAsync(loginRequest);
if (token.Success)
{
    Console.WriteLine($"Login successful! Token: {token.Token}");
}
```

---

### Session Management

CloudDrive2 provides session management capabilities to view and control active login sessions across all devices.

#### GetSessions

Lists all active refresh token sessions for the current user.

**Request:** `google.protobuf.Empty`

**Response:** `GetSessionsResponse`
```protobuf
message GetSessionsResponse {
  repeated Session sessions = 1;
}

message Session {
  string id = 1;
  string device_id = 2;
  string device_name = 3;
  string device_os_type = 4;
  string created_at = 5;
  string last_used_at = 6;
  string expires_at = 7;
  string last_ip_address = 8;
}
```

**Example (C#):**
```csharp
var response = await client.GetSessionsAsync(new Empty(), callOptions);

Console.WriteLine($"Active sessions: {response.Sessions.Count}");
foreach (var session in response.Sessions)
{
    Console.WriteLine($"ID: {session.Id}");
    Console.WriteLine($"  Device: {session.DeviceName} ({session.DeviceOsType})");
    Console.WriteLine($"  Last Used: {session.LastUsedAt}");
    Console.WriteLine($"  IP: {session.LastIpAddress}");
    Console.WriteLine($"  Expires: {session.ExpiresAt}");
}
```

---

#### RevokeSession

Revokes a specific session by ID, effectively logging out that device.

**Request:** `RevokeSessionRequest`
```protobuf
message RevokeSessionRequest {
  string session_id = 1;
}
```

**Response:** `google.protobuf.Empty`

**Example (C#):**
```csharp
var request = new RevokeSessionRequest { SessionId = "session-abc-123" };
await client.RevokeSessionAsync(request, callOptions);
Console.WriteLine("Session revoked successfully");
```

**Use Cases:**
- Remote logout of lost or stolen devices
- Logout from public computers you forgot to logout from
- Terminate suspicious sessions

---

#### RevokeOtherSessions

Revokes all sessions except the current one. Useful after password changes or when you suspect unauthorized access.

**Request:** `google.protobuf.Empty`

**Response:** `google.protobuf.Empty`

**Example (C#):**
```csharp
await client.RevokeOtherSessionsAsync(new Empty(), callOptions);
Console.WriteLine("All other sessions have been logged out");
```

**Use Cases:**
- After changing password
- When you suspect account compromise
- When you want to ensure only your current device has access

---

### Backup Management

#### BackupGetAll

Lists all backup configurations.

**Request:** `google.protobuf.Empty`

**Response:** `BackupList`
```protobuf
message BackupList {
  repeated BackupStatus backups = 1;
}

message BackupStatus {
  enum Status {
    Idle = 0;
    WalkingThrough = 1;
    Error = 2;
    Disabled = 3;
    Scanned = 4;
    Finished = 5;
  }
  Backup backup = 1;
  Status status = 2;
  string statusMessage = 3;
  // ... additional fields
}
```

---

#### BackupGetStatus

Gets status of a specific backup.

**Request:** `StringValue` (source path)

**Response:** `BackupStatus`

---

#### BackupAdd

Adds a new backup configuration.

**Request:** `Backup`
```protobuf
message Backup {
  string sourcePath = 1;
  repeated BackupDestination destinations = 2;
  repeated FileBackupRule fileBackupRules = 3;
  FileReplaceRule fileReplaceRule = 4;
  FileDeleteRule fileDeleteRule = 5;
  FileCompletionRule fileCompletionRule = 13;
  bool isEnabled = 6;
  bool fileSystemWatchEnabled = 7;
  int64 walkingThroughIntervalSecs = 8;
  bool forceWalkingThroughOnStart = 9;
  repeated TimeSchedule timeSchedules = 10;
  bool isTimeSchedulesEnabled = 11;
    bool syncDeleteFromDest = 14; // mirror destination deletions during full scan
    optional bool dontStartScanAfterAdd = 15; // if true, don't auto-start full scan after adding backup
}
```

Enable `syncDeleteFromDest` to have CloudDrive prune destination files or folders that no longer exist at the source during a full walk-through. The server applies the existing delete rule (keep, recycle, move to history, etc.), which lets you implement mirror-style backups entirely via the API.

Set `dontStartScanAfterAdd` to `true` to skip the automatic full scan when a new backup is added. By default (unset or `false`), a full scan starts immediately after the backup is created.

**Response:** `google.protobuf.Empty`

---

#### BackupRemove

Removes a backup by source path.

**Request:** `StringValue` (source path)

**Response:** `google.protobuf.Empty`

---

#### BackupUpdate

Updates a backup configuration.

**Request:** `Backup`

**Response:** `google.protobuf.Empty`

---

#### BackupSetEnabled

Enables or disables a backup.

**Request:** `BackupSetEnabledRequest`
```protobuf
message BackupSetEnabledRequest {
  string sourcePath = 1;
  bool isEnabled = 2;
}
```

**Response:** `google.protobuf.Empty`

---

#### BackupRestartWalkingThrough

Restarts backup scanning.

**Request:** `StringValue` (source path)

**Response:** `google.protobuf.Empty`

---

#### CanAddMoreBackups

Checks if user can add more backups.

**Request:** `google.protobuf.Empty`

**Response:** `FileOperationResult`

---

#### NotifyPhotoLibraryChanges

Notifies CloudDrive about photo library changes for backup (iOS/mobile platform integration).

**Request:** `PhotoLibraryChangeList`
```protobuf
message PhotoLibraryChange {
  enum ChangeType {
    Create = 0;
    Delete = 1;
  }
  ChangeType changeType = 1;
  string localFilePath = 2;        // Path in app's sandbox where photo was exported
  string originalIdentifier = 3;   // PHAsset localIdentifier for tracking
  optional string originalFileName = 4;
  optional google.protobuf.Timestamp creationDate = 5;
}

message PhotoLibraryChangeList {
  repeated PhotoLibraryChange changes = 1;
  string backupSourcePath = 2;     // The backup source path to notify (e.g., "Photos")
}
```

**Response:** `google.protobuf.Empty`

**New in 0.9.18:** Enables iOS apps to push photo library changes to CloudDrive for automatic backup.

---

### WebDAV Management

#### GetDavServerConfig

Gets WebDAV server configuration.

**Request:** `google.protobuf.Empty`

**Response:** `DavServerConfig`
```protobuf
message DavServerConfig {
  bool davServerEnabled = 1;
  string davServerPath = 2;
  bool enableClouddriveAccount = 3;
  string clouddriveAccountRootPath = 4;
  bool clouddriveAccountReadOnly = 5;
  bool enableAnonymousAccess = 6;
  string anonymousRootPath = 7;
  bool anonymousReadOnly = 8;
  repeated DavUser users = 9;
  bool enableAccessLog = 10;
}
```

---

#### SetDavServerConfig

Updates WebDAV server configuration.

**Request:** `ModifyDavServerConfigRequest`

**Response:** `google.protobuf.Empty`

---

#### AddDavUser

Adds a WebDAV user.

**Request:** `AddDavUserRequest`
```protobuf
message AddDavUserRequest {
  string userName = 1;
  string password = 2;
  optional string rootPath = 3;
  optional bool readOnly = 4;
  optional bool enabled = 5;
  optional bool guest = 6;
}
```

**Response:** `google.protobuf.Empty`

---

#### RemoveDavUser

Removes a WebDAV user.

**Request:** `StringValue` (username)

**Response:** `google.protobuf.Empty`

---

#### ModifyDavUser

Modifies WebDAV user settings.

**Request:** `ModifyDavUserRequest`

**Response:** `google.protobuf.Empty`

---

#### GetDavUser

Gets WebDAV user by username.

**Request:** `StringValue` (username)

**Response:** `DavUser`

---

### Token Management

#### CreateToken

Creates a new API token (admin only).

**Request:** `CreateTokenRequest`
```protobuf
message CreateTokenRequest {
  string rootDir = 1;
  TokenPermissions permissions = 2;
  string friendly_name = 3;
  optional uint64 expires_in = 4; // seconds, 0 = never expires
  optional bool enableGrpcLog = 5;
  optional bool enableStreamFileLog = 6;
}
```

**Response:** `TokenInfo`

---

#### ModifyToken

Modifies an existing API token.

**Request:** `ModifyTokenRequest`

**Response:** `TokenInfo`

---

#### RemoveToken

Removes an API token.

**Request:** `StringValue` (token)

**Response:** `google.protobuf.Empty`

---

#### ListTokens

Lists all API tokens.

**Request:** `google.protobuf.Empty`

**Response:** `ListTokensResult`

---

### Push Notifications

#### PushMessage (Server Streaming)

Subscribes to real-time push notifications from the CloudDrive server. This is a server-streaming RPC that continuously sends events to clients for real-time monitoring and UI updates.

**Request:** `google.protobuf.Empty`

**Response Stream:** `CloudDrivePushMessage`
```protobuf
message CloudDrivePushMessage {
  enum MessageType {
    DOWNLOADER_COUNT = 0;      // Download task count changed
    UPLOADER_COUNT = 1;        // Upload task count changed
    UPDATE_STATUS = 2;         // System update status changed
    FORCE_EXIT = 3;            // Server requests client logout
    FILE_SYSTEM_CHANGE = 4;    // File/folder modified
    MOUNT_POINT_CHANGE = 5;    // Mount points changed
    COPY_TASK_COUNT = 6;       // Copy/move task count changed
    LOG_MESSAGE = 7;           // Server log message
    MERGE_TASKS = 8;           // Folder merge task update
  }
  MessageType messageType = 1;
  oneof data {
    TransferTaskStatus transferTaskStatus = 2;
    UpdateStatus updateStatus = 3;
    ExitedMessage exitedMessage = 4;
    FileSystemChange fileSystemChange = 5;
    MountPointChange mountPointChange = 6;
    LogMessage logMessage = 7;
    MergeTaskUpdate mergeTaskUpdate = 8;
  }
}
```

### Message Types Detailed

#### 1. DOWNLOADER_COUNT / UPLOADER_COUNT / COPY_TASK_COUNT

**Purpose**: Notify clients when transfer task counts change (downloads, uploads, or copy/move tasks)

**Data**: `TransferTaskStatus`
- `downloadCount`: Number of active download tasks
- `uploadCount`: Number of active upload tasks
- `copyTaskCount`: Number of active copy/move folder tasks
- `clouddriveVersion`: Server version string
- `hasUpdate`: Whether a system update is available

**Use Case**: Update dashboard UI to show active task counts in real-time

**Example**:
```csharp
case CloudDrivePushMessage.Types.MessageType.UploaderCount:
case CloudDrivePushMessage.Types.MessageType.DownloaderCount:
case CloudDrivePushMessage.Types.MessageType.CopyTaskCount:
    var taskStatus = message.TransferTaskStatus;
    Console.WriteLine($"Tasks - Downloads: {taskStatus.DownloadCount}, " +
                     $"Uploads: {taskStatus.UploadCount}, " +
                     $"Copy: {taskStatus.CopyTaskCount}");

    // Update UI badges/counters
    UpdateTaskCountBadges(taskStatus);
    break;
```

#### 2. UPDATE_STATUS

**Purpose**: Notify clients about system update progress and availability

**Data**: `UpdateStatus`
- `updatePhase`: Current update phase (NoUpdate, Downloading, ReadyToUpdate, Updating, UpdateSuccess, UpdateFailed)
- `message`: Human-readable status message
- `newVersion`: Version number of available update
- `downloadedBytes`: Bytes downloaded so far (during download phase)
- `totalBytes`: Total bytes to download
- `clouddriveVersion`: Current server version

**Use Case**: Show update progress, notify users when update is ready to install

**Example**:
```csharp
case CloudDrivePushMessage.Types.MessageType.UpdateStatus:
    var updateStatus = message.UpdateStatus;

    switch (updateStatus.UpdatePhase)
    {
        case UpdateStatus.Types.UpdatePhase.Downloading:
            var progress = (updateStatus.DownloadedBytes * 100) / updateStatus.TotalBytes;
            Console.WriteLine($"Downloading update: {progress}% " +
                            $"({FormatBytes(updateStatus.DownloadedBytes)} / " +
                            $"{FormatBytes(updateStatus.TotalBytes)})");
            break;

        case UpdateStatus.Types.UpdatePhase.ReadyToUpdate:
            Console.WriteLine($"Update {updateStatus.NewVersion} ready to install!");
            ShowUpdateNotification(updateStatus.NewVersion);
            break;

        case UpdateStatus.Types.UpdatePhase.UpdateSuccess:
            Console.WriteLine("Update installed! Server will restart...");
            // Schedule page reload
            SchedulePageReload(10000);
            break;

        case UpdateStatus.Types.UpdatePhase.UpdateFailed:
            Console.WriteLine($"Update failed: {updateStatus.Message}");
            break;
    }
    break;
```

#### 3. FORCE_EXIT

**Purpose**: Server requests all clients to immediately logout (e.g., server shutdown, admin forced logout)

**Data**: `ExitedMessage`
- `message`: Reason for forced exit

**Use Case**: Handle server shutdown gracefully, force user re-authentication

**Example**:
```csharp
case CloudDrivePushMessage.Types.MessageType.ForceExit:
    var exitMessage = message.ExitedMessage;
    Console.WriteLine($"Forced logout: {exitMessage.Message}");

    // Clear authentication
    await authService.ClearAllLocalStorageAsync();
    await authService.RemoveTokenAsync();

    // Redirect to login
    navigationManager.NavigateTo("/login", forceLoad: true);
    break;
```

#### 4. FILE_SYSTEM_CHANGE

**Purpose**: Notify clients when files or folders are created, modified, moved, or deleted

**Data**: `FileSystemChange`
- `path`: Path of changed file/folder
- `changeType`: Type of change (Created, Modified, Deleted, Renamed, Moved)
- `oldPath`: Previous path (for rename/move operations)
- `isDirectory`: Whether the item is a directory

**Use Case**: Refresh file lists, update file explorer UI in real-time

**Example**:
```csharp
case CloudDrivePushMessage.Types.MessageType.FileSystemChange:
    var fsChange = message.FileSystemChange;

    switch (fsChange.ChangeType)
    {
        case FileSystemChange.Types.ChangeType.Created:
            Console.WriteLine($"New {(fsChange.IsDirectory ? "folder" : "file")} created: {fsChange.Path}");
            // Refresh current directory if we're viewing the parent
            if (IsViewingParentDirectory(fsChange.Path))
            {
                await RefreshCurrentDirectory();
            }
            break;

        case FileSystemChange.Types.ChangeType.Deleted:
            Console.WriteLine($"Deleted: {fsChange.Path}");
            // Remove from UI if visible
            RemoveFileFromUI(fsChange.Path);
            break;

        case FileSystemChange.Types.ChangeType.Moved:
        case FileSystemChange.Types.ChangeType.Renamed:
            Console.WriteLine($"Moved/Renamed: {fsChange.OldPath} -> {fsChange.Path}");
            // Update UI
            UpdateFileInUI(fsChange.OldPath, fsChange.Path);
            break;
    }
    break;
```

#### 5. MOUNT_POINT_CHANGE

**Purpose**: Notify clients when mount points are added, removed, mounted, or unmounted

**Data**: `MountPointChange`
- `mountPoint`: Mount point path that changed
- `changeType`: Type of change (Added, Removed, Mounted, Unmounted)
- `errorMessage`: Error message if mount/unmount failed

**Use Case**: Update mount point list, show mount status changes

**Example**:
```csharp
case CloudDrivePushMessage.Types.MessageType.MountPointChange:
    var mpChange = message.MountPointChange;
    Console.WriteLine($"Mount point {mpChange.ChangeType}: {mpChange.MountPoint}");

    // Refresh mount points list
    await RefreshMountPointsList();

    if (!string.IsNullOrEmpty(mpChange.ErrorMessage))
    {
        ShowError($"Mount error: {mpChange.ErrorMessage}");
    }
    break;
```

#### 6. LOG_MESSAGE

**Purpose**: Stream server log messages to clients for debugging and monitoring

**Data**: `LogMessage`
- `level`: Log level (Trace, Debug, Info, Warn, Error, Fatal)
- `message`: Log message content
- `source`: Log source/category
- `timestamp`: When the log was created
- `fields`: Additional structured log fields (key-value pairs)

**Use Case**: Real-time log viewer, debugging, monitoring server activity

**Example**:
```csharp
case CloudDrivePushMessage.Types.MessageType.LogMessage:
    var logMsg = message.LogMessage;

    var logLevel = logMsg.Level switch
    {
        LogMessage.Types.LogLevel.Error => "ERROR",
        LogMessage.Types.LogLevel.Warn => "WARN",
        LogMessage.Types.LogLevel.Info => "INFO",
        LogMessage.Types.LogLevel.Debug => "DEBUG",
        _ => "TRACE"
    };

    Console.WriteLine($"[{logMsg.Timestamp.ToDateTime():HH:mm:ss}] " +
                     $"[{logLevel}] [{logMsg.Source}] {logMsg.Message}");

    // Add to log viewer UI
    logViewer.AddLogEntry(logMsg);
    break;
```

#### 7. MERGE_TASKS

**Purpose**: Notify clients about folder merge task progress (recursive folder copy/move operations)

**Data**: `MergeTaskUpdate`
- `mergeTasks`: List of active merge tasks with details:
  - `sourcePath`: Source folder path
  - `destPath`: Destination folder path
  - `status`: Task status (Pending, Running, Completed, Failed, Cancelled)
  - `operationType`: Move or Copy operation
  - `conflictPolicy`: How to handle conflicts (Overwrite, Rename, Skip)
  - `mergedFolders`: Number of folders merged
  - `mergedFiles`: Number of files merged
  - `totalFolders`: Total folders to merge
  - `totalFiles`: Total files to merge
  - `errorMessage`: Error details if failed

**Use Case**: Show progress bars for long-running folder operations, display merge task status

**Example**:
```csharp
case CloudDrivePushMessage.Types.MessageType.MergeTasks:
    var mergeTasks = message.MergeTaskUpdate.MergeTasks;

    foreach (var task in mergeTasks)
    {
        var operation = task.OperationType == MergeTask.Types.OperationType.Copy ? "Copying" : "Moving";
        var progress = task.TotalFiles > 0
            ? (task.MergedFiles * 100) / task.TotalFiles
            : 0;

        Console.WriteLine($"{operation}: {GetFolderName(task.SourcePath)} -> {task.DestPath}");
        Console.WriteLine($"Progress: {task.MergedFiles}/{task.TotalFiles} files ({progress}%)");
        Console.WriteLine($"Status: {task.Status}");

        if (task.Status == MergeTask.Types.TaskStatus.Failed)
        {
            Console.WriteLine($"Error: {task.ErrorMessage}");
        }

        // Update progress UI
        UpdateMergeTaskProgress(task);

        // Remove completed tasks from UI
        if (task.Status == MergeTask.Types.TaskStatus.Completed ||
            task.Status == MergeTask.Types.TaskStatus.Failed ||
            task.Status == MergeTask.Types.TaskStatus.Cancelled)
        {
            RemoveMergeTaskFromUI(task);
        }
    }
    break;
```

### Complete Push Message Example

```csharp
public async Task MonitorPushMessagesAsync(CancellationToken cancellationToken)
{
    var callOptions = CreateAuthorizedCallOptions(cancellationToken);
    using var call = client.PushMessage(new Empty(), callOptions);

    await foreach (var message in call.ResponseStream.ReadAllAsync(cancellationToken))
    {
        try
        {
            switch (message.MessageType)
            {
                case CloudDrivePushMessage.Types.MessageType.FileSystemChange:
                    HandleFileSystemChange(message.FileSystemChange);
                    break;

                case CloudDrivePushMessage.Types.MessageType.DownloaderCount:
                case CloudDrivePushMessage.Types.MessageType.UploaderCount:
                case CloudDrivePushMessage.Types.MessageType.CopyTaskCount:
                    HandleTaskCountUpdate(message.TransferTaskStatus);
                    break;

                case CloudDrivePushMessage.Types.MessageType.UpdateStatus:
                    HandleUpdateStatus(message.UpdateStatus);
                    break;

                case CloudDrivePushMessage.Types.MessageType.ForceExit:
                    await HandleForceExit(message.ExitedMessage);
                    break;

                case CloudDrivePushMessage.Types.MessageType.MountPointChange:
                    HandleMountPointChange(message.MountPointChange);
                    break;

                case CloudDrivePushMessage.Types.MessageType.LogMessage:
                    HandleLogMessage(message.LogMessage);
                    break;

                case CloudDrivePushMessage.Types.MessageType.MergeTasks:
                    HandleMergeTasks(message.MergeTaskUpdate);
                    break;
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error handling push message: {ex.Message}");
        }
    }
}
```

**Best Practices for Push Messages**:
1. **Reconnection Logic**: Implement automatic reconnection with exponential backoff when stream disconnects
2. **Error Handling**: Wrap message processing in try-catch to prevent one error from stopping the stream
3. **Background Processing**: Handle messages on background thread to avoid blocking the stream
4. **UI Thread**: Marshal UI updates to the UI thread in GUI applications
5. **Cancellation**: Support graceful cancellation with CancellationToken
6. **Resource Cleanup**: Properly dispose streaming calls when done

---

### Remote Upload Protocol

The Remote Upload Protocol enables clients to upload files to the CloudDrive server through a coordinated request-response workflow. The server requests file data and hashes from the client as needed, making it ideal for browser-based and other clients without direct file system access.

#### Protocol Overview

**RPCs:**
- **StartRemoteUpload** (unary) - Request: `StartRemoteUploadRequest`, Response: `RemoteUploadStarted`
- **RemoteUploadChannel** (server-side streaming) - Request: `RemoteUploadChannelRequest`, Response: `RemoteUploadChannelReply`
- **RemoteReadData** (unary) - Request: `RemoteReadDataUpload`, Response: `RemoteReadDataReply`
- **RemoteHashProgress** (unary) - Request: `RemoteHashProgressUpload`, Response: `RemoteHashProgressReply`
- **RemoteUploadControl** (unary) - Request: `RemoteUploadControlRequest`, Response: `google.protobuf.Empty`

**Key Protocol Notes:**
- All operations are keyed by server-provided `upload_id` (returned from `StartRemoteUpload`)
- `RemoteUploadChannel` requests must include stable `device_id` that uniquely identifies the client device
- Reuse `device_id` across restarts so the server can replace the channel and replay pending work
- Server requests for hashing may include optional `block_size` (MD5-only) to request per-block MD5s
- Final hash value (and block hashes) must be delivered via `RemoteHashProgress`
- Client-side control (pause/resume/cancel) is sent via `RemoteUploadControl`
- Status changes are observed on the stream via `RemoteUploadStatusChanged`

#### Message Contracts

**StartRemoteUploadRequest:**
- `file_path`: string - desired path on server
- `file_size`: uint64 - total bytes
- `known_hashes`: map<uint32, string> - optional precomputed file hashes (keys: 1=MD5, 2=SHA1, 3=PIKPAK_SHA1)

**RemoteUploadChannelRequest:**
- `device_id`: string - stable identifier for the client device (reuse across process restarts)

**RemoteUploadChannelReply:**
- `upload_id`: string
- `oneof request`:
  - `read_data`: RemoteReadDataRequest (offset, length, lazy_read)
  - `hash_data`: RemoteHashDataRequest (hash_type, block_size)
  - `status_changed`: RemoteUploadStatusChanged (status, error_message)

**RemoteReadDataUpload:**
- `upload_id`: string
- `offset`: uint64
- `length`: uint64
- `lazy_read`: bool
- `data`: bytes
- `is_last_chunk`: bool

**RemoteHashProgressUpload:**
- `upload_id`: string
- `bytes_hashed`: uint64 - cumulative progress
- `total_bytes`: uint64 - file size
- `hash_type`: HashType
- `hash_value`: string (optional; present only on final progress message)
- `block_hashes`: repeated string (optional; MD5-only; when block_size > 0)

#### Client Workflow

**1. Start the upload:**
- Call `StartRemoteUpload` with `file_path` and `file_size`
- Use returned `upload_id` for all subsequent RPCs

**2. Open the global channel:**
- Call `RemoteUploadChannel` once per client session and keep it open
- Supply the same `device_id` every time you connect (even after restarting)
- Server uses `device_id` to swap in newest stream and replay outstanding requests
- Server will push `RemoteReadDataRequest`, `RemoteHashDataRequest`, and `RemoteUploadStatusChanged` messages

**3. Serve read requests:**
- Upon `RemoteReadDataRequest`, read the requested range from local file
- Call `RemoteReadData` with the bytes
- Set `is_last_chunk` when sending final portion

**4. Serve hash requests (with progress and finalization):**
- Upon `RemoteHashDataRequest`:
  - Determine algorithm from `hash_type`
  - If `hash_type == MD5` and `block_size > 0`, compute both file MD5 and per-block MD5s (lower-hex, in order)
  - For other algorithms (SHA1, PikPakSha1), compute only the file hash
  - While hashing, periodically call `RemoteHashProgress` with current `bytes_hashed`
  - When complete (or canceled), send final `RemoteHashProgress`:
    - Set `hash_value` to final file hash when successful
    - For MD5 with `block_size > 0`, include `block_hashes` (lower-hex, ordered)
    - If canceled, send terminal progress without `hash_value`

**5. Handle completion:**
- Server sends `RemoteUploadStatusChanged` with terminal state (Finish, Skipped, Cancelled, Error, FatalError)
- Clean up local state for that upload, but keep channel open for other uploads

**6. Control operations:**
- Use `RemoteUploadControl` to pause, resume, or cancel specific `upload_id`
- Status changes are streamed as `RemoteUploadStatusChanged` on the channel
- Control RPC returns Empty on success (errors via gRPC status)

#### Hashing Details

**Supported Algorithms:**
- MD5, SHA1, PikPakSha1
- Server indicates desired algorithm via `RemoteHashDataRequest.hash_type`

**MD5 Block Hashes (optional):**
- Server may request block hashes by providing `block_size` in `RemoteHashDataRequest` (MD5-only)
- Compute per-block MD5 digests over contiguous, non-overlapping blocks of size `block_size` (final block may be smaller)
- Represent each digest as 32-char lower-hex string
- Final `RemoteHashProgress` must include both `hash_value` (file's MD5) and `block_hashes` (ordered list) when `block_size > 0`

**Zero-Length Files:**
- File hash is algorithm's digest of empty byte stream (e.g., MD5 of empty string)
- `block_hashes` should be omitted/empty unless otherwise directed

**PikPakSha1 Algorithm:**

PikPakSha1 is a two-level hash (not plain SHA-1):
1. Split file into segments using dynamic segment size based on total file size:
   - size ≤ 128 MiB: 256 KiB segments
   - 128 MiB < size ≤ 256 MiB: 512 KiB segments
   - 256 MiB < size ≤ 512 MiB: 1024 KiB segments
   - size > 512 MiB: 2048 KiB segments
2. For each segment, compute SHA-1 over segment bytes (produces 20-byte digest)
3. Concatenate per-segment digests (in order) and compute final SHA-1 over concatenation
4. Output final digest as UPPERCASE hex

*Note:* PikPakSha1 does not use `block_size` from `RemoteHashDataRequest`; ignore that field for this algorithm.

#### Progress Semantics and Reliability

**Progress Cadence:**
- Send `RemoteHashProgress` periodically during hashing with increasing `bytes_hashed`
- Balance responsiveness and overhead (e.g., every few hundred milliseconds or meaningful byte increments)

**Finalization:**
- Server treats final `RemoteHashProgress` (where `hash_value` is present, and `block_hashes` if requested) as terminal event for that (`upload_id`, `hash_type`)

**Duplicate Requests:**
- If server observes no `RemoteHashProgress` for ~60 seconds, it may re-send the corresponding `RemoteHashDataRequest`
- Clients must handle re-requests idempotently (ignore if already in progress, or continue hashing)

**Client Restarts:**
- When client reconnects with same `device_id`, server transparently replaces old `RemoteUploadChannel`
- Server replays any outstanding `RemoteReadDataRequest` or `RemoteHashDataRequest` messages
- Keep local upload state keyed by `upload_id` to resume work immediately

**Cancellation:**
- If upload (or specific hash request) is canceled, stop work promptly
- Send terminal `RemoteHashProgress` without `hash_value`
- Server will clean up state accordingly

#### Example Sequence Diagram

```
Client                                Server
  |-- StartRemoteUploadRequest -------> |
  |<-- RemoteUploadStarted ------------ |
  |-- RemoteUploadChannel (stream) ---> |
  |<-- RemoteReadDataRequest ---------- |
  |-- RemoteReadData (chunk) ---------> |
  |<-- RemoteReadDataReply ------------ |
  |<-- RemoteHashDataRequest ---------- |
  |== compute hash locally ============|
  |-- RemoteHashProgress (progress) --> |
  |-- RemoteHashProgress (final) -----> |
  |<-- RemoteHashProgressReply -------- |
  |<-- RemoteUploadStatusChanged ------- |
  |-- RemoteUploadControl (pause/cancel)|
```

#### Implementation Outline

**Recommended Client Architecture:**
- Maintain single `RemoteUploadChannel` stream per session with small dispatcher to handle incoming requests
- Provide stable `device_id` when connecting `RemoteUploadChannel`; persist locally so reconnects map to same server-side device entry
- For each `RemoteHashDataRequest`, spawn hashing task keyed by (`upload_id`, `hash_type`) to avoid blocking stream reader
- Use cancellation token tied to `upload_id` to stop hashing promptly when canceled
- Throttle `RemoteHashProgress` updates to reasonable rate; always send terminal progress with `hash_value` (and `block_hashes` for MD5 when requested)
- Treat repeated `RemoteHashDataRequest` for same (`upload_id`, `hash_type`) as hints to resume/continue reporting progress

#### Code Examples

The following examples illustrate minimal client flow. Integrate with your own job/cancellation framework.

**C# Example (Grpc.Net.Client):**

```csharp
// Pseudocode — assumes generated gRPC client types exist.
using System;
using System.Buffers;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Threading;
using System.Threading.Tasks;

async Task UploadClientAsync(CloudDrive.CloudDriveClient client, string path, long size, CancellationToken ct)
{
    var started = await client.StartRemoteUploadAsync(new StartRemoteUploadRequest {
        FilePath = path,
        FileSize = (ulong)size
    }, cancellationToken: ct);
    var files = new ConcurrentDictionary<string, (string path, long size)>();
    files[started.UploadId] = (path, size);

  var deviceId = MachineIdProvider.Current; // stable per-device identifier
  using var channel = client.RemoteUploadChannel(new RemoteUploadChannelRequest { DeviceId = deviceId }, cancellationToken: ct);
    await foreach (var msg in channel.ResponseStream.ReadAllAsync(ct))
    {
        var uploadId = msg.UploadId;
        switch (msg.ReplyCase)
        {
            case RemoteUploadChannelReply.ReplyOneofCase.ReadData:
                _ = HandleReadAsync(client, uploadId, msg.ReadData, files, ct);
                break;
            case RemoteUploadChannelReply.ReplyOneofCase.HashData:
                _ = Task.Run(() => HandleHashAsync(client, uploadId, msg.HashData, files, ct), ct);
                break;
            case RemoteUploadChannelReply.ReplyOneofCase.StatusChanged:
                // observe completion/state if needed via msg.StatusChanged
                break;
        }
    }
}

async Task HandleReadAsync(CloudDrive.CloudDriveClient client, string uploadId, RemoteReadDataRequest req,
                           ConcurrentDictionary<string,(string path,long size)> files, CancellationToken ct)
{
    var (localPath, totalSize) = files[uploadId];
    using var fs = File.OpenRead(localPath);
    fs.Position = (long)req.Offset;
    byte[] buffer = ArrayPool<byte>.Shared.Rent((int)req.Length);
    try
    {
        int read = await fs.ReadAsync(buffer.AsMemory(0, (int)req.Length), ct);
        bool isLast = (ulong)req.Offset + (ulong)Math.Max(0, read) >= (ulong)totalSize;
        await client.RemoteReadDataAsync(new RemoteReadDataUpload {
            UploadId = uploadId,
            Offset = req.Offset,
            Length = (ulong)Math.Max(0, read),
            LazyRead = req.LazyRead,
            Data = Google.Protobuf.ByteString.CopyFrom(buffer, 0, Math.Max(0, read)),
            IsLastChunk = isLast
        }, cancellationToken: ct);
    }
    finally { ArrayPool<byte>.Shared.Return(buffer); }
}

async Task HandleHashAsync(CloudDrive.CloudDriveClient client, string uploadId, RemoteHashDataRequest req,
                           ConcurrentDictionary<string,(string path,long size)> files, CancellationToken ct)
{
    var (localPath, totalSize) = files[uploadId];
    ulong bytesHashed = 0;
    DateTime lastReport = DateTime.UtcNow;

    void report(bool isFinal, string? hashValue = null, List<string>? blockHashes = null)
    {
        if (!isFinal && (DateTime.UtcNow - lastReport).TotalMilliseconds < 250) return;
        lastReport = DateTime.UtcNow;
        client.RemoteHashProgress(new RemoteHashProgressUpload {
            UploadId = uploadId,
            TotalBytes = (ulong)totalSize,
            HashType = req.HashType,
            BytesHashed = bytesHashed,
            HashValue = hashValue ?? string.Empty,
            BlockHashes = { blockHashes ?? new List<string>() }
        });
    }

  using var fs = File.OpenRead(localPath);
  if (req.HashType == HashType.Md5 && req.BlockSize > 0)
    {
        using var md5File = MD5.Create();
        var blocks = new List<string>();
        byte[] block = new byte[req.BlockSize];
        int n;
        while ((n = await fs.ReadAsync(block, 0, block.Length, ct)) > 0)
        {
            md5File.TransformBlock(block, 0, n, null, 0);
            using var md5 = MD5.Create();
            blocks.Add(Convert.ToHexString(md5.ComputeHash(block, 0, n)).ToLowerInvariant());
            bytesHashed += (ulong)n;
            report(false);
            if (ct.IsCancellationRequested) { report(true); return; }
        }
        md5File.TransformFinalBlock(Array.Empty<byte>(), 0, 0);
        report(true, Convert.ToHexString(md5File.Hash!).ToLowerInvariant(), blocks);
  }
  else if (req.HashType == HashType.PikPakSha1)
  {
    // PikPakSha1: SHA1 over concatenation of per-segment SHA1 digests; dynamic segment size
    int segSize = totalSize <= (128L<<20) ? (256<<10) :
            (totalSize <= (256L<<20) ? (512<<10) :
            (totalSize <= (512L<<20) ? (1024<<10) : (2048<<10)));
    using var finalSha1 = SHA1.Create();
    byte[] buf = new byte[segSize];
    int n;
    while ((n = await fs.ReadAsync(buf, 0, buf.Length, ct)) > 0)
    {
      using var seg = SHA1.Create();
      seg.TransformBlock(buf, 0, n, null, 0);
      seg.TransformFinalBlock(Array.Empty<byte>(), 0, 0);
      finalSha1.TransformBlock(seg.Hash!, 0, seg.Hash!.Length, null, 0);
      bytesHashed += (ulong)n;
      report(false);
      if (ct.IsCancellationRequested) { report(true); return; }
    }
    finalSha1.TransformFinalBlock(Array.Empty<byte>(), 0, 0);
    report(true, Convert.ToHexString(finalSha1.Hash!).ToUpperInvariant());
  }
  else
    {
        using var hash = req.HashType == HashType.Sha1 ? SHA1.Create() : MD5.Create();
        byte[] buf = new byte[1 << 20];
        int n;
        while ((n = await fs.ReadAsync(buf, 0, buf.Length, ct)) > 0)
        {
            hash.TransformBlock(buf, 0, n, null, 0);
            bytesHashed += (ulong)n;
            report(false);
            if (ct.IsCancellationRequested) { report(true); return; }
        }
        hash.TransformFinalBlock(Array.Empty<byte>(), 0, 0);
        report(true, Convert.ToHexString(hash.Hash!).ToLowerInvariant());
    }
}
```

### Java (grpc-java)

```java
// Pseudocode — assumes generated stubs exist.
void startUpload(CloudDriveGrpc.CloudDriveBlockingStub blocking,
                 CloudDriveGrpc.CloudDriveStub async,
                 String path, long size, Context.CancellableContext ctx) {
  StartRemoteUploadRequest sreq = StartRemoteUploadRequest.newBuilder()
      .setFilePath(path).setFileSize(size).build();
  RemoteUploadStarted started = blocking.startRemoteUpload(sreq);
  Map<String, LocalFile> files = new ConcurrentHashMap<>();
  files.put(started.getUploadId(), new LocalFile(path, size));

  String deviceId = MachineIdProvider.get();
  RemoteUploadChannelRequest channelReq = RemoteUploadChannelRequest.newBuilder()
      .setDeviceId(deviceId)
      .build();
  async.remoteUploadChannel(channelReq, new StreamObserver<RemoteUploadChannelReply>() {
    @Override public void onNext(RemoteUploadChannelReply msg) {
      String uploadId = msg.getUploadId();
      switch (msg.getReplyCase()) {
        case READDATA:
          handleRead(blocking, uploadId, msg.getReadData(), files);
          break;
        case HASHDATA:
          CompletableFuture.runAsync(() -> handleHash(blocking, uploadId, msg.getHashData(), files, ctx));
          break;
        case STATUSCHANGED:
          // observe completion via status
          break;
        default: break;
      }
    }
    @Override public void onError(Throwable t) { }
    @Override public void onCompleted() { }
  });
}

void handleRead(CloudDriveGrpc.CloudDriveBlockingStub blocking, String uploadId, RemoteReadDataRequest req, Map<String, LocalFile> files) {
  try (RandomAccessFile raf = new RandomAccessFile(files.get(uploadId).path, "r")) {
    raf.seek(req.getOffset());
    byte[] buf = new byte[(int)req.getLength()];
    int read = raf.read(buf);
    boolean isLast = req.getOffset() + Math.max(0, read) >= files.get(uploadId).size;
    RemoteReadDataUpload up = RemoteReadDataUpload.newBuilder()
        .setUploadId(uploadId)
        .setOffset(req.getOffset())
        .setLength(Math.max(0, read))
        .setLazyRead(req.getLazyRead())
        .setData(ByteString.copyFrom(buf, 0, Math.max(0, read)))
        .setIsLastChunk(isLast)
        .build();
    blocking.remoteReadData(up);
  } catch (IOException e) { }
}

void handleHash(CloudDriveGrpc.CloudDriveBlockingStub blocking, String uploadId, RemoteHashDataRequest req, Map<String, LocalFile> files, Context.CancellableContext ctx) {
  File f = new File(files.get(uploadId).path);
  long bytesHashed = 0L;
  try (FileInputStream fis = new FileInputStream(f)) {
  if (req.getHashType() == HashType.MD5 && req.getBlockSize() > 0) {
      MessageDigest fileMd5 = MessageDigest.getInstance("MD5");
      List<String> blocks = new ArrayList<>();
      byte[] block = new byte[req.getBlockSize()];
      int n;
      while ((n = fis.read(block)) > 0) {
        fileMd5.update(block, 0, n);
        MessageDigest md5 = MessageDigest.getInstance("MD5");
        md5.update(block, 0, n);
        blocks.add(bytesToHex(md5.digest()).toLowerCase());
        bytesHashed += n;
        maybeProgress(blocking, uploadId, req, f.length(), bytesHashed, null, null);
        if (ctx.isCancelled()) { finalProgress(blocking, uploadId, req, f.length(), bytesHashed, null, null); return; }
      }
      finalProgress(blocking, uploadId, req, f.length(), bytesHashed, bytesToHex(fileMd5.digest()).toLowerCase(), blocks);
    } else if (req.getHashType() == HashType.PIKPAKSHA1) {
      // PikPakSha1: SHA1 of concatenated per-segment SHA1 digests
      int segSize = f.length() <= (128L<<20) ? (256<<10) :
                    (f.length() <= (256L<<20) ? (512<<10) :
                    (f.length() <= (512L<<20) ? (1024<<10) : (2048<<10)));
      MessageDigest finalSha1;
      try { finalSha1 = MessageDigest.getInstance("SHA-1"); } catch (Exception e) { return; }
      byte[] buf = new byte[segSize];
      int n;
      try (BufferedInputStream bis = new BufferedInputStream(new FileInputStream(f))) {
        while ((n = bis.read(buf)) > 0) {
          MessageDigest seg = MessageDigest.getInstance("SHA-1");
          seg.update(buf, 0, n);
          byte[] segDigest = seg.digest();
          finalSha1.update(segDigest);
          bytesHashed += n;
          maybeProgress(blocking, uploadId, req, f.length(), bytesHashed, null, null);
          if (ctx.isCancelled()) { finalProgress(blocking, uploadId, req, f.length(), bytesHashed, null, null); return; }
        }
      } catch (IOException | NoSuchAlgorithmException e) { return; }
      finalProgress(blocking, uploadId, req, f.length(), bytesHashed, bytesToHex(finalSha1.digest()).toUpperCase(), null);
    } else {
      MessageDigest dig = req.getHashType() == HashType.SHA1 ? MessageDigest.getInstance("SHA-1") : MessageDigest.getInstance("MD5");
      byte[] buf = new byte[1 << 20];
      int n;
      while ((n = fis.read(buf)) > 0) {
        dig.update(buf, 0, n);
        bytesHashed += n;
        maybeProgress(blocking, uploadId, req, f.length(), bytesHashed, null, null);
        if (ctx.isCancelled()) { finalProgress(blocking, uploadId, req, f.length(), bytesHashed, null, null); return; }
      }
      finalProgress(blocking, uploadId, req, f.length(), bytesHashed, bytesToHex(dig.digest()).toLowerCase(), null);
    }
  } catch (Exception e) { }
}

void maybeProgress(CloudDriveGrpc.CloudDriveBlockingStub blocking, String uploadId, RemoteHashDataRequest req, long fileSize, long bytes,
                   String hash, List<String> blocks) {
  RemoteHashProgressUpload up = RemoteHashProgressUpload.newBuilder()
      .setUploadId(uploadId)
      .setTotalBytes(fileSize)
      .setHashType(req.getHashType())
      .setBytesHashed(bytes)
      .setHashValue(hash == null ? "" : hash)
      .addAllBlockHashes(blocks == null ? Collections.emptyList() : blocks)
      .build();
  blocking.remoteHashProgress(up);
}

void finalProgress(CloudDriveGrpc.CloudDriveBlockingStub blocking, String uploadId, RemoteHashDataRequest req, long fileSize, long bytes,
                   String hash, List<String> blocks) {
  RemoteHashProgressUpload up = RemoteHashProgressUpload.newBuilder()
      .setUploadId(uploadId)
      .setTotalBytes(fileSize)
      .setHashType(req.getHashType())
      .setBytesHashed(bytes)
      .setHashValue(hash == null ? "" : hash)
      .addAllBlockHashes(blocks == null ? Collections.emptyList() : blocks)
      .build();
  blocking.remoteHashProgress(up);
}
```

### Python (grpcio)

```python
# Pseudocode — assumes generated stubs and messages exist.
import hashlib, os, time

def upload_client(stub, path, size, cancel_event):
    started = stub.StartRemoteUpload(StartRemoteUploadRequest(file_path=path, file_size=size))
    files = {started.upload_id: {'path': path, 'size': size}}

  device_id = machine_id_provider()  # return a stable per-device identifier
  channel_request = RemoteUploadChannelRequest(device_id=device_id)

  for msg in stub.RemoteUploadChannel(channel_request):
        uid = msg.upload_id
        which = msg.WhichOneof('request')
        if which == 'read_data':
            handle_read(stub, uid, msg.read_data, files)
        elif which == 'hash_data':
            handle_hash(stub, uid, msg.hash_data, files, cancel_event)
        elif which == 'status_changed':
            pass

def handle_read(stub, upload_id, req, files):
    local = files[upload_id]
    with open(local['path'], 'rb') as f:
        f.seek(req.offset)
        data = f.read(req.length)
    is_last = (req.offset + len(data)) >= local['size']
    stub.RemoteReadData(RemoteReadDataUpload(
        upload_id=upload_id,
        offset=req.offset,
        length=len(data),
        lazy_read=req.lazy_read,
        data=data,
        is_last_chunk=is_last,
    ))

def handle_hash(stub, upload_id, req, files, cancel_event):
    local = files[upload_id]
    file_size = local['size']
    bytes_hashed = 0
    last_report = 0.0

    def progress(final=False, hash_value='', block_hashes=None):
        nonlocal last_report
        now = time.time()
        if not final and (now - last_report) < 0.25:
            return
        last_report = now
        stub.RemoteHashProgress(RemoteHashProgressUpload(
            upload_id=upload_id,
            bytes_hashed=bytes_hashed,
            total_bytes=file_size,
            hash_type=req.hash_type,
            hash_value=hash_value,
            block_hashes=block_hashes or [],
        ))

  with open(local['path'], 'rb') as f:
    if req.hash_type == HashType.MD5 and req.block_size > 0:
            md5_file = hashlib.md5()
            blocks = []
            while True:
                chunk = f.read(req.block_size)
                if not chunk:
                    break
                md5_file.update(chunk)
                blocks.append(hashlib.md5(chunk).hexdigest())
                bytes_hashed += len(chunk)
                progress()
                if cancel_event.is_set():
                    progress(final=True)
                    return
            progress(final=True, hash_value=md5_file.hexdigest(), block_hashes=blocks)
    elif req.hash_type == HashType.PIKPAKSHA1:
      # PikPakSha1: SHA1 over concatenation of per-segment SHA1 digests (upper hex)
      size = file_size
      if size <= (128 << 20):
        seg = 256 << 10
      elif size <= (256 << 20):
        seg = 512 << 10
      elif size <= (512 << 20):
        seg = 1024 << 10
      else:
        seg = 2048 << 10
      final = hashlib.sha1()
      while True:
        chunk = f.read(seg)
        if not chunk:
          break
        final.update(hashlib.sha1(chunk).digest())
        bytes_hashed += len(chunk)
        progress()
        if cancel_event.is_set():
          progress(final=True)
          return
      progress(final=True, hash_value=final.hexdigest().upper())
    else:
            dig = hashlib.sha1() if req.hash_type == HashType.SHA1 else hashlib.md5()
            while True:
                chunk = f.read(1 << 20)
                if not chunk:
                    break
                dig.update(chunk)
                bytes_hashed += len(chunk)
                progress()
                if cancel_event.is_set():
                    progress(final=True)
                    return
            progress(final=True, hash_value=dig.hexdigest())
```

**Go Example (google.golang.org/grpc):**

```go
// Pseudocode — assumes generated gRPC client types exist.
package main

import (
    "context"
    "crypto/md5"
    "crypto/sha1"
    "encoding/hex"
    "io"
    "os"
    "time"

    pb "your/package/clouddrive"
)

func uploadClient(client pb.CloudDriveClient, path string, size int64, ctx context.Context) error {
    // Start upload
    started, err := client.StartRemoteUpload(ctx, &pb.StartRemoteUploadRequest{
        FilePath: path,
        FileSize: uint64(size),
    })
    if err != nil {
        return err
    }

    files := make(map[string]*LocalFile)
    files[started.UploadId] = &LocalFile{path: path, size: size}

    // Open channel
    deviceId := getMachineId() // stable per-device identifier
    stream, err := client.RemoteUploadChannel(ctx, &pb.RemoteUploadChannelRequest{
        DeviceId: deviceId,
    })
    if err != nil {
        return err
    }

    // Handle incoming requests
    for {
        msg, err := stream.Recv()
        if err == io.EOF {
            break
        }
        if err != nil {
            return err
        }

        uploadId := msg.UploadId
        switch msg.Request.(type) {
        case *pb.RemoteUploadChannelReply_ReadData:
            go handleRead(client, uploadId, msg.GetReadData(), files, ctx)
        case *pb.RemoteUploadChannelReply_HashData:
            go handleHash(client, uploadId, msg.GetHashData(), files, ctx)
        case *pb.RemoteUploadChannelReply_StatusChanged:
            // observe completion via status
        }
    }

    return nil
}

type LocalFile struct {
    path string
    size int64
}

func handleRead(client pb.CloudDriveClient, uploadId string, req *pb.RemoteReadDataRequest,
                files map[string]*LocalFile, ctx context.Context) error {
    f, err := os.Open(files[uploadId].path)
    if err != nil {
        return err
    }
    defer f.Close()

    f.Seek(int64(req.Offset), 0)
    buf := make([]byte, req.Length)
    n, err := f.Read(buf)
    if err != nil && err != io.EOF {
        return err
    }

    isLast := req.Offset+uint64(n) >= uint64(files[uploadId].size)
    _, err = client.RemoteReadData(ctx, &pb.RemoteReadDataUpload{
        UploadId:    uploadId,
        Offset:      req.Offset,
        Length:      uint64(n),
        LazyRead:    req.LazyRead,
        Data:        buf[:n],
        IsLastChunk: isLast,
    })

    return err
}

func handleHash(client pb.CloudDriveClient, uploadId string, req *pb.RemoteHashDataRequest,
                files map[string]*LocalFile, ctx context.Context) error {
    f, err := os.Open(files[uploadId].path)
    if err != nil {
        return err
    }
    defer f.Close()

    fileSize := files[uploadId].size
    var bytesHashed uint64
    lastReport := time.Now()

    report := func(final bool, hashValue string, blockHashes []string) error {
        if !final && time.Since(lastReport) < 250*time.Millisecond {
            return nil
        }
        lastReport = time.Now()

        _, err := client.RemoteHashProgress(ctx, &pb.RemoteHashProgressUpload{
            UploadId:    uploadId,
            TotalBytes:  uint64(fileSize),
            HashType:    req.HashType,
            BytesHashed: bytesHashed,
            HashValue:   hashValue,
            BlockHashes: blockHashes,
        })
        return err
    }

    if req.HashType == pb.HashType_MD5 && req.BlockSize > 0 {
        // MD5 with block hashes
        fileMd5 := md5.New()
        var blocks []string
        buf := make([]byte, req.BlockSize)

        for {
            n, err := f.Read(buf)
            if n > 0 {
                fileMd5.Write(buf[:n])
                blockMd5 := md5.Sum(buf[:n])
                blocks = append(blocks, hex.EncodeToString(blockMd5[:]))
                bytesHashed += uint64(n)
                report(false, "", nil)
            }
            if err == io.EOF {
                break
            }
            if err != nil {
                return err
            }
            if ctx.Err() != nil {
                report(true, "", nil)
                return ctx.Err()
            }
        }

        return report(true, hex.EncodeToString(fileMd5.Sum(nil)), blocks)

    } else if req.HashType == pb.HashType_PIKPAK_SHA1 {
        // PikPakSha1: SHA1 over concatenation of per-segment SHA1 digests
        var segSize int
        if fileSize <= 128<<20 {
            segSize = 256 << 10
        } else if fileSize <= 256<<20 {
            segSize = 512 << 10
        } else if fileSize <= 512<<20 {
            segSize = 1024 << 10
        } else {
            segSize = 2048 << 10
        }

        finalSha1 := sha1.New()
        buf := make([]byte, segSize)

        for {
            n, err := f.Read(buf)
            if n > 0 {
                segHash := sha1.Sum(buf[:n])
                finalSha1.Write(segHash[:])
                bytesHashed += uint64(n)
                report(false, "", nil)
            }
            if err == io.EOF {
                break
            }
            if err != nil {
                return err
            }
            if ctx.Err() != nil {
                report(true, "", nil)
                return ctx.Err()
            }
        }

        finalHash := hex.EncodeToString(finalSha1.Sum(nil))
        return report(true, toUpper(finalHash), nil)

    } else {
        // Standard MD5 or SHA1
        var hasher io.Writer
        if req.HashType == pb.HashType_SHA1 {
            hasher = sha1.New()
        } else {
            hasher = md5.New()
        }

        buf := make([]byte, 1<<20)
        for {
            n, err := f.Read(buf)
            if n > 0 {
                hasher.Write(buf[:n])
                bytesHashed += uint64(n)
                report(false, "", nil)
            }
            if err == io.EOF {
                break
            }
            if err != nil {
                return err
            }
            if ctx.Err() != nil {
                report(true, "", nil)
                return ctx.Err()
            }
        }

        var finalHash string
        if h, ok := hasher.(interface{ Sum([]byte) []byte }); ok {
            finalHash = hex.EncodeToString(h.Sum(nil))
        }
        return report(true, finalHash, nil)
    }
}

func toUpper(s string) string {
    // Convert to uppercase
    return strings.ToUpper(s)
}
```

#### Best Practices

**RPC Operations:**
- Always include correct `upload_id` on every RPC
- Reuse stable `device_id` for `RemoteUploadChannel` request so resumed connections are treated as same device
- Keep streaming channel open; do not create one channel per file

**Data Transfer:**
- Prefer chunk sizes ≤ 1 MiB to stay under typical gRPC message limits and reduce backpressure
- Validate `file_path` and `file_size` at `StartRemoteUpload` time to catch mismatches early
- For large files, prefer memory-mapped or buffered I/O and incremental hashing to minimize memory usage

**Reliability:**
- Log/trace progress and finalization points to aid diagnostics
- Implement backoff and retry for transient RPC failures when sending progress or data
- Avoid duplicating final messages unless unsure server received them

#### Error Handling

**RPC Errors:**
- Unary RPCs return standard gRPC status codes; handle retries where safe
- If `RemoteHashProgress` fails transiently, retry sending latest progress (including final one)
- Server deduplicates based on (`upload_id`, `hash_type`) and terminal state

**Cancellation:**
- If server cancels an upload, cease hashing/reading immediately
- Send terminal `RemoteHashProgress` without `hash_value` if applicable

#### Control Operations

**RemoteUploadControl Examples:**

**Cancel:**
```protobuf
upload_id: "abc123"
control: cancel {}
```

**Pause:**
```protobuf
upload_id: "abc123"
control: pause {}
```

**Resume:**
```protobuf
upload_id: "abc123"
control: resume {}
```

On success, RPC returns Empty. Observe resulting state via `RemoteUploadStatusChanged` on the streaming channel.

---

### Service Control

#### Logout

Logs out from CloudFS server.

**Request:** `UserLogoutRequest`
```protobuf
message UserLogoutRequest {
  bool logoutFromCloudFS = 1;
}
```

**Response:** `FileOperationResult`

---

#### GetServiceCapabilities

Gets service capabilities (restart/update availability).

**Request:** `google.protobuf.Empty`

**Response:** `ServiceCapabilities`
```protobuf
message ServiceCapabilities {
  bool canRestart = 1;
  bool canUpdate = 2;
}
```

**New in 1.0.0**

---

#### RestartService

Restarts the CloudDrive service.

**Request:** `google.protobuf.Empty`

**Response:** `google.protobuf.Empty`

---

#### ShutdownService

Shuts down the CloudDrive service.

**Request:** `google.protobuf.Empty`

**Response:** `google.protobuf.Empty`

---

### Update Management

#### HasUpdate

Checks if updates are available.

**Request:** `google.protobuf.Empty`

**Response:** `UpdateResult`

---

#### CheckUpdate

Checks for software updates.

**Request:** `google.protobuf.Empty`

**Response:** `UpdateResult`
```protobuf
message UpdateResult {
  bool hasUpdate = 1;
  string newVersion = 2;
  string description = 3;
}
```

---

#### DownloadUpdate

Downloads the newest version.

**Request:** `google.protobuf.Empty`

**Response:** `google.protobuf.Empty`

---

#### UpdateSystem

Updates to the newest version.

**Request:** `google.protobuf.Empty`

**Response:** `google.protobuf.Empty`

---

### Web Server Configuration

#### GetWebServerConfig

Gets web server configuration.

**Request:** `google.protobuf.Empty`

**Response:** `WebServerConfig`
```protobuf
message WebServerConfig {
  uint32 http_port = 1;
  uint32 https_port = 2;
  optional string cert_file = 3;
  optional string key_file = 4;
  bool enable_https = 5;
}
```

---

#### SetWebServerConfig

Sets web server configuration.

**Request:** `SetWebServerConfigRequest`

**Response:** `google.protobuf.Empty`

---

#### GenerateSelfSignedCert

Generates a self-signed SSL certificate.

**Request:** `GenerateSelfSignedCertRequest`
```protobuf
message GenerateSelfSignedCertRequest {
  bool restart_servers = 1;
}
```

**Response:** `google.protobuf.Empty`

---

## Data Types Reference

### CloudDriveFile

The central data type representing a file or folder.

```protobuf
message CloudDriveFile {
  string id = 1;
  string name = 2;
  string fullPathName = 3;
  int64 size = 4;

  enum FileType {
    Directory = 0;
    File = 1;
    Other = 2;
  }
  FileType fileType = 5;

  google.protobuf.Timestamp createTime = 6;
  google.protobuf.Timestamp writeTime = 7;
  google.protobuf.Timestamp accessTime = 8;

  CloudAPI CloudAPI = 9;
  string thumbnailUrl = 10;
  string previewUrl = 11;
  string originalPath = 14;

  // Boolean flags
  bool isDirectory = 30;
  bool isRoot = 31;
  bool isCloudRoot = 32;
  bool isCloudDirectory = 33;
  bool isCloudFile = 34;
  bool isSearchResult = 35;
  bool isForbidden = 36;
  bool isLocal = 37;

  // Capabilities
  bool canMount = 60;
  bool canUnmount = 61;
  bool canDirectAccessThumbnailURL = 62;
  bool canSearch = 63;
  bool hasDetailProperties = 64;
  FileDetailProperties detailProperties = 65;
  bool canOfflineDownload = 66;
  bool canAddShareLink = 67;
  optional uint64 dirCacheTimeToLiveSecs = 68;
  bool canDeletePermanently = 69;

  // Hash information
  enum HashType {
    Unknown = 0;
    Md5 = 1;
    Sha1 = 2;
    PikPakSha1 = 3;
  }
  map<uint32, string> fileHashes = 70;

  // Encryption
  enum FileEncryptionType {
    None = 0;
    Encrypted = 1; // password required
    Unlocked = 2;  // password provided
  }
  FileEncryptionType fileEncryptionType = 71;
  bool CanCreateEncryptedFolder = 72;
  bool CanLock = 73;
  bool CanSyncFileChangesFromCloud = 74;
  bool supportOfflineDownloadManagement = 75;

  optional DownloadUrlPathInfo downloadUrlPath = 76;
}
```

---

### FileOperationResult

Standard result for file operations.

```protobuf
message FileOperationResult {
  bool success = 1;
  string errorMessage = 2;
  repeated string resultFilePaths = 3;
}
```

---

### TokenPermissions

Fine-grained permissions for API tokens.

```protobuf
message TokenPermissions {
  // File Operations
  bool allow_list = 1;
  bool allow_search = 2;
  bool allow_create_folder = 4;
  bool allow_create_file = 5;
  bool allow_write = 6;
  bool allow_read = 7;
  bool allow_rename = 8;
  bool allow_move = 9;
  bool allow_copy = 10;
  bool allow_delete = 11;
  bool allow_delete_permanently = 12;

  // Encryption Operations
  bool allow_create_encrypt = 13;
  bool allow_unlock_encrypted = 14;
  bool allow_lock_encrypted = 15;

  // Cloud Operations
  bool allow_add_offline_download = 16;
  bool allow_list_offline_downloads = 17;
  bool allow_modify_offline_downloads = 18;
  bool allow_shared_links = 19;

  // System Information
  bool allow_view_properties = 20;
  bool allow_get_space_info = 21;
  bool allow_view_runtime_info = 22;
  bool allow_push_message = 41;

  // Management permissions
  bool allow_get_mounts = 25;
  bool allow_modify_mounts = 26;
  bool allow_get_transfer_tasks = 27;
  bool allow_modify_transfer_tasks = 28;
  bool allow_get_cloud_apis = 29;
  bool allow_modify_cloud_apis = 30;
  bool allow_get_system_settings = 31; // GetSystemSettings, GetEffectiveDirCacheTimeSecs, GetDirCacheDbSize, GetVacuumProgress
  bool allow_modify_system_settings = 32; // SetSystemSettings, SetDirCacheTimeSecs, ForceExpireDirCache, VacuumDirCache
  bool allow_get_backups = 33;
  bool allow_modify_backups = 34;
  bool allow_get_dav_config = 35;
  bool allow_modify_dav_config = 36;
  bool allow_token_management = 37;
  bool allow_get_account_info = 38;
  bool allow_modify_account = 39;
  bool allow_service_control = 40;
}
```

`allow_push_message` (added in 0.9.15) gates access to the `PushMessage`/`PushTaskChange` streaming RPCs—omit it for tokens that should not subscribe to realtime notifications.

---

### ProxyInfo

Proxy configuration.

```protobuf
enum ProxyType {
  SYSTEM = 0;
  NOPROXY = 1;
  HTTP = 2;
  SOCKS5 = 3;
}

message ProxyInfo {
  ProxyType proxyType = 1;
  string host = 2;
  uint32 port = 3;
  optional string username = 4;
  optional string password = 5;
}
```

---

## Error Handling

### gRPC Status Codes

CloudDrive2 uses standard gRPC status codes:

| Code | Name | Description |
|------|------|-------------|
| 0 | OK | Success |
| 1 | CANCELLED | Operation was cancelled |
| 2 | UNKNOWN | Unknown error |
| 3 | INVALID_ARGUMENT | Invalid argument |
| 4 | DEADLINE_EXCEEDED | Timeout |
| 5 | NOT_FOUND | Resource not found |
| 7 | PERMISSION_DENIED | No permission |
| 12 | UNIMPLEMENTED | Method not implemented |
| 14 | UNAVAILABLE | Service unavailable |
| 16 | UNAUTHENTICATED | Missing/invalid authentication |

### Common Error Scenarios

#### Invalid User Plan (Permission Denied)

**Error Code**: `PERMISSION_DENIED` (StatusCode 7)  
**Error Detail**: `"invalid user plan"`

This error occurs when the user's current subscription plan does not allow the requested operation. For example:
- Adding more cloud API connections than allowed by the plan
- Adding more mount points than the plan permits
- Accessing premium features without an appropriate subscription

**How to Handle:**

The error message indicates that the user needs to upgrade their plan to continue. When this error is encountered:

1. **Display User-Friendly Message**: Show a localized message explaining the limitation
2. **Provide Upgrade Option**: Direct users to the membership/upgrade page
3. **Graceful Degradation**: Allow the application to continue with available features

**Example (C#):**
```csharp
catch (RpcException ex) when (ex.StatusCode == StatusCode.PermissionDenied && 
                               ex.Status.Detail == "invalid user plan")
{
    var message = "Your current plan does not allow this operation. " +
                  "Please upgrade your plan to continue.";
    Console.WriteLine(message);
    
    // Optional: Show upgrade prompt
    ShowUpgradePrompt();
}
```

**Example (Python):**
```python
except grpc.RpcError as e:
    if (e.code() == grpc.StatusCode.PERMISSION_DENIED and 
        e.details() == "invalid user plan"):
        print("Your current plan does not allow this operation.")
        print("Click 'Upgrade Plan' to go to the Membership page.")
        # Show upgrade UI
```

**Best Practices:**
- Check account status before attempting restricted operations using `GetAccountStatus`
- Cache account plan information to avoid repeated API calls
- Provide clear UI indicators for premium features
- Handle the error gracefully without disrupting the user experience

### Error Handling Pattern (C#)

```csharp
try
{
    var result = await client.CreateFolderAsync(request, callOptions);
    if (result.Result.Success)
    {
        // Success
        Console.WriteLine($"Created: {result.FolderCreated.FullPathName}");
    }
    else
    {
        // Operation failed but no exception
        Console.WriteLine($"Error: {result.Result.ErrorMessage}");
    }
}
catch (RpcException ex)
{
    switch (ex.StatusCode)
    {
        case StatusCode.Unauthenticated:
            Console.WriteLine("Authentication required or token expired");
            break;
        case StatusCode.PermissionDenied:
            Console.WriteLine("Permission denied");
            break;
        case StatusCode.DeadlineExceeded:
            Console.WriteLine("Request timeout");
            break;
        case StatusCode.Unimplemented:
            Console.WriteLine("Method not supported by server");
            break;
        default:
            Console.WriteLine($"RPC error: {ex.Status.Detail}");
            break;
    }
}
catch (Exception ex)
{
    Console.WriteLine($"Unexpected error: {ex.Message}");
}
```

### Error Handling Pattern (Python)

```python
import grpc

try:
    result = client.create_folder('/path', 'folder_name')
    if result.result.success:
        print(f"Created: {result.folderCreated.fullPathName}")
    else:
        print(f"Error: {result.result.errorMessage}")

except grpc.RpcError as e:
    if e.code() == grpc.StatusCode.UNAUTHENTICATED:
        print("Authentication required or token expired")
    elif e.code() == grpc.StatusCode.PERMISSION_DENIED:
        print("Permission denied")
    elif e.code() == grpc.StatusCode.DEADLINE_EXCEEDED:
        print("Request timeout")
    else:
        print(f"RPC error: {e.details()}")
except Exception as e:
    print(f"Unexpected error: {e}")
```

---

## Best Practices

### 1. Connection Management

**Do:**
- Reuse gRPC channels across multiple requests
- Properly dispose channels when done
- Use connection pooling for high-throughput scenarios

**Don't:**
- Create a new channel for every request
- Leave channels open indefinitely in short-lived applications

```csharp
// Good
using var client = new CloudDriveClient("http://localhost:19798");
await client.AuthenticateAsync(...);
await client.GetSubFilesAsync(...);
await client.CreateFolderAsync(...);
// Channel disposed here

// Bad
for (int i = 0; i < 100; i++)
{
    using var client = new CloudDriveClient("http://localhost:19798");
    await client.GetSubFilesAsync(...);
}
```

### 2. Authentication

**Do:**
- Store JWT tokens securely
- Check token expiration before requests
- Refresh tokens proactively before expiration
- Clear tokens on logout

**Don't:**
- Store tokens in plain text files
- Hardcode credentials
- Ignore token expiration

```python
class CloudDriveClient:
    def __init__(self, address):
        self.jwt_token = None
        self.token_expiration = None

    def is_token_valid(self):
        if not self.jwt_token:
            return False
        if self.token_expiration and self.token_expiration < datetime.now():
            return False
        return True

    def ensure_authenticated(self):
        if not self.is_token_valid():
            self.authenticate(username, password)
```

### 3. Streaming RPCs

**Do:**
- Use server streaming for large result sets (GetSubFiles, GetSearchResults)
- Process streaming results in chunks to reduce memory usage
- Handle cancellation properly with CancellationTokens
- Use timeouts for streaming calls

**Don't:**
- Load all streaming results into memory at once
- Ignore cancellation requests
- Let streaming calls run indefinitely

```csharp
// Good: Chunked processing
var files = new List<CloudDriveFile>();
const int chunkSize = 1000;
var currentChunk = new List<CloudDriveFile>();

using var call = client.GetSubFiles(request, callOptions);
await foreach (var response in call.ResponseStream.ReadAllAsync(cancellationToken))
{
    currentChunk.AddRange(response.SubFiles);

    if (currentChunk.Count >= chunkSize)
    {
        ProcessChunk(currentChunk); // Process incrementally
        currentChunk.Clear();
    }
}
```

### 4. Error Handling

**Do:**
- Always check `FileOperationResult.Success` before using results
- Handle specific RpcException status codes
- Implement retry logic for transient errors
- Log errors with context

**Don't:**
- Assume operations always succeed
- Catch all exceptions without proper handling
- Retry indefinitely without backoff

```go
func retryWithBackoff(operation func() error, maxRetries int) error {
    for i := 0; i < maxRetries; i++ {
        err := operation()
        if err == nil {
            return nil
        }

        if st, ok := status.FromError(err); ok {
            switch st.Code() {
            case codes.Unavailable, codes.DeadlineExceeded:
                // Retry transient errors
                time.Sleep(time.Second * time.Duration(1<<i))
                continue
            default:
                // Don't retry other errors
                return err
            }
        }
        return err
    }
    return fmt.Errorf("max retries exceeded")
}
```

### 5. Performance Optimization

**Do:**
- Use `forceRefresh=false` for cached directory listings
- Set appropriate cache times with `SetDirCacheTimeSecs`
- Batch operations when possible (DeleteFiles, RenameFiles)
- Use `GetDownloadUrlPath` for direct downloads instead of proxying

**Don't:**
- Always force refresh on every request
- Make separate API calls for operations that can be batched
- Download files through your application when direct URLs are available

### 6. Security

**Do:**
- Use HTTPS in production
- Validate SSL certificates
- Use API tokens with minimal required permissions
- Set token expiration times
- Enable gRPC logging for API tokens when needed

**Don't:**
- Use insecure channels in production
- Give tokens full permissions
- Create tokens that never expire (for non-admin use)

```csharp
// Create limited-permission token
var tokenRequest = new CreateTokenRequest
{
    RootDir = "/public",
    FriendlyName = "Public Read-Only Token",
    ExpiresIn = 86400 * 30, // 30 days
    Permissions = new TokenPermissions
    {
        AllowList = true,
        AllowRead = true,
        AllowSearch = true,
        // All other permissions false by default
    }
};

var token = await client.CreateTokenAsync(tokenRequest, adminCallOptions);
```

### 7. Resource Management

**Do:**
- Dispose gRPC channels and streaming calls
- Close file handles after writing
- Cancel long-running operations when no longer needed
- Monitor open file handles with `GetOpenFileHandles`

**Don't:**
- Leave streaming calls open indefinitely
- Forget to close file handles
- Ignore resource limits

### 8. Web Browser Clients (gRPC-Web)

**Do:**
- Use `GrpcWebHandler` for Blazor WebAssembly and browser-based clients
- Handle browser-specific limitations (no HTTP/2 support)
- Use the Remote Upload Protocol for file uploads from browsers
- Test with CORS configuration

**Don't:**
- Try to use regular gRPC in browsers
- Use bidirectional streaming (not supported in gRPC-Web)

```csharp
// Browser-compatible client setup
var channel = GrpcChannel.ForAddress(baseAddress, new GrpcChannelOptions
{
    HttpHandler = new GrpcWebHandler(new HttpClientHandler()),
    UnsafeUseInsecureChannelCallCredentials = true // Only for development!
});
```

### 9. Monitoring and Debugging

**Do:**
- Use `PushMessage` to monitor real-time events
- Check `GetRunningInfo` for server health
- Monitor `GetAllTasksCount` for transfer progress
- Enable appropriate log levels
- Use `GetOpenFileHandles` to debug file locking issues

**Don't:**
- Poll status endpoints too frequently
- Set log level to Trace in production
- Ignore server health metrics

### 10. API Versioning

**Do:**
- Check server version with `GetRuntimeInfo`
- Handle `UNIMPLEMENTED` status for newer APIs
- Test compatibility with target server version
- Document minimum required server version

**Don't:**
- Assume all methods are available on all servers
- Ignore version incompatibilities

```java
try {
    result = stub.someNewMethod(request);
} catch (StatusRuntimeException e) {
    if (e.getStatus().getCode() == Status.Code.UNIMPLEMENTED) {
        // Fall back to older method or show error
        System.out.println("This feature requires CloudDrive 2.x or higher");
    }
}
```

---

## Complete Example: File Manager Application

Here's a comprehensive example showing common operations:

### C# Console Application

```csharp
using System;
using System.Threading.Tasks;
using Grpc.Net.Client;
using CloudDriveSrv.Protos;

class FileManager
{
    private readonly CloudDriveClient _client;

    public FileManager(string serverAddress)
    {
        _client = new CloudDriveClient(serverAddress);
    }

    public async Task RunAsync()
    {
        try
        {
            // 1. Check server status
            var sysInfo = await _client.GetSystemInfoAsync();
            Console.WriteLine($"Server: {sysInfo.SystemReady}");
            Console.WriteLine($"Logged in as: {sysInfo.UserName}");

            // 2. Authenticate
            Console.Write("Username: ");
            var username = Console.ReadLine();
            Console.Write("Password: ");
            var password = ReadPassword();

            if (!await _client.AuthenticateAsync(username, password))
            {
                Console.WriteLine("Authentication failed!");
                return;
            }

            // 3. Show account info
            var account = await _client.GetAccountStatusAsync(new Empty());
            Console.WriteLine($"\nAccount: {account.UserName}");
            Console.WriteLine($"Plan: {account.AccountPlan.PlanName}");
            Console.WriteLine($"Balance: ${account.AccountBalance}");

            // 4. Browse files
            await BrowseFiles("/");

            // 5. Upload a file
            await UploadFile("/test.txt", "Hello CloudDrive!");

            // 6. Monitor transfers
            await MonitorTransfers();

            // 7. Get server stats
            var stats = await _client.GetRunningInfoAsync();
            Console.WriteLine($"\nServer Stats:");
            Console.WriteLine($"CPU: {stats.CpuUsage:F1}%");
            Console.WriteLine($"Memory: {stats.MemUsageKB / 1024} MB");
            Console.WriteLine($"Download: {stats.DownloadBytesPerSecond / 1024:F1} KB/s");
            Console.WriteLine($"Upload: {stats.UploadBytesPerSecond / 1024:F1} KB/s");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error: {ex.Message}");
        }
    }

    private async Task BrowseFiles(string path)
    {
        Console.WriteLine($"\nListing: {path}");
        var files = await _client.GetSubFilesAsync(path);

        foreach (var file in files)
        {
            var type = file.IsDirectory ? "[DIR]" : "[FILE]";
            var size = file.IsDirectory ? "" : $" ({FormatSize(file.Size)})";
            Console.WriteLine($"{type} {file.Name}{size}");
        }

        Console.WriteLine($"Total: {files.Count} items");
    }

    private async Task UploadFile(string destPath, string content)
    {
        Console.WriteLine($"\nUploading to: {destPath}");

        // Create file
        var createResult = await _client.CreateFileAsync("/", "test.txt");
        var fileHandle = createResult.FileHandle;

        // Write data
        var buffer = System.Text.Encoding.UTF8.GetBytes(content);
        var writeResult = await _client.WriteToFileAsync(
            fileHandle, 0, (ulong)buffer.Length, buffer, true);

        Console.WriteLine($"Uploaded {writeResult.BytesWritten} bytes");
    }

    private async Task MonitorTransfers()
    {
        var tasks = await _client.GetAllTasksCountAsync();
        Console.WriteLine($"\nActive transfers:");
        Console.WriteLine($"Downloads: {tasks.DownloadCount}");
        Console.WriteLine($"Uploads: {tasks.UploadCount}");
        Console.WriteLine($"Copy tasks: {tasks.CopyTaskCount}");
    }

    private static string FormatSize(long bytes)
    {
        string[] sizes = { "B", "KB", "MB", "GB", "TB" };
        double len = bytes;
        int order = 0;
        while (len >= 1024 && order < sizes.Length - 1)
        {
            order++;
            len = len / 1024;
        }
        return $"{len:0.##} {sizes[order]}";
    }

    private static string ReadPassword()
    {
        var password = "";
        ConsoleKeyInfo key;
        do
        {
            key = Console.ReadKey(true);
            if (key.Key != ConsoleKey.Backspace && key.Key != ConsoleKey.Enter)
            {
                password += key.KeyChar;
                Console.Write("*");
            }
            else if (key.Key == ConsoleKey.Backspace && password.Length > 0)
            {
                password = password.Substring(0, password.Length - 1);
                Console.Write("\b \b");
            }
        }
        while (key.Key != ConsoleKey.Enter);
        Console.WriteLine();
        return password;
    }

    public static async Task Main(string[] args)
    {
        var manager = new FileManager("http://localhost:19798");
        await manager.RunAsync();
    }
}
```

---

## Conclusion

This guide covers the complete CloudDrive2 gRPC API with:

- ✅ **100+ RPC methods** documented
- ✅ **Sample code in C#, Java, Go, and Python**
- ✅ **Authentication and authorization** patterns
- ✅ **Streaming RPCs** (server-side, client-side)
- ✅ **Error handling** best practices
- ✅ **Performance optimization** tips
- ✅ **Security guidelines**
- ✅ **Complete working examples**

**API Version:** 0.9.18

---

*Last Updated: 2026-05-04*
*Copyright © 2026 CloudDrive. All rights reserved.*
