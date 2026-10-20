# iCloud.com.cn 逆向报告

> 目标：`https://www.icloud.com.cn/`
> 目的：判断能否、以及如何把它变成 Windows 桌面应用
> 方法：被动抓取（HTML/JS/CSS/网络）+ 运行时可观测（本应用内 CDP）+ 静态分析
> 结论标注：**[观测]** 直接抓到的证据；**[推断]** 由证据推导；**[未知]** 未验证

---

## 0. 一句话结论

`www.icloud.com.cn` 不是一组独立网页，而是 Apple 内部代号 **CloudOS** 的单页应用外壳：
一个 3.8 MB 的 `main.js` + 按需加载的「应用」chunk，所有业务数据走 CloudKit Web Services
与 Apple 的 JSON 接口，登录是 `idmsa.apple.com` 的嵌入式授权 iframe。

这决定了桌面化的正确形态：**不去重写/镜像站点，而是给它一个原生外壳**。
站点被 `X-Frame-Options: SAMEORIGIN` 锁死，无法用 iframe / `webview` 嵌入，
必须自己承载整个 origin —— 也就是一个受控的 Chromium 容器。

---

## 1. 交付形态：CloudOS 单页应用

**[观测]** 首页响应头与结构：

```
HTTP 200, Content-Type: text/html, Content-Length: 31328
Content-Location: /system/icloud.com/index.html.en-us.gz
Content-Version: V1
X-Frame-Options: SAMEORIGIN
Cross-Origin-Opener-Policy: same-origin-allow-popups
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
Content-Security-Policy: ... report-uri https://feedbackws.icloud.com.cn/reportRaw
Server: nginx (KS-CLOUD CDN)
```

**[观测]** HTML 根节点带构建号，并声明 base 路径：

```html
<html lang="en-us"
      data-cw-private-build-number="2638Build27"
      data-cw-private-mastering-number="2638Build27">
<base href="/system/icloud.com/2638Build27/en-us/">
<link rel="preload" as="script" href="/system/icloud.com/2638Build27/en-us/main.js">
```

**[观测]** 技术栈痕迹：React（`react-dnd`、`redux.js.org` 等文档链接）、Redux、
webpack 分包（`vendors~Routes-HomePageRoute.js` 这类命名）、
`@marcom/useragent-detect`（Apple 自用的 UA 解析库），
以及大量 `CloudOSApplication` / `remoteApplicationViewController` / `applicationConfiguration`
之类与 iOS/macOS 同源的命名。

**[观测]** 构建产物规模：

| 文件 | 大小 |
| --- | --- |
| `en-us/main.js` | 3 801 041 B |
| `zh-cn/main.js` | 3 801 552 B |
| 懒加载 chunk | `RootComponentRoute.js`、`Routes-HomePageRoute.js`、`vendors~Routes-HomePageRoute.js` |
| 样式 | `1.main.css`、`6.main.css` |

### 本地化是在客户端做的

**[观测]** 无论 `Accept-Language` 是 `zh-CN` 还是 `en-US`，CDN 都返回同一份
`index.html.en-us.gz`（`<html lang="en-us">`、base 指向 `en-us`）。

**[观测]** 但页面运行时会改从 `zh-cn` 目录取 chunk：

```
GET /system/icloud.com/2638Build27/zh-cn/RootComponentRoute.js   200
GET /system/icloud.com/2638Build27/zh-cn/Routes-HomePageRoute.js 200
GET /system/icloud.com/2638Build27/zh-cn/1.main.css              200
GET /locales/5/zh-Hans-CN.json?clientBuildNumber=2638Build27
    &clientMasteringNumber=2638Build27&clientId=<uuid>            200
```

**[推断]** 入口 HTML 只负责引导，`main.js` 读取 `navigator.language` → 映射到
**CloudOS 语言代码**（`zh-CN` → `zh-Hans-CN` → 目录 `zh-cn`）后才决定后续资源路径，
文案另外从 `/locales/<version>/<lang>.json` 拉取。

**[观测]** 支持的 locale 列表在 bundle 中硬编码：`ar-sa … zh-cn zh-hk zh-tw`，
并带二级语言回退（`hasSecondaryLocales`）。

> 对我们意味着：UA/语言都真实传给页面即可，**外壳不需要也不应该改写 locale**。

