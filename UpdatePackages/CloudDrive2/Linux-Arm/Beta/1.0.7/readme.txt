V1.0.7(Web3.0.7)

⚠️ 重要安全提示（Windows 用户必读）
本版本将 WinFSP 升级至 2026 beta1，以修复旧版本 WinFSP 中发现的安全漏洞 CVE-2026-3006。https://github.com/winfsp/winfsp/releases/tag/v2.2B1
 - 请务必下载完整安装包重新运行安装程序，并按安装向导提示重启系统。
 - 请勿使用应用内 OTA 升级：OTA 仅替换 CloudDrive2 程序文件，不会重新安装 WinFSP 驱动，将无法获得本次安全修复。

1. 115网盘配置界面最大下载线程数限制为2，设置的值不能超过2
2. 115网盘配置界面增加每秒最大请求数限制，最大不能超过5.0
3. SMB/SFTP/FTP新增支持获取磁盘空间大小（仅部分 FTP 服务端支持,目前已知 Pure-FTPd 与启用 mod_facts 的 ProFTPD 可正确返回,其它服务端将回退为占位值。受协议限制,AVBL 只返回可用字节数,因此 总容量 与 可用 相同、已用 显示为 0）
4. 改进smb服务器和共享发现算法，适应更多场景
5. 文件重命名冲突处理方式改进：
 - 核心层(webdav/http/clouddrive共享等)的重命名冲突从原来的直接覆盖旧文件（遵循POSIX重命名行为）改为返回重命名失败
 - Linux和macOS保持原来的遵循Unix重命名覆盖语义-先删除旧文件再重命名，若旧文件为非空目录则返回错误ENOTEMPTY，符合POSIX rename(2)行为
 - Windows由原来的遵循POSIX行为改为循序Win32 MoveFile默认行为，即重命名冲突时返回ERROR_ALREAD_EXISTS错误，资源管理器会弹出"目标已存在"提示
6. 通过迅雷直接登录的帐号和通过合作伙伴设备直接登录的帐号，在个人资料页屏蔽修改密码选项，只保留修改邮箱和密码选项
7. 修复web界面复制到剪贴板按钮在非安全上下文(访问cd2的url为http://且非localhost)下工作不正常的问题
8. 其它性能改进和bug修复
