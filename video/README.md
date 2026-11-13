# AgentFICO demo video

The [voiceover script](../docs/submission/video-script.md) follows the rendered cut at `out/agentfico-demo.mp4`. The MP4 has burned-in captions and a silent stereo track for recording the voiceover.

Capture the public fixture-backed demo from the repository root.

```sh
bash video/render.sh https://agentfico-free-demo.onrender.com
```

The renderer uses Node.js 22 or later, Playwright with Chromium, and FFmpeg with H.264 support. It can use an installed Playwright package in the repository or the local npm execution cache. To select a specific installation, set `AFC_PLAYWRIGHT_ENTRY` to its `playwright/index.mjs` file. These are local render tools and are not application dependencies.

`record.mjs` captures the dashboard and the HTML title cards in Chromium at 1920 × 1080. It writes individual recordings to `work/` and a local manifest to `out/`. `finalize.mjs` reads the manifest, crossfades the scenes, and encodes the 30 fps MP4 with a 48 kHz silent track.
