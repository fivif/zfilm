<p align="center">
  <br>
  <img src="docs/logo-light.svg#gh-light-mode-only" alt="Zfilm" height="72">
  <img src="docs/logo-dark.svg#gh-dark-mode-only" alt="Zfilm" height="72">
</p>

<h3 align="center">开源的 AI 视频智能体。</h3>

<p align="center">一个 HTML 文件，一个函数，一个真正的剪辑器。</p>

<p align="center"><a href="README.md">English</a> · <b>简体中文</b></p>

## 简介

Zfilm 让你的编程智能体来做视频，也让你亲手修改。

让 Claude Code、Codex 或任何编程智能体做一部片子。它把片子写成网页，Studio（一个在浏览器里运行的本地剪辑器）
实时显示片子成形的过程。之后哪里想改就改，可以自己动手，也可以直接跟它说。

- **一个 HTML 文件。** `film.html` 把动画网页、视频素材、图片和声音按轨道剪在一起，样式用 CSS 写。不用学新东西：
  你的智能体本来就懂网页。
- **一个函数。** 每个镜头都是一个网页，用 `frame(t)` 画出任意时刻，浏览器能画的都能用：three.js、WebGL、canvas、
  SVG、CSS、GSAP、视频等等。不需要框架：一个函数就够了。
- **一个真正的剪辑器。** 可以移动、缩放、旋转页面里的任何元素，改它的文字、颜色和样式；摆放、裁剪、调整每个片段的
  样式，在时间线上修剪和切分。

## 关于这个仓库

