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