---

## 2. 路由与模块清单

**[观测]** 每个模块路径都返回同一份外壳 HTML（200 `text/html`，内容长度只有几十字节差异），
即**路由对服务器无意义**，由前端决定渲染什么：

| 路径 | 服务器 | 内部应用标识（bundle 中的 `applicationName`） |
| --- | --- | --- |
| `/` | 200 | 首页 / Landing（未登录时是营销页） |
| `/photos/` | 200 | `photos3` |
| `/drive/` | 200 | `iclouddrive` |
| `/mail/` | 200 | `mail2` / `compose` |
| `/notes/` | 200 | `notes` / `notes3` |
| `/contacts/` | 200 | `contacts` / `contacts2` / `directory` |
| `/calendar/` | 200 | `calendar` |
| `/reminders/` | 200 | `reminders` / `reminders2` |
| `/find/` | 200 | `find-my-iphone` |
| `/settings/` | 200 | `customdomainsettings` / `hidemyemail` 等子页 |
| `/icloudplus/` | 200 | `plan` / `vetting` |
| `/keychain/`、`/shared/`、`/account/` | 404 | — |

**[观测]** bundle 里还有 iWork 三件套（`pages` / `numbers` / `keynote`）与
`newspublisher`，但它们不在 CloudOS 顶层路由上，属于「打开文档」时跳转到
`*.icloud.com` 的子站点（`globalThis.window.open(url, "_blank")`）。

**[观测]** 应用上下文里声明了窗口最小尺寸：

```js
mininumWindowSize: { width: 320, height: 240 }   // 原文如此拼写
```

> 桌面壳采用 380×300 作为下限，比站点声明略大，避免布局崩坏。

---

## 3. 认证流程

**[观测]** 点「登录」并不会离开首页，而是在 DOM 里插入一个 iframe：

```
https://idmsa.apple.com/appleauth/auth/authorize/signin
  ?frame_id=<uuid>
  &language=zh_CN
  &skVersion=7
  &iframeId=<uuid>
  &client_id=d39ba9916b7251055b22c7f910e2ea796ee65e98b2ddecea8f5dde8d9d1a815d
  &redirect_uri=https://www.icloud.com.cn
  &response_type=code
  &response_mode=web_message
  &state=<uuid>
  &authVersion=latest
```

关键点：

* `response_mode=web_message` —— 授权结果通过 `postMessage` 送回宿主页，**不跳转**。
  站点侧的控制台日志 `cloudOSAuth.unprocessedAuthenticationMessage.appleIdModeDidChange`
  说明宿主在监听这些消息。
* `client_id` 是固定的 64 位十六进制串，非随机。
* 授权页会加载 `appleid.cdn-apple.com/appleauth/static/jsj/<ver>/webSRPClientWorker.js`
  **[观测]** —— 密码走 **SRP** 协议在 Web Worker 里证明，明文密码不出浏览器。
* 随后有 `POST https://idmsa.apple.com/appleauth/auth/verify/device/key/challenge`
  **[观测]** ——「设备密钥」质询，即 passkey / 平台认证器路径；页面上对应的入口是
  「通过 iPhone 登录」。
* 响应头出现 `x-apple-id-session-id`、`scnt`、`X-APPLE-WEB-OON-ID` 等 Apple 侧会话标识。

**[观测]** 在 Electron 里这套流程原样工作：iframe 正常渲染中文登录页、
输入框、隐私说明与「通过 iPhone 登录」按钮（见 `docs/images/03-apple-signin.png`）。

**[推断]** 对桌面壳的要求只有三条：

1. 不允许**第三方 Cookie 拦截**（iframe 在 `idmsa.apple.com` 源上写 Cookie）；
2. 不得阻断 `postMessage`（Electron 默认不阻断）；
3. 窗口 UA 必须是「受支持的浏览器」，否则站点会走 unsupported/limited 分支。

> 这三条都满足，所以**不需要**任何注入、不需要改 CSP、也不需要代理登录。

---

## 4. 数据面

**[观测]** bundle 内出现的接口与主机（节选）：