这是 [OpenFilm](https://github.com/openfilm/openfilm) 的**自建分支**，基线为上游 `v0.3.2`（`758b1a3`），
当前版本 **0.3.6**。它不是上游项目，与上游没有隶属关系。上游的 issue、PR 和发行版都归上游管，这个分支
只维护自己的。

这个分支改了这些，简要地说：

- **用户可见处统一叫 Zfilm**：窗口、Studio、聊天、安装包、图标。命令行与 npm 包名仍是 `openfilm`，
  `zfilm` 作为别名可用。
- **没有更新机制。** 不查版本、没有 feed、不后台下载、没有"重启以更新"。新版本就是装一个新的构建覆盖旧的。
- **没有托管服务。** 账户、托管智能体、托管服务商都已移除。媒体服务用自己的 key，在 Studio 的设置 → 服务里连。
- **素材库可以整套下载离线使用**，在设置 → 素材库里管理：分部分进度、暂停、续传、清理。
- **可以把一个文件夹导入**受管素材库：原文件留在原地，副本编入目录，由你选中的智能体逐个描述。
- **本地转写**（whisper-small，WASM，不联网），用于有语音的素材。
- **Windows 修复**：切换项目标签遇到慢加载时不再被踢回项目列表；4K 导出在硬件编码器失败时逐级回退到软件编码，
  不再长时间卡住；桌面应用可以在 Windows 上构建和打包。

[SELF-CHANGELOG.md](SELF-CHANGELOG.md) 是完整的改动台账：每一处改动、为什么改、实测数据、以及还没做的部分。

## 安装

Windows 安装包在 [Releases](https://github.com/fivif/zfilm/releases)：

```
Zfilm-Setup-0.3.6-x64.exe   NSIS，x64，约 316 MB
```

安装包自带 ffmpeg 和无界面 Chromium，不需要另外装东西。它**没有代码签名**，Windows 会弹 SmartScreen 警告，
点"更多信息 → 仍要运行"即可。

这里只构建 x64 Windows。macOS 和 Linux 从源码运行（见下文）；上游的发行版没有配合这个分支的改动验证过。

## 一部片子

一部片子是一个文件夹，里面有一个 `film.html`：按轨道剪在一起的片段。

```html
<meta name="viewport" content="width=1920, height=1080">
<style>
  .card { object-fit: cover; border-radius: 24px; }
</style>
<section>
  <iframe src="title.html#t=0,4"></iframe>
</section>
<section>
  <video src="assets/footage.mp4#t=12,18" at="4" speed="0.5" class="card" style="left: 160px; top: 90px; width: 1600px; height: 700px"></video>
</section>
<section>
  <audio src="assets/music.mp3" volume="0.6"></audio>
</section>
```

每个 `<section>` 是一条轨道，顺序就是时间线显示的顺序：第一个在最上面。一个片段就是一个元素：一个页面、
一段视频、一张静态图或一段声音。播它的哪一部分是媒体片段（`#t=12,18`），从哪里开始是 `at`，放在哪里是
样式里的 `left`、`top`、`width` 和 `height`，长什么样是 CSS。每段声音都是自己的一条片段。`overrides` 保存你对
页面内元素的修改，智能体编辑时会保留它们。

页面就是一个能画出自己任意时刻的网页，这就是全部契约：

```html
<script type="module">
window.film = {
  frame(t) { /* 用任何方式画出 t 秒的完整画面 */ },
  duration: 4,               // 可选：自己的长度，秒
  ready: loadFonts(),        // 可选：字体、图片、模型、数据的 Promise
  width: 480, height: 320,   // 可选：只占画面一部分的页面
};
</script>
```

**唯一的规则**：同一个 `t` 永远画出同一张图，不管之前画过什么。帧是乱序、并行、在帧与帧之间（为运动模糊）
被请求的，所以守规则的页面在任何尺寸、任何机器上渲染结果都一样。其他做画面的东西（Python、Blender、
视频模型）以视频或图片的形式进来。

[packages/openfilm/SPEC.md](packages/openfilm/SPEC.md) 是格式规范，写给做播放器、渲染器或编辑器的人。
[packages/openfilm/MANUAL.md](packages/openfilm/MANUAL.md) 是 `openfilm` 命令打印给智能体的手册，
[packages/openfilm/manual](packages/openfilm/manual) 放着教怎么拍片子的技能。

## Studio

Studio 在你自己的机器上跑，在浏览器里：用 Chromium 内核的浏览器（Chrome、Edge），也就是片子的绘制与导出引擎，
所以预览就是导出的样子。片子里的一切都能改：画面里的文字和图层、时间线上的片段、它们的位置、外观、音量和速度，
以及字幕。你的修改会写回片子的文件，智能体看得到也会保留；还可以存命名版本随时回去。

可以导出视频、GIF、声音或其分轨、字幕、静帧、幻灯片、透明视频，或者把时间线本身导给 Final Cut Pro、
Premiere Pro 和 DaVinci Resolve。

编辑旁边是画布：一块板子，你和智能体在上面摆笔记、图片、片段、配音、音乐和音效，把它们连起来，按顺序把做好的
东西送上时间线。

## 命令行

命令是 `packages/openfilm/bin/openfilm.mjs`（npm 名：`openfilm`）。在这个仓库里 `pnpm dev` 会在
`packages/openfilm/.dev/bin/openfilm`（Windows 上是 `openfilm.cmd`）留下一个指向那个 Studio 的构建。

```sh
openfilm                          # 一部片子是什么，以及技能：智能体的起点
openfilm open   [folder | url]    # 在 Studio 里打开一部片子
openfilm look   [what] [t | a-b]  # 检查片子：联系表、单帧，或一段范围
openfilm render [a-b]             # MP4；--4k、--blur、--alpha、--loudness=-14
openfilm get    [what]            # 素材：先找本地库，再找已连接的服务
openfilm canvas [apply <steps>]   # 编辑旁边的画布
openfilm skills                   # 可以用哪些技能做片子
openfilm doctor                   # 这台机器为 Zfilm 准备了什么
```

`npx -y openfilm@latest` 装的是**上游**的包，不是这个分支。想让它到处可用，在 `packages/openfilm` 里
`npm link`。

## 从源码

需要 Node 22.18 或更高、pnpm 9（`corepack enable` 会给你这个仓库指定的版本）、PATH 上有 ffmpeg，以及 git。

```sh
git clone https://github.com/fivif/zfilm && cd zfilm
pnpm install                 # 同时构建 Studio 的编辑器
pnpm --filter openfilm exec playwright-core install chromium-headless-shell
pnpm dev                     # 从这份代码跑 Studio，带一部示例片
pnpm test
pnpm typecheck
```

`pnpm dev:desktop` 以"Zfilm Dev"从源码运行桌面应用，有自己的数据目录和端口，不会和已安装的正式版撞车。
`pnpm build` 构建 Studio 的编辑器和桌面应用的窗口页；`pnpm audit:public` 检查有没有私密内容或外部依赖混进来。

打 Windows 安装包：

```powershell
cd apps/desktop
node scripts/release.mjs --platform=win --arch=x64
# → .release/win-x64/out/Zfilm-Setup-x64.exe
```

[CONTRIBUTING.md](CONTRIBUTING.md) 有每个包的细节。

## 已知限制

- **渲染吞吐。** 每帧约 79% 的时间花在把像素从 Chromium 里取出来（1080p 47.6 ms，4K 174 ms）。出路是让
  canvas/WebGL 页面直接把 `VideoFrame` 交给编码器，但那要改 `frame(t)` 的契约。
- **每个标签 = 一整个 Studio。** 切标签等于重新启动一次编辑器（2.54 MB 的 JS）。真正的解法是在一个实例里切项目。
- **音频素材导入**描述的是文件名和技术元数据；除非装了本地模型，否则不做语音转写。

## 许可证

格式、命令行、Studio 和桌面应用是 [MIT](LICENSE)。

这个分支是 [OpenFilm](https://github.com/openfilm/openfilm) 的 fork。Zfilm 和 OpenFilm 的名称与标志是上游项目的
商标（见 [TRADEMARK.md](TRADEMARK.md)）；这里不授予把商标用于其他产品的权利。
