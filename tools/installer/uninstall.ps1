# iCloud 桌面版 — 卸载脚本
#
#   powershell -ExecutionPolicy Bypass -File uninstall.ps1
#
# 默认删除程序文件和快捷方式，保留登录状态；加 -PurgeData 可一并删除
# %APPDATA%\iCloudDesktop 中的会话、缓存与设置。

[CmdletBinding()]
param(
  [switch]$PurgeData
)

$ErrorActionPreference = 'Stop'
$AppName    = 'iCloud'
$AppId      = 'com.icloud.desktop'
$InstallDir = Join-Path $env:LOCALAPPDATA 'Programs\iCloud'
$DataDir    = Join-Path $env:APPDATA 'iCloudDesktop'

Get-Process -Name 'iCloud' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process | Where-Object { $_.Path -and $_.Path.StartsWith($InstallDir, 'OrdinalIgnoreCase') } |
  Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 600

foreach ($lnk in @(
    (Join-Path ([Environment]::GetFolderPath('Programs')) "$AppName.lnk"),
    (Join-Path ([Environment]::GetFolderPath('Desktop')) "$AppName.lnk")
  )) {
  if (Test-Path $lnk) {
    Remove-Item $lnk -Force
    Write-Host "已删除快捷方式 $lnk"
  }
}

foreach ($key in @(
    'HKCU:\Software\Classes\icloud',
    'HKCU:\Software\Classes\AppUserModelId\com.icloud.desktop'
  )) {
  if (Test-Path $key) {
    Remove-Item $key -Recurse -Force
    Write-Host "已清理注册表 $key"
  }
}

if (Test-Path $InstallDir) {
  $resolved = (Resolve-Path $InstallDir).Path
  if ($resolved -like "$env:LOCALAPPDATA\Programs\iCloud*") {
    Remove-Item $resolved -Recurse -Force
    Write-Host "已删除程序目录 $resolved"
  } else {
    Write-Warning "安装目录不在预期位置，已跳过删除: $resolved"
  }
}

if ($PurgeData -and (Test-Path $DataDir)) {
  Remove-Item $DataDir -Recurse -Force
  Write-Host "已删除用户数据 $DataDir"
} elseif (Test-Path $DataDir) {
  Write-Host "已保留登录状态与设置: $DataDir（加 -PurgeData 可删除）"
}

Write-Host "卸载完成。"