| 类别 | 端点 |
| --- | --- |
| CloudKit 记录 | `/records/lookup`、`/records/query`、`/records/modify`、`/records/accept`、`/records/resolve` |
| 大文件 | `/records/copy/start`、`/records/copy/status`、`/records/zip/prepare`、`/assets/upload` |
| 同步 | `/zones/list`、`/zones/modify`、`/changes/database`、`/changes/zone` |
| 照片 | `/database/1/com.apple.photos.cloud/production/...`、`/applications/photos3/current/` |
| 邮件 | `/cc/mail/v1/account/`、`/mailws2/v1/thread/search|flag|move` |
| 联系人 | `v1/co/contacts/search` |
| 存储 | `/storage`、`/setup/ws/1/`、`/preference/recents` |
| 埋点 | `feedbackws.icloud.com.cn/reportStats`、`/reportRaw` |
| 主机 | `ckdatabasews`、`gatewayws`、`setup`、`cvws-h2.icloud-content.com`、`photos.icloud`、`drive.icloud`（均有 `.com.cn` 变体） |

**[观测]** 每个请求都带 `clientBuildNumber`、`clientMasteringNumber`、`clientId`
（会话级 UUID，落在 `window.__earlyClientId`），登录后再加 `dsid`。

**[观测]** 实时通道有两种：

* `wss://<host>` 的 **web courier**（CloudKit 订阅推送）
* 长轮询（`_longPollAbortController`）+ APNs 主题（`apsTopic`）

**[观测]** 前端推送用 Service Worker：

```js
// 特性门控（原样）
"Notification" in window && "serviceWorker" in navigator &&
"PushManager" in window && "indexedDB" in window

navigator.serviceWorker.register(pushServiceWorker, { scope: "/" })
```

worker 文件：`84dd839e98ba35a68b00-push-serviceworker.worker.js`、
`e084373f54b18d686b58-push-service-sharedworker.worker.js`；
成功后 token 写入 `localStorage['iCloud.accountPreferences.pushToken']`。

**[观测]** 在本应用的运行时里，上述门控**全部为真**
（`typeof PushManager === "function"`、`serviceWorker in navigator === true`、
`Notification.permission === "granted"`）。

**[未知]** `pushManager.subscribe()` 是否真的成功。Electron 没有随 Chromium 分发
浏览器推送服务（FCM）的凭据，订阅通常会以 `push service error` 失败。
**[推断]** 失败后站点保留 web courier 长连接，因此在应用运行期间更新照常到达；
完全退出后不会有推送 —— 这是外壳无法绕过的边界，已在 README「已知限制」中写明。

---

## 5. 运行时约束（直接决定外壳设计）

### 5.1 CSP

**[观测]** 首页下发两条 CSP：一条 `<meta http-equiv>`，一条响应头。合并后的关键指令：

| 指令 | 允许 | 对桌面化的影响 |
| --- | --- | --- |
| `script-src` | `'self' blob:` + `idmsa*`/`appleid*` + `*.apple-cloudkit.com`/`*.cdn-apple.com` + 8 个 sha256 | 不能注入外链脚本；`preload` 注入属于 renderer 内部，不受限制但也不该做 |
| `connect-src` | `*.icloud.com(.cn)`、`*.apple.com`、`*.cdn-apple.com`、`*.icloud-content.com(.cn)`、`wss://*.push.apple.com` | 企业代理/抓包必须放行这些域 |
| `frame-src` | `'self' blob: mailto: sms: tel:` + `*.apple.com`、`*.icloud-sandbox.com`、`*.icloud-content.com` | **不能**把 iCloud 页面嵌进第三方页面 |
| `base-uri` | `'self'` + `*.icloud.com.cn` + `*.cdn-apple.com` | — |
| `object-src` | `'none'` | — |

### 5.2 不能被嵌入

**[观测]** `X-Frame-Options: SAMEORIGIN` + CSP `frame-ancestors 'self' *.icloud.com.cn *.apple.com`。

> 结论：任何「用 iframe/webview 拼接多模块」的方案（例如左侧原生导航 + 右侧 iframe）
> 在技术上不可能。要么整站承载，要么重写 —— 后者不现实（SRP 认证 + CloudKit 私有协议）。

### 5.3 COOP

**[观测]** `Cross-Origin-Opener-Policy: same-origin-allow-popups`：站点允许自己开弹窗，
但会把跨源弹窗放到独立 browsing context group，`window.opener` 关系被切断。
**[推断]** 桌面壳开子窗口时必须让子窗口共享同一 session，否则 iWork 文档/登录回跳会丢会话。

