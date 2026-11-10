# Filmcraft-inspired editing tools

Reference: [storytold/filmcraft](https://github.com/storytold/filmcraft). This application uses its editing workflows as a reference; it does not embed Filmcraft's Rust engine or claim full feature parity.

## Available

| Workflow | Implementation |
| --- | --- |
| Long video to shorts | Local file upload, duration-based segmentation, trim, split, duplicate, delete, selected/batch export |
| Reframing | 9:16, 1:1, 16:9; fit/fill, zoom, focal position, safe-zone guide |
| Color | Per-clip brightness, contrast, saturation, hue, blur; bypass and reset; shared preview/export compositor |
| Audio | Per-clip volume, mute, fade in/out; fades measured in output seconds and scaled to fit short clips |
| Speed | 0.5×, 1×, 1.5×, 2×; playback and export use the same speed; output duration and SRT timings adjust |
| Titles | One timed text overlay per clip, position, size, color and background; suitable for titles/lower thirds |
| Captions | Manual timed cues, SRT/VTT import, style controls, burn-in toggle, speed-adjusted clip-relative SRT download |
| Auto-captions | On-device speech recognition (Whisper via transformers.js in a Web Worker, WebGPU or WebAssembly) for one clip or the whole video; word-timed cues grouped by a length preset; one undoable edit that can replace captions in the range |
| Word-by-word captions | Karaoke, Highlight, Pop and Reveal animations with an accent colour; uses spoken word timing from auto-captions and length-weighted timing for other captions; identical in preview and export |
| Timeline | Horizontal zoom/scroll, trim handles, optional eight-pixel snapping to other clip boundaries and markers, named markers |
| Keyboard | Space play/pause, I/O trim, M marker, Ctrl/Command+K split, arrows source time step, Shift+arrows one second, undo/redo |
| Export | 720p / 1080p / 4K (2160p) presets at 24/30 fps; frame-exact WebCodecs encoding (MP4 H.264+AAC or WebM VP9+Opus) with pitch-preserving speed changes, real-time recording as a fallback; progress/cancel, ZIP with matching SRT |
| Native templates | Five original single-clip styles, animated titles/subtitles, motion/tempo/accent controls, optional per-clip caption styling, selected-clip application and undo |
| Projects | Existing v1 JSON compatibility, autosave/relink, project import/export, undo/redo for edits |
| Export isolation | Each queued job captures its source File, clip settings, captions/style, quality and SRT; later edits cannot change it |
| Small screens | Shorts/Preview/Tools panel navigation; eight inspector tabs |

## Timing and project behavior

- Trim, caption, title and marker times are **source seconds**. Speed changes output time, not source positions.
- Audio fade durations are **output seconds**. When both fades exceed output duration, their lengths are scaled proportionally.
- Arrow stepping uses 1/24 or 1/30 source-second increments. It is not decoded-frame-accurate navigation.
- Color filters apply only to video; titles and captions stay sharp. Blur is scaled with render resolution.
- Burn-in controls both previewed captions and rendered captions. SRT sidecars remain available when burn-in is off.
- New source/project operations clear edit history, preventing undo from restoring metadata for a different local File. Source changes cancel pending exports; completed downloads remain available.
- Local videos are not uploaded or stored in project JSON. Re-select the same source after reloading.

## Auto-captions

Open **Captions → Auto-captions**, choose the range (this clip or the whole video, up to 60 minutes per run), the model (Accurate ≈ 80 MB, the default, or Fast ≈ 40 MB — quicker but noticeably less accurate), the spoken language (or auto-detect) and a caption length, then **Generate captions**.

- Audio is decoded locally with Mediabunny, mixed to mono and resampled to 16 kHz. It is cut into windows of up to 28 seconds at the quietest nearby moment, and silent windows are skipped to avoid invented text.
- Whisper runs in a Web Worker: WebGPU with fp16 weights when the GPU supports `shader-f16`, otherwise 8-bit weights on WebAssembly. Model weights download once from Hugging Face and the ONNX runtime from jsDelivr; both are cached by the browser. **The video and its audio are never uploaded.**
- Word timestamps are grouped into cues by the length preset (Punchy, Standard or Sentences). Cues break at sentence ends and pauses, have a minimum on-screen time and never overlap. Times are source seconds like every other caption, so clip-relative SRT export, speed changes and burn-in work unchanged.
- The result is one undoable edit. Captions already in the range are replaced unless you untick the option. Progress, ETA and Cancel are shown; canceling changes nothing. Switching the source mid-run discards the result.
- Verified in headless Chromium (WebAssembly path) on a 31 s H.264/AAC test video with two spoken passages: the decoded 16 kHz audio matches ffmpeg's conversion (correlation 0.989, zero lag); Accurate transcribed both passages with cue times within ~0.3 s of speech onset in ≈ 26 s including model load; Fast took ≈ 18 s but misheard most of the second passage. The WebGPU path was not exercised (no GPU in the test environment).
- Limits: automatic transcripts make mistakes (names, jargon, overlapping speakers, music), so review the text. CPU (WebAssembly) transcription is slower than real time on many devices; the first run also waits for the model download.

## Word-by-word captions

In **Captions**, choose a **Word animation** and an **Accent** colour:

- **Karaoke** — spoken words fill with the accent colour.
- **Highlight** — an accent pill sits behind the word being spoken (text colour picked for contrast).
- **Pop** — the current word bounces in the accent colour.
- **Reveal** — words fade in as they are spoken; the box grows with them.
- **None** (default) — the whole caption at once, exactly as before.

Auto-captions store each word's spoken time alongside the caption. Correcting a misheard word keeps the timing as long as the number of words is unchanged; adding or removing words, or captions that were typed or imported from SRT/VTT, fall back to spreading the caption's time across its words by length. Trimming a caption's in/out points clamps its word times. The same canvas code draws the preview and the export, so what you see is what is burned in. SRT/VTT downloads stay plain (one cue per caption). Older projects load with no animation.

Verified in Chromium: on the 31 s test video, Accurate auto-captions stored timings for every word; preview screenshots of all five modes and a real 1080×1920 export with Highlight showed the pill on the spoken word at 4.65 s ("are"), 5.40 s ("one") and 12.20 s ("and").

## Frame-exact export and 4K

**Export → Resolution** offers 720p, 1080p and **4K (2160p)**: 2160×3840 for 9:16, 2160×2160 for 1:1 and 3840×2160 for 16:9, at 32 Mbps. 4K needs a WebCodecs encoder that supports the size; if there isn't one the job stops with a message — it never falls back to real-time capture or a smaller file. 4K files are about 4× larger than 1080p and are held in memory until downloaded. 4K only adds detail when the source has it: a 9:16 crop of 1080p footage is about 600 px wide, so exporting it at 4K is an upscale.

Verified in headless Chromium on a CPU-only 4-core sandbox (no GPU, no hardware video, no AAC encoder, so WebM VP9 + Opus was chosen):

| Export | Wall clock | Output |
| --- | --- | --- |
| 20 s test pattern, 1080×1920, frame-exact path | 35 s | 600 / 600 frames at 30 fps, 20.0 s, 440 Hz tone intact |
| Same, original real-time path (WebCodecs hidden) | 21 s | **216 / 600 frames** (≈ 11 fps) — dropped 64% of frames |
| 2× speed | 23 s | 300 frames, 10.0 s, tone still **440 Hz** (not 880) |
| 0.5× speed | 67 s | 1,200 frames, 40.0 s, tone still **440 Hz** (not 220) |
| 30 s speech video, 1080×1920 | 50 s | 900 frames, 30.0 s |
| 20 s test pattern, 2160×3840 (4K) | 114 s | 600 / 600 frames at 30 fps, 20.0 s, 40.9 MB, audio intact |

Profiling showed decode ≈ 11 ms/frame, encode ≈ 22 ms/frame and compositing 0.07 ms/frame; in this sandbox, moving each decoded frame onto the 2D canvas is a CPU copy (software rendering), which dominates. On machines with a GPU canvas and hardware codecs those costs are much lower, but that was not measured here.

## Browser limitations and deferred features

**Export paths.** Where WebCodecs is available (Chrome, Edge, recent Safari and Firefox), exports are frame-exact: each output frame is decoded at its exact source timestamp, composited with the same code as the preview and encoded — the clip is never played, so no frames are dropped. MP4 (H.264 + AAC) is used when the browser can encode both, otherwise WebM (VP9 + Opus); the job shows which. Speed changes are rendered offline with a pitch-preserving time-stretch (WSOLA). How fast this runs depends on the device: with hardware video decode/encode it is typically faster than real time; on CPU-only machines it can take longer than the clip, but the result is still complete. If WebCodecs can't decode the source or encode the size at 720p/1080p, the export falls back to the original real-time capture: canvas + WebAudio + MediaRecorder exports run in real time. Keep the tab visible. Resolution is fixed by the selected preset, while frame rate/bitrate are targets and may vary under device load. Format selection prefers supported H.264 MP4, then browser-selected MP4, then WebM; the UI reports the available choice. MP4 alone does not guarantee H.264/AAC compatibility. Pitch preservation depends on the browser.

Not implemented: AI highlight selection, face tracking, multitrack video/audio, external music mixing, transitions between clips, keyframes, LUT import, professional grading scopes, noise reduction, a native Filmcraft/WASM engine, or guaranteed Instagram-compatible encoding on every browser. No placeholder controls are presented for these features.

## Validation

Run `npm test`, `npx tsc --noEmit`, and `npm run build`. Regression tests cover timing, fades, legacy project loading, snapshot isolation, actual queue wiring, component edits/undo, render-layer ordering, and timeline geometry. Existing seek timeout, cancellation and audio-initialization tests are retained.

Before release, use a short source with visible motion and audio to check import → trim → speed → title/color/audio edits → download. Inspect the output duration, dimensions, frame progression, sound/fades, titles and subtitle timing. Test 720p/24 and 1080p/30, cancellation, and the small-screen layout.

The development environment could not complete this browser smoke test: local Chromium was blocked from creating its process socket and shared Chrome could not connect to the local development server. Build/unit/component checks do not establish media-encoder or visual behavior in a real browser.

## Editable template gallery

Open **Templates** after loading a source. Choose a style, then **Apply to this clip** or **Apply to selected**. Browse cards without changing the project. Applying replaces the clip's color and title styling, preserves any existing nonempty enabled title text, and keeps source trim, framing, playback speed, audio and caption text. Undo restores the prior look. Templates use output seconds for animation and opening title defaults; title ranges remain stored in source seconds like other titles.

| Original Reelcraft style | Inspiration from the provided CapCut shortlist | Native implementation |
| --- | --- | --- |
| Weekend Journal | [weekend story](https://www.capcut.com/template-detail/weekend-story/7547228528903720253) | Warm color, gentle push-in, border and progress line |
| Rhythm Frames | [LF](https://www.capcut.com/template-detail/LF/7493918549925203253) | Smooth rhythmic zoom, framed composition, manual pulse tempo |
| Momentum | [trending video](https://www.capcut.com/id-id/template-detail/trending-video/7606590613190053125) | Bold opening title, push-in and moving accent line |
| Prism Reveal | [EPIC TRANSITION](https://www.capcut.com/template-detail/EPIC-TRANSITION/7628152739305917716) | Opening accent sweep, rising title and corner marks |
| Slow Spotlight | [Trending template](https://www.capcut.com/template-detail/Trending-template/7687835534021971220) | Gentle zoom-out, vignette and minimal title |

These designs are original, locally rendered interpretations of broad styles, not exact reconstructions or imported CapCut templates. No CapCut media, music, project files or proprietary transitions are bundled. The source shortlist was selected using publicly displayed template uses and likes, not Instagram views or a measured engagement rate. Popularity of the source templates is not attributed to these recreations.

All template motion and text use the existing shared canvas compositor in preview/export. Customizations persist in v1 project JSON and queued export snapshots. Optional caption styling applies only to that clip and does not change caption text or SRT. Bypassing template motion/decorations retains the applied color/title edits. Pulse tempo is manual; this version does not detect audio beats, stitch multiple sources or add music. Slow Spotlight preserves playback speed; change it in Clip when desired.

Gallery thumbnails are labeled style sketches. Actual footage is previewed after applying. A real-browser visual and video-encoding check is still required before release; the current execution environment blocked Chromium process sockets. Unit/component tests cover application/undo, batch independence, speed-aware timing, malformed imports, persistence, export snapshots, drawing and preview/export geometry.
