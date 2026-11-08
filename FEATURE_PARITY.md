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
| Timeline | Horizontal zoom/scroll, trim handles, optional eight-pixel snapping to other clip boundaries and markers, named markers |
| Keyboard | Space play/pause, I/O trim, M marker, Ctrl/Command+K split, arrows source time step, Shift+arrows one second, undo/redo |
| Export | 720/1080 size presets, 24/30 fps targets, real-time browser recording, progress/cancel, ZIP with matching SRT |
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

## Browser limitations and deferred features

Canvas + WebAudio + MediaRecorder exports run in real time. Keep the tab visible. Resolution is fixed by the selected preset, while frame rate/bitrate are targets and may vary under device load. Format selection prefers supported H.264 MP4, then browser-selected MP4, then WebM; the UI reports the available choice. MP4 alone does not guarantee H.264/AAC compatibility. Pitch preservation depends on the browser.

Not implemented: AI highlight selection, speech transcription, face tracking, multitrack video/audio, external music mixing, transitions between clips, keyframes, LUT import, professional grading scopes, noise reduction, a native Filmcraft/WASM engine, deterministic frame-accurate/offline rendering, or guaranteed Instagram-compatible encoding on every browser. No placeholder controls are presented for these features.

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