### 5.4 UA 嗅探

**[观测]** bundle 内的判定逻辑：

```js
platformType(): /ipad|ipod|iphone/ → iOS
                /android/          → ANDROID
                /mac/ && !/like mac/ && touch → TABLET
                otherwise          → desktop
isEdge       = /\sedge\//
isChrome     = !isEdge && !isFirefoxIOS && /chrome|crios/
isBrowserVersionAtLeast({chrome: N, safari: N, otherwise})
```

另有一套 `Error.UnsupportedBrowser.*` 文案与 `window.hasEnteredLimitedExperienceMode`
降级开关。

**[观测]** Electron 默认 UA 形如 `... Chrome/152.0.0.0 Safari/537.36 Electron/44.9.0`，
既非 Safari 也非 Edge，被判定为 Chrome；把 UA 换成标准 Chrome 串后
`hasEnteredLimitedExperienceMode === false`，首页正常渲染。

> 外壳策略：`app.userAgentFallback` 使用**与内置 Chromium 完全一致的版本号**的
> Chrome UA（当前 `Chrome/152.0.0.0`），并去掉 `Electron/x.y.z` 令牌。
> 用假版本号会踩到版本门槛判定，所以版本号是**运行时从 `process.versions.chrome` 读的**。

### 5.5 存储

**[观测]** 站点大量使用 `localStorage`（`iCloud.accountPreferences.*`）、
`IndexedDB`（CloudKit 本地缓存）与 Cookie（`X-APPLE-WEB-OON-ID` 等）。
**[推断]** 会话必须持久化在固定 profile 里，否则每次启动都要重新登录。

> 外壳把 `userData` 固定到 `%APPDATA%\iCloudDesktop`，"清除网站数据" 走
> `session.clearStorageData() + clearCache()`，等价于站点内的退出登录。

---

## 6. 桌面化设计决策

| 问题 | 观测到的约束 | 采取的方案 |
| --- | --- | --- |
| 怎么承载页面 | XFO/CSP 禁止外嵌 | Electron 主窗口直接 `loadURL` 该 origin |
| 浏览器身份 | UA 嗅探 + 版本门槛 | `app.userAgentFallback` = 匹配内核版本的 Chrome UA |
| 登录 | `web_message` iframe + 第三方 Cookie | 不拦截、不注入；权限策略只放行 notifications / fullscreen / clipboard-write 等 |
| 通知 | 页面用 `new Notification()` + SW push | 系统权限放行 → Windows Toast；用带 AppUserModelID 的开始菜单快捷方式让归属显示为 `iCloud` |
| 弹窗 | iWork 文档、账号管理用 `window.open` | 同 session 子窗口；源不在白名单则交给默认浏览器 |
| 外链 | 官网/支持页都在 `apple.com` | 只有 `icloud.com(.cn)`、`idmsa.apple.com`、`appleid.apple.com` 留在应用内，其余 `shell.openExternal` |
| 下载 | 站点用 `<a download>` 与 Mail Drop | `will-download` 接管：默认存「下载」目录、重名编号、任务栏进度、完成通知 |
| 后台存活 | 站点靠长连接收更新 | `backgroundThrottling: false` + 关闭到托盘 |
| 深链接 | 无（站点无自定义协议） | 外壳新增 `icloud://<module>`，映射到 `/photos/` 等路由 |

**[观测]** 白名单实测（`tools/test-url-policy.js`，27 条断言全部通过）：

```
https://www.icloud.com.cn.evil.example/   → 外部
https://evil-icloud.com.cn/               → 外部
http://www.icloud.com.cn/                 → 外部（拒绝降级）
javascript:alert(1)                       → 拒绝
https://idmsa.apple.com/...               → 应用内
```

---

## 7. 验证记录

