# 自家构建：版本与改动台账

本仓库是 OpenFilm 的**自维护分支**，不是上游的镜像。分支基线：上游 `v0.3.2`（commit `758b1a3`）。
上游远端保留为 `upstream`（`https://github.com/openfilm/openfilm.git`），用于 `git fetch upstream` / diff / cherry-pick。

---

## V0.3.3（第一批）

基线 v0.3.2，四组改动。所有改动都在工作区可单独 `git checkout` 还原。

### 1. 切换项目标签：不再"点了没反应"

**问题**（上游 0.3.2 仍有）：切到一个重的项目标签时，`preparePage` 的 15 秒 `loadTimeoutMs` 到点后 `reject` +
`contents.stop()`；`ensure()` 收到 reject 就把整个 `WebContentsView` 丢掉；`failed()` 再 `show(fallback)`，
于是人被**踢回项目首页**——标签还在，点了没反应。日志里就是一行一条：

```
page: could not prepare replacement (Page loading timed out)
```

（更早的 0.3.1 是同一链条的另一种表现：`Editor did not become ready`，因为 Windows 上被遮挡的视图不产
`requestAnimationFrame`，那条等待永远不会满足。）

**改法**：慢加载不再算失败。页面照样呈现，帧到了就出来；只有 renderer 真死了才失败。不再 `stop()` 加载。

- `apps/desktop/src/page-presentation.mjs`：`preparePage` 超时改为"标记 late 并继续进入呈现"，返回 `{ late }`；
  `waitForPaint` 时若已 late，则绘制失败不再上抛（macOS 的 native view 仍然先画再显示，只是不把慢当错）。
- 测试：新增 `a slow load is shown rather than throwing the person back to the projects`、
  `preparePage reports a late load instead of failing it`；把原来把该 bug 当契约的
  `a hung page load fails without presenting unloaded contents` 改为
  `a hung page load is presented, not stopped, and not treated as a failed destination`。

### 2. 4K / 大画幅：硬件编码器逐级回退 + 软件编码降档

**问题**：`render.mjs` 在芯片编码器**跑到一半失败**时，直接 `broken()` 并整段改用 `libx264`。实测
1080p 软编 64.9 fps、**4K 软编只有 16.5 fps**——4K 渲染撞上这面墙就是"长时间不推进"。

**改法**：

- 失败后先试**同机器上的下一个**硬件编码器（Windows 顺序 `nvenc → qsv → amf → mf`），全部失败才落软件，
  并明确打印是哪一级、为什么慢。
- 4K 及以上的默认 MP4（非宿主自带格式）软件编码改用 `libx264 -preset veryfast -crf 17`：本机实测
  `medium/crf16` 16.5 fps → `veryfast` 约 2 倍，这个尺寸下画质差别看不出来。

### 3. seek 副本缓存：7 天上限 + 2 GiB 上限

**问题**：`.film/cache/seek` 只增不减（社区实测 90 秒片 1.8 GB、30 分钟片约 4.3 GB）。

**改法**：每次渲染前清扫一次——超过 7 天没被任何渲染用到的副本删掉，之后按最旧优先删到 2 GiB 以下。
清扫在本次渲染生成自己的副本**之前**运行，所以需要的那份会被重做而不是被误删；任何磁盘错误都不让渲染失败。

### 4. 去除更新机制（全部）

| 位置 | 处理 |
|---|---|
| `apps/desktop/src/updates.mjs` | 重写为永久 `off` 的桩，保留 `startUpdates` 形状，不再 import `electron-updater` |
| `update-controller/-channel/-launch/-menu/-schedule.mjs`、`installing.html`、`i18n/install-window.mjs`、`i18n/update-dialogs.mjs` 及测试 | **删除**（已 track，可 `git checkout` 还原） |
| `main.mjs` | 去掉 `stepAside` 导入与分支、去掉启动时安装更新 |
| `menu.mjs` | 未改：`updates` 为 null 时本来就没有"检查更新/测试版"菜单项，而我们的 `packaged` 恒为 false |
| `scripts/release.mjs` | `FEED` 恒为 `null` → 不写 `app-update.yml`、不生成 `.yml` feed |
| `packages/openfilm/product.official.json` | `desktop.updates` 清空 |
| `apps/desktop/package.json` | 移除 `electron-updater` 依赖 |
| `bin/openfilm.mjs` | 不再每次启动问 npm 最新版；`openfilm update` 直接回 "this build does not update itself" |
| `studio/client.mjs` | `npmOpenfilm` 直接返回空（不发请求、不写 `update.json`） |
| `studio/server/server.mjs` | `/api/version` 不再问 npm；`/api/update` 一律 409 `no-updates` |

