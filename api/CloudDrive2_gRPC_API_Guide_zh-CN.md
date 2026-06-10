# CloudDrive2 gRPC API 开发者指南

版本: 1.0.9

## 目录

- [1.0.9 版本新特性](#109-版本新特性)
- [1.0.8 版本新特性](#108-版本新特性)
- [1.0.7 版本新特性](#107-版本新特性)
- [1.0.6 版本新特性](#106-版本新特性)
- [1.0.5 版本新特性](#105-版本新特性)
- [1.0.1 版本新特性](#101-版本新特性)
- [1.0.0 版本新特性](#100-版本新特性)
- [概述](#概述)
- [服务定义](#服务定义)
- [下载 Proto 文件](#下载-proto-文件)
- [身份验证](#身份验证)
- [快速入门](#快速入门)
  - [C# 配置](#c-配置)
  - [Java 配置](#java-配置)
  - [Go 配置](#go-配置)
  - [Python 配置](#python-配置)
- [API 参考](#api-参考)
  - [公共方法(无需授权)](#公共方法无需授权)
  - [授权方法](#授权方法)
  - [文件操作](#文件操作)
  - [挂载点管理](#挂载点管理)
  - [传输任务管理](#传输任务管理)
  - [云 API 管理](#云-api-管理)
  - [备份管理](#备份管理)
  - [WebDAV 管理](#webdav-管理)
  - [令牌管理](#令牌管理)
  - [双因素认证 (2FA)](#双因素认证-2fa)
  - [会话管理](#会话管理)
  - [远程上传协议](#远程上传协议)
- [数据类型参考](#数据类型参考)
- [错误处理](#错误处理)
- [最佳实践](#最佳实践)

---

## 1.0.9 版本新特性

### 应用内购买（App Store / Google Play / Meta Quest）

CloudDrive2 1.0.9 引入完整的应用内购买流程，面向各应用商店分发版本。服务器先报价店内价格（自动应用优惠码/推荐码折扣以及人民币余额），然后在购买完成后校验票据并激活计划。

**新增 RPC:**
- **`GetStorePurchaseQuote`** — 报价店内商品价格。服务器自动应用优惠码/推荐码与人民币余额，返回需在店内支付的剩余金额。
- **`VerifyStorePurchase`** — 提交店内购买票据进行服务端校验并激活计划。幂等接口 — 重复提交已知票据会返回 `ALREADY_ACTIVE`。

**新增枚举:**
```protobuf
enum VerifyStorePurchaseStatus {
  VERIFY_STORE_PURCHASE_SUCCESS = 0;        // 新授予/延长
  VERIFY_STORE_PURCHASE_ALREADY_ACTIVE = 1; // 幂等重提交 / 恢复购买
  VERIFY_STORE_PURCHASE_PENDING = 2;        // 预留（Ask-to-Buy / Google PENDING）
}
```

**新增消息:**
```protobuf
message GetStorePurchaseQuoteRequest {
  string productId = 1;            // 规范商品 ID，如 "cd_app_pro"
  optional string couponCode = 2;  // 优惠码或 8 位推荐码
}
message StorePurchaseQuote {
  string productId = 1;
  string planId = 2;
  double basePriceUsd = 3;         // 目录/参考价
  double basePriceCny = 4;
  double couponDiscountCny = 5;
  double balanceAppliedCny = 6;    // 从人民币余额扣减的金额
  double finalPriceCny = 7;
  double finalPriceUsd = 8;        // 实际在店内收取的金额（CNY 余额 / 7，向上取整）
}
message VerifyStorePurchaseRequest {
  string store = 1;                // "apple" | "google" | "meta"
  string productId = 2;            // 规范商品 ID
  string receipt = 3;              // Apple JWS / Google purchaseToken / Meta receipt
  optional string transactionId = 4;
  optional bool sandbox = 5;
  optional string couponCode = 6;  // 报价时使用的同一优惠码
  optional string packageName = 7; // 预留给 Google
}
message VerifyStorePurchaseResult {
  VerifyStorePurchaseStatus status = 1;
  optional AccountStatusResult accountStatus = 2; // SUCCESS/ALREADY_ACTIVE 时返回最新账号状态
  optional string pendingReason = 3;              // status == PENDING 时设置
}
```

**`CloudDrivePlan` 新增字段（用于商店感知的计划展示）:**
- `priceUsd`（字段 11）— 预定义美元价（App Store 目录价）。未设置则不返回。
- `originalPriceUsd`（字段 12）— 预定义美元原价（折扣前）。未设置则不返回。
- `payableByBalance`（字段 13）— 为 `true` 时表示用户人民币余额可覆盖该计划（客户端可跳过 IAP 直接调用 `JoinPlan`）。
- `balancePriceCny`（字段 14）— 直接购买时从余额扣减的人民币金额。未设置则不返回。
- `storeProductId`（字段 15）— 该计划在商店的 SKU（升级套餐可能是不同的 SKU）。

### 自动续费订阅信息

`AccountStatusResult` 新增字段，面向应用商店分发版本报告用户的自动续费订阅状态。

**`AccountStatusResult` 新增字段:**
- `subscription`（字段 11）— 仅在用户拥有商店自动续费订阅（Apple / Google / Meta）时存在。支付宝或一次性购买不返回该字段。

**新增消息:**
```protobuf
message SubscriptionInfo {
  string store = 1;        // apple | google | meta — 用于跳转到对应商店管理
  string productId = 2;    // cd_core_monthly | cd_core_yearly
  bool autoRenew = 3;      // 取消后变为 false（仍可使用至 expiresAt）
  bool inGracePeriod = 4;
  string expiresAt = 5;    // 下一次自动扣款日期（自动续费时）或访问截止时间（naive UTC 字符串）
}
```

### 合作伙伴设备管理与 2FA 恢复流程

新增三个 RPC，让用户无需联系客服即可恢复账号访问：解绑账号绑定的合作伙伴 OEM 设备；在 TOTP 与恢复代码均不可用时，通过邮件验证码关闭 2FA。

**新增 RPC:**
- **`UnbindDevice`** *（需要授权）* — 解绑账号当前绑定的所有合作伙伴设备（如设备丢失或转售）。需要账号密码，开启 2FA 时还需 TOTP。
- **`SendDisable2FAEmail`** *（公共方法）* — 恢复流程：请求 cloudfs 服务器向账号邮箱发送一次性的关闭 2FA 验证码。
- **`Disable2FAByEmail`** *（公共方法）* — 恢复流程：提交邮件中的关闭验证码和账号密码以关闭 2FA。

**`AccountStatusResult` 新增字段:**
- `boundDevices`（字段 10）— 账号当前绑定的合作伙伴设备列表。无绑定时为空。驱动解绑界面。

**新增消息:**
```protobuf
message BoundDevice {
  string deviceId = 1;
  string manufacturerId = 2;
  string status = 3;       // ACTIVE / INACTIVE / DELETED
  string createTime = 4;   // naive UTC 日期时间字符串
  string partnerName = 5;  // 合作伙伴可读名称（缺失时为空）
}

message SendDisable2FAEmailRequest {
  string email = 1;
  optional ProxyInfo cloudfsProxy = 2; // 访问 CloudFS 账号服务器的可选代理
}

message Disable2FAByEmailRequest {
  string disable_code = 1; // 恢复邮件中的 UUID 验证码
  string password = 2;     // 明文账号密码；后端发送前会进行 MD5 哈希
  optional ProxyInfo cloudfsProxy = 3;
}

message UnbindDeviceRequest {
  string password = 1;           // 明文账号密码；后端会进行 MD5 哈希
  optional string totp_code = 2; // 仅在开启 2FA 时必填
}
```

### OAuth `state` 签名令牌

OAuth 登录流程（Google Drive、OneDrive、迅雷等）现在使用服务端签发的签名 `state` 令牌。前端调用 `CreateOAuthState` 获取一个短期签名令牌，作为 OAuth `state` 参数传递；回调服务器在处理重定向回调前验证该令牌，避免 CSRF 和 OAuth state 伪造。

**新增 RPC:**
- **`CreateOAuthState`** — 签发短期 OAuth `state` 签名令牌（中继到 cloudfs 服务器）。

**新增消息:**
```protobuf
message CreateOAuthStateRequest {
  string oauth_type = 1;          // 提供方标识，如 "google_drive"、"onedrive"
  string return_url = 2;          // 回调完成后接收令牌的地址
  optional string device_id = 3;  // 迅雷流程中需要透传
}
message CreateOAuthStateResult {
  bool success = 1;
  string error_message = 2;
  string state = 3;       // 用作 OAuth `state` 参数的签名令牌
  uint64 expires_in = 4;  // 令牌有效期（秒）
}
```

### CloudAPIConfig：复制/上传使用多线程下载器

新增可选字段，让复制/上传任务通过传统的多线程缓冲下载器读取源字节，而不是使用单条长 HTTP GET 流 — 适用于单流吞吐低于目标端写入/上传速度的场景。

**`CloudAPIConfig` 新增字段:**
- `useMultithreadDownloaderForCopy`（字段 21）— 设置后，复制/上传任务从该云盘读取源字节时改用多线程缓冲下载器（`ENTRY_READER_MANAGER`）。对哈希预处理与上传字节流均生效。

### AccountPlan：服务端计划 ID

`AccountPlan` 新增服务端计划 ID，便于客户端无需解析本地化显示名即可区分计划等级。

**`AccountPlan` 新增字段:**
- `planId`（字段 6）— 服务端计划 ID。例如：`"1"` = 终身 VIP，`"4"` = 终身轻享。`"0"` 或空表示无计划。

### CopyTaskBatchRequest：明确的 key 格式

`CopyTaskBatchRequest.taskKeys` 的文档注释现在明确说明格式：每个 key 形如 `"{sourcePath}:{destPath}"`，使用 `GetCopyTasks` 返回的 `CopyTask` 中的原始 `sourcePath` 与 `destPath`，不做任何额外规范化处理。无 schema 变更。

---

## 1.0.8 版本新特性

### MountPoint：Windows 卷标

`MountPoint` 消息新增 `name` 字段（字段 11）。在 Windows 盘符挂载场景下，该字段是嵌入到 WinFSP UNC 路径中的卷标。在非 Windows 挂载场景下该字段仅作展示用途 — 用户实际看到的仍是 `mountPoint` 的最后一段。

**`MountPoint` 新增字段:**
- `name`（字段 11）— Windows 盘符挂载的卷标。

---

## 1.0.7 版本新特性

### 客户端驱动的缓存预取提示

CloudDrive2 1.0.7 新增客户端驱动的预取系统。客户端可以提前告知服务器即将读取的字节范围，让服务器在实际读取请求到达之前填充预读缓存，同时通过优先级对并发任务进行调度。该机制面向能预知访问模式的客户端（媒体播放器拖动、批量缩略图生成、压缩归档浏览器读取中心目录等）。

**新增 RPC:**
- **`PrefetchFileRanges`** — 通知服务器对文件中一组字节范围进行预取。返回 `hint_id` 用于后续取消，以及接受/拒绝计数。
- **`CancelFilePrefetch`** — 取消之前在某路径上注册的一个或多个提示。`hint_ids` 为空时取消该路径上的全部提示。
- **`CloseFileReader`** — 告诉服务器"我不会再读这个文件了"。当不再有打开的文件句柄时立即释放服务端 `EntryReader`（下载缓冲 + 下载线程），跳过默认 2 秒的关闭后保留窗口。用于一次性读取场景（Web 缩略图、元数据探测）。
- **`GetActivePrefetchHints`** — 诊断接口：返回当前注册的提示快照以及进程启动以来的累计计数器。

**新增枚举:**
```protobuf
// HIGH 优先于 NORMAL，NORMAL 优先于 LOW。LOW 用于
// 不应阻塞主播放读流的尽力而为预取（如批量缩略图）。
enum HintPriority {
  HINT_PRIORITY_LOW = 0;
  HINT_PRIORITY_NORMAL = 1;
  HINT_PRIORITY_HIGH = 2;
}
```

**新增消息:**
```protobuf
message ByteRange {
  uint64 start = 1;  // 起始位置（含）
  uint64 length = 2; // 字节数
}

message PrefetchFileRangesRequest {
  string path = 1;
  repeated ByteRange ranges = 2;
  HintPriority priority = 3;
  // 0 = 由服务器分配并返回 id
  uint64 hint_id = 4;
  // 0 = 服务器默认值（限制在 [1, PREFETCH_HINT_TTL_SEC] 范围内）
  uint32 ttl_seconds = 5;
  // 为 true 时，添加前先取消该路径上已存在的提示
  bool replace_existing = 6;
}

message PrefetchFileRangesReply {
  uint64 hint_id = 1;
  uint32 accepted_range_count = 2;
  // 因越界或已完全缓存而被丢弃的范围数
  uint32 rejected_range_count = 3;
}

message CancelFilePrefetchRequest {
  string path = 1;
  // 为空时取消该路径上的全部提示
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

### CloudAPIConfig：服务器报告的上限

`CloudAPIConfig` 新增三个只读字段。服务器会报告每个设置在当前云端（必要时还会按平台进一步收紧）的有效上限，便于客户端在配置界面中限制用户输入。字段缺失或为 0 表示"未声明上限，客户端应使用合理默认值"。这些字段在 `SetCloudAPIConfig` 中会被忽略。

**`CloudAPIConfig` 新增字段:**
- `maxDownloadThreadsLimit`（字段 18）— `maxDownloadThreads` 的有效上限。
- `maxBufferPoolSizeMBLimit`（字段 19）— `maxBufferPoolSizeMB` 的有效上限。
- `maxQueriesPerSecondLimit`（字段 20）— `maxQueriesPerSecond` 的有效上限。

示例：115 网盘报告 `maxDownloadThreadsLimit = 2` 和 `maxQueriesPerSecondLimit = 5.0`，因此客户端 UI 会将下载线程数滑块限制在 2、QPS 滑块限制在 5.0。

---

## 1.0.6 版本新特性

### 网络文件系统支持（SFTP / FTP / SMB）

CloudDrive2 1.0.6 新增三种网络文件系统协议支持，每种协议都有专用的登录 RPC 和请求消息。

**新增 RPC:**
- **`APILoginSftp`** — 添加 SFTP 服务器。支持密码和私钥认证。
- **`APILoginFtp`** — 添加 FTP/FTPS 服务器。设置 `useTls = true` 启用 FTPS。
- **`APILoginSmb`** — 添加 SMB/CIFS 共享。
- **`DiscoverSmbServers`** — 发现局域网内的 SMB 服务器（返回 `DiscoverSmbServersResult`）。
- **`DiscoverSmbShares`** — 列出指定 SMB 服务器上的共享目录（返回 `DiscoverSmbSharesResult`）。

**新增消息:**
```protobuf
message LoginSftpRequest {
  string host = 1;
  uint32 port = 2;                    // 默认 22
  string userName = 3;
  string password = 4;                // 密码认证
  optional string privateKey = 5;     // PEM 编码的私钥
  optional string passphrase = 6;     // 加密私钥的密码短语
  optional string rootPath = 7;       // 远程根目录（默认 "/"）
  bool doNotSyncToCloud = 8;
  optional ProxyInfo apiProxy = 9;
  optional ProxyInfo dataProxy = 10;
}

message LoginFtpRequest {
  string host = 1;
  uint32 port = 2;                    // 默认 21
  string userName = 3;
  string password = 4;
  bool useTls = 5;                    // 启用 FTPS (TLS)
  optional string rootPath = 6;       // 远程根目录（默认 "/"）
  bool doNotSyncToCloud = 7;
  optional ProxyInfo apiProxy = 8;
  optional ProxyInfo dataProxy = 9;
}

message LoginSmbRequest {
  string server = 1;                  // SMB 服务器主机名或 IP
  string share = 2;                   // 共享名（如 "SharedDocs"）
  uint32 port = 3;                    // 默认 445
  string userName = 4;
  string password = 5;
  optional string workgroup = 6;      // 域/工作组
  optional string rootPath = 7;       // 共享内路径（默认 "/"）
  bool doNotSyncToCloud = 8;
  optional ProxyInfo apiProxy = 9;
  optional ProxyInfo dataProxy = 10;
}

message SmbServerInfo {
  string name = 1;                    // 服务器名称（如 "MINIPC-Y10"）
  string address = 2;                 // IP 地址或主机名
}
message DiscoverSmbServersResult {
  repeated SmbServerInfo servers = 1;
}

message DiscoverSmbSharesRequest {
  string server = 1;
  uint32 port = 2;                    // 默认 445
  string userName = 3;
  string password = 4;
  optional string workgroup = 5;
}
message DiscoverSmbSharesResult {
  repeated string shareNames = 1;
}
```

### 备份：跳过初始扫描

`Backup` 消息新增可选字段 `dontStartScanAfterAdd`（字段 15）。设置为 `true` 时，添加备份后不会立即触发全量扫描。默认行为（未设置或 `false`）保持不变 — 添加备份后立即开始全量扫描。

---

## 1.0.5 版本新特性

### 设备电源类型

新增 `DevicePowerType` 枚举，用于描述宿主设备的电源和存储特性。通过 `GetSystemInfo` 在 `CloudDriveSystemInfo` 消息中暴露。

**新增枚举:**
```protobuf
enum DevicePowerType {
  // 桌面/服务器：持续供电，快速存储 — 无限制（默认）
  DESKTOP = 0;
  // 电视机/机顶盒：持续供电，慢速闪存存储
  // → 本地缓存禁用，Web UI 应隐藏缓存相关功能
  SLOW_STORAGE = 1;
  // 手机/平板：电池供电，快速存储
  // → Web UI 应在电池模式下提供省电选项
  BATTERY = 2;
}
```

**`CloudDriveSystemInfo` 新增字段:**
- `devicePowerType`（字段 6）— 设备电源和存储配置。参见 `DevicePowerType` 枚举。
- `diskCacheDisabled`（字段 7）— 当目录缓存持久化和磁盘缓冲区被强制禁用时为 `true`（由平台配置或 `SLOW_STORAGE` 设备类型决定）。

---

## 1.0.1 版本新特性

### 日志文件轮转设置

`SystemSettings` 现在支持可配置的日志文件轮转。新增四个字段用于控制日志文件的轮转和保留策略：

**`SystemSettings` 新增字段:**
- `maxFileLogSizeBytes`（字段 27）— 单个日志文件轮转前的最大字节数。未设置 = 无限制；0 = 禁用文件日志；> 0 = 文件超过此大小时轮转。
- `maxBackupLogSizeBytes`（字段 28）— 单个备份日志文件轮转前的最大字节数，语义同上。
- `maxFileLogFiles`（字段 29）— 保留的轮转日志文件最大数量（默认：10）。
- `maxBackupLogFiles`（字段 30）— 保留的轮转备份日志文件最大数量（默认：10）。

> **重要提示:** 在 `SetSystemSettings` 中必须同时发送所有 4 个字段。当任一字段存在时，服务器将更新全部 4 个字段，因此未设置的大小字段将被解释为"无限制"而非"不更改"。

---

## 1.0.0 版本新特性

CloudDrive2 1.0.0 是一个重大版本，新增按文件夹磁盘缓存控制、内容搜索、云 API 登录代理支持、服务能力查询以及本地文件夹创建功能。

### 按文件夹磁盘缓存控制

磁盘缓存设置已从按云 API 配置迁移到按文件夹粒度。`CloudAPIConfig` 上的旧字段 `fileBufferDiskCacheEnabled` 和 `fileBufferDiskCacheMaxFileSize` 已被移除（reserved 16, 17）。

**新增 RPC:**
- **`SetFolderDiskCache`** - 为指定文件夹启用并配置磁盘缓存规则
- **`RemoveFolderDiskCache`** - 禁用文件夹的磁盘缓存
- **`ListDiskCacheFolders`** - 列出所有配置了磁盘缓存规则的文件夹

**新增消息:**
```protobuf
enum ExtensionFilterMode {
  EXTENSION_FILTER_DISABLED = 0;
  EXTENSION_FILTER_INCLUDE = 1; // 仅缓存列出扩展名的文件
  EXTENSION_FILTER_EXCLUDE = 2; // 缓存除列出扩展名外的所有文件
}

message SetFolderDiskCacheRequest {
  string path = 1;
  uint64 maxFileSize = 2;      // 0 = 无限制
  uint64 minFileSize = 3;      // 0 = 无最小限制
  ExtensionFilterMode extensionFilterMode = 4;
  repeated string extensions = 5; // 不含点号，小写（如 "mp4"、"mkv"）
  bool enabled = 6;            // true = 启用，false = 显式禁用
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

**`CloudDriveFile` 新增字段:**
- `fileBufferDiskCacheEnabled`（字段 77）- 是否为此文件/文件夹启用了磁盘缓存（通过祖先解析）
- `fileBufferDiskCacheRules`（字段 78）- 此文件/文件夹的磁盘缓存规则（通过祖先解析，仅在启用时存在）

### 内容搜索

现在可以按文件内容搜索（不仅仅是文件名），前提是云端支持。

**`SearchRequest` 新增字段:**
- `contentSearch`（字段 6）- 如果为 true，同时搜索文件内容（需要云端 `canContentSearch` 支持）

**`CloudDriveFile` 新增字段:**
- `canContentSearch`（字段 79）- 云端是否支持内容搜索

### 云 API 登录代理支持

所有云 API 登录请求现在都支持可选的 `apiProxy` 和 `dataProxy` 字段，用于通过代理路由连接。用户登录/注册请求支持 `cloudfsProxy`，用于访问 CloudFS 账户服务器。

**新增代理字段的消息:**
- `UserLoginRequest`、`UserRegisterRequest`、`LoginWith2FARequest`、`LoginWithThirdPartyAccountRequest` - 新增 `cloudfsProxy`
- `LoginAliyundriveOAuthRequest`、`LoginAliyundriveQRCodeRequest`、`LoginBaiduPanOAuthRequest`、`LoginOneDriveOAuthRequest`、`LoginGoogleDriveOAuthRequest`、`LoginGoogleDriveRefreshTokenRequest`、`LoginXunleiOAuthRequest`、`LoginXunleiOpenOAuthRequest`、`Login123panOAuthRequest`、`Login115OpenOAuthRequest`、`LoginWebDavRequest`、`LoginS3Request`、`LoginCloudDriveRequest` - 新增 `apiProxy` 和 `dataProxy`
- `SystemSettings` - 新增 `cloudfsProxy`（字段 26）

**变更的 RPC:**
- `APILogin115OpenQRCode` - 现在接受 `Login115OpenQRCodeRequest` 而非 `google.protobuf.Empty`
- `APILogin189QRCode` - 现在接受 `Login189QRCodeRequest` 而非 `google.protobuf.Empty`

### 服务能力查询

**新增 RPC:**
- **`GetServiceCapabilities`** - 查询服务是否支持重启和更新

```protobuf
message ServiceCapabilities {
  bool canRestart = 1; // 服务重启是否可用
  bool canUpdate = 2;  // 服务更新是否可用
}
```

### 本地文件夹创建

**新增 RPC:**
- **`LocalCreateFolder`** - 在本地文件系统创建文件夹

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

### 历史版本亮点 (0.9.22 - 0.9.24)

**0.9.24:**
- S3 签名版本配置，以更好地兼容传统 S3 服务

**0.9.23:**
- 支持从 115 Open 和阿里云盘快速复制到 123 云盘
- 修复打开本地缓存时某些情况下可能内存占用高的问题
- 其它 bug 修复

**0.9.22:**
- 增加 Amazon S3 及 S3 兼容对象存储支持
- 新增 `APILoginS3` RPC 用于 S3 集成

**新增 RPC:**
- **`APILoginS3`** - 添加 Amazon S3 或 S3 兼容存储

**新增消息:**
```protobuf
message LoginS3Request {
  string accessKeyId = 1;           // AWS 访问密钥 ID
  string secretAccessKey = 2;       // AWS 秘密访问密钥
  string region = 3;                // AWS 区域（如 "us-east-1"）
  string bucket = 4;                // S3 桶名称
  optional string endpoint = 5;     // S3 兼容服务的自定义端点 URL（如 MinIO、Wasabi）
  bool pathStyle = 6;               // 使用路径样式 URL 而非虚拟主机样式
  bool doNotSyncToCloud = 7;        // 如为 true，则不将此 API 配置同步到云端
}
```

**主要功能:**
- 对 S3 桶的完整读写访问
- 支持标准 AWS S3 区域
- 为 S3 兼容服务提供自定义端点配置
- 为不支持虚拟主机样式的服务提供路径样式 URL 选项
- 与 CloudDrive 统一文件管理界面无缝集成

**支持的服务:**
- **Amazon S3** - AWS 的对象存储服务
- **MinIO** - 自托管 S3 兼容存储
- **Wasabi** - 云对象存储
- **Backblaze B2** - 带 S3 兼容 API 的云存储
- **DigitalOcean Spaces** - 面向开发者的对象存储
- **阿里云 OSS** - S3 兼容模式
- 任何其他实现 S3 API 的服务

**使用示例:**
```csharp
// 添加 AWS S3 桶
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

// 添加 MinIO（S3 兼容）
var minioRequest = new LoginS3Request
{
    AccessKeyId = "minioadmin",
    SecretAccessKey = "minioadmin",
    Region = "us-east-1",  // MinIO 需要但值可以是任意的
    Bucket = "test-bucket",
    Endpoint = "http://localhost:9000",
    PathStyle = true,  // MinIO 需要路径样式
    DoNotSyncToCloud = false
};

var result = await client.APILoginS3Async(minioRequest);
```

**配置说明:**
- **region**: 必填字段。对于 AWS S3，使用实际区域（如 "us-east-1"、"eu-west-1"）。对于 S3 兼容服务，此字段仍然必填，但值可能不重要，具体取决于服务。
- **endpoint**: 对于 AWS S3 可选（使用默认端点）。对于 S3 兼容服务必填（如 Wasabi 为 "https://s3.wasabisys.com"，MinIO 为 "http://localhost:9000"）。
- **pathStyle**: 对于需要路径样式 URL（`https://endpoint/bucket/key`）而非虚拟主机样式（`https://bucket.endpoint/key`）的服务，设置为 `true`。MinIO 和其他一些服务需要路径样式。
- **doNotSyncToCloud**: 如果为 `true`，此 S3 配置将不会同步到使用同一账户的其他 CloudDrive 实例。

### 历史版本亮点 (0.9.19 - 0.9.21)

**0.9.21:**
- 修复缓存大小统计不准确，可能导致磁盘空间超过配置限制的问题
- 其它 bug 修复

**0.9.20:**
- 修复缓存淘汰策略设置重启后失效的问题
- 修复部分缓存文件重启后需要重新下载的问题

**0.9.19:**

#### 文件缓冲磁盘缓存

0.9.18 版本引入了强大的基于磁盘的缓存系统，可将下载的文件内容存储在本地，显著减少云 API 调用并提升频繁访问文件的读取性能。

**RPC:**
- **`GetFileBufferDiskCacheStats`** - 获取磁盘缓存的运行时统计信息
- **`PurgeFileBufferDiskCache`** - 清除所有缓存的文件缓冲区以释放磁盘空间

**系统设置:**
- `fileBufferDiskCacheLocation` - 缓存分段的根目录
- `fileBufferDiskCacheMaxBytes` - 磁盘缓存允许的最大字节数

**每云配置 (`CloudAPIConfig`):** *（已在 1.0.0 中移除 — 磁盘缓存现在通过 `SetFolderDiskCache` 按文件夹配置）*
- ~~`fileBufferDiskCacheEnabled`~~ - 已在 1.0.0 中移除
- ~~`fileBufferDiskCacheMaxFileSize`~~ - 已在 1.0.0 中移除

#### 照片库集成（iOS/移动端）

- **`NotifyPhotoLibraryChanges`** - 通知 CloudDrive 有新照片可供备份

#### 第三方账户登录

- **`LoginWithThirdPartyAccount`** - 使用支持的第三方云提供商的 OAuth 令牌登录

### 历史版本亮点 (0.9.16)

#### 备份自动化增强

`Backup` 消息新增 `syncDeleteFromDest` 开关。启用后，CloudDrive 在完整扫描过程中会按照已配置的删除策略（保留、回收站、移动到历史文件夹等）清理目标端不存在于源端的文件。

#### 可配置的延迟启动

`SystemSettings` 新增 `startDelaySecs`，可在服务启动后先等待指定秒数再挂载云盘或启动备份——适合需要等待 VPN、磁盘或其他服务的场景。

### API 令牌推送权限 (0.9.15)

`TokenPermissions` 的 `allow_push_message` 权限可授予令牌推送通知访问权限。仅对需要 `PushMessage`/`PushTaskChange` 流式 RPC 的自动化授予此权限。

### 0.9.14 引入的安全增强

0.9.14 为想要启用双因素认证(2FA)和会话管理的部署奠定了基础。这些能力在 0.9.19 中保持不变，下面是速查参考。

#### 双因素认证 (2FA)

CloudDrive2 支持业界标准的基于时间的一次性密码 (TOTP) 双因素认证,兼容 Microsoft Authenticator、Google Authenticator 和 Authy 等身份验证器应用。

**2FA 方法:**
- **`Check2FAStatus`** - 检查当前用户是否启用了 2FA
- **`Setup2FA`** - 生成 TOTP 密钥和二维码用于身份验证器应用设置
- **`Enable2FA`** - 通过验证 TOTP 代码启用 2FA(返回恢复代码)
- **`Disable2FA`** - 使用有效的 TOTP 代码禁用 2FA
- **`GetRecoveryCodes`** - 查看剩余的未使用恢复代码
- **`RegenerateRecoveryCodes`** - 生成新的恢复代码(使旧代码失效)
- **`LoginWith2FA`** - 支持 TOTP 代码和恢复代码的公共登录方法

**支持 2FA 的现有方法:**
- `GetToken` - 接受可选的 `totpCode` 参数用于启用 2FA 的账户
- `ChangePassword` - 启用 2FA 时需要 TOTP 代码
- `ChangeEmail` - 启用 2FA 时需要 TOTP 代码

**安全特性:**
- 基于 TOTP 的身份验证(RFC 6238 标准)
- 当身份验证器不可用时可使用恢复代码访问账户
- 每个恢复代码只能使用一次,使用后自动失效
- 恢复代码可随时重新生成

**重要提示:**
- 启用 2FA 后,旧版本的 CloudDrive2 客户端(< 0.9.14)将无法登录
- 启用 2FA 之前确保所有设备都已升级到 0.9.14+
- 将恢复代码存储在安全位置 - 它们是您的备用访问方法

#### 会话管理

会话管理允许用户查看和控制所有设备上的活动登录会话。

**会话管理方法:**
- **`GetSessions`** - 列出所有活动的刷新令牌会话及设备信息
- **`RevokeSession`** - 通过 ID 撤销特定会话(注销该设备)
- **`RevokeOtherSessions`** - 撤销除当前会话外的所有会话

**会话信息包括:**
- 会话 ID 和设备 ID
- 设备名称和操作系统类型
- 创建时间戳和最后使用时间戳
- 过期时间戳
- 最后已知 IP 地址

**使用场景:**
- 查看所有可访问您账户的设备
- 远程注销遗忘的会话或丢失的设备
- 更改密码后清除所有其他会话以增强安全性
- 监控账户访问模式

### 安全最佳实践

1. **在所有生产账户上启用 2FA** 以防止未经授权的访问
2. **定期使用 `GetSessions` 审查会话**以识别未知设备
3. **撤销未使用的会话**以最小化攻击面
4. **安全存储恢复代码** - 像对待密码一样对待它们
5. **在启用 2FA 之前将所有客户端升级到 0.9.14+** 以避免锁定

---

## 概述

CloudDrive2 提供了一个全面的 gRPC API,用于管理云存储、文件操作和系统管理。该 API 遵循客户端-服务器架构,客户端通过 HTTP/2 上的 Protocol Buffers(或浏览器客户端使用 gRPC-Web)与 CloudDrive 服务器通信。

**核心特性:**
- 基于 JWT 令牌的用户认证
- 文件和文件夹操作(创建、读取、更新、删除)
- 云存储集成(115、阿里云盘、百度网盘、OneDrive、Google Drive 等)
- 挂载点管理
- 传输任务监控(上传/下载)
- 备份和同步操作
- WebDAV 服务器配置
- 通过服务器流式传输的实时推送通知

**Proto 文件位置:** `clouddrive.proto`

**服务名称:** `CloudDriveFileSrv`

**命名空间:** `CloudDriveSrv.Protos` (C#)

---

## 服务定义

```protobuf
syntax = "proto3";
package clouddrive;
option csharp_namespace = "CloudDriveSrv.Protos";

service CloudDriveFileSrv {
  // 100+ 个 RPC 方法用于全面的云盘管理
}
```

---

## 下载 Proto 文件

CloudDrive2 gRPC 服务在 Protocol Buffers (.proto) 文件中定义。您需要此文件来为您首选的编程语言生成客户端代码。

### 获取 Proto 文件

**从官方网站下载**

从 CloudDrive2 官方网站下载 proto 文件:

**直接下载链接:** [clouddrive.proto](https://www.clouddrive2.com/api/clouddrive.proto)

**或使用 curl:**

```bash
# 下载 proto 文件
curl https://www.clouddrive2.com/api/clouddrive.proto -o clouddrive.proto
```

**或使用 wget:**

```bash
# 下载 proto 文件
wget https://www.clouddrive2.com/api/clouddrive.proto
```

将文件保存为 `clouddrive.proto` 到您的项目目录。

### 使用 Proto 文件

获得 proto 文件后,为您的语言生成客户端代码:

**C#:**
```bash
# 使用 protoc 编译器
protoc --csharp_out=. --grpc_out=. --plugin=protoc-gen-grpc=grpc_csharp_plugin clouddrive.proto
```

**Java:**
```bash
# 使用带有 Java 插件的 protoc
protoc --java_out=. --grpc-java_out=. clouddrive.proto
```

**Go:**
```bash
# 使用带有 Go 插件的 protoc
protoc --go_out=. --go_opt=paths=source_relative \
       --go-grpc_out=. --go-grpc_opt=paths=source_relative \
       clouddrive.proto
```

**Python:**
```bash
# 使用 grpcio-tools
python -m grpc_tools.protoc -I. --python_out=. --grpc_python_out=. clouddrive.proto
```

### Proto 文件结构

`clouddrive.proto` 文件包含:
- **服务定义**: 包含 100+ RPC 方法的 `CloudDriveFileSrv`
- **消息类型**: 所有操作的请求和响应消息
- **枚举**: 状态码、哈希类型、云提供商类型等
- **嵌套类型**: 文件、文件夹和元数据的复杂数据结构

### 版本兼容性

**当前版本:** 0.9.19

始终使用与 CloudDrive2 服务器相同版本的 proto 文件以确保兼容性。您可以使用 `GetRuntimeInfo` 方法检查服务器版本。

---

## 身份验证

CloudDrive2 对大多数 API 端点使用 JWT (JSON Web Token) 持有者认证。

### 认证流程

有两种方法可以获取 JWT 令牌用于 API 认证:

#### 方法一: 使用 GetToken (用户名/密码)

1. **获取 JWT 令牌**: 使用用户名和密码调用 `GetToken`
2. **存储令牌**: 保存 JWT 令牌供后续请求使用
3. **包含在请求中**: 将令牌添加到 `Authorization` 元数据头中
4. **令牌格式**: `Authorization: Bearer <your-jwt-token>`

#### 方法二: 使用 API 令牌 (推荐用于应用程序)

**为了获得更好的安全性和权限控制,建议使用用户创建的 API 令牌:**

1. **创建 API 令牌**: 用户通过 CloudDrive 用户界面或 `CreateToken` API 创建 API 令牌
   - 指定权限(文件操作、挂载管理等)
   - 设置根目录限制
   - 配置令牌过期时间
   - 启用特定的日志选项

2. **导入令牌**: 应用程序直接使用预先创建的 API 令牌
   - 无需存储用户名/密码
   - 细粒度权限控制
   - 易于撤销而不更改用户密码
   - 通过令牌特定的日志记录提供更好的审计追踪

3. **使用令牌**: 将 API 令牌添加到 `Authorization` 元数据头中
   - 令牌格式: `Authorization: Bearer <api-token>`

**C# 示例 - 使用 API 令牌:**

```csharp
// 用户通过 UI 或 CreateToken API 创建具有特定权限的令牌
// 然后应用程序直接使用该令牌
var apiToken = "eyJhbGc..."; // 预先创建的 API 令牌

_client.SetJwtToken(apiToken);
var files = await _client.GetSubFilesAsync("/");
```

### 不需要认证的方法

以下方法是公开的,不需要 JWT 令牌:
- `GetSystemInfo` - 检查服务器是否已登录
- `GetToken` - 获取 JWT 令牌
- `Login` - 登录到 CloudFS 服务器
- `LoginWithThirdPartyAccount` - 使用第三方云账户登录
- `Register` - 注册新账户
- `SendResetAccountEmail` - 请求密码重置
- `ResetAccount` - 使用验证码重置账户
- `GetApiTokenInfo` - 获取 API 令牌信息

所有其他方法都需要带有有效 JWT 令牌的 `Authorization` 头。

---

## 快速入门

### C# 配置

**前置要求:**
- .NET 6.0 或更高版本
- NuGet 包: `Grpc.Net.Client`, `Google.Protobuf`, `Grpc.Tools`

**1. 从 proto 文件生成 C# 客户端:**

添加到你的 `.csproj`:
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

**2. 基本客户端示例:**

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

    // 获取 JWT 令牌
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
            Console.WriteLine($"认证成功。令牌过期时间: {response.Expiration}");
            return true;
        }

        Console.WriteLine($"认证失败: {response.ErrorMessage}");
        return false;
    }

    // 创建授权调用选项
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

    // 获取系统信息(无需认证)
    public async Task<CloudDriveSystemInfo> GetSystemInfoAsync()
    {
        return await _client.GetSystemInfoAsync(new Google.Protobuf.WellKnownTypes.Empty());
    }

    // 列出目录中的文件(需要认证)
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

    // 创建文件夹
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

    // 获取下载文件 URL
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

// 使用示例
class Program
{
    static async Task Main(string[] args)
    {
        using var client = new CloudDriveClient("http://localhost:19798");

        // 检查系统信息
        var sysInfo = await client.GetSystemInfoAsync();
        Console.WriteLine($"系统就绪: {sysInfo.SystemReady}, 用户: {sysInfo.UserName}");

        // 认证
        if (await client.AuthenticateAsync("your-username", "your-password"))
        {
            // 列出根目录文件
            var files = await client.GetSubFilesAsync("/");
            Console.WriteLine($"找到 {files.Count} 个文件");

            foreach (var file in files)
            {
                Console.WriteLine($"{file.Name} ({file.Size} 字节) - {file.FileType}");
            }

            // 创建文件夹
            var result = await client.CreateFolderAsync("/", "MyNewFolder");
            if (result.Result.Success)
            {
                Console.WriteLine($"文件夹已创建: {result.FolderCreated.FullPathName}");
            }
        }
    }
}
```

---

### Java 配置

**前置要求:**
- Java 11 或更高版本
- Maven 或 Gradle
- 依赖: `grpc-netty`, `grpc-protobuf`, `grpc-stub`

**1. 添加依赖到 `pom.xml`:**

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

**2. 基本客户端示例:**

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

    // 认证并获取 JWT 令牌
    public boolean authenticate(String username, String password) {
        GetTokenRequest request = GetTokenRequest.newBuilder()
                .setUserName(username)
                .setPassword(password)
                .build();

        JWTToken response = blockingStub.getToken(request);

        if (response.getSuccess()) {
            this.jwtToken = response.getToken();
            System.out.println("认证成功");
            return true;
        }

        System.err.println("认证失败: " + response.getErrorMessage());
        return false;
    }

    // 创建带授权头的 stub
    private CloudDriveFileSrvGrpc.CloudDriveFileSrvBlockingStub createAuthorizedStub() {
        if (jwtToken == null || jwtToken.isEmpty()) {
            return blockingStub;
        }

        Metadata headers = new Metadata();
        Metadata.Key<String> authKey = Metadata.Key.of("Authorization", Metadata.ASCII_STRING_MARSHALLER);
        headers.put(authKey, "Bearer " + jwtToken);

        return MetadataUtils.attachHeaders(blockingStub, headers);
    }

    // 获取系统信息(无需认证)
    public CloudDriveSystemInfo getSystemInfo() {
        return blockingStub.getSystemInfo(Empty.getDefaultInstance());
    }

    // 列出目录中的文件
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

    // 创建文件夹
    public CreateFolderResult createFolder(String parentPath, String folderName) {
        CreateFolderRequest request = CreateFolderRequest.newBuilder()
                .setParentPath(parentPath)
                .setFolderName(folderName)
                .build();

        CloudDriveFileSrvGrpc.CloudDriveFileSrvBlockingStub stub = createAuthorizedStub();
        return stub.createFolder(request);
    }

    // 删除文件
    public FileOperationResult deleteFile(String filePath) {
        FileRequest request = FileRequest.newBuilder()
                .setPath(filePath)
                .build();

        CloudDriveFileSrvGrpc.CloudDriveFileSrvBlockingStub stub = createAuthorizedStub();
        return stub.deleteFile(request);
    }

    // 重命名文件
    public FileOperationResult renameFile(String filePath, String newName) {
        RenameFileRequest request = RenameFileRequest.newBuilder()
                .setTheFilePath(filePath)
                .setNewName(newName)
                .build();

        CloudDriveFileSrvGrpc.CloudDriveFileSrvBlockingStub stub = createAuthorizedStub();
        return stub.renameFile(request);
    }

    // 使用示例
    public static void main(String[] args) throws Exception {
        CloudDriveClient client = new CloudDriveClient("localhost", 19798);

        try {
            // 检查系统信息
            CloudDriveSystemInfo sysInfo = client.getSystemInfo();
            System.out.println("系统就绪: " + sysInfo.getSystemReady() +
                             ", 用户: " + sysInfo.getUserName());

            // 认证
            if (client.authenticate("your-username", "your-password")) {
                // 列出根目录
                List<CloudDriveFile> files = client.getSubFiles("/", false);
                System.out.println("找到 " + files.size() + " 个文件");

                for (CloudDriveFile file : files) {
                    System.out.println(file.getName() + " (" + file.getSize() + " 字节)");
                }

                // 创建文件夹
                CreateFolderResult result = client.createFolder("/", "MyNewFolder");
                if (result.getResult().getSuccess()) {
                    System.out.println("文件夹已创建: " +
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

### Go 配置

**前置要求:**
- Go 1.19 或更高版本
- Protocol Buffers 编译器 (`protoc`)
- Go 插件: `protoc-gen-go`, `protoc-gen-go-grpc`

**1. 安装依赖:**

```bash
go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest

# 在你的项目目录中
go mod init clouddrive-client
go get google.golang.org/grpc
go get google.golang.org/protobuf
```

**2. 从 proto 生成 Go 代码:**

```bash
protoc --go_out=. --go_opt=paths=source_relative \
    --go-grpc_out=. --go-grpc_opt=paths=source_relative \
    clouddrive.proto
```

**3. 基本客户端示例:**

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
    pb "your-module/clouddrive" // 调整导入路径
)

type CloudDriveClient struct {
    conn     *grpc.ClientConn
    client   pb.CloudDriveFileSrvClient
    jwtToken string
}

// NewClient 创建新的 CloudDrive 客户端
func NewClient(address string) (*CloudDriveClient, error) {
    conn, err := grpc.Dial(address, grpc.WithTransportCredentials(insecure.NewCredentials()))
    if err != nil {
        return nil, fmt.Errorf("连接失败: %v", err)
    }

    return &CloudDriveClient{
        conn:   conn,
        client: pb.NewCloudDriveFileSrvClient(conn),
    }, nil
}

// Close 关闭连接
func (c *CloudDriveClient) Close() error {
    return c.conn.Close()
}

// Authenticate 获取 JWT 令牌
func (c *CloudDriveClient) Authenticate(ctx context.Context, username, password string) error {
    req := &pb.GetTokenRequest{
        UserName: username,
        Password: password,
    }

    resp, err := c.client.GetToken(ctx, req)
    if err != nil {
        return fmt.Errorf("认证失败: %v", err)
    }

    if !resp.Success {
        return fmt.Errorf("认证失败: %s", resp.ErrorMessage)
    }

    c.jwtToken = resp.Token
    fmt.Printf("认证成功。令牌过期时间: %v\n", resp.Expiration.AsTime())
    return nil
}

// createAuthorizedContext 创建带授权头的上下文
func (c *CloudDriveClient) createAuthorizedContext(ctx context.Context) context.Context {
    if c.jwtToken == "" {
        return ctx
    }

    md := metadata.Pairs("authorization", fmt.Sprintf("Bearer %s", c.jwtToken))
    return metadata.NewOutgoingContext(ctx, md)
}

// GetSystemInfo 获取系统信息(无需认证)
func (c *CloudDriveClient) GetSystemInfo(ctx context.Context) (*pb.CloudDriveSystemInfo, error) {
    return c.client.GetSystemInfo(ctx, &pb.Empty{})
}

// GetSubFiles 列出目录中的文件
func (c *CloudDriveClient) GetSubFiles(ctx context.Context, path string, forceRefresh bool) ([]*pb.CloudDriveFile, error) {
    req := &pb.ListSubFileRequest{
        Path:         path,
        ForceRefresh: forceRefresh,
    }

    authCtx := c.createAuthorizedContext(ctx)
    stream, err := c.client.GetSubFiles(authCtx, req)
    if err != nil {
        return nil, fmt.Errorf("获取子文件失败: %v", err)
    }

    var files []*pb.CloudDriveFile
    for {
        resp, err := stream.Recv()
        if err == io.EOF {
            break
        }
        if err != nil {
            return nil, fmt.Errorf("接收流时出错: %v", err)
        }
        files = append(files, resp.SubFiles...)
    }

    return files, nil
}

// CreateFolder 创建新文件夹
func (c *CloudDriveClient) CreateFolder(ctx context.Context, parentPath, folderName string) (*pb.CreateFolderResult, error) {
    req := &pb.CreateFolderRequest{
        ParentPath: parentPath,
        FolderName: folderName,
    }

    authCtx := c.createAuthorizedContext(ctx)
    return c.client.CreateFolder(authCtx, req)
}

// DeleteFile 删除文件或文件夹
func (c *CloudDriveClient) DeleteFile(ctx context.Context, filePath string) (*pb.FileOperationResult, error) {
    req := &pb.FileRequest{
        Path: filePath,
    }

    authCtx := c.createAuthorizedContext(ctx)
    return c.client.DeleteFile(authCtx, req)
}

// RenameFile 重命名文件
func (c *CloudDriveClient) RenameFile(ctx context.Context, filePath, newName string) (*pb.FileOperationResult, error) {
    req := &pb.RenameFileRequest{
        TheFilePath: filePath,
        NewName:     newName,
    }

    authCtx := c.createAuthorizedContext(ctx)
    return c.client.RenameFile(authCtx, req)
}

// 使用示例
func main() {
    client, err := NewClient("localhost:19798")
    if err != nil {
        log.Fatalf("创建客户端失败: %v", err)
    }
    defer client.Close()

    ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
    defer cancel()

    // 获取系统信息
    sysInfo, err := client.GetSystemInfo(ctx)
    if err != nil {
        log.Fatalf("获取系统信息失败: %v", err)
    }
    fmt.Printf("系统就绪: %v, 用户: %s\n", sysInfo.SystemReady, sysInfo.UserName)

    // 认证
    err = client.Authenticate(ctx, "your-username", "your-password")
    if err != nil {
        log.Fatalf("认证失败: %v", err)
    }

    // 列出根目录中的文件
    files, err := client.GetSubFiles(ctx, "/", false)
    if err != nil {
        log.Fatalf("获取文件失败: %v", err)
    }

    fmt.Printf("找到 %d 个文件\n", len(files))
    for _, file := range files {
        fmt.Printf("%s (%d 字节) - 类型: %v\n", file.Name, file.Size, file.FileType)
    }

    // 创建文件夹
    result, err := client.CreateFolder(ctx, "/", "MyNewFolder")
    if err != nil {
        log.Fatalf("创建文件夹失败: %v", err)
    }

    if result.Result.Success {
        fmt.Printf("文件夹已创建: %s\n", result.FolderCreated.FullPathName)
    } else {
        fmt.Printf("创建文件夹失败: %s\n", result.Result.ErrorMessage)
    }
}
```

---

### Python 配置

**前置要求:**
- Python 3.7 或更高版本
- pip 包: `grpcio`, `grpcio-tools`

**1. 安装依赖:**

```bash
pip install grpcio grpcio-tools
```

**2. 从 proto 生成 Python 代码:**

```bash
python -m grpc_tools.protoc -I. --python_out=. --grpc_python_out=. clouddrive.proto
```

**3. 基本客户端示例:**

```python
import grpc
from google.protobuf import empty_pb2
import clouddrive_pb2
import clouddrive_pb2_grpc


class CloudDriveClient:
    def __init__(self, address):
        """初始化 CloudDrive 客户端

        Args:
            address: 服务器地址 (例如 'localhost:19798')
        """
        self.channel = grpc.insecure_channel(address)
        self.stub = clouddrive_pb2_grpc.CloudDriveFileSrvStub(self.channel)
        self.jwt_token = None

    def close(self):
        """关闭通道"""
        self.channel.close()

    def authenticate(self, username, password):
        """认证并获取 JWT 令牌

        Args:
            username: 用户名
            password: 密码

        Returns:
            bool: 如果认证成功返回 True
        """
        request = clouddrive_pb2.GetTokenRequest(
            userName=username,
            password=password
        )

        response = self.stub.GetToken(request)

        if response.success:
            self.jwt_token = response.token
            print(f"认证成功。令牌过期时间: {response.expiration}")
            return True
        else:
            print(f"认证失败: {response.errorMessage}")
            return False

    def _create_authorized_metadata(self):
        """创建带授权头的元数据"""
        if not self.jwt_token:
            return []
        return [('authorization', f'Bearer {self.jwt_token}')]

    def get_system_info(self):
        """获取系统信息(无需认证)

        Returns:
            CloudDriveSystemInfo: 系统信息
        """
        return self.stub.GetSystemInfo(empty_pb2.Empty())

    def get_sub_files(self, path, force_refresh=False):
        """列出目录中的文件

        Args:
            path: 目录路径
            force_refresh: 强制刷新缓存

        Returns:
            list: CloudDriveFile 对象列表
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
        """创建新文件夹

        Args:
            parent_path: 父目录路径
            folder_name: 新文件夹名称

        Returns:
            CreateFolderResult: 操作结果
        """
        request = clouddrive_pb2.CreateFolderRequest(
            parentPath=parent_path,
            folderName=folder_name
        )

        metadata = self._create_authorized_metadata()
        return self.stub.CreateFolder(request, metadata=metadata)

    def delete_file(self, file_path):
        """删除文件或文件夹

        Args:
            file_path: 文件或文件夹路径

        Returns:
            FileOperationResult: 操作结果
        """
        request = clouddrive_pb2.FileRequest(path=file_path)
        metadata = self._create_authorized_metadata()
        return self.stub.DeleteFile(request, metadata=metadata)

    def rename_file(self, file_path, new_name):
        """重命名文件

        Args:
            file_path: 当前文件路径
            new_name: 新文件名

        Returns:
            FileOperationResult: 操作结果
        """
        request = clouddrive_pb2.RenameFileRequest(
            theFilePath=file_path,
            newName=new_name
        )

        metadata = self._create_authorized_metadata()
        return self.stub.RenameFile(request, metadata=metadata)

    def move_file(self, source_paths, dest_path, conflict_policy=0):
        """移动文件到目标位置

        Args:
            source_paths: 源文件路径列表
            dest_path: 目标路径
            conflict_policy: 0=覆盖, 1=重命名, 2=跳过

        Returns:
            FileOperationResult: 操作结果
        """
        request = clouddrive_pb2.MoveFileRequest(
            theFilePaths=source_paths,
            destPath=dest_path,
            conflictPolicy=conflict_policy
        )

        metadata = self._create_authorized_metadata()
        return self.stub.MoveFile(request, metadata=metadata)

    def search_files(self, search_term, path="/", force_refresh=False, fuzzy_match=False):
        """搜索文件

        Args:
            search_term: 搜索查询
            path: 搜索根路径
            force_refresh: 强制刷新缓存
            fuzzy_match: 使用模糊匹配

        Returns:
            list: CloudDriveFile 对象列表
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
        """获取账户状态和计划信息

        Returns:
            AccountStatusResult: 账户状态
        """
        metadata = self._create_authorized_metadata()
        return self.stub.GetAccountStatus(empty_pb2.Empty(), metadata=metadata)

    def get_download_url(self, path, preview=False, lazy_read=False):
        """获取文件下载 URL

        Args:
            path: 文件路径
            preview: 预览模式
            lazy_read: 延迟读取模式

        Returns:
            DownloadUrlPathInfo: 下载 URL 信息
        """
        request = clouddrive_pb2.GetDownloadUrlPathRequest(
            path=path,
            preview=preview,
            lazy_read=lazy_read
        )

        metadata = self._create_authorized_metadata()
        return self.stub.GetDownloadUrlPath(request, metadata=metadata)


# 使用示例
def main():
    client = CloudDriveClient('localhost:19798')

    try:
        # 获取系统信息
        sys_info = client.get_system_info()
        print(f"系统就绪: {sys_info.SystemReady}, 用户: {sys_info.UserName}")

        # 认证
        if client.authenticate('your-username', 'your-password'):
            # 列出根目录
            files = client.get_sub_files('/')
            print(f"找到 {len(files)} 个文件")

            for file in files:
                file_type = "目录" if file.isDirectory else "文件"
                print(f"{file.name} ({file.size} 字节) - {file_type}")

            # 创建文件夹
            result = client.create_folder('/', 'MyNewFolder')
            if result.result.success:
                print(f"文件夹已创建: {result.folderCreated.fullPathName}")
            else:
                print(f"创建文件夹失败: {result.result.errorMessage}")

            # 搜索文件
            search_results = client.search_files('test', '/')
            print(f"找到 {len(search_results)} 个匹配文件")

            # 获取账户状态
            account = client.get_account_status()
            print(f"账户: {account.userName}, 余额: {account.accountBalance}")
            print(f"计划: {account.accountPlan.planName}")

    finally:
        client.close()


if __name__ == '__main__':
    main()
```

---

## API 参考

### 公共方法(无需授权)

#### GetSystemInfo

返回系统信息,包括登录状态和用户名。

**请求:** `google.protobuf.Empty`

**响应:** `CloudDriveSystemInfo`
```protobuf
message CloudDriveSystemInfo {
  bool IsLogin = 1;
  string UserName = 2;
  bool SystemReady = 3;
  optional string SystemMessage = 4;
  optional bool hasError = 5;
  // 设备电源和存储配置，参见 DevicePowerType
  DevicePowerType devicePowerType = 6;
  // 当目录缓存持久化和磁盘缓冲区被强制禁用时为 true
  //（由平台配置或 SLOW_STORAGE 设备类型决定）
  optional bool diskCacheDisabled = 7;
}
```

**示例 (C#):**
```csharp
var systemInfo = await client.GetSystemInfoAsync(new Empty());
Console.WriteLine($"已登录: {systemInfo.IsLogin}, 用户: {systemInfo.UserName}");
```

---

#### GetToken

获取用于认证的 JWT 令牌。

**请求:** `GetTokenRequest`
```protobuf
message GetTokenRequest {
  string userName = 1;
  string password = 2;
  optional string totpCode = 3; // 启用 2FA 的账户的可选 TOTP 代码
}
```

**注意:** 如果账户启用了双因素认证 (2FA),您必须在 `totpCode` 字段中提供有效的 6 位 TOTP 代码或 8 位恢复代码。对于未启用 2FA 的账户,可以省略此字段。

**响应:** `JWTToken`
```protobuf
message JWTToken {
  bool success = 1;
  string errorMessage = 2;
  string token = 3;
  google.protobuf.Timestamp expiration = 4;
}
```

**示例 (Java):**
```java
GetTokenRequest request = GetTokenRequest.newBuilder()
    .setUserName("myusername")
    .setPassword("mypassword")
    .build();

JWTToken response = blockingStub.getToken(request);
if (response.getSuccess()) {
    String token = response.getToken();
    // 存储令牌供将来请求使用
}
```

---

#### Login

登录到 CloudFS 服务器。

**请求:** `UserLoginRequest`
```protobuf
message UserLoginRequest {
  string userName = 1;
  string password = 2;
  bool synDataToCloud = 3;
  optional ProxyInfo cloudfsProxy = 4; // 可选代理，用于访问 CloudFS 账户服务器
}
```

**响应:** `FileOperationResult`

**示例 (Go):**
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
    fmt.Println("登录成功")
}
```

---

#### LoginWithThirdPartyAccount

使用第三方云账户（如迅雷）登录。这是一个不需要预先授权的公开方法。

**请求:** `LoginWithThirdPartyAccountRequest`
```protobuf
message LoginWithThirdPartyAccountRequest {
  string cloudName = 1;       // 云提供商名称（如 "Xunlei"）
  string refreshToken = 2;    // OAuth 刷新令牌
  string accessToken = 3;     // OAuth 访问令牌
  uint64 expiresIn = 4;       // 令牌过期时间（秒）
  bool synDataToCloud = 5;    // 是否同步数据到云端
}
```

**响应:** `JWTToken`

**0.9.18 新增**

---

#### Register

注册新用户账户。

**请求:** `UserRegisterRequest`
```protobuf
message UserRegisterRequest {
  string userName = 1;
  string password = 2;
}
```

**响应:** `FileOperationResult`

---

#### SendResetAccountEmail

发送密码重置邮件。

**请求:** `SendResetAccountEmailRequest`
```protobuf
message SendResetAccountEmailRequest {
  string email = 1;
}
```

**响应:** `google.protobuf.Empty`

---

#### ResetAccount

使用重置验证码重置账户密码。

**请求:** `ResetAccountRequest`
```protobuf
message ResetAccountRequest {
  string resetCode = 1;
  string newPassword = 2;
}
```

**响应:** `google.protobuf.Empty`

---

#### GetApiTokenInfo

获取 API 令牌信息。

**请求:** `StringValue` (令牌字符串)

**响应:** `TokenInfo`

---

### 授权方法

以下所有方法都需要 `Authorization: Bearer <token>` 头。

---

### 文件操作

#### GetSubFiles (服务器流式传输)

列出路径中的所有文件和子目录。

**请求:** `ListSubFileRequest`
```protobuf
message ListSubFileRequest {
  string path = 1;
  bool forceRefresh = 2;
  optional bool checkExpires = 3;
}
```

**响应流:** `SubFilesReply`
```protobuf
message SubFilesReply {
  repeated CloudDriveFile subFiles = 1;
}
```

**示例 (Python):**
```python
request = clouddrive_pb2.ListSubFileRequest(
    path="/my/folder",
    forceRefresh=False
)

files = []
for response in stub.GetSubFiles(request, metadata=auth_metadata):
    files.extend(response.subFiles)

print(f"找到 {len(files)} 个文件")
```

---

#### FindFileByPath

通过路径查找特定文件。

**请求:** `FindFileByPathRequest`
```protobuf
message FindFileByPathRequest {
  string parentPath = 1;
  string path = 2;
}
```

**响应:** `CloudDriveFile`

---

#### CreateFolder

创建新文件夹。

**请求:** `CreateFolderRequest`
```protobuf
message CreateFolderRequest {
  string parentPath = 1;
  string folderName = 2;
}
```

**响应:** `CreateFolderResult`
```protobuf
message CreateFolderResult {
  CloudDriveFile folderCreated = 1;
  FileOperationResult result = 2;
}
```

**示例 (C#):**
```csharp
var request = new CreateFolderRequest
{
    ParentPath = "/Documents",
    FolderName = "NewFolder"
};

var result = await client.CreateFolderAsync(request, callOptions);
if (result.Result.Success)
{
    Console.WriteLine($"已创建: {result.FolderCreated.FullPathName}");
}
```

---

#### CreateEncryptedFolder

创建带密码保护的加密文件夹。

**请求:** `CreateEncryptedFolderRequest`
```protobuf
message CreateEncryptedFolderRequest {
  string parentPath = 1;
  string folderName = 2;
  string password = 3;
  bool savePassword = 4; // 如果为 true,密码将保存到数据库
}
```

**响应:** `CreateFolderResult`

---

#### UnlockEncryptedFile

解锁加密的文件或文件夹。

**请求:** `UnlockEncryptedFileRequest`
```protobuf
message UnlockEncryptedFileRequest {
  string path = 1;
  string password = 2;
  bool permanentUnlock = 3; // 如果为 true,密码保存到数据库
}
```

**响应:** `FileOperationResult`

---

#### LockEncryptedFile

锁定加密的文件或文件夹。

**请求:** `FileRequest`

**响应:** `FileOperationResult`

---

#### RenameFile

重命名单个文件或文件夹。

**请求:** `RenameFileRequest`
```protobuf
message RenameFileRequest {
  string theFilePath = 1;
  string newName = 2;
}
```

**响应:** `FileOperationResult`

**示例 (Java):**
```java
RenameFileRequest request = RenameFileRequest.newBuilder()
    .setTheFilePath("/Documents/oldname.txt")
    .setNewName("newname.txt")
    .build();

FileOperationResult result = stub.renameFile(request);
if (result.getSuccess()) {
    System.out.println("文件重命名成功");
}
```

---

#### RenameFiles

批量重命名多个文件。

**请求:** `RenameFilesRequest`
```protobuf
message RenameFilesRequest {
  repeated RenameFileRequest renameFiles = 1;
}
```

**响应:** `FileOperationResult`

---

#### MoveFile

将文件移动到目标文件夹。

**请求:** `MoveFileRequest`
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
  optional bool handleConflictRecursively = 5; // 用于文件夹冲突
}
```

**响应:** `FileOperationResult`

**示例 (Go):**
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

将文件复制到目标文件夹。

**请求:** `CopyFileRequest`
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

**响应:** `FileOperationResult`

---

#### DeleteFile

删除单个文件或文件夹。

**请求:** `FileRequest`
```protobuf
message FileRequest {
  string path = 1;
  optional bool forceRefresh = 2;
}
```

**响应:** `FileOperationResult`

---

#### DeleteFiles

批量删除多个文件。

**请求:** `MultiFileRequest`
```protobuf
message MultiFileRequest {
  repeated string path = 1;
}
```

**响应:** `FileOperationResult`

**示例 (Python):**
```python
request = clouddrive_pb2.MultiFileRequest(
    path=["/file1.txt", "/file2.txt", "/folder1"]
)

result = stub.DeleteFiles(request, metadata=auth_metadata)
if result.success:
    print("文件删除成功")
```

---

#### DeleteFilePermanently

永久删除文件(某些云存储支持,如阿里云盘)。

**请求:** `FileRequest`

**响应:** `FileOperationResult`

---

#### DeleteFilesPermanently

批量永久删除文件。

**请求:** `MultiFileRequest`

**响应:** `FileOperationResult`

---

#### GetSearchResults (服务器流式传输)

搜索符合条件的文件。

**请求:** `SearchRequest`
```protobuf
message SearchRequest {
  string path = 1;
  string searchFor = 2;
  bool forceRefresh = 3;
  bool fuzzyMatch = 4;
  optional bool addResultToMountedSearchFolder = 5; // 将搜索结果添加到已挂载的搜索文件夹
  optional bool contentSearch = 6; // 如果为 true，同时搜索文件内容（需要 canContentSearch）
}
```

**响应流:** `SubFilesReply`

**示例 (C#):**
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

获取文件夹的详细属性。

**请求:** `FileRequest`

**响应:** `FileDetailProperties`
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

获取总空间/可用空间/已用空间信息。

**请求:** `FileRequest`

**响应:** `SpaceInfo`
```protobuf
message SpaceInfo {
  int64 totalSpace = 1;
  int64 usedSpace = 2;
  int64 freeSpace = 3;
}
```

---

#### GetMetaData

获取文件元数据。

**请求:** `FileRequest`

**响应:** `FileMetaData`
```protobuf
message FileMetaData {
  map<string, string> metadata = 1;
}
```

---

#### GetOriginalPath

获取搜索结果文件的原始路径。

**请求:** `FileRequest`

**响应:** `StringResult`

---

#### GetDownloadUrlPath

获取文件的下载 URL。

**请求:** `GetDownloadUrlPathRequest`
```protobuf
message GetDownloadUrlPathRequest {
  string path = 1;
  bool preview = 2;
  bool lazy_read = 3;
  bool get_direct_url = 4; // 如果可用,请求直接 URL
}
```

**响应:** `DownloadUrlPathInfo`
```protobuf
message DownloadUrlPathInfo {
  string downloadUrlPath = 1; // 带占位符 {SCHEME}, {HOST}, {PREVIEW} 的 URL
  optional uint64 expiresIn = 2; // 过期前的秒数
  optional string directUrl = 3; // 直接 URL(如果可用)
  optional string userAgent = 4; // 直接下载使用的 User-Agent
  map<string, string> additionalHeaders = 5; // 直接下载的附加请求头
}
```

**示例 (Java):**
```java
GetDownloadUrlPathRequest request = GetDownloadUrlPathRequest.newBuilder()
    .setPath("/Movies/video.mp4")
    .setPreview(false)
    .setLazyRead(false)
    .setGetDirectUrl(true)
    .build();

DownloadUrlPathInfo info = stub.getDownloadUrlPath(request);
System.out.println("下载 URL: " + info.getDownloadUrlPath());
if (info.hasDirectUrl()) {
    System.out.println("直接 URL: " + info.getDirectUrl());
    if (info.hasUserAgent()) {
        System.out.println("User-Agent: " + info.getUserAgent());
    }
}
```

---

#### CreateFile

创建新文件并打开以供写入。

**请求:** `CreateFileRequest`
```protobuf
message CreateFileRequest {
  string parentPath = 1;
  string fileName = 2;
}
```

**响应:** `CreateFileResult`
```protobuf
message CreateFileResult {
  uint64 fileHandle = 1;
}
```

---

#### WriteToFile

向打开的文件写入数据。

**请求:** `WriteFileRequest`
```protobuf
message WriteFileRequest {
  uint64 fileHandle = 1;
  uint64 startPos = 2;
  uint64 length = 3;
  bytes buffer = 4;
  bool closeFile = 5;
}
```

**响应:** `WriteFileResult`
```protobuf
message WriteFileResult {
  uint64 bytesWritten = 1;
}
```

---

#### WriteToFileStream (客户端流式传输)

使用客户端流式传输向文件写入数据。

**请求流:** `WriteFileRequest`

**响应:** `WriteFileResult`

---

#### CloseFile

关闭打开的文件。

**请求:** `CloseFileRequest`
```protobuf
message CloseFileRequest {
  uint64 fileHandle = 1;
}
```

**响应:** `FileOperationResult`

---

### 离线下载管理

#### AddOfflineFiles

添加离线下载任务(磁力链接等)。

**请求:** `AddOfflineFileRequest`
```protobuf
message AddOfflineFileRequest {
  string urls = 1;
  string toFolder = 2;
  uint32 checkFolderAfterSecs = 3; // 指定秒数后检查文件夹
}
```

**响应:** `FileOperationResult`

---

#### ListOfflineFilesByPath

列出特定路径中的离线文件。

**请求:** `FileRequest`

**响应:** `OfflineFileListResult`
```protobuf
message OfflineFileListResult {
  repeated OfflineFile offlineFiles = 1;
  OfflineStatus status = 2;
}
```

---

#### ListAllOfflineFiles

分页列出所有离线文件。

**请求:** `OfflineFileListAllRequest`
```protobuf
message OfflineFileListAllRequest {
  string cloudName = 1;
  string cloudAccountId = 2;
  uint32 page = 3;
  optional string path = 4;
}
```

**响应:** `OfflineFileListAllResult`

---

#### RemoveOfflineFiles

删除离线下载任务。

**请求:** `RemoveOfflineFilesRequest`
```protobuf
message RemoveOfflineFilesRequest {
  string cloudName = 1;
  string cloudAccountId = 2;
  bool deleteFiles = 3;
  repeated string infoHashes = 4;
  optional string path = 5;
}
```

**响应:** `FileOperationResult`

---

#### GetOfflineQuotaInfo

获取离线下载配额信息。

**请求:** `OfflineQuotaRequest`
```protobuf
message OfflineQuotaRequest {
  string cloudName = 1;
  string cloudAccountId = 2;
  optional string path = 3;
}
```

**响应:** `OfflineQuotaInfo`
```protobuf
message OfflineQuotaInfo {
  int32 total = 1;
  int32 used = 2;
  int32 left = 3;
}
```

---

#### ClearOfflineFiles

按筛选类型清除离线下载。

**请求:** `ClearOfflineFileRequest`
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

**响应:** `google.protobuf.Empty`

---

#### RestartOfflineTask

重启失败的离线下载任务。

**请求:** `RestartOfflineFileRequest`
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

**响应:** `google.protobuf.Empty`

---

### 共享链接

#### AddSharedLink

将共享链接添加到文件夹。

**请求:** `AddSharedLinkRequest`
```protobuf
message AddSharedLinkRequest {
  string sharedLinkUrl = 1;
  optional string sharedPassword = 2;
  string toFolder = 3;
}
```

**响应:** `google.protobuf.Empty`

---

### 挂载点管理

#### GetMountPoints

获取所有配置的挂载点。

**请求:** `google.protobuf.Empty`

**响应:** `GetMountPointsResult`
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
  // Windows 盘符挂载使用的卷标（会嵌入到 WinFSP UNC 路径中）。
  // 在非 Windows 挂载场景下该字段仅作展示用途 —
  // 用户实际看到的是 mountPoint 的最后一段。
  string name = 11;
}
```

**示例 (C#):**
```csharp
var result = await client.GetMountPointsAsync(new Empty(), callOptions);
foreach (var mp in result.MountPoints)
{
    Console.WriteLine($"挂载点: {mp.MountPoint} -> {mp.SourceDir} (已挂载: {mp.IsMounted})");
}
```

---

#### AddMountPoint

添加新挂载点。

**请求:** `MountOption`
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

**响应:** `MountPointResult`

---

#### RemoveMountPoint

删除挂载点。

**请求:** `MountPointRequest`
```protobuf
message MountPointRequest {
  string MountPoint = 1;
}
```

**响应:** `MountPointResult`

---

#### Mount

挂载挂载点。

**请求:** `MountPointRequest`

**响应:** `MountPointResult`

---

#### Unmount

卸载挂载点。

**请求:** `MountPointRequest`

**响应:** `MountPointResult`

---

#### UpdateMountPoint

更新挂载点设置。

**请求:** `UpdateMountPointRequest`
```protobuf
message UpdateMountPointRequest {
  string mountPoint = 1;
  MountOption newMountOption = 2;
}
```

**响应:** `MountPointResult`

---

#### GetAvailableDriveLetters

获取未使用的驱动器号(仅 Windows)。

**请求:** `google.protobuf.Empty`

**响应:** `GetAvailableDriveLettersResult`

---

#### HasDriveLetters

检查系统是否支持驱动器号(Windows)。

**请求:** `google.protobuf.Empty`

**响应:** `HasDriveLettersResult`

---

#### CanMountBothLocalAndCloud

检查服务器是否可以同时挂载本地和云驱动器。

**请求:** `google.protobuf.Empty`

**响应:** `BoolResult`

---

#### CanAddMoreMountPoints

检查当前用户是否可以添加更多挂载点。

**请求:** `google.protobuf.Empty`

**响应:** `FileOperationResult`

---

### 传输任务管理

#### GetAllTasksCount

获取所有传输任务的计数。

**请求:** `google.protobuf.Empty`

**响应:** `GetAllTasksCountResult`
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

获取活动下载任务的计数。

**请求:** `google.protobuf.Empty`

**响应:** `GetDownloadFileCountResult`

---

#### GetDownloadFileList

获取所有下载任务的列表。

**请求:** `google.protobuf.Empty`

**响应:** `GetDownloadFileListResult`
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

获取上传任务的计数。

**请求:** `google.protobuf.Empty`

**响应:** `GetUploadFileCountResult`

---

#### GetUploadFileList

获取上传任务的分页列表。

**请求:** `GetUploadFileListRequest`
```protobuf
message GetUploadFileListRequest {
  bool getAll = 1;  // 注意: 当前不支持此选项，请使用分页方式
  uint32 itemsPerPage = 2;
  uint32 pageNumber = 3;  // 页码从 0 开始
  string filter = 4;
  optional UploadFileInfo.Status statusFilter = 5;
  optional UploadFileInfo.OperatorType operatorTypeFilter = 6;
}
```

**响应:** `GetUploadFileListResult`
```protobuf
message GetUploadFileListResult {
  uint32 totalCount = 1;
  repeated UploadFileInfo uploadFiles = 2;
  double globalBytesPerSecond = 3;
  uint64 totalBytes = 4;
  uint64 finishedBytes = 5;
}
```

**示例 (Python):**
```python
request = clouddrive_pb2.GetUploadFileListRequest(
    getAll=False,  # 注意: getAll 当前不支持
    itemsPerPage=50,
    pageNumber=0,  # 页码从 0 开始（第一页）
    filter="",
    statusFilter=clouddrive_pb2.UploadFileInfo.Transfer
)

result = stub.GetUploadFileList(request, metadata=auth_metadata)
print(f"总上传数: {result.totalCount}")
print(f"上传速度: {result.globalBytesPerSecond / 1024 / 1024:.2f} MB/s")
```

---

#### CancelAllUploadFiles

取消所有上传任务。

**请求:** `google.protobuf.Empty`

**响应:** `google.protobuf.Empty`

---

#### CancelUploadFiles

取消选定的上传任务。

**请求:** `MultpleUploadFileKeyRequest`
```protobuf
message MultpleUploadFileKeyRequest {
  repeated string keys = 1;
}
```

**响应:** `google.protobuf.Empty`

---

#### PauseAllUploadFiles

暂停所有上传任务。

**请求:** `google.protobuf.Empty`

**响应:** `google.protobuf.Empty`

---

#### PauseUploadFiles

暂停选定的上传任务。

**请求:** `MultpleUploadFileKeyRequest`

**响应:** `google.protobuf.Empty`

---

#### ResumeAllUploadFiles

恢复所有暂停的上传任务。

**请求:** `google.protobuf.Empty`

**响应:** `google.protobuf.Empty`

---

#### ResumeUploadFiles

恢复选定的暂停上传任务。

**请求:** `MultpleUploadFileKeyRequest`

**响应:** `google.protobuf.Empty`

---

#### GetCopyTasks

获取所有复制/移动文件夹任务。

**请求:** `google.protobuf.Empty`

**响应:** `GetCopyTaskResult`
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

获取所有合并任务(递归文件夹合并)。

**请求:** `google.protobuf.Empty`

**响应:** `GetMergeTasksResult`

---

#### CancelMergeTask

取消合并任务。

**请求:** `CancelMergeTaskRequest`
```protobuf
message CancelMergeTaskRequest {
  string sourcePath = 1;
  string destPath = 2;
}
```

**响应:** `google.protobuf.Empty`

---

#### CancelCopyTask

取消复制文件夹任务。

**请求:** `CopyTaskRequest`
```protobuf
message CopyTaskRequest {
  string sourcePath = 1;
  string destPath = 2;
}
```

**响应:** `google.protobuf.Empty`

---

#### PauseCopyTask

暂停复制任务。

**请求:** `PauseCopyTaskRequest`

**响应:** `google.protobuf.Empty`

---

#### RestartCopyTask

重启复制任务。

**请求:** `CopyTaskRequest`

**响应:** `google.protobuf.Empty`

---

#### RemoveCompletedCopyTasks

删除所有已完成的复制任务。

**请求:** `google.protobuf.Empty`

**响应:** `google.protobuf.Empty`

---

### 云 API 管理

#### OAuth 登录流程

许多云存储提供商使用 OAuth 2.0 进行安全身份验证。OAuth 流程允许用户授权 CloudDrive2 访问其云存储,而无需共享密码。

**支持的 OAuth 登录方法:**
- `APILoginOneDriveOAuth` - Microsoft OneDrive
- `ApiLoginGoogleDriveOAuth` - Google Drive
- `APILoginAliyundriveOAuth` - 阿里云盘 Open
- `APILoginBaiduPanOAuth` - 百度网盘
- `ApiLoginXunleiOAuth` - 迅雷网盘
- `APILogin115OpenOAuth` - 115 云盘 Open
- `ApiLogin123panOAuth` - 123 云盘

**OAuth 流程概述:**

```
用户                    您的应用              云服务提供商       CloudDrive2 服务器
 |                         |                         |                      |
 |-- 点击授权 ------------>|                         |                      |
 |                         |                         |                      |
 |                         |-- 打开 OAuth URL ------>|                      |
 |                         |                         |                      |
 |<------- 登录页面 -------|-------------------------|                      |
 |                         |                         |                      |
 |-- 输入凭据 ------------>|------------------------>|                      |
 |                         |                         |                      |
 |<------- 授权访问 -------|-------------------------|                      |
 |                         |                         |                      |
 |                         |<-- 授权码 --------------|                      |
 |                         |                         |                      |
 |                         |-- 交换授权码获取令牌 --> (OAuth 服务器)         |
 |                         |   (通过您的后端/重定向)  |                      |
 |                         |                         |                      |
 |                         |<-- 访问令牌 +        ---|                      |
 |                         |    刷新令牌             |                      |
 |                         |                         |                      |
 |                         |-- 调用 APILoginXxxOAuth(refresh_token, ------->|
 |                         |   access_token, expires_in)                    |
 |                         |                         |                      |
 |                         |<----------------------- 成功/错误 -------------|
 |                         |                         |                      |
 |<-- 云存储已添加 ---------|                         |                      |
```

**OAuth 实现步骤:**

**1. 注册您的应用程序**

在使用 OAuth 之前,向云服务提供商注册您的应用程序以获取:
- **Client ID**: 应用程序的公共标识符
- **Client Secret**: 密钥(保密,仅在服务器端使用)
- **Redirect URI**: OAuth 提供商发送授权码的 URL

**2. 构建 OAuth 授权 URL**

```csharp
// 各提供商的 OAuth URL 示例
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

        _ => throw new NotSupportedException($"不支持 {cloudType} 的 OAuth")
    };
}
```

**3. 处理 OAuth 回调**

您的重定向 URI 端点必须:
1. 从查询参数接收授权码
2. 交换授权码以获取令牌(服务器端使用 client_secret)
3. 提取 `access_token`、`refresh_token` 和 `expires_in`
4. 调用相应的 CloudDrive2 API

**示例 (ASP.NET Core):**

```csharp
[HttpGet("oauth/callback")]
public async Task<IActionResult> OAuthCallback(
    [FromQuery] string code,
    [FromQuery] string state,
    [FromQuery] string cloud_type)
{
    try
    {
        // 交换授权码以获取令牌
        var tokenResponse = await ExchangeCodeForTokens(cloud_type, code);

        // 调用 CloudDrive2 API 添加云存储
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

            // ... 其他提供商

            _ => throw new NotSupportedException($"未知云类型: {cloud_type}")
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

// 令牌交换辅助方法(仅服务器端 - 需要 client_secret)
private async Task<TokenResponse> ExchangeCodeForTokens(string cloudType, string code)
{
    using var httpClient = new HttpClient();

    var tokenEndpoint = cloudType switch
    {
        "onedrive" => "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        "googledrive" => "https://oauth2.googleapis.com/token",
        "aliyundriveopen" => "https://open.aliyundrive.com/oauth/access_token",
        "baidupan" => "https://openapi.baidu.com/oauth/2.0/token",
        // ... 其他提供商
        _ => throw new NotSupportedException()
    };

    var parameters = new Dictionary<string, string>
    {
        ["grant_type"] = "authorization_code",
        ["code"] = code,
        ["client_id"] = GetClientId(cloudType),
        ["client_secret"] = GetClientSecret(cloudType), // 保密,仅在服务器端!
        ["redirect_uri"] = GetRedirectUri(cloudType)
    };

    var response = await httpClient.PostAsync(tokenEndpoint,
        new FormUrlEncodedContent(parameters));
    response.EnsureSuccessStatusCode();

    var json = await response.Content.ReadAsStringAsync();
    return JsonSerializer.Deserialize<TokenResponse>(json);
}
```

**4. 完整代码示例**

**示例 (C#) - OneDrive OAuth:**

```csharp
// OAuth 流程和令牌交换成功后
var request = new LoginOneDriveOAuthRequest
{
    RefreshToken = "OAQABAAIAAAAm-06blBE1TpVMil8KPQ41...",
    AccessToken = "EwBwA8l6BAAUbDba3x2OMJElkF7gJ4z/VbCPEz0AA...",
    ExpiresIn = 3600 // 秒
};

var callOptions = CreateAuthorizedCallOptions();
var result = await client.APILoginOneDriveOAuthAsync(request, callOptions);

if (result.Success)
{
    Console.WriteLine("OneDrive 添加成功!");
}
else
{
    Console.WriteLine($"错误: {result.ErrorMessage}");
}
```

**示例 (Python) - Google Drive OAuth:**

```python
# OAuth 流程和令牌交换后
request = clouddrive_pb2.LoginGoogleDriveOAuthRequest(
    refresh_token="1//0gH_xxxxxxxxxxxxxxxxxxx",
    access_token="ya29.a0AfH6SMxxxxxxxxxxxxxxxxxx",
    expires_in=3599
)

result = stub.ApiLoginGoogleDriveOAuth(request, metadata=auth_metadata)

if result.success:
    print("Google Drive 添加成功!")
else:
    print(f"错误: {result.errorMessage}")
```

**示例 (Java) - 阿里云盘 Open OAuth:**

```java
// OAuth 流程和令牌交换后
LoginAliyundriveOAuthRequest request = LoginAliyundriveOAuthRequest.newBuilder()
    .setRefreshToken("xxxxxxxxxxxxxxxxxxxxx")
    .setAccessToken("eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...")
    .setExpiresIn(7200)
    .build();

APILoginResult result = blockingStub.apiLoginAliyundriveOAuth(request);

if (result.getSuccess()) {
    System.out.println("阿里云盘添加成功!");
} else {
    System.err.println("错误: " + result.getErrorMessage());
}
```

**示例 (Go) - 百度网盘 OAuth:**

```go
// OAuth 流程和令牌交换后
req := &pb.LoginBaiduPanOAuthRequest{
    RefreshToken: "122.xxxxxxxxxxxxxxxxxxxxxxx",
    AccessToken:  "121.xxxxxxxxxxxxxxxxxxxxxxx",
    ExpiresIn:    2592000, // 30 天
}

result, err := client.APILoginBaiduPanOAuth(authCtx, req)
if err != nil {
    log.Fatalf("RPC 错误: %v", err)
}

if result.Success {
    fmt.Println("百度网盘添加成功!")
} else {
    fmt.Printf("错误: %s\n", result.ErrorMessage)
}
```

**OAuth 最佳实践:**

1. **安全性**:
   - 绝不要在客户端代码(浏览器、移动应用)中暴露 `client_secret`
   - 始终在服务器端交换授权码
   - 对所有 OAuth 重定向使用 HTTPS
   - 验证 `state` 参数以防止 CSRF 攻击

2. **令牌存储**:
   - 安全存储刷新令牌(加密数据库)
   - 永远不要记录或暴露令牌
   - CloudDrive2 自动处理令牌刷新

3. **权限请求**:
   - 请求最低必要权限
   - 某些提供商需要特定权限才能进行文件操作

4. **错误处理**:
   - 处理过期的授权码(通常有效期为 10 分钟)
   - 向用户提供清晰的错误消息
   - 为网络故障实现重试逻辑

5. **用户体验**:
   - 在弹出窗口中打开 OAuth 以获得更好的用户体验
   - 在令牌交换期间显示加载状态
   - 提供取消选项

**常见 OAuth 错误:**

| 错误 | 原因 | 解决方案 |
|------|------|----------|
| `invalid_client` | client_id 或 client_secret 错误 | 从提供商控制台验证凭据 |
| `invalid_grant` | 授权码已过期或已使用 | 请求新授权 |
| `redirect_uri_mismatch` | 重定向 URI 与注册不匹配 | 在提供商控制台中更新 |
| `invalid_scope` | 请求的权限不可用 | 查看提供商文档 |
| `access_denied` | 用户拒绝授权 | 提示用户重试 |

---

#### 二维码登录流程

多个云服务商支持基于二维码的身份验证,提供无缝的登录体验。二维码登录流程遵循标准的服务器流式传输模式,服务器发送有关身份验证状态的实时更新。

**支持的二维码登录方法:**
- `APILogin115OpenQRCode` - 115 云盘 (Open API)
- `APILoginAliyunDriveQRCode` - 阿里云盘
- `APILogin189QRCode` - 189 云盘 (天翼云盘)

**二维码消息类型:**

```protobuf
enum QRCodeScanMessageType {
  SHOW_IMAGE = 0;          // 从 URL 显示二维码图像
  SHOW_IMAGE_CONTENT = 1;  // 消息包含应编码为二维码的原始文本
  CHANGE_STATUS = 2;       // 更新状态消息(扫描中、确认中等)
  CLOSE = 3;               // 登录成功,关闭二维码对话框
  ERROR = 4;               // 登录失败并显示错误消息
}

message QRCodeScanMessage {
  QRCodeScanMessageType messageType = 1;
  string message = 2;  // URL、要编码的文本、状态文本或错误消息
}
```

**通用二维码登录流程:**

1. **启动二维码登录**: 调用相应的二维码登录方法(返回服务器流式 RPC)
2. **接收 SHOW_IMAGE 或 SHOW_IMAGE_CONTENT**:
   - `SHOW_IMAGE`: `message` 包含二维码图像的 URL
   - `SHOW_IMAGE_CONTENT`: `message` 包含应由客户端编码为二维码的原始文本
3. **显示二维码**: 向用户显示二维码以便使用移动应用扫描
4. **接收 CHANGE_STATUS**: 用户扫描/确认时的状态更新
   - 示例消息: "等待扫描"、"已扫描,请在手机上确认"、"确认中..."
5. **接收 CLOSE 或 ERROR**:
   - `CLOSE`: 登录成功,云 API 已添加
   - `ERROR`: 登录失败,`message` 包含错误详情

**完整示例 (C#):**

```csharp
// 示例: 115 Open 二维码登录
public async Task Login115OpenQRCodeAsync(CancellationToken cancellationToken = default)
{
    var callOptions = CreateAuthorizedCallOptions(cancellationToken);
    using var call = client.APILogin115OpenQRCode(new Empty(), callOptions);

    try
    {
        await foreach (var message in call.ResponseStream.ReadAllAsync(cancellationToken))
        {
            switch (message.MessageType)
            {
                case QRCodeScanMessageType.ShowImage:
                    Console.WriteLine($"请扫描二维码: {message.Message}");
                    // 从 URL 显示二维码
                    await ShowQRCodeFromUrlAsync(message.Message);
                    break;

                case QRCodeScanMessageType.ShowImageContent:
                    Console.WriteLine("已接收二维码文本");
                    // 从原始消息文本生成二维码
                    await GenerateAndShowQRCodeAsync(message.Message);
                    break;

                case QRCodeScanMessageType.ChangeStatus:
                    Console.WriteLine($"状态: {message.Message}");
                    // 使用状态消息更新 UI
                    await UpdateStatusAsync(message.Message);
                    break;

                case QRCodeScanMessageType.Close:
                    Console.WriteLine("登录成功!");
                    await CloseQRCodeDialogAsync();
                    await RefreshCloudApiListAsync();
                    return;

                case QRCodeScanMessageType.Error:
                    Console.WriteLine($"登录失败: {message.Message}");
                    await ShowErrorAsync(message.Message);
                    return;
            }
        }
    }
    catch (RpcException ex)
    {
        Console.WriteLine($"二维码登录错误: {ex.Status}");
        throw;
    }
}
```

**示例 (Java):**

```java
// 阿里云盘二维码登录
public void loginAliyunDriveQRCode() {
    LoginAliyundriveQRCodeRequest request = LoginAliyundriveQRCodeRequest.newBuilder()
        .setUseOpenApi(true)  // 使用阿里云盘 Open API
        .build();

    Iterator<QRCodeScanMessage> responses = blockingStub.apiLoginAliyunDriveQRCode(request);

    while (responses.hasNext()) {
        QRCodeScanMessage message = responses.next();

        switch (message.getMessageType()) {
            case SHOW_IMAGE:
                System.out.println("二维码 URL: " + message.getMessage());
                displayQRCodeFromUrl(message.getMessage());
                break;

            case SHOW_IMAGE_CONTENT:
                // 从原始消息文本生成二维码
                generateAndDisplayQRCode(message.getMessage());
                break;

            case CHANGE_STATUS:
                System.out.println("状态: " + message.getMessage());
                updateStatus(message.getMessage());
                break;

            case CLOSE:
                System.out.println("登录成功!");
                closeQRCodeDialog();
                refreshCloudApiList();
                return;

            case ERROR:
                System.err.println("错误: " + message.getMessage());
                showError(message.getMessage());
                return;
        }
    }
}
```

**示例 (Python):**

```python
# 189 云盘二维码登录
def login_189_qrcode():
    responses = stub.APILogin189QRCode(Empty(), metadata=auth_metadata)

    for message in responses:
        if message.messageType == clouddrive_pb2.SHOW_IMAGE:
            print(f"扫描二维码: {message.message}")
            display_qrcode_from_url(message.message)

        elif message.messageType == clouddrive_pb2.SHOW_IMAGE_CONTENT:
            # 从原始消息文本生成二维码
            generate_and_display_qrcode(message.message)

        elif message.messageType == clouddrive_pb2.CHANGE_STATUS:
            print(f"状态: {message.message}")
            update_status(message.message)

        elif message.messageType == clouddrive_pb2.CLOSE:
            print("登录成功!")
            close_qrcode_dialog()
            return True

        elif message.messageType == clouddrive_pb2.ERROR:
            print(f"登录失败: {message.message}")
            show_error(message.message)
            return False
```

**示例 (Go):**

```go
// 通用二维码登录处理器
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
            fmt.Printf("扫描二维码: %s\n", msg.Message)
            displayQRCodeFromURL(msg.Message)

        case pb.QRCodeScanMessageType_SHOW_IMAGE_CONTENT:
            // 从原始消息文本生成二维码
            generateAndDisplayQRCode(msg.Message)

        case pb.QRCodeScanMessageType_CHANGE_STATUS:
            fmt.Printf("状态: %s\n", msg.Message)
            updateStatus(msg.Message)

        case pb.QRCodeScanMessageType_CLOSE:
            fmt.Println("登录成功!")
            closeQRCodeDialog()
            return nil

        case pb.QRCodeScanMessageType_ERROR:
            return fmt.Errorf("登录失败: %s", msg.Message)
        }
    }
    return nil
}
```

**最佳实践:**

1. **超时处理**: 为二维码扫描实现超时(通常为 2-5 分钟)
2. **用户取消**: 允许用户取消二维码登录过程
3. **二维码刷新**: 某些提供商可能会在旧二维码过期时发送新的二维码
4. **状态更新**: 显示实时状态消息以保持用户知情
5. **错误恢复**: 提供清晰的错误消息和重试选项
6. **移动应用要求**: 告知用户需要安装相应的移动应用

---

#### GetAllCloudApis

获取所有配置的云 API 连接。

**请求:** `google.protobuf.Empty`

**响应:** `CloudAPIList`
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
  bool supportHttpDownload = 11; // 支持 HTTP 下载
}
```

---

#### CanAddMoreCloudApis

检查当前用户是否可以添加更多云 API。

**请求:** `google.protobuf.Empty`

**响应:** `FileOperationResult`

---

#### APILogin115OpenOAuth

使用 OAuth 令牌添加 115 云盘 (Open API)。

**请求:** `Login115OpenOAuthRequest`
```protobuf
message Login115OpenOAuthRequest {
  string refresh_token = 1;
  string access_token = 2;
  uint64 expires_in = 3;
  optional ProxyInfo apiProxy = 4;
  optional ProxyInfo dataProxy = 5;
}
```

**响应:** `APILoginResult`

---

#### APILogin115OpenQRCode (服务器流式传输)

通过扫描二维码添加 115 云盘 (Open API)。详见 [二维码登录流程](#二维码登录流程)。

**请求:** `Login115OpenQRCodeRequest`
```protobuf
message Login115OpenQRCodeRequest {
  optional ProxyInfo apiProxy = 1;
  optional ProxyInfo dataProxy = 2;
}
```

**响应流:** `QRCodeScanMessage`

**示例 (C#):**
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
            Console.WriteLine("115 云盘添加成功!");
            return;
        case QRCodeScanMessageType.Error:
            Console.WriteLine($"错误: {message.Message}");
            return;
    }
}
```

---

#### APILoginAliyundriveOAuth

使用 OAuth 令牌添加阿里云盘。

**请求:** `LoginAliyundriveOAuthRequest`
```protobuf
message LoginAliyundriveOAuthRequest {
  string refresh_token = 1;
  string access_token = 2;
  uint64 expires_in = 3;
  optional ProxyInfo apiProxy = 4;
  optional ProxyInfo dataProxy = 5;
}
```

**响应:** `APILoginResult`

---

#### APILoginAliyundriveRefreshtoken

使用刷新令牌添加阿里云盘。

**请求:** `LoginAliyundriveRefreshtokenRequest`
```protobuf
message LoginAliyundriveRefreshtokenRequest {
  string refreshToken = 1;
  bool useOpenAPI = 2;
}
```

**响应:** `APILoginResult`

**示例 (C#):**
```csharp
var request = new LoginAliyundriveRefreshtokenRequest
{
    RefreshToken = "your-refresh-token",
    UseOpenAPI = true  // 使用阿里云盘 Open API
};

var result = await client.APILoginAliyundriveRefreshtokenAsync(request, callOptions);
if (result.Success)
{
    Console.WriteLine("阿里云盘添加成功");
}
```

---

#### APILoginAliyunDriveQRCode (服务器流式传输)

通过扫描二维码添加阿里云盘。详见 [二维码登录流程](#二维码登录流程)。

**请求:** `LoginAliyundriveQRCodeRequest`
```protobuf
message LoginAliyundriveQRCodeRequest {
  bool useOpenAPI = 1;  // 使用阿里云盘 Open API
  optional ProxyInfo apiProxy = 2;
  optional ProxyInfo dataProxy = 3;
}
```

**响应流:** `QRCodeScanMessage`

---

#### APILoginBaiduPanOAuth

使用 OAuth 令牌添加百度网盘。

**请求:** `LoginBaiduPanOAuthRequest`
```protobuf
message LoginBaiduPanOAuthRequest {
  string refresh_token = 1;
  string access_token = 2;
  uint64 expires_in = 3;
  optional ProxyInfo apiProxy = 4;
  optional ProxyInfo dataProxy = 5;
}
```

**响应:** `APILoginResult`

---

#### APILoginOneDriveOAuth

使用 OAuth 令牌添加 OneDrive。

**请求:** `LoginOneDriveOAuthRequest`
```protobuf
message LoginOneDriveOAuthRequest {
  string refresh_token = 1;
  string access_token = 2;
  uint64 expires_in = 3;
  optional ProxyInfo apiProxy = 4;
  optional ProxyInfo dataProxy = 5;
}
```

**响应:** `APILoginResult`

---

#### ApiLoginGoogleDriveOAuth

使用 OAuth 令牌添加 Google Drive。

**请求:** `LoginGoogleDriveOAuthRequest`
```protobuf
message LoginGoogleDriveOAuthRequest {
  string refresh_token = 1;
  string access_token = 2;
  uint64 expires_in = 3;
  optional ProxyInfo apiProxy = 4;
  optional ProxyInfo dataProxy = 5;
}
```

**响应:** `APILoginResult`

---

#### ApiLoginGoogleDriveRefreshToken

使用客户端凭据和刷新令牌添加 Google Drive。

**请求:** `LoginGoogleDriveRefreshTokenRequest`
```protobuf
message LoginGoogleDriveRefreshTokenRequest {
  string client_id = 1;
  string client_secret = 2;
  string refresh_token = 3;
  optional ProxyInfo apiProxy = 4;
  optional ProxyInfo dataProxy = 5;
}
```

**响应:** `APILoginResult`

**示例 (Python):**
```python
request = clouddrive_pb2.LoginGoogleDriveRefreshTokenRequest(
    client_id="your-client-id",
    client_secret="your-client-secret",
    refresh_token="your-refresh-token"
)

result = stub.ApiLoginGoogleDriveRefreshToken(request, metadata=auth_metadata)
if result.success:
    print("Google Drive 添加成功")
else:
    print(f"错误: {result.errorMessage}")
```

---

#### ApiLoginXunleiOAuth

使用 OAuth 令牌添加迅雷网盘。

**请求:** `LoginXunleiOAuthRequest`
```protobuf
message LoginXunleiOAuthRequest {
  string refresh_token = 1;
  string access_token = 2;
  uint64 expires_in = 3;
  optional ProxyInfo apiProxy = 4;
  optional ProxyInfo dataProxy = 5;
}
```

**响应:** `APILoginResult`

---

#### ApiLoginXunleiOpenOAuth

使用 OAuth 令牌添加迅雷网盘 (Open API)。

**请求:** `LoginXunleiOpenOAuthRequest`
```protobuf
message LoginXunleiOpenOAuthRequest {
  string refresh_token = 1;
  string access_token = 2;
  uint64 expires_in = 3;
  optional ProxyInfo apiProxy = 4;
  optional ProxyInfo dataProxy = 5;
}
```

**响应:** `APILoginResult`

---

#### ApiLogin123panOAuth

使用客户端凭证添加 123 云盘。

**请求:** `Login123panOAuthRequest`
```protobuf
message Login123panOAuthRequest {
  string refresh_token = 1;
  string access_token = 2;
  uint64 expires_in = 3;
  optional ProxyInfo apiProxy = 4;
  optional ProxyInfo dataProxy = 5;
}
```

**响应:** `APILoginResult`

**示例 (Java):**
```java
Login123panOAuthRequest request = Login123panOAuthRequest.newBuilder()
    .setClientId("your-client-id")
    .setClientSecret("your-client-secret")
    .build();

APILoginResult result = blockingStub.apiLogin123panOAuth(request);
if (result.getSuccess()) {
    System.out.println("123 云盘添加成功");
} else {
    System.err.println("错误: " + result.getErrorMessage());
}
```

---

#### CreateOAuthState

签发短期 OAuth `state` 签名令牌（中继到 cloudfs 服务器）。前端将返回的令牌作为 OAuth `state` 参数；OAuth 回调服务器在处理重定向回调前验证该令牌 — 避免 CSRF 和 OAuth state 伪造。

**请求:** `CreateOAuthStateRequest`
```protobuf
message CreateOAuthStateRequest {
  string oauth_type = 1;          // 提供方标识，如 "google_drive"、"onedrive"
  string return_url = 2;          // 回调完成后接收令牌的地址
  optional string device_id = 3;  // 迅雷流程中需要透传
}
```

**响应:** `CreateOAuthStateResult`
```protobuf
message CreateOAuthStateResult {
  bool success = 1;
  string error_message = 2;
  string state = 3;       // 用作 OAuth `state` 参数的签名令牌
  uint64 expires_in = 4;  // 令牌有效期（秒）
}
```

**1.0.9 新增**

---

#### APILogin189QRCode (服务器流式传输)

通过扫描二维码添加 189 云盘 (天翼云盘)。详见 [二维码登录流程](#二维码登录流程)。

**请求:** `Login189QRCodeRequest`
```protobuf
message Login189QRCodeRequest {
  optional ProxyInfo apiProxy = 1;
  optional ProxyInfo dataProxy = 2;
}
```

**响应流:** `QRCodeScanMessage`

---

#### APILoginWebDav

添加 WebDAV 连接。

**请求:** `LoginWebDavRequest`
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

**响应:** `APILoginResult`

*0.9.8 新增*

---

#### APILoginS3

添加 Amazon S3 或 S3 兼容对象存储。

**请求:** `LoginS3Request`
```protobuf
message LoginS3Request {
  string accessKeyId = 1;           // AWS 访问密钥 ID
  string secretAccessKey = 2;       // AWS 秘密访问密钥
  string region = 3;                // AWS 区域（如 "us-east-1"）
  string bucket = 4;                // S3 桶名称
  optional string endpoint = 5;     // S3 兼容服务的自定义端点 URL
  bool pathStyle = 6;               // 使用路径样式 URL 而非虚拟主机样式
  bool doNotSyncToCloud = 7;        // 如为 true，则不将此 API 配置同步到云端
  optional uint32 signatureVersion = 8; // S3 签名版本：2 或 4（默认 4）
  optional ProxyInfo apiProxy = 9;
  optional ProxyInfo dataProxy = 10;
}
```

**响应:** `APILoginResult`

**字段说明:**
- `accessKeyId`: AWS 访问密钥 ID 或 S3 兼容服务的等效凭证
- `secretAccessKey`: AWS 秘密访问密钥或等效凭证
- `region`: AWS 区域（如 "us-east-1"、"eu-west-1"）。即使对于 S3 兼容服务也是必填的。
- `bucket`: 要访问的 S3 桶名称
- `endpoint`: 对于 AWS S3 可选。对于 S3 兼容服务必填（如 MinIO 为 "http://localhost:9000"，Wasabi 为 "https://s3.wasabisys.com"）
- `pathStyle`: 对于需要路径样式 URL（`https://endpoint/bucket/key`）的服务设置为 `true`，虚拟主机样式（`https://bucket.endpoint/key`）设置为 `false`。MinIO 和其他一些服务需要 `true`。
- `doNotSyncToCloud`: 如果为 `true`，此配置将不会同步到其他设备
- `signatureVersion`: S3 签名版本，`2` 或 `4`（默认：`4`）。对于不支持签名 v4 的传统 S3 兼容服务使用 `2`。

**示例 - AWS S3:**
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

**示例 - MinIO:**
```csharp
var request = new LoginS3Request
{
    AccessKeyId = "minioadmin",
    SecretAccessKey = "minioadmin",
    Region = "us-east-1",  // 对于 MinIO 可以是任意值
    Bucket = "test-bucket",
    Endpoint = "http://localhost:9000",
    PathStyle = true  // MinIO 需要路径样式
};
var result = await client.APILoginS3Async(request);
```

**示例 - Wasabi:**
```csharp
var request = new LoginS3Request
{
    AccessKeyId = "YOUR_WASABI_ACCESS_KEY",
    SecretAccessKey = "YOUR_WASABI_SECRET_KEY",
    Region = "us-east-1",  // Wasabi 区域
    Bucket = "my-wasabi-bucket",
    Endpoint = "https://s3.wasabisys.com",
    PathStyle = false
};
var result = await client.APILoginS3Async(request);
```

*0.9.22 新增*

---

#### APIAddLocalFolder

将本地文件夹添加为云存储。

**请求:** `AddLocalFolderRequest`
```protobuf
message AddLocalFolderRequest {
  string localFolderPath = 1;
}
```

**响应:** `APILoginResult`

---

#### APILoginCloudDrive

添加远程 CloudDrive 服务器。

**请求:** `LoginCloudDriveRequest`
```protobuf
message LoginCloudDriveRequest {
  string grpcUrl = 1;
  string token = 2;
  bool insecureTls = 3; // 用于自签名证书
  bool doNotSyncToCloud = 4;
  optional ProxyInfo apiProxy = 5;
  optional ProxyInfo dataProxy = 6;
}
```

**响应:** `APILoginResult`

---

#### APILoginSftp

添加 SFTP 服务器。支持密码和私钥认证。

**请求:** `LoginSftpRequest`
```protobuf
message LoginSftpRequest {
  string host = 1;
  uint32 port = 2;                    // 默认 22
  string userName = 3;
  string password = 4;
  optional string privateKey = 5;     // PEM 编码的私钥
  optional string passphrase = 6;     // 加密私钥的密码短语
  optional string rootPath = 7;       // 远程根目录（默认 "/"）
  bool doNotSyncToCloud = 8;
  optional ProxyInfo apiProxy = 9;
  optional ProxyInfo dataProxy = 10;
}
```

**响应:** `APILoginResult`

---

#### APILoginFtp

添加 FTP/FTPS 服务器。设置 `useTls = true` 启用 FTPS。

**请求:** `LoginFtpRequest`
```protobuf
message LoginFtpRequest {
  string host = 1;
  uint32 port = 2;                    // 默认 21
  string userName = 3;
  string password = 4;
  bool useTls = 5;                    // 启用 FTPS (TLS)
  optional string rootPath = 6;       // 远程根目录（默认 "/"）
  bool doNotSyncToCloud = 7;
  optional ProxyInfo apiProxy = 8;
  optional ProxyInfo dataProxy = 9;
}
```

**响应:** `APILoginResult`

---

#### APILoginSmb

添加 SMB/CIFS 共享。

**请求:** `LoginSmbRequest`
```protobuf
message LoginSmbRequest {
  string server = 1;                  // SMB 服务器主机名或 IP
  string share = 2;                   // 共享名（如 "SharedDocs"）
  uint32 port = 3;                    // 默认 445
  string userName = 4;
  string password = 5;
  optional string workgroup = 6;      // 域/工作组
  optional string rootPath = 7;       // 共享内路径（默认 "/"）
  bool doNotSyncToCloud = 8;
  optional ProxyInfo apiProxy = 9;
  optional ProxyInfo dataProxy = 10;
}
```

**响应:** `APILoginResult`

---

#### DiscoverSmbServers

发现局域网内的 SMB 服务器。

**请求:** `google.protobuf.Empty`

**响应:** `DiscoverSmbServersResult`
```protobuf
message SmbServerInfo {
  string name = 1;                    // 服务器名称（如 "MINIPC-Y10"）
  string address = 2;                 // IP 地址或主机名
}
message DiscoverSmbServersResult {
  repeated SmbServerInfo servers = 1;
}
```

---

#### DiscoverSmbShares

列出指定 SMB 服务器上的共享目录。

**请求:** `DiscoverSmbSharesRequest`
```protobuf
message DiscoverSmbSharesRequest {
  string server = 1;
  uint32 port = 2;                    // 默认 445
  string userName = 3;
  string password = 4;
  optional string workgroup = 5;
}
```

**响应:** `DiscoverSmbSharesResult`
```protobuf
message DiscoverSmbSharesResult {
  repeated string shareNames = 1;
}
```

---

#### RemoveCloudAPI

删除云 API 连接。

**请求:** `RemoveCloudAPIRequest`
```protobuf
message RemoveCloudAPIRequest {
  string cloudName = 1;
  string userName = 2;
  bool permanentRemove = 3;
}
```

**响应:** `FileOperationResult`

---

#### GetCloudAPIConfig

获取云 API 的配置。

**请求:** `GetCloudAPIConfigRequest`
```protobuf
message GetCloudAPIConfigRequest {
  string cloudName = 1;
  string userName = 2;
}
```

**响应:** `CloudAPIConfig`
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
  optional bool useHttpDownload = 13; // 使用 HTTP 下载
  optional bool supportDirectLink = 14; // 支持直接链接下载
  optional bool supportDirectDownloadUrl = 15; // 支持直接下载 URL（只读）
  // 字段 16, 17 已移除：磁盘缓存设置已迁移到按文件夹配置（SetFolderDiskCache）
  reserved 16, 17;
  // 服务器报告的只读上限，便于客户端限制用户输入。
  // 每个字段都是当前云端（必要时按平台进一步收紧）的有效上限。
  // 缺失或为 0 表示"未声明上限，客户端应使用合理默认值"。
  // 在 SetCloudAPIConfig 中会被忽略。
  optional uint32 maxDownloadThreadsLimit = 18;
  optional uint64 maxBufferPoolSizeMBLimit = 19;
  optional double maxQueriesPerSecondLimit = 20;
  // 设置后，复制/上传任务从该云盘读取源字节时使用传统的多线程缓冲下载器
  // （ENTRY_READER_MANAGER）而非单条长 HTTP GET 流。适用于单流吞吐低于目标
  // 端写入/上传速度的场景。对哈希预处理与上传字节流均生效。
  optional bool useMultithreadDownloaderForCopy = 21;
}
```

**注意:** 字段 `fileBufferDiskCacheEnabled`（16）和 `fileBufferDiskCacheMaxFileSize`（17）已在 1.0.0 中移除。磁盘缓存现在通过 `SetFolderDiskCache` 按文件夹配置。

**服务器报告的上限（1.0.7）：** 字段 18、19、20 是服务器报告的各对应设置的只读上限。客户端在 UI 中存在这些值时应据此限制滑块/输入。这些字段在 `SetCloudAPIConfig` 中会被忽略。

**复制使用多线程下载器（1.0.9）：** 字段 21 让复制/上传读取走多线程缓冲下载器。在单流 HTTP GET 成为瓶颈时启用。

---

#### SetCloudAPIConfig

设置云 API 的配置。

**请求:** `SetCloudAPIConfigRequest`
```protobuf
message SetCloudAPIConfigRequest {
  string cloudName = 1;
  string userName = 2;
  CloudAPIConfig config = 3;
}
```

**响应:** `google.protobuf.Empty`

---

### 系统设置

#### GetSystemSettings

获取所有系统设置。

**请求:** `google.protobuf.Empty`

**响应:** `SystemSettings`
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
  optional string fileBufferDiskCacheLocation = 24; // 缓存段的根目录
  optional uint64 fileBufferDiskCacheMaxBytes = 25; // 磁盘缓存最大字节数；LRU 淘汰
  optional ProxyInfo cloudfsProxy = 26; // 用于访问 CloudFS 账户服务器的代理
  optional uint64 maxFileLogSizeBytes = 27;   // 日志文件轮转前的最大大小（None=无限制，0=禁用）
  optional uint64 maxBackupLogSizeBytes = 28; // 备份日志文件轮转前的最大大小
  optional uint32 maxFileLogFiles = 29;       // 保留的轮转日志文件最大数量（默认：10）
  optional uint32 maxBackupLogFiles = 30;     // 保留的轮转备份日志文件最大数量（默认：10）
}
```

**1.0.1 新增:** `maxFileLogSizeBytes`、`maxBackupLogSizeBytes`、`maxFileLogFiles` 和 `maxBackupLogFiles` 用于配置日志文件轮转。在 `SetSystemSettings` 中必须同时发送所有 4 个字段。

**0.9.18 新增:** `fileBufferDiskCacheLocation` 和 `fileBufferDiskCacheMaxBytes` 用于配置全局文件缓冲磁盘缓存系统。

---

#### SetSystemSettings

更新系统设置。

**请求:** `SystemSettings`

**响应:** `google.protobuf.Empty`

**示例 (C#):**
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

为特定目录设置缓存时间。

**请求:** `SetDirCacheTimeRequest`
```protobuf
message SetDirCacheTimeRequest {
  string path = 1;
  optional uint64 dirCachTimeToLiveSecs = 2; // 如果不存在,删除以恢复默认值
}
```

**响应:** `google.protobuf.Empty`

---

#### GetEffectiveDirCacheTimeSecs

获取路径的有效缓存时间。

**请求:** `GetEffectiveDirCacheTimeRequest`

**响应:** `GetEffectiveDirCacheTimeResult`

---

#### ForceExpireDirCache

强制目录缓存递归过期。

**请求:** `FileRequest`

**响应:** `google.protobuf.Empty`

---

#### VacuumDirCache

清理目录缓存数据库以回收空间。

**请求:** `google.protobuf.Empty`

**响应:** `google.protobuf.Empty`

---

#### GetVacuumProgress

获取清理操作进度。

**请求:** `google.protobuf.Empty`

**响应:** `VacuumProgressResult`
```protobuf
enum VacuumStatus {
  VACUUM_IDLE = 0;       // 空闲
  VACUUM_RUNNING = 1;    // 运行中
  VACUUM_COMPLETED = 2;  // 已完成
  VACUUM_FAILED = 3;     // 失败
}

message VacuumProgressResult {
  VacuumStatus status = 1;
  optional google.protobuf.Timestamp startTime = 2;  // 开始时间
  optional google.protobuf.Timestamp endTime = 3;    // 结束时间
  uint64 sizeBefore = 4;           // 清理前数据库大小
  uint64 sizeAfter = 5;            // 清理后数据库大小（仅完成时设置）
  optional string errorMessage = 6; // 失败时的错误信息
}
```

**0.9.18 增强:** 新增 `startTime`、`endTime`、`sizeBefore`、`sizeAfter` 和 `errorMessage` 字段，提供详细的清理进度追踪。

---

#### GetDirCacheDbSize

获取目录缓存数据库大小。

**请求:** `google.protobuf.Empty`

**响应:** `GetDirCacheDbSizeResult`
```protobuf
message GetDirCacheDbSizeResult {
  uint64 totalSizeBytes = 1; // 总大小（包括主数据库 + WAL + SHM 文件）
  bool isVacuuming = 2;      // 数据库是否正在清理中
}
```

---

### 运行时信息

#### GetRuntimeInfo

获取服务器运行时信息。

**请求:** `google.protobuf.Empty`

**响应:** `RuntimeInfo`
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

获取实时服务器统计信息。

**请求:** `google.protobuf.Empty`

**响应:** `RunInfo`
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

获取文件缓冲磁盘缓存的运行时统计信息。

**请求:** `google.protobuf.Empty`

**响应:** `FileBufferDiskCacheStats`
```protobuf
// 磁盘缓存淘汰策略
enum EvictionStrategy {
  LRU = 0;           // 最近最少使用 - 淘汰最近未访问的条目
  LARGEST_FIRST = 1; // 优先移除大文件 - 快速释放空间
  SMALLEST_FIRST = 2; // 优先移除小文件 - 保留大文件在缓存中
}

message FileBufferDiskCacheStats {
  bool enabled = 1;
  uint64 totalBytes = 2;               // 当前已缓存的总字节数
  uint64 maxBytes = 3;                 // 允许的最大字节数
  uint64 entryCount = 4;               // 缓存的文件条目数
  uint64 segmentCount = 5;             // 缓存的分段数
  string rootDir = 6;                  // 缓存存储的根目录
  bool scanCompleted = 7;              // 重启后初始磁盘扫描是否完成
  EvictionStrategy evictionStrategy = 8; // 当前活动的淘汰策略
}
```

**0.9.18 新增，0.9.19 更新**（新增 `scanCompleted` 和 `evictionStrategy` 字段）

---

#### PurgeFileBufferDiskCache

清除所有磁盘缓存的文件缓冲区以释放磁盘空间。

**请求:** `google.protobuf.Empty`

**响应:** `google.protobuf.Empty`

**0.9.18 新增**

---

#### SetDiskCacheEvictionStrategy

设置磁盘缓存的淘汰策略。

**请求:** `SetDiskCacheEvictionStrategyRequest`
```protobuf
message SetDiskCacheEvictionStrategyRequest {
  EvictionStrategy strategy = 1;
}
```

**响应:** `google.protobuf.Empty`

**淘汰策略选项:**
- `LRU` (0): 最近最少使用 - 淘汰最近未访问的条目（默认）
- `LARGEST_FIRST` (1): 优先移除大文件 - 快速释放空间
- `SMALLEST_FIRST` (2): 优先移除小文件 - 保留大文件在缓存中

**0.9.19 新增**

---

#### SetFolderDiskCache

为指定文件夹启用并配置磁盘缓存规则。

**请求:** `SetFolderDiskCacheRequest`
```protobuf
message SetFolderDiskCacheRequest {
  string path = 1;
  uint64 maxFileSize = 2;      // 0 = 无限制
  uint64 minFileSize = 3;      // 0 = 无最小限制
  ExtensionFilterMode extensionFilterMode = 4;
  repeated string extensions = 5; // 不含点号，小写（如 "mp4"、"mkv"）
  bool enabled = 6;            // true = 启用，false = 显式禁用
}
```

**响应:** `google.protobuf.Empty`

**1.0.0 新增**

---

#### RemoveFolderDiskCache

禁用文件夹的磁盘缓存。

**请求:** `FileRequest`

**响应:** `google.protobuf.Empty`

**1.0.0 新增**

---

#### ListDiskCacheFolders

列出所有配置了磁盘缓存规则的文件夹。

**请求:** `google.protobuf.Empty`

**响应:** `ListDiskCacheFoldersReply`
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

**1.0.0 新增**

---

#### PrefetchFileRanges

通知服务器对文件中一组字节范围进行预取，同时通过优先级对并发任务进行调度。面向能预知访问模式的客户端（媒体拖动、批量缩略图生成、压缩归档读取中心目录等）。

**请求:** `PrefetchFileRangesRequest`
```protobuf
message ByteRange {
  uint64 start = 1;  // 起始位置（含）
  uint64 length = 2; // 字节数
}

message PrefetchFileRangesRequest {
  string path = 1;
  repeated ByteRange ranges = 2;
  HintPriority priority = 3;
  // 0 = 由服务器分配并返回 id
  uint64 hint_id = 4;
  // 0 = 服务器默认值（限制在 [1, PREFETCH_HINT_TTL_SEC] 范围内）
  uint32 ttl_seconds = 5;
  // 为 true 时，添加前先取消该路径上已存在的提示
  bool replace_existing = 6;
}
```

**响应:** `PrefetchFileRangesReply`
```protobuf
message PrefetchFileRangesReply {
  uint64 hint_id = 1;
  uint32 accepted_range_count = 2;
  // 因越界或已完全缓存而被丢弃的范围数
  uint32 rejected_range_count = 3;
}
```

**1.0.7 新增**

---

#### CancelFilePrefetch

取消之前通过 `PrefetchFileRanges` 注册的一个或多个提示。`hint_ids` 为空时取消该路径上的全部提示。

**请求:** `CancelFilePrefetchRequest`
```protobuf
message CancelFilePrefetchRequest {
  string path = 1;
  // 为空时取消该路径上的全部提示
  repeated uint64 hint_ids = 2;
}
```

**响应:** `google.protobuf.Empty`

**1.0.7 新增**

---

#### CloseFileReader

告诉服务器"我不会再读这个文件了"。当不再有打开的文件句柄时立即释放服务端 `EntryReader`（下载缓冲 + 下载线程），跳过默认 2 秒的关闭后保留窗口（该窗口主要服务于挂载文件系统的快速关闭/重开模式）。适用于一次性读取场景（Web 缩略图生成、元数据探测）等能保证近期不会再次打开该文件的客户端。

**请求:** `FileRequest`（路径）

**响应:** `google.protobuf.Empty`

**1.0.7 新增**

---

#### GetActivePrefetchHints

诊断接口：返回当前注册的预取提示快照，以及进程启动以来的累计计数器。

**请求:** `google.protobuf.Empty`

**响应:** `GetActivePrefetchHintsReply`
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

**1.0.7 新增**

---

#### GetOpenFileHandles

获取所有打开的文件句柄。

**请求:** `google.protobuf.Empty`

**响应:** `OpenFileHandleList`
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

### 账户管理

#### SendConfirmEmail

发送账户确认邮件。

**请求:** `google.protobuf.Empty`

**响应:** `google.protobuf.Empty`

---

#### ConfirmEmail

使用验证码确认邮箱。

**请求:** `ConfirmEmailRequest`
```protobuf
message ConfirmEmailRequest {
  string confirmCode = 1;
}
```

**响应:** `google.protobuf.Empty`

---

#### GetAccountStatus

获取当前账户状态和计划。

**请求:** `google.protobuf.Empty`

**响应:** `AccountStatusResult`
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
  // 账号当前绑定的合作伙伴设备（无绑定时为空），驱动解绑界面
  repeated BoundDevice boundDevices = 10;
  // 仅在用户拥有商店自动续费订阅（Apple/Google/Meta）时存在；
  // 支付宝或一次性购买不返回
  optional SubscriptionInfo subscription = 11;
}

message AccountPlan {
  string planName = 1;
  string description = 2;
  string fontAwesomeIcon = 3;
  string durationDescription = 4;
  google.protobuf.Timestamp endTime = 5;
  // 服务端计划 ID（"1" = 终身 VIP，"4" = 终身轻享等）；"0"/空表示无计划
  string planId = 6;
}

message BoundDevice {
  string deviceId = 1;
  string manufacturerId = 2;
  string status = 3;       // ACTIVE / INACTIVE / DELETED
  string createTime = 4;   // naive UTC 日期时间字符串
  string partnerName = 5;
}

message SubscriptionInfo {
  string store = 1;        // apple | google | meta
  string productId = 2;    // cd_core_monthly | cd_core_yearly
  bool autoRenew = 3;
  bool inGracePeriod = 4;
  string expiresAt = 5;    // 下一次自动扣款或访问截止时间（naive UTC 字符串）
}
```

---

#### ChangePassword

更改账户密码。

**请求:** `ChangePasswordRequest`
```protobuf
message ChangePasswordRequest {
  string oldPassword = 1;
  string newPassword = 2;
  optional string totpCode = 3;
}
```

**注意:** 如果您的账户启用了双因素认证 (2FA),您必须在 `totpCode` 字段中提供有效的 TOTP 代码或恢复代码。

**响应:** `FileOperationResult`

---

#### ChangeEmail

更改账户邮箱。

**请求:** `ChangeEmailRequest`
```protobuf
message ChangeEmailRequest {
  string newEmail = 1;
  string password = 2;
  optional string changeCode = 3;
  optional string totpCode = 4;
}
```

**注意:** 如果您的账户启用了双因素认证 (2FA),您必须在 `totpCode` 字段中提供有效的 TOTP 代码或恢复代码。

**响应:** `google.protobuf.Empty`

---

#### TransferBalance

向其他用户转账余额。

**请求:** `TransferBalanceRequest`
```protobuf
message TransferBalanceRequest {
  string toUserName = 1;
  double amount = 2;
  string password = 3;
}
```

**响应:** `google.protobuf.Empty`

---

#### GetBalanceLog

获取余额交易历史。

**请求:** `google.protobuf.Empty`

**响应:** `BalanceLogResult`

---

#### GetCloudDrivePlans

获取可用的订阅计划。

**请求:** `google.protobuf.Empty`

**响应:** `GetCloudDrivePlansResult`

---

#### JoinPlan

加入/购买计划。

**请求:** `JoinPlanRequest`
```protobuf
message JoinPlanRequest {
  string planId = 1;
  optional string couponCode = 2;
}
```

**响应:** `JoinPlanResult`

---

#### CheckActivationCode

验证激活码。

**请求:** `StringValue` (激活码)

**响应:** `CheckActivationCodeResult`

---

#### ActivatePlan

使用激活码激活计划。

**请求:** `StringValue` (激活码)

**响应:** `JoinPlanResult`

---

#### GetReferralCode

获取用户的推荐码。

**请求:** `google.protobuf.Empty`

**响应:** `StringValue`

---

#### GetStorePurchaseQuote

IAP — 报价店内商品价格。服务器自动应用优惠码/推荐码折扣与人民币余额，返回需在店内支付的剩余金额。

**请求:** `GetStorePurchaseQuoteRequest`
```protobuf
message GetStorePurchaseQuoteRequest {
  string productId = 1;            // 规范商品 ID，如 "cd_app_pro"
  optional string couponCode = 2;  // 优惠码或 8 位推荐码
}
```

**响应:** `StorePurchaseQuote`
```protobuf
message StorePurchaseQuote {
  string productId = 1;
  string planId = 2;
  double basePriceUsd = 3;          // 目录/参考价
  double basePriceCny = 4;
  double couponDiscountCny = 5;
  double balanceAppliedCny = 6;     // 从人民币余额扣减的金额
  double finalPriceCny = 7;
  double finalPriceUsd = 8;         // 实际在店内收取的金额（CNY 余额 / 7，向上取整）
}
```

**说明:**
- 通过 `CloudDrivePlan.payableByBalance` 判断用户余额是否可完全覆盖该计划 — 对这些计划应跳过 IAP，直接调用 `JoinPlan`。
- `finalPriceUsd` 是客户端发起店内购买时使用的金额。服务器会在 `VerifyStorePurchase` 中根据相同的 `couponCode` 对账。

**1.0.9 新增**

---

#### VerifyStorePurchase

IAP — 提交店内购买票据进行服务端校验并激活计划。幂等接口 — 重复提交已知票据会返回 `ALREADY_ACTIVE`，这正是"恢复购买"流程所需要的。

**请求:** `VerifyStorePurchaseRequest`
```protobuf
message VerifyStorePurchaseRequest {
  string store = 1;                 // "apple" | "google" | "meta"
  string productId = 2;             // 规范商品 ID
  string receipt = 3;               // Apple JWS / Google purchaseToken / Meta receipt
  optional string transactionId = 4;
  optional bool sandbox = 5;
  optional string couponCode = 6;   // 报价时使用的同一优惠码
  optional string packageName = 7;  // 预留给 Google
}
```

**响应:** `VerifyStorePurchaseResult`
```protobuf
enum VerifyStorePurchaseStatus {
  VERIFY_STORE_PURCHASE_SUCCESS = 0;        // 新授予/延长
  VERIFY_STORE_PURCHASE_ALREADY_ACTIVE = 1; // 幂等重提交 / 恢复购买
  VERIFY_STORE_PURCHASE_PENDING = 2;        // 预留（Ask-to-Buy / Google PENDING）
}

message VerifyStorePurchaseResult {
  VerifyStorePurchaseStatus status = 1;
  optional AccountStatusResult accountStatus = 2; // SUCCESS/ALREADY_ACTIVE 时返回最新账号状态
  optional string pendingReason = 3;              // status == PENDING 时设置
}
```

**说明:**
- 必须传入与 `GetStorePurchaseQuote` 一致的 `couponCode`，否则服务器可能因价格与报价不一致而拒绝票据。
- `accountStatus` 包含更新后的 `accountPlan` / `subscription` — 客户端可直接替换缓存的账号状态。

**1.0.9 新增**

---

### 双因素认证 (2FA)

CloudDrive2 支持基于时间的一次性密码 (TOTP) 双因素认证以增强账户安全性。本节记录所有与 2FA 相关的方法。

#### Check2FAStatus

检查当前认证用户是否启用了 2FA。

**请求:** `google.protobuf.Empty`

**响应:** `TwoFactorAuthStatusResult`
```protobuf
message TwoFactorAuthStatusResult {
  bool two_factor_enabled = 1;
}
```

**示例 (C#):**
```csharp
var status = await client.Check2FAStatusAsync(new Empty(), callOptions);
if (status.TwoFactorEnabled)
{
    Console.WriteLine("2FA 已启用");
}
```

---

#### Setup2FA

生成 TOTP 密钥和二维码用于设置 2FA。这是启用 2FA 的第一步。

**请求:** `Setup2FARequest`
```protobuf
message Setup2FARequest {
  string password = 1;
}
```

**响应:** `TwoFactorAuthSetupResult`
```protobuf
message TwoFactorAuthSetupResult {
  string secret = 1;
  string qr_code = 2;  // Base64 编码的 PNG 图像(数据 URL 格式)
  string manual_entry_key = 3;
}
```

**工作流程:**
1. 用户提供密码
2. 服务器生成 TOTP 密钥
3. 服务器返回二维码(base64 数据 URL)和手动输入密钥
4. 用户使用身份验证器应用扫描二维码(Microsoft Authenticator、Google Authenticator、Authy 等)
5. 用户使用应用中的代码继续执行 `Enable2FA`

**示例 (C#):**
```csharp
var setupRequest = new Setup2FARequest { Password = "mypassword" };
var setup = await client.Setup2FAAsync(setupRequest, callOptions);

// 在 UI 中显示二维码(setup.QrCode 是数据 URL,如 "data:image/png;base64,...")
Console.WriteLine($"密钥: {setup.Secret}");
Console.WriteLine($"手动输入密钥: {setup.ManualEntryKey}");
// 在 UI 中将 setup.QrCode 显示为图像供用户扫描
```

---

#### Enable2FA

通过验证用户身份验证器应用中的 TOTP 代码来启用 2FA。返回应安全存储的恢复代码。

**请求:** `TwoFactorAuthCodeRequest`
```protobuf
message TwoFactorAuthCodeRequest {
  string totp_code = 1;  // 6 位 TOTP 代码或 8 位恢复代码
}
```

**响应:** `TwoFactorAuthEnableResult`
```protobuf
message TwoFactorAuthEnableResult {
  repeated string recovery_codes = 1;
  string message = 2;
}
```

**重要提示:**
- 在 `Setup2FA` 之后立即调用此方法以验证设置是否正常工作
- TOTP 代码必须是当前的(代码每 30 秒过期一次)
- 恢复代码仅生成并返回一次 - 请安全存储!
- 每个恢复代码只能使用一次

**示例 (C#):**
```csharp
var enableRequest = new TwoFactorAuthCodeRequest { TotpCode = "123456" };
var result = await client.Enable2FAAsync(enableRequest, callOptions);

Console.WriteLine(result.Message);
Console.WriteLine("恢复代码(请安全存储这些代码!):");
foreach (var code in result.RecoveryCodes)
{
    Console.WriteLine($"  {code}");
}
```

---

#### Disable2FA

禁用账户的 2FA。需要有效的 TOTP 代码或恢复代码。

**请求:** `TwoFactorAuthCodeRequest`
```protobuf
message TwoFactorAuthCodeRequest {
  string totp_code = 1;  // 6 位 TOTP 代码或 8 位恢复代码
}
```

**响应:** `TwoFactorAuthMessageResult`
```protobuf
message TwoFactorAuthMessageResult {
  string message = 1;
}
```

**示例 (C#):**
```csharp
var disableRequest = new TwoFactorAuthCodeRequest { TotpCode = "654321" };
var result = await client.Disable2FAAsync(disableRequest, callOptions);
Console.WriteLine(result.Message);
```

---

#### GetRecoveryCodes

检索未使用的恢复代码列表。需要有效的 TOTP 代码。

**请求:** `TwoFactorAuthCodeRequest`
```protobuf
message TwoFactorAuthCodeRequest {
  string totp_code = 1;  // 6 位 TOTP 代码
}
```

**响应:** `TwoFactorAuthRecoveryCodesResult`
```protobuf
message TwoFactorAuthRecoveryCodesResult {
  repeated string recovery_codes = 1;
  uint32 total = 2;
  string message = 3;
}
```

**示例 (C#):**
```csharp
var request = new TwoFactorAuthCodeRequest { TotpCode = "123456" };
var result = await client.GetRecoveryCodesAsync(request, callOptions);

Console.WriteLine($"您有 {result.Total} 个未使用的恢复代码:");
foreach (var code in result.RecoveryCodes)
{
    Console.WriteLine($"  {code}");
}
```

---

#### RegenerateRecoveryCodes

生成一组新的恢复代码并使所有现有代码失效。需要有效的 TOTP 代码。

**请求:** `TwoFactorAuthCodeRequest`
```protobuf
message TwoFactorAuthCodeRequest {
  string totp_code = 1;  // 6 位 TOTP 代码
}
```

**响应:** `TwoFactorAuthRecoveryCodesResult`
```protobuf
message TwoFactorAuthRecoveryCodesResult {
  repeated string recovery_codes = 1;
  uint32 total = 2;
  string message = 3;
}
```

**警告:** 重新生成后,所有旧的恢复代码将立即失效。

**示例 (C#):**
```csharp
var request = new TwoFactorAuthCodeRequest { TotpCode = "123456" };
var result = await client.RegenerateRecoveryCodesAsync(request, callOptions);

Console.WriteLine("新的恢复代码(旧代码现已失效!):");
foreach (var code in result.RecoveryCodes)
{
    Console.WriteLine($"  {code}");
}
```

---

#### UnbindDevice

解绑账号当前绑定的所有合作伙伴 OEM 设备（如设备丢失或转售）。需要账号密码，开启 2FA 时还需当前的 TOTP 验证码。通过 `AccountStatusResult.boundDevices` 判断用户是否存在已绑定设备。

**请求:** `UnbindDeviceRequest`
```protobuf
message UnbindDeviceRequest {
  string password = 1;           // 明文账号密码；后端会进行 MD5 哈希
  optional string totp_code = 2; // 仅在开启 2FA 时必填
}
```

**响应:** `google.protobuf.Empty`

**1.0.9 新增**

---

#### LoginWith2FA

用于使用 2FA 登录的公共方法。当您知道账户启用了 2FA 时,请使用此方法而不是 `GetToken`。

**请求:** `LoginWith2FARequest`
```protobuf
message LoginWith2FARequest {
  string userName = 1;
  string password = 2;
  string totp_code = 3;  // 6 位 TOTP 代码或 8 位恢复代码
  bool synDataToCloud = 4;
}
```

**响应:** `JWTToken`

**示例 (C#):**
```csharp
var loginRequest = new LoginWith2FARequest
{
    UserName = "myusername",
    Password = "mypassword",
    TotpCode = "123456",  // 或使用恢复代码如 "ABC12345"
    SynDataToCloud = true
};

var token = await client.LoginWith2FAAsync(loginRequest);
if (token.Success)
{
    Console.WriteLine($"登录成功! 令牌: {token.Token}");
}
```

---

#### SendDisable2FAEmail

公共恢复方法 — 请求 cloudfs 账号服务器向账号邮箱发送一次性的关闭 2FA 验证码。在用户同时丢失 TOTP 验证器和所有恢复代码时使用。

**请求:** `SendDisable2FAEmailRequest`
```protobuf
message SendDisable2FAEmailRequest {
  string email = 1;
  optional ProxyInfo cloudfsProxy = 2; // 访问 CloudFS 账号服务器的可选代理
}
```

**响应:** `google.protobuf.Empty`

**1.0.9 新增**

---

#### Disable2FAByEmail

公共恢复方法 — 提交恢复邮件中的关闭验证码和账号密码以关闭 2FA。成功后，用户可以重新使用 `GetToken` 登录（无需 TOTP）。

**请求:** `Disable2FAByEmailRequest`
```protobuf
message Disable2FAByEmailRequest {
  string disable_code = 1; // 恢复邮件中的 UUID 验证码
  string password = 2;     // 明文账号密码；后端发送前会进行 MD5 哈希
  optional ProxyInfo cloudfsProxy = 3;
}
```

**响应:** `google.protobuf.Empty`

**1.0.9 新增**

---

### 会话管理

CloudDrive2 提供会话管理功能,可查看和控制所有设备上的活动登录会话。

#### GetSessions

列出当前用户的所有活动刷新令牌会话。

**请求:** `google.protobuf.Empty`

**响应:** `GetSessionsResponse`
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

**示例 (C#):**
```csharp
var response = await client.GetSessionsAsync(new Empty(), callOptions);

Console.WriteLine($"活动会话数: {response.Sessions.Count}");
foreach (var session in response.Sessions)
{
    Console.WriteLine($"ID: {session.Id}");
    Console.WriteLine($"  设备: {session.DeviceName} ({session.DeviceOsType})");
    Console.WriteLine($"  最后使用: {session.LastUsedAt}");
    Console.WriteLine($"  IP: {session.LastIpAddress}");
    Console.WriteLine($"  过期时间: {session.ExpiresAt}");
}
```

---

#### RevokeSession

通过 ID 撤销特定会话,有效地注销该设备。

**请求:** `RevokeSessionRequest`
```protobuf
message RevokeSessionRequest {
  string session_id = 1;
}
```

**响应:** `google.protobuf.Empty`

**示例 (C#):**
```csharp
var request = new RevokeSessionRequest { SessionId = "session-abc-123" };
await client.RevokeSessionAsync(request, callOptions);
Console.WriteLine("会话已成功撤销");
```

**使用场景:**
- 远程注销丢失或被盗设备
- 从忘记注销的公共计算机注销
- 终止可疑会话

---

#### RevokeOtherSessions

撤销除当前会话外的所有会话。在更改密码后或怀疑未经授权访问时很有用。

**请求:** `google.protobuf.Empty`

**响应:** `google.protobuf.Empty`

**示例 (C#):**
```csharp
await client.RevokeOtherSessionsAsync(new Empty(), callOptions);
Console.WriteLine("所有其他会话已注销");
```

**使用场景:**
- 更改密码后
- 怀疑账户被盗用时
- 当您希望确保只有当前设备可以访问时

---

### 备份管理

#### BackupGetAll

列出所有备份配置。

**请求:** `google.protobuf.Empty`

**响应:** `BackupList`
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
  // ... 其他字段
}
```

---

#### BackupGetStatus

获取特定备份的状态。

**请求:** `StringValue` (源路径)

**响应:** `BackupStatus`

---

#### BackupAdd

添加新的备份配置。

**请求:** `Backup`
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
    bool syncDeleteFromDest = 14; // 完整扫描时同步删除目标端多余的文件
    optional bool dontStartScanAfterAdd = 15; // 为 true 时添加备份后不自动开始全量扫描
}
```

启用 `syncDeleteFromDest` 后, 备份在完整扫描阶段会依据当前删除策略自动清理目标端多出的文件/文件夹, 便于实现镜像式备份。

将 `dontStartScanAfterAdd` 设为 `true` 可跳过添加备份后的自动全量扫描。默认行为（未设置或 `false`）保持不变 — 添加备份后立即开始全量扫描。

**响应:** `google.protobuf.Empty`

---

#### BackupRemove

通过源路径删除备份。

**请求:** `StringValue` (源路径)

**响应:** `google.protobuf.Empty`

---

#### BackupUpdate

更新备份配置。

**请求:** `Backup`

**响应:** `google.protobuf.Empty`

---

#### BackupSetEnabled

启用或禁用备份。

**请求:** `BackupSetEnabledRequest`
```protobuf
message BackupSetEnabledRequest {
  string sourcePath = 1;
  bool isEnabled = 2;
}
```

**响应:** `google.protobuf.Empty`

---

#### BackupRestartWalkingThrough

重启备份扫描。

**请求:** `StringValue` (源路径)

**响应:** `google.protobuf.Empty`

---

#### CanAddMoreBackups

检查用户是否可以添加更多备份。

**请求:** `google.protobuf.Empty`

**响应:** `FileOperationResult`

---

#### NotifyPhotoLibraryChanges

通知 CloudDrive 照片库变更以进行备份（iOS/移动端平台集成）。

**请求:** `PhotoLibraryChangeList`
```protobuf
message PhotoLibraryChange {
  enum ChangeType {
    Create = 0;
    Delete = 1;
  }
  ChangeType changeType = 1;
  string localFilePath = 2;        // 应用沙盒中导出的照片路径
  string originalIdentifier = 3;   // PHAsset localIdentifier 用于追踪
  optional string originalFileName = 4;
  optional google.protobuf.Timestamp creationDate = 5;
}

message PhotoLibraryChangeList {
  repeated PhotoLibraryChange changes = 1;
  string backupSourcePath = 2;     // 要通知的备份源路径（如 "Photos"）
}
```

**响应:** `google.protobuf.Empty`

**0.9.18 新增:** 允许 iOS 应用将照片库变更推送到 CloudDrive 进行自动备份。

---

### WebDAV 管理

#### GetDavServerConfig

获取 WebDAV 服务器配置。

**请求:** `google.protobuf.Empty`

**响应:** `DavServerConfig`
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

更新 WebDAV 服务器配置。

**请求:** `ModifyDavServerConfigRequest`

**响应:** `google.protobuf.Empty`

---

#### AddDavUser

添加 WebDAV 用户。

**请求:** `AddDavUserRequest`
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

**响应:** `google.protobuf.Empty`

---

#### RemoveDavUser

删除 WebDAV 用户。

**请求:** `StringValue` (用户名)

**响应:** `google.protobuf.Empty`

---

#### ModifyDavUser

修改 WebDAV 用户设置。

**请求:** `ModifyDavUserRequest`

**响应:** `google.protobuf.Empty`

---

#### GetDavUser

通过用户名获取 WebDAV 用户。

**请求:** `StringValue` (用户名)

**响应:** `DavUser`

---

### 令牌管理

#### CreateToken

创建新的 API 令牌(仅管理员)。

**请求:** `CreateTokenRequest`
```protobuf
message CreateTokenRequest {
  string rootDir = 1;
  TokenPermissions permissions = 2;
  string friendly_name = 3;
  optional uint64 expires_in = 4; // 秒, 0 = 永不过期
  optional bool enableGrpcLog = 5;
  optional bool enableStreamFileLog = 6;
}
```

**响应:** `TokenInfo`

---

#### ModifyToken

修改现有 API 令牌。

**请求:** `ModifyTokenRequest`

**响应:** `TokenInfo`

---

#### RemoveToken

删除 API 令牌。

**请求:** `StringValue` (令牌)

**响应:** `google.protobuf.Empty`

---

#### ListTokens

列出所有 API 令牌。

**请求:** `google.protobuf.Empty`

**响应:** `ListTokensResult`

---

### 推送通知

#### PushMessage (服务器流式传输)

订阅实时推送通知。

**请求:** `google.protobuf.Empty`

**响应流:** `CloudDrivePushMessage`
```protobuf
message CloudDrivePushMessage {
  enum MessageType {
    DOWNLOADER_COUNT = 0;
    UPLOADER_COUNT = 1;
    UPDATE_STATUS = 2;
    FORCE_EXIT = 3;
    FILE_SYSTEM_CHANGE = 4;
    MOUNT_POINT_CHANGE = 5;
    COPY_TASK_COUNT = 6;
    LOG_MESSAGE = 7;
    MERGE_TASKS = 8;
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

### 消息类型详解

#### 1. DOWNLOADER_COUNT / UPLOADER_COUNT / COPY_TASK_COUNT

**目的**: 当传输任务数量发生变化时通知客户端

**数据**: `TransferTaskStatus`
- `downloadCount`: 活动下载任务数
- `uploadCount`: 活动上传任务数
- `copyTaskCount`: 活动复制任务数

**使用场景**: 更新 UI 中的传输任务计数,显示活动操作

**示例 (C#):**
```csharp
case CloudDrivePushMessage.Types.MessageType.DownloaderCount:
case CloudDrivePushMessage.Types.MessageType.UploaderCount:
case CloudDrivePushMessage.Types.MessageType.CopyTaskCount:
    var status = message.TransferTaskStatus;
    Console.WriteLine($"传输任务 - 下载: {status.DownloadCount}, " +
                     $"上传: {status.UploadCount}, " +
                     $"复制: {status.CopyTaskCount}");
    break;
```

#### 2. UPDATE_STATUS

**目的**: 通知客户端系统更新进度

**数据**: `UpdateStatus`
- `newVersion`: 可用的新版本号
- `progress`: 下载进度 (0-100)
- `updatePhase`: 更新阶段 (CHECKING, DOWNLOADING, INSTALLING, COMPLETED, ERROR)

**使用场景**:
- 提示用户有新版本可用
- 在更新过程中显示进度条
- 处理更新完成或错误情况

**示例 (C#):**
```csharp
case CloudDrivePushMessage.Types.MessageType.UpdateStatus:
    var update = message.UpdateStatus;
    switch (update.UpdatePhase)
    {
        case UpdateStatus.Types.UpdatePhase.Checking:
            Console.WriteLine("正在检查更新...");
            break;
        case UpdateStatus.Types.UpdatePhase.Downloading:
            Console.WriteLine($"正在下载更新 {update.NewVersion}: {update.Progress}%");
            break;
        case UpdateStatus.Types.UpdatePhase.Installing:
            Console.WriteLine("正在安装更新...");
            break;
        case UpdateStatus.Types.UpdatePhase.Completed:
            Console.WriteLine($"更新到 {update.NewVersion} 完成");
            break;
        case UpdateStatus.Types.UpdatePhase.Error:
            Console.WriteLine($"更新失败: {update.ErrorMessage}");
            break;
    }
    break;
```

#### 3. FORCE_EXIT

**目的**: 通知客户端他们已被强制登出

**数据**: `ExitedMessage`
- `reason`: 登出原因 (账户过期、从其他设备登录、管理员强制登出等)
- `message`: 用户可读的消息

**使用场景**:
- 清除本地会话
- 重定向到登录页面
- 向用户显示登出原因

**示例 (C#):**
```csharp
case CloudDrivePushMessage.Types.MessageType.ForceExit:
    var exitMsg = message.ExitedMessage;
    Console.WriteLine($"已强制登出: {exitMsg.Reason}");
    Console.WriteLine($"消息: {exitMsg.Message}");

    // 清理本地会话
    _jwtToken = null;

    // 通知 UI 重定向到登录
    await RedirectToLoginAsync(exitMsg.Message);
    break;
```

#### 4. FILE_SYSTEM_CHANGE

**目的**: 通知客户端文件或文件夹更改

**数据**: `FileSystemChange`
- `changeType`: 更改类型 (CREATED, MODIFIED, DELETED, RENAMED)
- `path`: 受影响的文件/文件夹路径
- `oldPath`: 对于重命名操作的旧路径
- `isDirectory`: 是否为目录

**使用场景**:
- 在文件浏览器中实时更新文件列表
- 检测外部更改
- 同步多个客户端的视图

**示例 (C#):**
```csharp
case CloudDrivePushMessage.Types.MessageType.FileSystemChange:
    var change = message.FileSystemChange;
    var itemType = change.IsDirectory ? "目录" : "文件";

    switch (change.ChangeType)
    {
        case FileSystemChange.Types.ChangeType.Created:
            Console.WriteLine($"{itemType} 已创建: {change.Path}");
            await RefreshFileListAsync(Path.GetDirectoryName(change.Path));
            break;

        case FileSystemChange.Types.ChangeType.Modified:
            Console.WriteLine($"{itemType} 已修改: {change.Path}");
            await UpdateFileDetailsAsync(change.Path);
            break;

        case FileSystemChange.Types.ChangeType.Deleted:
            Console.WriteLine($"{itemType} 已删除: {change.Path}");
            await RemoveFromCacheAsync(change.Path);
            break;

        case FileSystemChange.Types.ChangeType.Renamed:
            Console.WriteLine($"{itemType} 已重命名: {change.OldPath} -> {change.Path}");
            await UpdateFilePathAsync(change.OldPath, change.Path);
            break;
    }
    break;
```

#### 5. MOUNT_POINT_CHANGE

**目的**: 通知客户端挂载点状态更改

**数据**: `MountPointChange`
- `changeType`: 更改类型 (MOUNTED, UNMOUNTED, STATUS_CHANGED)
- `mountPoint`: 挂载点信息
- `cloudAccountId`: 相关云账户 ID

**使用场景**:
- 更新可用挂载点列表
- 显示挂载/卸载状态
- 处理挂载点错误

**示例 (C#):**
```csharp
case CloudDrivePushMessage.Types.MessageType.MountPointChange:
    var mpChange = message.MountPointChange;

    switch (mpChange.ChangeType)
    {
        case MountPointChange.Types.ChangeType.Mounted:
            Console.WriteLine($"挂载点已挂载: {mpChange.MountPoint.Name} " +
                            $"在 {mpChange.MountPoint.MountPath}");
            await AddMountPointToUIAsync(mpChange.MountPoint);
            break;

        case MountPointChange.Types.ChangeType.Unmounted:
            Console.WriteLine($"挂载点已卸载: {mpChange.MountPoint.Name}");
            await RemoveMountPointFromUIAsync(mpChange.MountPoint.Id);
            break;

        case MountPointChange.Types.ChangeType.StatusChanged:
            Console.WriteLine($"挂载点状态已更改: {mpChange.MountPoint.Name} - " +
                            $"{mpChange.MountPoint.Status}");
            await UpdateMountPointStatusAsync(mpChange.MountPoint);
            break;
    }
    break;
```

#### 6. LOG_MESSAGE

**目的**: 向客户端流式传输实时日志消息

**数据**: `LogMessage`
- `level`: 日志级别 (DEBUG, INFO, WARNING, ERROR, CRITICAL)
- `message`: 日志消息文本
- `timestamp`: 消息时间戳
- `source`: 日志源 (组件名称)

**使用场景**:
- 在管理界面中显示实时日志
- 调试和故障排除
- 监控系统活动

**示例 (C#):**
```csharp
case CloudDrivePushMessage.Types.MessageType.LogMessage:
    var log = message.LogMessage;
    var logLevel = log.Level switch
    {
        LogMessage.Types.LogLevel.Debug => "调试",
        LogMessage.Types.LogLevel.Info => "信息",
        LogMessage.Types.LogLevel.Warning => "警告",
        LogMessage.Types.LogLevel.Error => "错误",
        LogMessage.Types.LogLevel.Critical => "严重",
        _ => "未知"
    };

    Console.WriteLine($"[{log.Timestamp:yyyy-MM-dd HH:mm:ss}] " +
                     $"[{logLevel}] [{log.Source}] {log.Message}");

    // 可选: 根据级别过滤
    if (log.Level >= LogMessage.Types.LogLevel.Error)
    {
        await NotifyUserOfErrorAsync(log);
    }
    break;
```

#### 7. MERGE_TASKS

**目的**: 通知客户端文件夹合并操作的进度

**数据**: `MergeTaskUpdate`
- `taskId`: 合并任务 ID
- `status`: 任务状态 (RUNNING, COMPLETED, FAILED, CANCELLED)
- `progress`: 完成百分比 (0-100)
- `currentFile`: 当前正在处理的文件
- `totalFiles`: 要合并的总文件数
- `processedFiles`: 已处理的文件数

**使用场景**:
- 在 UI 中显示合并进度条
- 显示当前正在处理的文件
- 处理完成或错误状态

**示例 (C#):**
```csharp
case CloudDrivePushMessage.Types.MessageType.MergeTasks:
    var mergeTask = message.MergeTaskUpdate;

    switch (mergeTask.Status)
    {
        case MergeTaskUpdate.Types.TaskStatus.Running:
            Console.WriteLine($"合并进度: {mergeTask.Progress}% " +
                            $"({mergeTask.ProcessedFiles}/{mergeTask.TotalFiles})");
            Console.WriteLine($"当前文件: {mergeTask.CurrentFile}");
            await UpdateProgressBarAsync(mergeTask.Progress);
            break;

        case MergeTaskUpdate.Types.TaskStatus.Completed:
            Console.WriteLine($"合并完成! 已处理 {mergeTask.TotalFiles} 个文件");
            await ShowCompletionNotificationAsync(mergeTask);
            break;

        case MergeTaskUpdate.Types.TaskStatus.Failed:
            Console.WriteLine($"合并失败: {mergeTask.ErrorMessage}");
            await ShowErrorDialogAsync(mergeTask.ErrorMessage);
            break;

        case MergeTaskUpdate.Types.TaskStatus.Cancelled:
            Console.WriteLine("合并已取消");
            break;
    }
    break;
```

### 完整示例 - 处理所有推送消息类型

```csharp
public async Task ListenToPushMessagesAsync(CancellationToken cancellationToken)
{
    var callOptions = CreateAuthorizedCallOptions(cancellationToken);
    using var call = client.PushMessage(new Empty(), callOptions);

    try
    {
        await foreach (var message in call.ResponseStream.ReadAllAsync(cancellationToken))
        {
            switch (message.MessageType)
            {
                case CloudDrivePushMessage.Types.MessageType.DownloaderCount:
                case CloudDrivePushMessage.Types.MessageType.UploaderCount:
                case CloudDrivePushMessage.Types.MessageType.CopyTaskCount:
                    await HandleTransferTaskStatusAsync(message.TransferTaskStatus);
                    break;

                case CloudDrivePushMessage.Types.MessageType.UpdateStatus:
                    await HandleUpdateStatusAsync(message.UpdateStatus);
                    break;

                case CloudDrivePushMessage.Types.MessageType.ForceExit:
                    await HandleForceExitAsync(message.ExitedMessage);
                    return; // 退出循环,因为我们被强制登出

                case CloudDrivePushMessage.Types.MessageType.FileSystemChange:
                    await HandleFileSystemChangeAsync(message.FileSystemChange);
                    break;

                case CloudDrivePushMessage.Types.MessageType.MountPointChange:
                    await HandleMountPointChangeAsync(message.MountPointChange);
                    break;

                case CloudDrivePushMessage.Types.MessageType.LogMessage:
                    await HandleLogMessageAsync(message.LogMessage);
                    break;

                case CloudDrivePushMessage.Types.MessageType.MergeTasks:
                    await HandleMergeTaskUpdateAsync(message.MergeTaskUpdate);
                    break;

                default:
                    Console.WriteLine($"未知消息类型: {message.MessageType}");
                    break;
            }
        }
    }
    catch (RpcException ex) when (ex.StatusCode == StatusCode.Cancelled)
    {
        Console.WriteLine("推送消息流已取消");
    }
    catch (Exception ex)
    {
        Console.WriteLine($"推送消息流错误: {ex.Message}");
        throw;
    }
}
```

### 推送消息最佳实践

1. **连接管理**:
   - 使用专用任务维护推送消息连接
   - 实现自动重连逻辑以应对网络中断
   - 在应用程序关闭时正确取消流

2. **错误处理**:
   - 捕获并记录流异常
   - 实现指数退避重连
   - 处理令牌过期和重新认证

3. **消息处理**:
   - 保持消息处理程序轻量级和快速
   - 对于耗时操作,分派到后台任务
   - 避免在消息处理程序中阻塞

4. **UI 更新**:
   - 将 UI 更新批处理以提高性能
   - 使用防抖动避免过于频繁的更新
   - 根据可见性优先处理 UI 更新

5. **资源清理**:
   - 始终在 using 语句或 try-finally 中处理流
   - 在应用程序关闭时取消 CancellationToken
   - 清理事件处理程序和订阅

---

### 远程上传协议

远程上传协议使客户端能够通过协调的请求-响应工作流程将文件上传到 CloudDrive 服务器。服务器根据需要从客户端请求文件数据和哈希,非常适合基于浏览器的客户端和其他没有直接文件系统访问权限的客户端。

#### 协议概览

**RPC:

- StartRemoteUpload (一元)
  - 请求: StartRemoteUploadRequest
  - 响应: RemoteUploadStarted
- RemoteUploadChannel (服务器端流式传输;每个客户端会话使用一个长连接通道)
  - 请求: RemoteUploadChannelRequest
  - 响应: RemoteUploadChannelReply
    - 字段: upload_id
    - oneof request
      - read_data: RemoteReadDataRequest
      - hash_data: RemoteHashDataRequest
      - status_changed: RemoteUploadStatusChanged
- RemoteReadData (一元)
  - 请求: RemoteReadDataUpload
  - 响应: RemoteReadDataReply
- RemoteHashProgress (一元) — 用于进度更新和哈希请求的完成确认
  - 请求: RemoteHashProgressUpload
  - 响应: RemoteHashProgressReply
- RemoteUploadControl (一元)
  - 请求: RemoteUploadControlRequest (oneof: cancel, pause, resume)
  - 响应: google.protobuf.Empty (通过 RPC 状态报告错误)

关键协议说明:
- 所有操作都通过服务器提供的 upload_id 进行索引(从 StartRemoteUpload 返回)。
- RemoteUploadChannel 请求必须包含稳定的 device_id,用于唯一标识客户端设备;跨重启重用它,以便服务器可以替换通道并在客户端重新连接时重放待处理工作。
- file_path 仅在 StartRemoteUpload 中提供;后续消息通过 upload_id 索引。不使用 cloudName/cloudAccountId。
- 服务器对哈希的请求可能包含可选的 block_size(仅限 MD5)以请求每块 MD5。
- 最终哈希值(和任何块哈希)必须通过 RemoteHashProgress 传递。
- 客户端控制(暂停/恢复/取消)通过 RemoteUploadControl 发送。状态变更通过流上的 RemoteUploadStatusChanged 观察;控制 RPC 成功时返回 Empty,不携带状态。

---

## 消息契约(基本字段)

- StartRemoteUploadRequest
  - file_path: string — 服务器上的目标路径
  - file_size: uint64 — 总字节数
  - known_hashes: map<uint32, string> — 可选的预计算文件哈希;键是 CloudDriveFile.HashType 数值(1=MD5, 2=SHA1, 3=PIKPAK_SHA1)

- RemoteUploadChannelRequest
  - device_id: string — 客户端设备的稳定标识符。跨进程重启重用相同值(例如 CloudFS 的 `SELF_GENERATE_MACHINE_ID`)。

- RemoteUploadChannelReply
  - upload_id: string
  - oneof request
    - RemoteReadDataRequest
      - offset: uint64
      - length: uint64
      - lazy_read: bool
    - RemoteHashDataRequest
      - hash_type: HashType (例如 MD5, SHA1, PIKPAK_SHA1)
      - block_size: uint32 (可选;仅限 MD5;0 或未设置表示无每块哈希)
    - RemoteUploadStatusChanged
      - status: UploadFileInfo.Status (例如 WaitforPreprocessing, Preprocessing, Transfer, Pause, Cancelled, Finish, Skipped, Inqueue, Ignored, Error, FatalError)
      - error_message: string (当状态指示错误时设置)

- RemoteReadDataUpload
  - upload_id: string
  - offset: uint64
  - length: uint64
  - lazy_read: bool
  - data: bytes
  - is_last_chunk: bool

- RemoteHashProgressUpload
  - upload_id: string
  - bytes_hashed: uint64 — 累计进度
  - total_bytes: uint64 — 通常是文件大小
  - hash_type: HashType
  - hash_value: string (可选;仅在最终进度消息中存在)
  - block_hashes: repeated string (可选;仅限 MD5;仅当 block_size > 0 时在最终进度消息中存在)

---

## 端到端客户端工作流程

1) 启动上传
- 使用 file_path 和 file_size 调用 StartRemoteUpload。对所有后续 RPC 使用返回的 upload_id。

2) 打开全局通道
- 每个客户端会话调用一次 RemoteUploadChannel 并保持打开。每次连接时提供相同的 device_id(即使在重启进程后)。服务器使用 device_id 交换该设备的最新流,并将自动向新通道重放任何未完成的读取/哈希请求。
- 服务器将为任何活动的 upload_id 推送 RemoteReadDataRequest、RemoteHashDataRequest 和 RemoteUploadStatusChanged 消息。

3) 服务读取请求
- 收到 RemoteReadDataRequest 时,从本地文件读取请求的范围并使用字节调用 RemoteReadData。当您知道正在发送该上传的最后一部分时设置 is_last_chunk。

4) 服务哈希请求(带进度和完成确认)
- 收到 RemoteHashDataRequest 时:
  - 从 hash_type 确定算法。
  - 如果 hash_type == MD5 且 block_size > 0,则计算文件 MD5 和每块 MD5(小写十六进制,按顺序)。对于其他算法(例如 SHA1、PikPakSha1),仅计算文件哈希。
  - 在哈希计算过程中,定期使用当前 bytes_hashed 调用 RemoteHashProgress。选择合理的节奏(基于时间或字节)以避免过度调用。
  - 哈希完成(或取消)时,发送最终 RemoteHashProgress:
    - 成功时将 hash_value 设置为最终文件哈希。
    - 对于 block_size > 0 的 MD5,包含 block_hashes(小写十六进制,每块一个,有序)。
    - 如果哈希被取消,发送不带 hash_value 的终止进度。
  - 通过 RemoteHashProgress 报告进度。服务器在终止 RemoteHashProgress 上识别完成。

5) 处理完成
- 服务器将发送带有终止状态的 RemoteUploadStatusChanged(例如 Finish、Skipped、Cancelled、Error、FatalError)。将这些视为给定 upload_id 的完成信号。清理该上传的任何本地状态,但保持通道对其他上传开放。

6) 控制操作
- 使用 RemoteUploadControl 暂停、恢复或取消特定 upload_id。不要在此查询状态;状态变更在通道上作为 RemoteUploadStatusChanged 流式传输。
  - 取消: control = cancel {}
  - 暂停: control = pause {}
  - 恢复: control = resume {}
  - 响应: 成功时为 Empty(通过 gRPC 状态报告错误)

---

## 哈希详情

- 支持的算法(典型): MD5、SHA1、PikPakSha1。服务器通过 RemoteHashDataRequest.hash_type 指示所需算法。
- MD5 块哈希(可选):
  - 服务器可能通过在 RemoteHashDataRequest 中提供 block_size 来请求块哈希(仅限 MD5)。
  - 计算大小为 block_size 的连续、不重叠块的每块 MD5 摘要(最后一块可能更小)。将每个摘要表示为 32 字符小写十六进制字符串。
  - 当 block_size > 0 时,最终 RemoteHashProgress 必须包含 hash_value(文件的 MD5)和 block_hashes(块 MD5 的有序列表)。
- 零长度文件:
  - 文件哈希是空字节流的算法摘要(例如空字符串的 MD5)。
  - block_hashes 应省略/为空,除非服务器特定约定另有指示。

### PikPakSha1 算法(规范)

PikPakSha1 不是对整个文件的普通 SHA-1。它是一个两级哈希:

- 使用基于总文件大小的动态分段大小将文件分割为连续段:
  - size <= 128 MiB: 256 KiB 段
  - 128 MiB < size <= 256 MiB: 512 KiB 段
  - 256 MiB < size <= 512 MiB: 1024 KiB 段
  - size > 512 MiB: 2048 KiB 段
- 对于每个段,对段字节计算 SHA-1,生成 20 字节摘要。
- 连接这些每段摘要(按顺序)并对连接计算最终 SHA-1。
- 将最终摘要输出为大写十六进制。

注意:
- PikPakSha1 不使用 RemoteHashDataRequest 中的 block_size;忽略该字段用于此算法。
- 进度(bytes_hashed)应反映到目前为止处理的字节,通常在每个段被读取/哈希后递增。

---

## 进度语义和可靠性

- 进度节奏: 在哈希计算期间定期发送 RemoteHashProgress,字节数递增。在响应性和开销之间取得平衡(例如每几百毫秒或有意义的字节增量后)。
- 完成确认: 服务器将最终 RemoteHashProgress(存在 hash_value,如果请求还有 block_hashes 的那个)视为该(upload_id, hash_type)的终止事件。
- 重复请求: 如果服务器观察到给定(upload_id, hash_type)约 60 秒没有 RemoteHashProgress,它可能重新发送相应的 RemoteHashDataRequest。客户端必须幂等地处理此类重新请求(例如,如果已在进行则忽略,或继续哈希并继续发送进度/最终)。
- 客户端重启: 当客户端使用相同 device_id 重新连接时,服务器透明地替换旧的 RemoteUploadChannel 并重放任何未完成的 RemoteReadDataRequest 或 RemoteHashDataRequest 消息。保持您的本地上传状态按 upload_id 索引,以便您可以在收到重放请求时立即恢复工作。
- 取消: 如果上传(或特定哈希请求)被取消,请立即停止工作并发送不带 hash_value 的终止 RemoteHashProgress。服务器将相应地清理状态。

---

## 示例序列图

```
客户端                                     服务器
  |                                            |
  |-- StartRemoteUploadRequest --------------> |
  |                                            |
  |<----------- RemoteUploadStarted ---------- |
  |                                            |
  |-- RemoteUploadChannel (stream) ----------> |
  |                                            |
  |<-- RemoteReadDataRequest (stream) -------- |
  |                                            |
  |-- RemoteReadData (chunk) ----------------> |
  |<-- RemoteReadDataReply ------------------- |
  |                                            |
  |<-- RemoteHashDataRequest (stream) -------- |
  |                                            |
  |== compute hash locally =================== |
  |-- RemoteHashProgress (progress) ---------> |
  |-- RemoteHashProgress (progress) ---------> |
  |-- RemoteHashProgress (final: hash[,blocks])|
  |<-- RemoteHashProgressReply --------------- |
  |                                            |
  |<-- RemoteUploadStatusChanged (Finish/Skipped/Cancelled/Error/FatalError) -- |
  |                                            |
  |-- RemoteUploadControl (pause/resume/cancel) ----> OK |
  |                                            |
  |-- (repeat for more files) ---------------- |
  |-- (close channel on session end) -------- |
```

---

## 实现概要(客户端)

- 每个会话维护一个 RemoteUploadChannel 流和一个小型调度器来处理传入请求。
- 每次连接 RemoteUploadChannel 时提供稳定的 device_id;在本地持久化它,以便重新连接映射到相同的服务器端设备条目。
- 对于每个 RemoteHashDataRequest,生成一个按(upload_id, hash_type)索引的哈希任务,以避免阻塞流读取器。
- 使用绑定到 upload_id 的取消令牌在取消时立即停止哈希。
- 将 RemoteHashProgress 更新限制在合理的速率;始终发送带有 hash_value(和 MD5 请求时的 block_hashes)的终止进度。
- 将相同(upload_id, hash_type)的重复 RemoteHashDataRequest 视为恢复/继续报告进度的提示。

---

## 伪代码示例 (C#, Java, Python)

这些片段说明了最小的客户端流程。它们不依赖于任何特定的任务管理器;与您自己的作业/取消框架集成。

### C# (Grpc.Net.Client)

```csharp
// 伪代码 — 假设生成的 gRPC 客户端类型存在。
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

  var deviceId = MachineIdProvider.Current; // 稳定的每设备标识符
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
                // 根据需要通过 msg.StatusChanged 观察完成/状态
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
    // PikPakSha1: 对每段 SHA1 摘要连接的 SHA1;动态段大小
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
// 伪代码 — 假设生成的存根存在。
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
          // 通过状态观察完成
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
      // PikPakSha1: 连接每段 SHA1 摘要的 SHA1
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
# 伪代码 — 假设生成的存根和消息存在。
import hashlib, os, time

def upload_client(stub, path, size, cancel_event):
    started = stub.StartRemoteUpload(StartRemoteUploadRequest(file_path=path, file_size=size))
    files = {started.upload_id: {'path': path, 'size': size}}

  device_id = machine_id_provider()  # 返回稳定的每设备标识符
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
      # PikPakSha1: 对每段 SHA1 摘要连接的 SHA1(大写十六进制)
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

**Go 示例 (google.golang.org/grpc):**

```go
// 伪代码 — 假设生成的 gRPC 客户端类型存在。
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
    // 启动上传
    started, err := client.StartRemoteUpload(ctx, &pb.StartRemoteUploadRequest{
        FilePath: path,
        FileSize: uint64(size),
    })
    if err != nil {
        return err
    }

    files := make(map[string]*LocalFile)
    files[started.UploadId] = &LocalFile{path: path, size: size}

    // 打开通道
    deviceId := getMachineId() // 稳定的每设备标识符
    stream, err := client.RemoteUploadChannel(ctx, &pb.RemoteUploadChannelRequest{
        DeviceId: deviceId,
    })
    if err != nil {
        return err
    }

    // 处理传入请求
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
            // 通过状态观察完成
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
        // 带块哈希的 MD5
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
        // PikPakSha1: 对每段 SHA1 摘要连接的 SHA1
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
        // 标准 MD5 或 SHA1
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
    // 转换为大写
    return strings.ToUpper(s)
}
```

#### 最佳实践

**RPC 操作:**
- 始终在每个 RPC 上包含正确的 `upload_id`
- 为 `RemoteUploadChannel` 请求重用稳定的 `device_id`,以便恢复的连接被视为相同设备
- 保持流通道打开;不要为每个文件创建一个通道

**数据传输:**
- 首选 ≤ 1 MiB 的块大小以保持在典型 gRPC 消息限制下并减少反压
- 在 `StartRemoteUpload` 时验证 `file_path` 和 `file_size` 以尽早捕获不匹配
- 对于大文件,首选内存映射或缓冲 I/O 和增量哈希以最小化内存使用

**可靠性:**
- 日志/跟踪进度和完成点以帮助诊断
- 为发送进度或数据时的瞬态 RPC 故障实现退避和重试
- 除非不确定服务器是否收到,否则避免重复最终消息

#### 错误处理

**RPC 错误:**
- 一元 RPC 返回标准 gRPC 状态代码;在安全的地方处理重试
- 如果 `RemoteHashProgress` 瞬态失败,重试发送最新进度(包括最终进度)
- 服务器基于 (`upload_id`, `hash_type`) 和终止状态进行去重

**取消:**
- 如果服务器取消上传,立即停止哈希/读取
- 在适用时发送不带 `hash_value` 的终止 `RemoteHashProgress`

#### 控制操作

**RemoteUploadControl 示例:**

**取消:**
```protobuf
upload_id: "abc123"
control: cancel {}
```

**暂停:**
```protobuf
upload_id: "abc123"
control: pause {}
```

**恢复:**
```protobuf
upload_id: "abc123"
control: resume {}
```

成功时,RPC 返回 Empty。通过流通道上的 `RemoteUploadStatusChanged` 观察结果状态。

---

### 服务控制

#### Logout

从 CloudFS 服务器注销。

**请求:** `UserLogoutRequest`
```protobuf
message UserLogoutRequest {
  bool logoutFromCloudFS = 1;
}
```

**响应:** `FileOperationResult`

---

#### GetServiceCapabilities

获取服务能力（重启/更新可用性）。

**请求:** `google.protobuf.Empty`

**响应:** `ServiceCapabilities`
```protobuf
message ServiceCapabilities {
  bool canRestart = 1; // 服务重启是否可用
  bool canUpdate = 2;  // 服务更新是否可用
}
```

**1.0.0 新增**

---

#### RestartService

重启 CloudDrive 服务。

**请求:** `google.protobuf.Empty`

**响应:** `google.protobuf.Empty`

---

#### ShutdownService

关闭 CloudDrive 服务。

**请求:** `google.protobuf.Empty`

**响应:** `google.protobuf.Empty`

---

### 更新管理

#### HasUpdate

检查是否有更新可用。

**请求:** `google.protobuf.Empty`

**响应:** `UpdateResult`

---

#### CheckUpdate

检查软件更新。

**请求:** `google.protobuf.Empty`

**响应:** `UpdateResult`
```protobuf
message UpdateResult {
  bool hasUpdate = 1;
  string newVersion = 2;
  string description = 3;
}
```

---

#### DownloadUpdate

下载最新版本。

**请求:** `google.protobuf.Empty`

**响应:** `google.protobuf.Empty`

---

#### UpdateSystem

更新到最新版本。

**请求:** `google.protobuf.Empty`

**响应:** `google.protobuf.Empty`

---

### Web 服务器配置

#### GetWebServerConfig

获取 Web 服务器配置。

**请求:** `google.protobuf.Empty`

**响应:** `WebServerConfig`
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

设置 Web 服务器配置。

**请求:** `SetWebServerConfigRequest`

**响应:** `google.protobuf.Empty`

---

#### GenerateSelfSignedCert

生成自签名 SSL 证书。

**请求:** `GenerateSelfSignedCertRequest`
```protobuf
message GenerateSelfSignedCertRequest {
  bool restart_servers = 1;
}
```

**响应:** `google.protobuf.Empty`

---

## 数据类型参考

### CloudDriveFile

表示文件或文件夹的核心数据类型。

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

  // 布尔标志
  bool isDirectory = 30;
  bool isRoot = 31;
  bool isCloudRoot = 32;
  bool isCloudDirectory = 33;
  bool isCloudFile = 34;
  bool isSearchResult = 35;
  bool isForbidden = 36;
  bool isLocal = 37;

  // 功能
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

  // 哈希信息
  enum HashType {
    Unknown = 0;
    Md5 = 1;
    Sha1 = 2;
    PikPakSha1 = 3;
  }
  map<uint32, string> fileHashes = 70;

  // 加密
  enum FileEncryptionType {
    None = 0;
    Encrypted = 1; // 需要密码
    Unlocked = 2;  // 已提供密码
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

文件操作的标准结果。

```protobuf
message FileOperationResult {
  bool success = 1;
  string errorMessage = 2;
  repeated string resultFilePaths = 3;
}
```

---

### TokenPermissions

API 令牌的细粒度权限。

```protobuf
message TokenPermissions {
  // 文件操作
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

  // 加密操作
  bool allow_create_encrypt = 13;
  bool allow_unlock_encrypted = 14;
  bool allow_lock_encrypted = 15;

  // 云操作
  bool allow_add_offline_download = 16;
  bool allow_list_offline_downloads = 17;
  bool allow_modify_offline_downloads = 18;
  bool allow_shared_links = 19;

  // 系统信息
  bool allow_view_properties = 20;
  bool allow_get_space_info = 21;
  bool allow_view_runtime_info = 22;
  bool allow_push_message = 41;

  // 管理权限
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

`allow_push_message`(0.9.15 新增) 用于控制令牌是否可以订阅 `PushMessage`/`PushTaskChange` 等流式推送通知, 仅在需要实时消息时才应开启。

---

### ProxyInfo

代理配置。

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

## 错误处理

### gRPC 状态码

CloudDrive2 使用标准 gRPC 状态码:

| 代码 | 名称 | 描述 |
|------|------|-------------|
| 0 | OK | 成功 |
| 1 | CANCELLED | 操作已取消 |
| 2 | UNKNOWN | 未知错误 |
| 3 | INVALID_ARGUMENT | 无效参数 |
| 4 | DEADLINE_EXCEEDED | 超时 |
| 5 | NOT_FOUND | 资源未找到 |
| 7 | PERMISSION_DENIED | 没有权限 |
| 12 | UNIMPLEMENTED | 方法未实现 |
| 14 | UNAVAILABLE | 服务不可用 |
| 16 | UNAUTHENTICATED | 缺少/无效的身份验证 |

### 常见错误场景

#### 无效的用户计划 (权限被拒绝)

**错误代码**: `PERMISSION_DENIED` (StatusCode 7)  
**错误详情**: `"invalid user plan"`

当用户当前的订阅计划不允许请求的操作时会发生此错误。例如:
- 添加的云 API 连接超过计划允许的数量
- 添加的挂载点超过计划允许的数量
- 在没有适当订阅的情况下访问高级功能

**如何处理:**

错误消息表明用户需要升级其计划才能继续。遇到此错误时:

1. **显示用户友好的消息**: 显示本地化消息解释限制
2. **提供升级选项**: 引导用户到会员资格/升级页面
3. **优雅降级**: 允许应用程序继续使用可用功能

**示例 (C#):**
```csharp
catch (RpcException ex) when (ex.StatusCode == StatusCode.PermissionDenied && 
                               ex.Status.Detail == "invalid user plan")
{
    var message = "您当前的计划不允许此操作。" +
                  "请升级您的计划以继续。";
    Console.WriteLine(message);
    
    // 可选: 显示升级提示
    ShowUpgradePrompt();
}
```

**示例 (Python):**
```python
except grpc.RpcError as e:
    if (e.code() == grpc.StatusCode.PERMISSION_DENIED and 
        e.details() == "invalid user plan"):
        print("您当前的计划不允许此操作。")
        print("点击'升级计划'转到会员资格页面。")
        # 显示升级 UI
```

**最佳实践:**
- 在尝试受限操作之前使用 `GetAccountStatus` 检查账户状态
- 缓存账户计划信息以避免重复的 API 调用
- 为高级功能提供清晰的 UI 指示符
- 优雅地处理错误,不要中断用户体验

### 错误处理模式 (C#)

```csharp
try
{
    var result = await client.CreateFolderAsync(request, callOptions);
    if (result.Result.Success)
    {
        // 成功
        Console.WriteLine($"已创建: {result.FolderCreated.FullPathName}");
    }
    else
    {
        // 操作失败但没有异常
        Console.WriteLine($"错误: {result.Result.ErrorMessage}");
    }
}
catch (RpcException ex)
{
    switch (ex.StatusCode)
    {
        case StatusCode.Unauthenticated:
            Console.WriteLine("需要认证或令牌已过期");
            break;
        case StatusCode.PermissionDenied:
            Console.WriteLine("权限被拒绝");
            break;
        case StatusCode.DeadlineExceeded:
            Console.WriteLine("请求超时");
            break;
        case StatusCode.Unimplemented:
            Console.WriteLine("服务器不支持该方法");
            break;
        default:
            Console.WriteLine($"RPC 错误: {ex.Status.Detail}");
            break;
    }
}
catch (Exception ex)
{
    Console.WriteLine($"意外错误: {ex.Message}");
}
```

### 错误处理模式 (Python)

```python
import grpc

try:
    result = client.create_folder('/path', 'folder_name')
    if result.result.success:
        print(f"已创建: {result.folderCreated.fullPathName}")
    else:
        print(f"错误: {result.result.errorMessage}")

except grpc.RpcError as e:
    if e.code() == grpc.StatusCode.UNAUTHENTICATED:
        print("需要认证或令牌已过期")
    elif e.code() == grpc.StatusCode.PERMISSION_DENIED:
        print("权限被拒绝")
    elif e.code() == grpc.StatusCode.DEADLINE_EXCEEDED:
        print("请求超时")
    else:
        print(f"RPC 错误: {e.details()}")
except Exception as e:
    print(f"意外错误: {e}")
```

---

## 最佳实践

### 1. 连接管理

**应该:**
- 在多个请求之间重用 gRPC 通道
- 使用完毕后正确释放通道
- 在高吞吐量场景中使用连接池

**不应该:**
- 为每个请求创建新通道
- 在短期应用程序中无限期地保持通道打开

```csharp
// 好的做法
using var client = new CloudDriveClient("http://localhost:19798");
await client.AuthenticateAsync(...);
await client.GetSubFilesAsync(...);
await client.CreateFolderAsync(...);
// 通道在此处释放

// 不好的做法
for (int i = 0; i < 100; i++)
{
    using var client = new CloudDriveClient("http://localhost:19798");
    await client.GetSubFilesAsync(...);
}
```

### 2. 身份验证

**应该:**
- 安全地存储 JWT 令牌
- 在请求前检查令牌过期
- 在过期前主动刷新令牌
- 注销时清除令牌

**不应该:**
- 在纯文本文件中存储令牌
- 硬编码凭据
- 忽略令牌过期

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

### 3. 流式 RPC

**应该:**
- 对大型结果集使用服务器流式传输(GetSubFiles、GetSearchResults)
- 分块处理流式结果以减少内存使用
- 使用 CancellationTokens 正确处理取消
- 为流式调用使用超时

**不应该:**
- 一次性将所有流式结果加载到内存中
- 忽略取消请求
- 让流式调用无限期运行

```csharp
// 好的做法: 分块处理
var files = new List<CloudDriveFile>();
const int chunkSize = 1000;
var currentChunk = new List<CloudDriveFile>();

using var call = client.GetSubFiles(request, callOptions);
await foreach (var response in call.ResponseStream.ReadAllAsync(cancellationToken))
{
    currentChunk.AddRange(response.SubFiles);

    if (currentChunk.Count >= chunkSize)
    {
        ProcessChunk(currentChunk); // 增量处理
        currentChunk.Clear();
    }
}
```

### 4. 错误处理

**应该:**
- 在使用结果前始终检查 `FileOperationResult.Success`
- 处理特定的 RpcException 状态码
- 为瞬态错误实现重试逻辑
- 记录带上下文的错误

**不应该:**
- 假设操作总是成功
- 捕获所有异常而不进行适当处理
- 无限期重试而不使用退避

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
                // 重试瞬态错误
                time.Sleep(time.Second * time.Duration(1<<i))
                continue
            default:
                // 不要重试其他错误
                return err
            }
        }
        return err
    }
    return fmt.Errorf("超过最大重试次数")
}
```

### 5. 性能优化

**应该:**
- 对缓存的目录列表使用 `forceRefresh=false`
- 使用 `SetDirCacheTimeSecs` 设置适当的缓存时间
- 尽可能批量操作(DeleteFiles、RenameFiles)
- 使用 `GetDownloadUrlPath` 进行直接下载,而不是代理

**不应该:**
- 在每次请求时都强制刷新
- 对可以批量处理的操作进行单独的 API 调用
- 当直接 URL 可用时通过应用程序下载文件

### 6. 安全性

**应该:**
- 在生产环境中使用 HTTPS
- 验证 SSL 证书
- 使用具有最小所需权限的 API 令牌
- 设置令牌过期时间
- 在需要时为 API 令牌启用 gRPC 日志记录

**不应该:**
- 在生产环境中使用不安全的通道
- 给予令牌完全权限
- 创建永不过期的令牌(对于非管理员使用)

```csharp
// 创建有限权限的令牌
var tokenRequest = new CreateTokenRequest
{
    RootDir = "/public",
    FriendlyName = "公共只读令牌",
    ExpiresIn = 86400 * 30, // 30 天
    Permissions = new TokenPermissions
    {
        AllowList = true,
        AllowRead = true,
        AllowSearch = true,
        // 所有其他权限默认为 false
    }
};

var token = await client.CreateTokenAsync(tokenRequest, adminCallOptions);
```

### 7. 资源管理

**应该:**
- 释放 gRPC 通道和流式调用
- 写入后关闭文件句柄
- 不再需要时取消长期运行的操作
- 使用 `GetOpenFileHandles` 监控打开的文件句柄

**不应该:**
- 让流式调用无限期地保持打开
- 忘记关闭文件句柄
- 忽略资源限制

### 8. Web 浏览器客户端 (gRPC-Web)

**应该:**
- 对 Blazor WebAssembly 和基于浏览器的客户端使用 `GrpcWebHandler`
- 处理特定于浏览器的限制(不支持 HTTP/2)
- 使用远程上传协议从浏览器上传文件
- 测试 CORS 配置

**不应该:**
- 尝试在浏览器中使用常规 gRPC
- 使用双向流式传输(在 gRPC-Web 中不支持)

```csharp
// 浏览器兼容的客户端设置
var channel = GrpcChannel.ForAddress(baseAddress, new GrpcChannelOptions
{
    HttpHandler = new GrpcWebHandler(new HttpClientHandler()),
    UnsafeUseInsecureChannelCallCredentials = true // 仅用于开发!
});
```

### 9. 监控和调试

**应该:**
- 使用 `PushMessage` 监控实时事件
- 检查 `GetRunningInfo` 以了解服务器健康状况
- 监控 `GetAllTasksCount` 以了解传输进度
- 启用适当的日志级别
- 使用 `GetOpenFileHandles` 调试文件锁定问题

**不应该:**
- 过于频繁地轮询状态端点
- 在生产环境中将日志级别设置为 Trace
- 忽略服务器健康指标

### 10. API 版本控制

**应该:**
- 使用 `GetRuntimeInfo` 检查服务器版本
- 对较新的 API 处理 `UNIMPLEMENTED` 状态
- 测试与目标服务器版本的兼容性
- 记录所需的最低服务器版本

**不应该:**
- 假设所有方法在所有服务器上都可用
- 忽略版本不兼容

```java
try {
    result = stub.someNewMethod(request);
} catch (StatusRuntimeException e) {
    if (e.getStatus().getCode() == Status.Code.UNIMPLEMENTED) {
        // 回退到旧方法或显示错误
        System.out.println("此功能需要 CloudDrive 2.x 或更高版本");
    }
}
```

---

## 完整示例: 文件管理器应用程序

这是一个全面的示例,展示了常见操作:

### C# 控制台应用程序

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
            // 1. 检查服务器状态
            var sysInfo = await _client.GetSystemInfoAsync();
            Console.WriteLine($"服务器: {sysInfo.SystemReady}");
            Console.WriteLine($"登录为: {sysInfo.UserName}");

            // 2. 认证
            Console.Write("用户名: ");
            var username = Console.ReadLine();
            Console.Write("密码: ");
            var password = ReadPassword();

            if (!await _client.AuthenticateAsync(username, password))
            {
                Console.WriteLine("认证失败!");
                return;
            }

            // 3. 显示账户信息
            var account = await _client.GetAccountStatusAsync(new Empty());
            Console.WriteLine($"\n账户: {account.UserName}");
            Console.WriteLine($"计划: {account.AccountPlan.PlanName}");
            Console.WriteLine($"余额: ${account.AccountBalance}");

            // 4. 浏览文件
            await BrowseFiles("/");

            // 5. 上传文件
            await UploadFile("/test.txt", "Hello CloudDrive!");

            // 6. 监控传输
            await MonitorTransfers();

            // 7. 获取服务器统计信息
            var stats = await _client.GetRunningInfoAsync();
            Console.WriteLine($"\n服务器统计信息:");
            Console.WriteLine($"CPU: {stats.CpuUsage:F1}%");
            Console.WriteLine($"内存: {stats.MemUsageKB / 1024} MB");
            Console.WriteLine($"下载: {stats.DownloadBytesPerSecond / 1024:F1} KB/s");
            Console.WriteLine($"上传: {stats.UploadBytesPerSecond / 1024:F1} KB/s");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"错误: {ex.Message}");
        }
    }

    private async Task BrowseFiles(string path)
    {
        Console.WriteLine($"\n列出: {path}");
        var files = await _client.GetSubFilesAsync(path);

        foreach (var file in files)
        {
            var type = file.IsDirectory ? "[目录]" : "[文件]";
            var size = file.IsDirectory ? "" : $" ({FormatSize(file.Size)})";
            Console.WriteLine($"{type} {file.Name}{size}");
        }

        Console.WriteLine($"总计: {files.Count} 项");
    }

    private async Task UploadFile(string destPath, string content)
    {
        Console.WriteLine($"\n上传到: {destPath}");

        // 创建文件
        var createResult = await _client.CreateFileAsync("/", "test.txt");
        var fileHandle = createResult.FileHandle;

        // 写入数据
        var buffer = System.Text.Encoding.UTF8.GetBytes(content);
        var writeResult = await _client.WriteToFileAsync(
            fileHandle, 0, (ulong)buffer.Length, buffer, true);

        Console.WriteLine($"已上传 {writeResult.BytesWritten} 字节");
    }

    private async Task MonitorTransfers()
    {
        var tasks = await _client.GetAllTasksCountAsync();
        Console.WriteLine($"\n活动传输:");
        Console.WriteLine($"下载: {tasks.DownloadCount}");
        Console.WriteLine($"上传: {tasks.UploadCount}");
        Console.WriteLine($"复制任务: {tasks.CopyTaskCount}");
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

## 结论

本指南涵盖了完整的 CloudDrive2 gRPC API,包括:

- ✅ 记录了 **100 多个 RPC 方法**
- ✅ **C#、Java、Go 和 Python 的示例代码**
- ✅ **身份验证和授权**模式
- ✅ **流式 RPC**(服务器端、客户端)
- ✅ **错误处理**最佳实践
- ✅ **性能优化**技巧
- ✅ **安全准则**
- ✅ **完整的工作示例**

**API 版本:** 0.9.18

---

*最后更新: 2026-06-10*
*版权所有 © 2026 CloudDrive. 保留所有权利.*