| 验证项 | 方法 | 结果 |
| --- | --- | --- |
| 应用能渲染站点 | `--remote-debugging-port` + CDP 截图 | ✅ 深色首页、Memoji 动画、登录按钮 |
| UA 被接受 | `Runtime.evaluate` | ✅ `navigator.userAgent` 无 Electron 令牌；`hasEnteredLimitedExperienceMode === false` |
| Apple 登录可嵌入 | 点击「登录」后读 DOM + 截图 | ✅ iframe 渲染出完整中文登录页 |
| 通知权限 | `Notification.permission` | ✅ `granted`；Toast 实际弹出 |
| Toast 归属 | 安装带 AUMID 的快捷方式后重测 | ✅ 从 `Electron` 变为 `iCloud`（`docs/images/05-notification.png`） |
| 关闭到托盘 | `WM_CLOSE` | ✅ 日志 `window hide`，进程存活 |
| 深链接 | 第二实例 `iCloud.exe icloud://notes` | ✅ 首实例收到 `second-instance`，导航到 `/notes/` |
| 下载落盘 | 页面触发 `<a download>` | ✅ `download done {"state":"completed"}`，重名生成 `(1)` |
| 跳转策略 | 纯函数单测 | ✅ 27/27 |
| 设置窗口 | `--preferences` + 窗口截图 | ✅ 全部开关读写正常 |

诊断日志（`%APPDATA%\iCloudDesktop\shell.log`）保留了上述过程的原始记录。

---

## 8. 未解决 / 不打算解决

* **[未知]** Web Push 在 Electron 中的最终行为：门控通过、订阅很可能失败，
  站点是否因此关闭 web courier 长连接，需要登录真实账户后长时间观察才能确认。
  这属于「运行期间通常可用、退出后收不到」的已知边界。
* **[未知]** 通行密钥（`verify/device/key/challenge`）在 Windows Hello 场景下的成功率，
  取决于 Chromium 的平台认证器；失败时站点自动退回 6 位验证码。
* **[未知]** `skVersion=7` 的授权协议细节，以及 `client_id` 与 CloudKit 的绑定关系 ——
  这些属于 Apple 服务端，逆向到边界即可。
* **[不做]** 不复刻站点 UI、不代理任何接口、不缓存凭据。外壳一旦开始「理解」业务数据，
  就会在 Apple 每次改版后失效，也会把用户凭据暴露给第三方代码。

---

## 9. 如何复核

本仓库**不分发** Apple 的 HTML / JS / 接口响应（那是 Apple 的版权内容，
把它们打包进仓库既不必要也不合适）。上文的每条 **[观测]** 都可以用公开请求
在本地重放，结论不依赖任何随仓库携带的副本。

### 命令级复核

| 要复核什么 | 做法 |
| --- | --- |
| 构建号、base 路径、CSP | `curl -s https://www.icloud.com.cn/` 后搜 `data-cw-private-build-number`、`<base href`、`Content-Security-Policy` |
| 路由对服务器无意义 | 对 `/photos/`、`/drive/`、`/mail/` … 各 `curl -s -o NUL -w "%{http_code} %{content_type}"`，都是 `200 text/html` 且长度只差几十字节 |
| 主 bundle 体积 | `curl -sI https://www.icloud.com.cn/system/icloud.com/<build>/en-us/main.js` 看 `content-length` |
| 本地化在客户端 | 用两种 `Accept-Language` 请求首页，`<base>` 不变；再用 DevTools 观察运行时实际请求了 `zh-cn/*.js` 与 `/locales/5/zh-Hans-CN.json` |
| 登录是嵌入授权 | 打开站点 → 点「登录」→ DevTools 里搜 `idmsa.apple.com`，看 `response_mode=web_message` |
| UA 是否被降级 | 站点控制台执行 `window.hasEnteredLimitedExperienceMode` |
| 应用内运行时状态 | `iCloud.exe --remote-debugging-port=9222`，再 `node tools/cdp.js eval "navigator.userAgent"` |

### 仓库自带的验证工具

| 脚本 | 覆盖范围 |
| --- | --- |
| `npm test`（`tools/test-url-policy.js`） | 跳转白名单、快捷协议、路由表 —— 27 条断言 |
| `node tools/cdp.js eval "<expr>"` | 在运行中的应用里执行表达式（UA、特性探测、存储） |
| `node tools/cdp.js shot <file>` | 抓取应用内页面截图 |

抓取时的构建版本：`2638Build27`，页面语言 `zh-Hans-CN`，时间 2026-10-20。
构建号会随 Apple 发版变化，本报告中的路径以此版本为准；除构建号外，
架构层面的结论（CloudOS 外壳 + CloudKit 数据面 + idmsa 嵌入授权）在历次构建中稳定。