**结果**：没有任何出站版本查询、没有 feed、没有后台下载、没有"重启以更新"、没有启动时安装。
新版本只能靠**装一个新的构建覆盖**。

### 版本号

`packages/openfilm`、`packages/shared`、`apps/desktop` 统一 `0.3.3`（上游用 changesets 固定三包同版本）。

---

## V0.3.3 追加（同一版本，第二批次）

### 5. 标签页不再被随意丢弃：切回去是瞬时的

**问题**：上游 `IDLE_PAGE_MS = 5 分钟`——标签在后台待 5 分钟就丢掉它的 `WebContentsView`，再切回来要**重新加载一整个
Studio**（单 chunk 2.54 MB JS）＋ 项目。这就是"切标签卡"的另一半：就算不失败，也慢。

**改法**（`main.mjs` + `tabs.mjs`）：

- `IDLE_PAGE_MS` 5 分钟 → **2 小时**：常见的一下午来回切都在热态。
- 新增 `tabs.warmBeyond(max)`：**最多保留 3 个后台页面**，多出来的按"最久没被看"先丢（有 agent 在跑、有导出在跑的不丢）。
  4 个常驻页面 ≈ 1–2 GB，是个有界值，不再无限涨。
- 测试：`tabs.test.mjs` 新增一条覆盖上限与"忙碌标签不丢"。

### 6. 渲染吞吐：走到硬墙了，结论写在下面（代码已回退）

目标原本是 C2：「让页面直接交出 `VideoFrame`，用 Chromium 的 `VideoEncoder` 编码，跳过截图」。

**做出来的部分**：`host.mjs` 的 `startEncoding/encode/stopEncoding` + `render.mjs` 的 `encodeOwn`（`-f h264 -i - -c:v copy`
只做封装，不重编码）、SPEC §2 的 `capture` 字段设计。**结果：对 OpenFilm 的片子完全无效，已回退**。

**为什么无效（这是本次最有价值的发现）**：

`render` 打开的顶层页面是 `film.html`（由宿主注入的 `timeline.mjs` 提供 `window.film`），每个镜头是**跨文档的
`<iframe>`**，合成（叠加/淡入淡出/变换/字幕）都发生在 film 层。而 `film.html` 不允许有 `<script>`、也没有自己的
`capture`，所以快路径永远不会被触发——它只对"整片就是一个 canvas 页面"成立。

**但是**：我实测了一个关键事实——**HTML-in-Canvas 能抓 iframe**：

```
canvas layoutsubtree > iframe(same-origin)  →  ctx.drawElementImage(iframe, 0,0,200,100)
结果：ok，画布上 19868/20000 像素是 iframe 的内容（drawImage(iframe) 则报错，是另一条路）
```

这推翻了我之前的判断（原以为跨文档抓不到）。所以快路径对 film 型片子**不是不可能**，而是要把 film 的舞台搬进一个
`<canvas layoutsubtree>`（运行时把这些 `<section>` 移进去），再由 timeline 提供 `capture(t)`。**风险**：布局与定位是否
等价（绝对定位的参考系会变）、`<video>` 镜头、`opacity`/`mix-blend-mode`、字幕轨、overrides 逐帧施加，全都得重新验证；
预计 2–4 天，且失败就白干。**没有动 **——先要你拍板是否接受这个风险。

## 决策记录：渲染吞吐，暂时维持截图路径（2026-11-10）

**决定**：不做 CEF + 零拷贝（`OnAcceleratedPaint` → 硬编）的架构迁移，维持现有的
「CDP `Page.captureScreenshot` → ffmpeg」。**理由不是"懒"，是这台机器上不成立：**

