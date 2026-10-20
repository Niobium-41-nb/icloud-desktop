# iCloud 桌面版 — 安装脚本
#
#   powershell -ExecutionPolicy Bypass -File install.ps1
#
# 作用：
#   1. 将应用复制到 %LOCALAPPDATA%\Programs\iCloud（就地安装时跳过）
#   2. 创建「开始菜单」和桌面快捷方式，并写入 AppUserModelID
#      （Windows 靠这个 ID 把通知、任务栏分组、跳转列表归属到 iCloud）
#   3. 注册 icloud:// 协议，支持 icloud://photos 这类深链接
#
# 不写系统级注册表，不需要管理员权限；卸载见 uninstall.ps1。

[CmdletBinding()]
param(
  [switch]$NoLaunch,
  [switch]$NoDesktopShortcut
)

$ErrorActionPreference = 'Stop'

$AppName     = 'iCloud'
$AppId       = 'com.icloud.desktop'
$SourceDir   = $PSScriptRoot
$InstallDir  = Join-Path $env:LOCALAPPDATA 'Programs\iCloud'
$ExeName     = 'iCloud.exe'

function Write-Step($text) { Write-Host "· $text" }

# --- 0. 校验 ---------------------------------------------------------------
$sourceExe = Join-Path $SourceDir $ExeName
if (-not (Test-Path $sourceExe)) {
  throw "未找到 $ExeName，请在解压后的完整目录中运行本脚本。"
}

