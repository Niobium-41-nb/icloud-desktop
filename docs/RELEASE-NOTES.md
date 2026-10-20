## 安装

下载 `iCloud-<tag>-win32-x64.zip`，解压后在目录内执行：

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1
```

脚本会复制到 `%LOCALAPPDATA%\Programs\iCloud`、创建开始菜单与桌面快捷方式
（写入 AppUserModelID，这是系统通知显示为 iCloud 的前提）、注册 `icloud://`
协议，并启动应用。不需要管理员权限。

也可以直接双击解压目录里的 `iCloud.exe` 便携运行，代价是通知归属会显示为
`Electron`（没有带 AUMID 的快捷方式）。

## 包含内容

- `iCloud.exe` + Electron 运行时（Chromium 152 / Electron 44）
- `install.ps1` / `uninstall.ps1`
- 完整源码见仓库，`npm run package` 可本地复现同样的构建

## 卸载

```powershell
powershell -ExecutionPolicy Bypass -File uninstall.ps1           # 保留登录状态
powershell -ExecutionPolicy Bypass -File uninstall.ps1 -PurgeData # 一并删除数据
```

## 须知

- 需要 Windows 10/11 x64 与 Apple 账户；iCloud 中国区由云上贵州运营。
- 本项目与 Apple Inc. 无关联，不含 Apple 的代码或素材，运行时加载公开的
  `https://www.icloud.com.cn/` 页面，登录在 Apple 官方页面内完成。
- 应用完全退出后收不到后台推送（Electron 不具备浏览器级 Web Push 服务），
  在托盘常驻期间更新正常到达。