1. 本机只有 **Intel Arc 核显**，没有 NVIDIA。唯一把这条路走通的开源实现
   [strobe](https://github.com/hridaya423/strobe) 的 Windows 路径是 **NVENC 优先**；Intel 只能退到
   D3D12 Video Encode，**且只支持 H.264**，作者明写未测 AMD、"Linux 没做"。
2. 零拷贝**复用不了 ffmpeg**：共享纹理要自己接 NVENC/QSV/D3D12 VE SDK。这是这条路真正的成本项
   （strobe 自己写了 `vrf-encode` crate）。
3. 就算打通，strobe 自己的结论是：**硬编 1080p 能到 480 fps，但"没有一条片能到它 15% 以内，
   因为现在慢的是 Chromium 的页面渲染"**。对 iframe + CSS + 4K 实拍解码的片子，收益要再打折。

**保留的调研结论（将来重开这个话题时直接看这段）**：

| 方案 | 对标实测 | 判断 |
|---|---|---|
| WebCodecs（页面内编码） | 1080p 138 fps，但要求页面交出 canvas | ❌ 对 iframe 型片子无效（已实现后回退） |
| CEF 加速绘制 + 硬编（strobe） | vs Remotion/HyperFrames **2.8–11.6×** | ✅ 唯一可行，但需重写 host 层 + 自家编码器 |
| framefold / 原生合成器 | — | ❌ 丢掉 CSS，等于废掉"网页即片子" |
| webgl2video / bbc html5-video-compositor | — | ❌ 只吃 WebGL / 2016 年废弃 |

**重开这个话题的判据**（满足任一条再来找我）：

- 换到有 **NVIDIA（NVENC）** 的机器，或 Intel 上确认 **D3D12 Video Encode** 可用；
- 或上游 OpenFilm 自己做了这条（关注 CEF/零拷贝相关 PR）；
- 或片子的瓶颈从"取像素"变成"页面渲染"（那时该优化的是页面本身）。

**在现有栈上还能做的（都低于 20%，不值得现在动）**：去掉每帧双 rAF 改 `beginFrame`（省 5–15 ms）、
渲染结束输出"每帧耗时分解"（截图/编码/seek）便于将来定位。

## 改名 Zfilm + 拆除托管服务（2026-11-11）

### 7. 产品改名：OpenFilm → Zfilm（用户可见层）

| 层 | 改了什么 |
|---|---|
| 安装身份 | `release.mjs`：`NAME`→`Zfilm`（预览版 `Zfilm Preview`）、`appId`→`dev.zfilm.desktop`、exe 元数据（ProductName/FileDescription/CompanyName/OriginalFilename/InternalName/LegalCopyright）、author、mac 版权与麦克风说明、产物名 `Zfilm-Setup-x64.exe` |
| 桌面包 | `productName`→`Zfilm`、description 改写 |
| 文案 | 5 个语言表 **327 处**（en 66 / zh-CN 65 / ja 65 / ko 65 / es 66）→ 0 残留；chat 端 6 个 locale 各 7 处 |
| 文档 | MANUAL.md、manual/{edit,media,canvas}/SKILL.md、skills/openfilm/SKILL.md、README、CONTRIBUTING、SPEC.md、TRADEMARK.md、library/LICENSE.md、bin 帮助 |
| 代码内用户可见串 | `client.mjs` 启动/更新提示、doctor、library-search 帮助、Studio 全部 UI 源码（42 文件 117 处，含 BrandLogo 的 `aria-label`）、server 各模块 75 处 |
| 品牌残留清理 | 顺手修掉 8 处过时指引「左上角 OpenFilm logo 开设置」→「齿轮」（logo 已被设置按钮取代） |

**刻意未改（这条分支内部标识符，改了要迁移数据）**：npm 包名 `openfilm`、CLI 命令 `openfilm`（**新增 `zfilm` 别名**，两条都能用）、`~/.openfilm` 数据目录、`OPENFILM_*` 环境变量、`.film/` 目录、git refs `refs/openfilm/*`、技能 id `openfilm/edit` 等。

### 8. 拆除托管服务（真正去掉的那部分）

**删掉的 6 个文件**：`studio/server/account.mjs`（+test）、`studio/server/providers/openfilm.mjs`（+test）、
`apps/desktop/src/openfilm-agent.mjs`（+test）。

| 拆掉的集成 | 说明 |
|---|---|
| 托管模型网关 | Services 里不再有 `openfilm` provider；模型只能用你自己的 key 或本地模型 |
| 托管账号 | 登录态、`desktop-account` 导出、`account:read` IPC、`readAccount` 全部移除 |
| 托管内置 agent | id `openfilm` 的 agent 删除（它把 key 和模型目录都指向云端）。**本地「自有 key」agent（id `byok`，pi-agent.mjs）保留**，功能不丢 |
| 云端库语义搜索 | `src/library-semantic.mjs` 的 `nearest()` 恒返回 null，**不再向 openfilm.dev 发任何请求**（此前默认联网、且开关随 provider 消失后用户已无法关闭——这是最该拆的一处）；库检索现在只用关键词 |

**验收**：`pnpm typecheck` 三个包全过；`providers/index`+`keys` 21/21、`agent-roster`+`agent-definitions` 35/35、
`pi-agent` 9/9、`agents`+`agent-skills`+`agent-marks` 62/62、`library-semantic` 3/3、`fcpxml`+`exports`+`saved`+`prefs`+`projects` 等全绿。

**已知残留（不影响使用，下一轮清）**：`studio/ui` 里托管 agent 的界面死代码（ZfilmAgentDialog、AgentsSection 的
`agent.id==='openfilm'` 分支、ModelsSection 的库搜索开关）、`apps/desktop/src/openfilm-models.mjs` 无生产引用、
`apps/desktop/bench/` 两个文件仍按 id `openfilm` 伪造、`studio/canvas-warm.test.mjs` 里伪造的 `/api/providers/openfilm/sign-in` 前提已消失。

### 9. 改名与拆服务收尾（打包装配时踩到的两个坑）

1. **窗口页也带品牌**：`apps/desktop/shell/index.html` 的 `<title>` 与 favicon 的 `aria-label`、`shell/bridge.ts` 的
   `name: 'OpenFilm'`（窗口页对象）——第一轮改名漏了这个目录，结果**装好后窗口标题仍是 OpenFilm**，而 Studio UI 怎么改都
   没效果（我一开始误判成"UI 打包缓存"，绕了 40 分钟）。
2. **`release.mjs` 的 UI 构建用了 `--emptyOutDir=false`**：原注释是"让已在跑的 Studio 还能加载它开着的页面"，代价是
   **旧 bundle 一直留在 dist 里**，打包时新旧两份一起进 asar。这一支不需要那份兼容，改成每次清空重建。

### 版本：0.3.3 → **0.3.4**

改名 + 拆服务是一次会改变外观与可用服务的发布，故升版。安装包：
`apps/desktop/.release/win-x64/out/Zfilm-Setup-x64.exe`（309 MB，未签名，`feed: none`）。

### 装好后的实测（已安装的 0.3.4）

| 检查 | 结果 |
|---|---|
| 窗口页标题 | **Zfilm** |
| `/api/version` | `0.3.4`，`latest: null`，`newer: false`（不再问 npm） |
| 服务清单 | 17 个，**无 `openfilm`**；`librarySearch: null`（云端语义搜索已断） |
| 内置 agent | 托管那个已删；本地「自有 key」agent 保留 |
| 用户数据 | 5 个项目完好；`~/.openfilm`（密钥/库）未动 |

### 10. 反转：保留联网找素材（语义检索恢复）

在装好后实测发现：唯一被拆掉的联网能力里，**"按意思搜素材"恰恰是最该留的那条**——它只发一句搜索词给
openfilm.dev（免费、无账号），不发项目内容，而且效果明显（`sad farewell at a train station` → "Clarinet farewell
at dusk"，标签 Sad/Ending/Night/Moving，一个词都不重合也能命中）。

**因此恢复**，并改成独立于服务卡片的开关：

| 改动 | 内容 |
|---|---|
| `src/library-semantic.mjs` | 恢复请求实现；`SEARCH_TIMEOUT_MS` 2500 → **7000**（本机 DNS 冷解析要 5–6 s，2.5 s 会次次超时静默降级） |
| `settings/models` 里一行 | 新增"素材检索：**按意思 / 只按词**"（`SettingsSegmented`），不再依赖已删的 openfilm 服务卡片；选"只按词"= 完全不出网 |
| i18n | 5 语言各 2 句（byMeaning / wordsOnly） |
| 测试 | 恢复原用例 + 修回 `keys.test` 的开关语义（默认 'openfilm' / 关闭后 null / 再开回来） |

**实测（装好的 0.3.4，走 App 自己的 API）**：

```
『sad farewell at a train station』 → 200  6.86s（DNS 冷）→ Clarinet farewell at dusk
『calm piano for a quiet morning』  → 200  1.60s（DNS 热）→ Quiet morning piano
```

**仍然保持拆除的**：托管模型网关、托管账号、托管内置 agent（这三条才是"服务集成"的实质，跟找素材无关）。

### 11. 素材库：可离线，且在应用内可管理（方案 B）

上游把大件素材放在 `openfilm.dev/library`，按需取；这一支把它做成**可选的全量离线**，并且**在设置里管理**。

**新增**（后端 + 界面）：

| 位置 | 内容 |
|---|---|
| `studio/server/library-sync.mjs` | 从包里的目录算出"总清单"（音乐 1222 / 音效 5436 / 封面 125 / emoji 贴纸 1587），8 路并发下载、**可暂停**、**断点续**（已在的不再请求）、每批落盘进度、单个失败不拖垮全局；**清理**只删 `~/.openfilm/library` 里下载来的那份，内置文件不碰 |
| `GET /api/library/status` | 各部分 `{files, done, bytes}` + 总计 + 是否在跑 + 最近失败 |
| `POST /api/library/sync` | `{action:'start'|'pause'|'clear', parts?}`；`clear` 必须 `confirm:true` |
| 设置 → **素材库**（新段落） | 总进度条 + 已下载体积、四类各自进度、**下载全部 / 暂停 / 清理（二次确认）**；下载时每 1.5s 自动刷新，关掉窗口服务端照下 |
| 文案 | 5 语言 × 20 条 |

**聪明的点**（相对"直接下全套"）：

- **不需要上游清单**：路径从包里已有目录推导，所以离线也能显示"共 N 个文件"；体积边下边学（上游不提供 manifest）。
- **重复点没用**：已在的文件直接跳过，随时可停可续。
- **下载在服务端**：关窗口不影响；重启 App 后状态还在（`~/.openfilm/library/.sync.json`）。
- **只在用到时才联网**：不点"下载全部"，行为和原来一致（按需取单文件）。

**测试**：`library-sync.test.mjs` 5/5（用本地假 host，不联网）：清单推导、逐文件计数与体积、重复不重下、暂停后续、清理只删该删的。

**已知限制**：上游不给 sha256，完整性只能靠长度与 HTTP 状态；单文件进度（MB 级百分比）没做，按文件数显示。

### 12. 全量下载实测：三个真问题（都修了）

在装好的 0.3.4 上真跑"下载全部"，暴露三件事：

| 现象 | 原因 | 改法 |
|---|---|---|
| 8 路并发全部失败 | 这台机器的 DNS 是 **fake-IP**（`198.18.x`，代理软件接管），代理没开时连接直接超时 | 并发降到 6；**每个文件重试 2 次**（0.4s/0.8s 退避）；先**单个热身**再并行，让连接池复用 |
| 失败只显示「it did not arrive」 | 错误被 `fetchLibrary` 吞了 | `library.mjs` 记下真实原因（`lastLibraryError`），设置里显示"为什么没下来" |
| 每个文件 ~10s，全库要 29 小时 | 每个文件都先**走一次 302**到 `assets.openfilm.dev`，等于每文件多一次连接+DNS | 记住跳转后的主机，之后**直连 CDN**（实测 ~1.2s/文件，快 8 倍） |

**顺带**：`--emptyOutDir` 那类打包坑之外，这一轮还确认了 Node 的 `fetch` **默认不读** `HTTPS_PROXY`（要 `NODE_USE_ENV_PROXY=1`）——所以在这台机器上，代理软件开着时应用内的下载才快；这是环境，不是功能。

### 13. 素材下载可以用自己的代理（只作用于下载）

设置 → 素材库 → **下载代理**：填 `http://host:port`、`https://…`、`socks4`、`socks5`、`socks5h`，可带 `user:pass@`；
留空 = 直连。**只作用于素材库的下载**，语义检索与模型服务不走它。

| 层 | 内容 |
|---|---|
| `studio/server/library-proxy.mjs` | 校验（协议/主机/端口）、保存到 `~/.openfilm/library-proxy.json`（0600，原子写）、按名缓存 agent；`socks5://` 按 `socks5h` 处理（DNS 在代理侧解析） |
| `library.mjs` | 新增 `open()`：有代理走 `https-proxy-agent`/`socks-proxy-agent`，无代理仍用 `fetch`；下载与 bundle 的 `files.json` 都走它 |
| API | `status` 里带 `proxy`；`POST /api/library/sync {action:'proxy', proxy}` 保存/清除，非法值 400 |
| 界面 | 一行输入 + 保存 + 「不用代理」，脚注说明"只用于下载" |
| 依赖 | 新增 `https-proxy-agent`、`socks-proxy-agent`（纯 JS） |
| 测试 | `library-proxy.test.mjs` 3/3（校验、持久化 0600、非法不覆盖旧值） |

**实测**：非法值 → 400 `a proxy looks like http://host:port or socks5://host:port`；保存 `socks5://127.0.0.1:10808`
后不设任何环境变量，应用内下载即走它（7 个音效 0 失败）。代理路径的请求超时收到 20 s、单文件重试 3 次（0.5/1.5/4 s 退避）。

### 14. 本地转写模型：装上、跑通，并修掉两个只在打包版才犯的错

要装的是 `whisper-small`（254.9 MB，11 个文件，MIT，OpenAI）：`POST /api/local-models/whisper-small/install`。

**修掉的三个真问题**（都只在 Electron 打包版复现，源码跑不出来）：

| 症状 | 根因 | 改法 |
|---|---|---|
| 点"安装"后零进度、零报错，5 分钟没动静 | `local-models.mjs` 用 `spawn(process.execPath, …)` 拉起下载进程；打包版里 `process.execPath` 是 `Zfilm.exe`，没带 `ELECTRON_RUN_AS_NODE=1` → 子进程变成"再开一个 App"直接退出 | 运行时是 Electron 就补 `ELECTRON_RUN_AS_NODE: '1'` |
| 装好也转写不了：`no available backend found … fetch failed` | onnxruntime-web 用 `fetch` 读 `wasmPaths` 下的 loader 与 wasm；Node 的 fetch 读不了本地路径（裸路径） | `wasmPaths` 改成 `file://` URL，并临时给 `globalThis.fetch` 加一层"能读 file://"的兜底 |
| 想多线程提速：`ERR_UNSUPPORTED_ESM_URL_SCHEME … blob:` | 多线程时 runtime 把 worker 的 loader 交给 ESM loader 当 `blob:` URL，Node 不支持 | `numThreads = 1`，注释写清原因 |
| 同样的 spawn 病还有一处：`providers/local.mjs` 的 `runLocal()` | 同上 | 同样补 env |

**实测**（8 秒真人旁白，单线程 WASM）：输出 `text` + 逐词时间 + `language`，**35 秒**（约 4 倍实时，含模型加载）。
60 秒片子约 4–5 分钟；单线程是这个 runtime 在 Node 里的上限。

---

## V0.3.5：文件夹导入 + 图标（2026-11-12）

### 15. 素材库：从文件夹导入，交给当前 agent 分析

设置 → 素材库新增「从文件夹导入」：原生目录选择器选一个文件夹，逐个文件**复制进受管素材库**（原文件不动），
再用**当前对话的 agent、模型和选项**（同一套 ACP 基础设施，不另起一套）生成标题、描述、标签和用途建议；
任务与日志持久化到 `%APPDATA%\Zfilm\library-imports`，可看进度、可**只重试失败项**、重启后接着跑。

| 位置 | 内容 |
|---|---|
| `apps/desktop/src/library-import-service.mjs` | 任务队列、逐文件准备/复制/分析、断点续跑、失败重试；来源目录当作不可信输入：跳过符号链接，不读密钥 |
| `apps/desktop/src/library-import-formats.mjs` | 可导入格式判定 |
| `apps/desktop/src/library-agent-analysis.mjs` | 通过 ACP 调当前 agent 产出结构化分析（标题/描述/标签/用途） |
| `shell/bridge.ts` · `src/preload.cjs` · `src/main.mjs` | 原生选择器 + IPC 通道，选择器授权一次性绑定到发起方 |
| `studio/ui/.../settings/LibrarySection.tsx` | 设置里的完整界面：导入、任务列表、实时日志、重试 |
| 测试 | 任务持久化、重试、DNS 与 `.partial` 回归（假 agent 跑，不花钱） |

**真机验证**：装好的 0.3.5 上，用真实 Codex（`gpt-6-astra`，`reasoning_effort=high`）跑通一张 PNG：
约 18 秒产出标题「黑底银白色 Z 字母标志」、描述、9 个标签、4 条用途建议；受管副本与原文件 SHA256 一致。

### 16. 下载器两个真 bug

| 症状 | 根因 | 改法 |
|---|---|---|
| SOCKS 代理下素材下载全部失败 | `new SocksProxyAgent(name)` 不把 `socks5://` 规范成 `socks5h://`，DNS 在本地解析 | 统一按 `socks5h` 处理，域名交给代理解析 |
| 半截 bundle 被当成完整包，之后再也不重下 | `here(path) \|\| bundleHere(path)` 接受了名字带 `.partial` 的目录 | 拒收 `.partial`，只认完成标记 |

测试用真实的本地 TCP 代理 + 故意不可解析的域名，以及真实 HTTP 子文件下载，两个都在修复前失败。

### 17. 图标：圆角

用户提供的金属 Z 保留不动，方形底色加抗锯齿透明圆角（半径 230/1024）。PNG、多分辨率 ICO、ICNS、
Studio/chat 品牌图、可执行文件与安装包统一用这个结果；原图留在桌面。

### 版本：0.3.4 → **0.3.5**

安装包 `Zfilm-Setup-0.3.5-x64.exe`（313 MB，未签名）。桌面全量测试 443 项 / 438 通过 / 4 跳过 / 1 个既有的
并发音频导航超时（单独重跑通过）。

---

## V0.3.6：文件夹导入修正（2026-11-12）

用真实的 552 文件文件夹压测，暴露了 0.3.5 的两处遗漏——当时只测了一张 PNG，没覆盖静态 JPEG 和文档类文件。

### 18. JPEG 静态图解码失败

`-ss 0` 对 image2 输入的 JPEG 会 seek 过唯一一帧：FFmpeg 退出码 0、stdout 为空，最后报
`Unable to prepare a reference frame.`。改为静态图直接解码（不再做零时刻 seek），视频仍保留正时刻采样。

### 19. 文档与源码文件也能导入（只读，不执行）

0.3.5 只认图片/音频/视频，552 个文件里 352 个被跳过（Markdown 346、HTML 4、JS 1、JSON 1）。
新版本把文档/源码**当数据读**：从不执行代码、不渲染不可信标记（SVG 也只当文本分析，不声称视觉渲染）；
文本预览上限 64 KiB 并显式标注截断，支持 UTF-8/UTF-16，二进制拒收。原文件与受管副本都完整保留。

### 20. 显式重试可升级旧任务

一条「重试」，把 0.3.5 里被标成「不支持」而跳过的条目按新规则重新处理，**保留**已成功的分析与受管副本、
以及冻结的 agent 选项（`codex / gpt-6-astra / reasoning_effort=high / fast-mode=on`）。只读历史不会触发重启。

### 21. ACP 完成记录被截断

真实跑批时发现，完整分析对象之后跟着已知的 `z_end_turn_review` 尾注会让解析失败。`readMediaAnalysis`
现在接受「四个完整字段 + 已知尾注」，仍然拒收不完整或畸形的 JSON。

### 22. 设置页导航标签缺失

素材库设置的中英文导航标签补上。

### 版本：0.3.5 → **0.3.6**

**真机验证**：预检 552 个源文件全部本地通过（零失败、零不支持、零模型请求）：JPG 193、PNG 3、MP4 3、
SVG 1、Markdown 346、HTML 4、JSON 1、JS 1。装好的 0.3.6 上通过原生 IPC 续跑原任务，恢复时刻
**10 成功 / 0 失败 / 0 跳过 / 1 运行中 / 541 排队**；抽样的 JPG、Markdown、JSON、JS 五份，原文件/副本
SHA256 一致，元数据 sidecar 与结果一致。剩余的仍在跑，不声称 552 个已全部完成。

安装包 `Zfilm-Setup-0.3.6-x64.exe`（316 MB，未签名）。打包 FFmpeg 下 16/16 导入校验、17/17 ACP/下载/UI
回归通过，工作区 typecheck 通过。

---

## 怎么用

```powershell
# 从源码跑（"OpenFilm Dev"：独立数据目录、独立端口，不碰已安装的正式版）
pnpm dev:desktop

# 只跑 Studio（浏览器里打开）
pnpm dev

# Windows 安装包（必须显式给目标平台，否则脚本默认打 Mac 包）
cd apps/desktop
node scripts/release.mjs --platform=win --arch=x64
# → .release/win-x64/out/OpenFilm-Setup-x64.exe（约 296 MB，未签名，安装时会有 SmartScreen 提示）
```

**Windows 上打包要注意三件事**（上游只在 macOS 上打桌面包，所以这三处在本树修掉了）：

1. `npm`/`pnpm` 在 Windows 是 `.cmd`，`execFileSync` 起不来 → `release.mjs` 的 `tool()` 加了 `shell: true`。
2. 本机 `~/.npmrc` 里若带 `allow-scripts`（npm 11.17 会拒绝），stage 安装会失败 → 我们的 stage 安装加了
   `--ignore-scripts`；必要时也可临时用 `npm_config_userconfig` 指向一个干净的 npmrc。
3. 必须先下载 Electron 二进制：`node node_modules/.pnpm/electron@*/node_modules/electron/install.js`
   （Node 的 fetch 不认代理环境变量，需要 `NODE_USE_ENV_PROXY=1`）。

测试（渲染相关要 ffmpeg 在 PATH 上；没装系统 ffmpeg 时可以借安装版的）：

```powershell
$env:PATH = "D:\AI\openfilm\resources\runtime\ffmpeg;$env:PATH"
pnpm test
pnpm typecheck
```

## 和上游同步

```sh
git fetch upstream
git log --oneline HEAD..upstream/main        # 上游多了什么
git diff HEAD..upstream/main -- <某个文件>    # 上游改了什么
```

我们自己动过的文件（合并时预期冲突的地方）：

```
apps/desktop/src/page-presentation.mjs
apps/desktop/src/updates.mjs
apps/desktop/src/main.mjs
apps/desktop/src/menu.test.mjs
apps/desktop/scripts/release.mjs
apps/desktop/package.json
packages/openfilm/src/render.mjs
packages/openfilm/src/seekable.mjs
packages/openfilm/bin/openfilm.mjs
packages/openfilm/studio/client.mjs
packages/openfilm/studio/server/server.mjs
packages/openfilm/product.official.json
packages/openfilm/package.json · packages/shared/package.json （版本号）
```

## 已知未做（按优先级）

1. **渲染吞吐**：每帧 79% 花在"把像素从 Chromium 取出"（1080p 47.6 ms / 4K 174 ms）。出路是让 canvas/WebGL
   页面直接交 `VideoFrame` 给 `VideoCodec`（实测 1080p 138 fps vs 现状 16.6 fps），但要改 `frame(t)` 协议。
2. **每个 tab = 一整个 Studio**：切换 = 启动一次 2.54 MB JS 的编辑器。正解是单应用内切项目（周级改动）。
3. 片段关键帧 / 转场原语 / 声音处理链：上游明确"按设计不做"，属于要不要偏离上游的产品决定。