# --- 1. 复制文件 -----------------------------------------------------------
$sourceFull  = (Resolve-Path $SourceDir).Path.TrimEnd('\')
$installFull = [System.IO.Path]::GetFullPath($InstallDir).TrimEnd('\')

if ($sourceFull -ieq $installFull) {
  Write-Step "已在安装目录中，跳过复制"
} else {
  Write-Step "安装到 $installFull"
  New-Item -ItemType Directory -Force -Path $installFull | Out-Null
  $robocopy = Start-Process -FilePath 'robocopy.exe' `
    -ArgumentList @("`"$sourceFull`"", "`"$installFull`"", '/MIR', '/NFL', '/NDL', '/NJH', '/NJS', '/R:1', '/W:1') `
    -Wait -PassThru -WindowStyle Hidden
  if ($robocopy.ExitCode -ge 8) { throw "复制失败（robocopy 退出码 $($robocopy.ExitCode)）" }
}

$exe = Join-Path $installFull $ExeName
if (-not (Test-Path $exe)) { throw "安装后未找到 $exe" }

# --- 2. 快捷方式（带 AppUserModelID） --------------------------------------
$csharp = @'
using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;

public static class ShellShortcut {
  [ComImport, Guid("00021401-0000-0000-C000-000000000046")]
  private class CShellLink { }

  [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("000214F9-0000-0000-C000-000000000046")]
  private interface IShellLinkW {
    void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszFile, int cch, IntPtr pfd, uint fFlags);
    void GetIDList(out IntPtr ppidl);
    void SetIDList(IntPtr pidl);
    void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszName, int cch);
    void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string pszName);
    void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszDir, int cch);
    void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string pszDir);
    void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszArgs, int cch);
    void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string pszArgs);
    void GetHotkey(out short pwHotkey);
    void SetHotkey(short wHotkey);
    void GetShowCmd(out int piShowCmd);
    void SetShowCmd(int iShowCmd);
    void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszIconPath, int cch, out int piIcon);
    void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string pszIconPath, int iIcon);
    void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string pszPathRel, uint dwReserved);
    void Resolve(IntPtr hwnd, uint fFlags);
    void SetPath([MarshalAs(UnmanagedType.LPWStr)] string pszFile);
  }

  [StructLayout(LayoutKind.Sequential, Pack = 4)]
  private struct PropertyKey { public Guid fmtid; public uint pid; }

  [StructLayout(LayoutKind.Explicit, Size = 24)]
  private struct PropVariant {
    [FieldOffset(0)] public ushort vt;
    [FieldOffset(2)] public ushort reserved1;
    [FieldOffset(4)] public ushort reserved2;
    [FieldOffset(6)] public ushort reserved3;
    [FieldOffset(8)] public IntPtr pointer;
  }

  [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  private interface IPropertyStore {
    void GetCount(out uint cProps);
    void GetAt(uint iProp, out PropertyKey pkey);
    void GetValue(ref PropertyKey key, out PropVariant pv);
    void SetValue(ref PropertyKey key, ref PropVariant pv);
    void Commit();
  }

  private static IShellLinkW Create(string path, string target, string workingDirectory, string icon) {
    var link = (IShellLinkW)new CShellLink();
    link.SetPath(target);
    link.SetWorkingDirectory(workingDirectory);
    link.SetIconLocation(icon, 0);
    link.SetDescription("iCloud");
    return link;
  }

  private static PropertyKey MakeAumidKey() {
    return new PropertyKey { fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), pid = 5 };
  }

  public static void CreateWithAumid(string lnkPath, string target, string workingDirectory, string icon, string aumid) {
    var link = Create(lnkPath, target, workingDirectory, icon);
    var store = (IPropertyStore)link;
    var key = MakeAumidKey();
    var pv = new PropVariant { vt = 31 };
    pv.pointer = Marshal.StringToCoTaskMemUni(aumid);
    try {
      store.SetValue(ref key, ref pv);
      store.Commit();
    } finally {
      Marshal.FreeCoTaskMem(pv.pointer);
    }
    ((IPersistFile)link).Save(lnkPath, true);
  }

  public static string ReadAumid(string lnkPath) {
    var link = (IShellLinkW)new CShellLink();
    ((IPersistFile)link).Load(lnkPath, 0);
    var store = (IPropertyStore)link;
    var key = MakeAumidKey();
    PropVariant pv;
    store.GetValue(ref key, out pv);
    if (pv.vt != 31 || pv.pointer == IntPtr.Zero) return null;
    return Marshal.PtrToStringUni(pv.pointer);
  }
}
'@

if (-not ('ShellShortcut' -as [type])) {
  Add-Type -TypeDefinition $csharp -Language CSharp
}

function New-AppShortcut([string]$linkPath) {
  $dir = Split-Path -Parent $linkPath
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  [ShellShortcut]::CreateWithAumid($linkPath, $exe, $installFull, $exe, $AppId)
  $readback = [ShellShortcut]::ReadAumid($linkPath)
  if ($readback -ne $AppId) { Write-Warning "快捷方式 AppUserModelID 写入校验不一致: $readback" }
  return $linkPath
}

$startMenu = Join-Path ([Environment]::GetFolderPath('Programs')) "$AppName.lnk"
New-AppShortcut $startMenu | ForEach-Object { Write-Step "开始菜单快捷方式: $_" }

if (-not $NoDesktopShortcut) {
  $desktop = Join-Path ([Environment]::GetFolderPath('Desktop')) "$AppName.lnk"
  New-AppShortcut $desktop | ForEach-Object { Write-Step "桌面快捷方式: $_" }
}

# --- 3. 协议注册 -----------------------------------------------------------
$proto = "HKCU:\Software\Classes\icloud"
New-Item -Path $proto -Force | Out-Null
Set-ItemProperty -Path $proto -Name '(default)' -Value 'URL:iCloud Protocol'
Set-ItemProperty -Path $proto -Name 'URL Protocol' -Value ''
$cmdKey = Join-Path $proto 'shell\open\command'
New-Item -Path $cmdKey -Force | Out-Null
Set-ItemProperty -Path $cmdKey -Name '(default)' -Value "`"$exe`" `"%1`""
Write-Step "已注册协议 icloud://"

# --- 4. 启动 ---------------------------------------------------------------
if (-not $NoLaunch) {
  Write-Step "启动 iCloud"
  Start-Process -FilePath $exe -WorkingDirectory $installFull
}

Write-Host ""
Write-Host "安装完成。"
Write-Host "  程序位置: $installFull"
Write-Host "  卸载方式: powershell -File `"$installFull\uninstall.ps1`""
