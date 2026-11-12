<p align="center">
  <br>
  <img src="docs/logo-light.svg#gh-light-mode-only" alt="Zfilm" height="72">
  <img src="docs/logo-dark.svg#gh-dark-mode-only" alt="Zfilm" height="72">
</p>

<h3 align="center">The open source AI video agent.</h3>

<p align="center">One HTML file, one function, one real editor.</p>

<p align="center"><b>English</b> · <a href="README.zh-CN.md">简体中文</a></p>

## About

Zfilm lets your coding agent make videos, and lets you edit them.

Ask Claude Code, Codex or any coding agent to make a film. It writes the film as web pages, and Studio, a local
editor that runs in your browser, shows it taking shape. Then change anything you like, by hand or by asking.

- **One HTML file.** `film.html` cuts animated web pages, footage, pictures and sound together on tracks, styled
  with CSS. Nothing new to learn: your agent already knows the web.
- **One function.** Each shot is a web page that draws any moment with `frame(t)`, using anything a browser can
  draw: three.js, WebGL, canvas, SVG, CSS, GSAP, video and more. No framework: one function is enough.
- **One real editor.** Move, scale and rotate any element inside a page, change its text, color and style; place,
  crop and restyle every clip, trim and cut them on the timeline.

## This repository

This is a self-built branch of [OpenFilm](https://github.com/openfilm/openfilm), forked at upstream `v0.3.2`
(`758b1a3`) and now at **0.3.6**. It is not the upstream project and has no affiliation with it. Upstream's issues,
pull requests and releases belong upstream; this one keeps its own.

What this branch changes, in short:

- **Named Zfilm** everywhere a person sees it: the window, Studio, the chat, the installer, the icons. The CLI and
  the npm package are still `openfilm`, and `zfilm` works as an alias.
- **No update mechanism.** No version check, no feed, no background download, no "restart to update". A new version
  is a new build installed over the old one.
- **No hosted service.** The account, the hosted agent and the hosted provider are gone. Media services are
  connected with your own keys, in Studio's Settings → Services.
- **The media library can be downloaded whole** and used offline, managed in Settings → Library: progress per
  part, pause, resume, clear.
- **A folder can be imported** into the managed library: the originals stay where they are, copies are catalogued,
  and the agent you have selected describes each file.
- **Local transcription** (whisper-small, WASM, no network) for material that has speech.
- **Windows fixes**: switching project tabs no longer throws you back to the project list on a slow load, 4K
  exports fall back through hardware encoders to software instead of stalling, and the desktop app builds and
  packages on Windows.

[SELF-CHANGELOG.md](SELF-CHANGELOG.md) is the ledger: every change, why it was made, what was measured, and what
is still open. It is written in Chinese.

## Install

The Windows installer is in [Releases](https://github.com/fivif/zfilm/releases):

```
Zfilm-Setup-0.3.6-x64.exe   NSIS, x64, about 316 MB
```

It carries ffmpeg and the headless Chromium, so nothing else is needed. It is **not code-signed**: Windows will
show a SmartScreen warning, and "More info → Run anyway" gets past it.

Only x64 Windows is built here. macOS and Linux run from source (below); upstream's releases have not been tried
with this branch's changes.

## A film

A film is a folder with a `film.html`: tracks of clips cut together.

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

Each `<section>` is a track, in the order the timeline shows them: the first on top. A clip is an element: a page,
a video, a still picture or a sound. Which part of its file plays is a media fragment (`#t=12,18`), where it starts
is `at`, where it sits is its style's `left`, `top`, `width` and `height`, and how it looks is CSS. Every sound is a
clip of its own. `overrides` hold your changes to elements of a page, and agents keep them when they edit.

A page is a web page that draws any moment of itself, and that is the whole contract:

```html
<script type="module">
window.film = {
  frame(t) { /* draw the complete picture at t seconds, with anything */ },
  duration: 4,               // optional: its own length, in seconds
  ready: loadFonts(),        // optional: a Promise for fonts, images, models, data
  width: 480, height: 320,   // optional: a page that is only a part of the picture
};
</script>
```

**The one rule:** the same `t` always draws the same picture, whatever was drawn before. Frames are asked for out
of order, in parallel and between frames (for motion blur), so a page that keeps the rule renders the same at any
size, on any machine. Anything else that makes pictures (Python, Blender, a video model) comes in as video or
images.

[packages/openfilm/SPEC.md](packages/openfilm/SPEC.md) is the format, for anyone building a player, renderer or
editor. [packages/openfilm/MANUAL.md](packages/openfilm/MANUAL.md) is what the `openfilm` command prints for
agents, and [packages/openfilm/manual](packages/openfilm/manual) holds the skills that teach how a film is made.

## Studio

Studio runs on your machine, in your browser: use one built on Chromium (Chrome, Edge), the engine films are drawn
and exported with, so the preview is what you export. Everything in the film can be changed: text and layers in the
picture, clips on the timeline, their place, look, volume and speed, and the subtitles. Your edits are saved to the
film's files, so the agent sees and keeps them, and you can save named versions to go back to.

Export a video, a GIF, the sound or its stems, subtitles, stills, slides, a transparent video, or the timeline
itself for Final Cut Pro, Premiere Pro and DaVinci Resolve.

Beside the edit is the canvas: a board where you and the agent lay out notes, pictures, clips, voice-over, music
and sound, wire them into each other, and send what you made to the timeline in order.

## CLI

The command is `packages/openfilm/bin/openfilm.mjs` (npm name: `openfilm`). From this checkout, `pnpm dev` leaves a
build of it at `packages/openfilm/.dev/bin/openfilm` (`openfilm.cmd` on Windows), pointed at that Studio.

```sh
openfilm                          # what a film is, and the skills: where an agent starts
openfilm open   [folder | url]    # show a film in Studio
openfilm look   [what] [t | a-b]  # check the film: a contact sheet, one frame, or a range
openfilm render [a-b]             # the MP4; --4k, --blur, --alpha, --loudness=-14
openfilm get    [what]            # media: the library first, else a connected service
openfilm canvas [apply <steps>]   # the canvas beside the edit
openfilm skills                   # the skills a film can be made with
openfilm doctor                   # what this computer has for Zfilm
```

`npx -y openfilm@latest` installs **upstream's** package, not this branch. To use this branch everywhere,
`npm link` in `packages/openfilm`.

## From source

You need Node 22.18 or later, pnpm 9 (`corepack enable` gives you the version this repository names), ffmpeg on the
PATH, and git.

```sh
git clone https://github.com/fivif/zfilm && cd zfilm
pnpm install                 # also builds Studio's editor
pnpm --filter openfilm exec playwright-core install chromium-headless-shell
pnpm dev                     # Studio from this checkout, with a sample film
pnpm test
pnpm typecheck
```

`pnpm dev:desktop` runs the desktop app from source as "Zfilm Dev", with its own data folder and port, so it never
collides with an installed Zfilm. `pnpm build` builds Studio's editor and the desktop app's window;
`pnpm audit:public` checks that nothing private or outsourced slipped in.

To build the Windows installer:

```powershell
cd apps/desktop
node scripts/release.mjs --platform=win --arch=x64
# -> .release/win-x64/out/Zfilm-Setup-x64.exe
```

[CONTRIBUTING.md](CONTRIBUTING.md) has the details of each package.

## Known limits

- **Render throughput.** About 79% of each frame is spent reading pixels back out of Chromium (1080p 47.6 ms,
  4K 174 ms). The way out is letting canvas/WebGL pages hand a `VideoFrame` straight to the encoder, which means
  changing the `frame(t)` contract.
- **Every tab is a whole Studio.** Switching a tab starts the editor again (2.54 MB of JS). Switching projects
  inside one instance is the real fix.
- **Audio-analysis imports** describe filename and technical metadata; they do not transcribe speech unless the
  local model is installed.

## License

The format, the CLI, Studio and the desktop app are [MIT](LICENSE).

This branch is a fork of [OpenFilm](https://github.com/openfilm/openfilm). The Zfilm and OpenFilm names and logos
are the upstream project's trademarks (see [TRADEMARK.md](TRADEMARK.md)); nothing here grants a right to use them
for a different product.
