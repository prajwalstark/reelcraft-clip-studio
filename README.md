# Reelcraft Clip Studio

**Routes:** `/` is the cinematic landing page (GSAP ScrollTrigger + Lenis, scroll-scrubbed video hero, React Three Fiber scene, horizontal workflow, live-crop showcase). The editor lives at **`/studio`**. Landing components are in `src/components/landing/`; the footage is rendered in-house — see `scripts/render-footage/`. All motion respects `prefers-reduced-motion` (static stills, no smooth scroll or pinning).

**Editable templates:** Load a video and open **Templates** for five original styles inspired by the selected CapCut trends. Customize titles, subtitles, accent colors and motion; apply to one clip or a selection and undo changes. See [FEATURE_PARITY.md](FEATURE_PARITY.md#editable-template-gallery) for scope and inspiration links.

**Editor tools update:** color adjustments, audio fades, clip speed, timed titles, timeline markers/snapping/zoom, responsive panels and configurable exports. See [FEATURE_PARITY.md](FEATURE_PARITY.md) for implemented features, shortcuts, timing rules and verification limits.

Create a complete working webapp called ReelForge for turning full-length uploaded videos into multiple shorts / Instagram Reels. User requested a modern 3D webapp and explicitly chose Lovable. Build an actual editor, not a marketing landing page.

Reference repository reviewed through GitHub: https://github.com/storytold/filmcraft . Its docs/architecture.md describe separate media/project model, command-based edits, undo snapshots, timeline trim/split, caption tracks, export jobs with progress/cancel, and vertical presets. docs/web.md describes local File/Blob-backed browser media, WebCodecs and WebAudio with capability checks. docs/captions.md describes timed caption editing, SRT/VTT import/export and burn-in. Filmcraft is Rust/egui/WASM, not React; use these workflow and architectural concepts as a reference for a fresh TypeScript implementation. Do not claim the Rust engine is connected unless you actually integrate and test it. Add a discreet About reference link; use original branding, no ArtCraft trademarks/assets.

VISUAL: premium cinematic near-black charcoal (#090b10), frosted translucent layers, electric-lime primary action, restrained cyan accents, subtle grain, thin borders and beautiful typography. Make the app feel like a polished professional editing studio. Incorporate an actual interactive 3D film strip / floating frame sculpture in the empty upload workspace (Three.js / react-three-fiber if appropriate), mouse parallax and gently tilted glass clip cards, with reduced-motion and WebGL fallback. Keep timeline and editing controls flat/readable. Desktop left navigation, project/source rail, central vertical video preview on a spatial stage, right inspector, bottom real timeline, top project name/export action. Responsive mobile panel tabs. Minimal empty state, a small clearly marked optional demo, no fake completed projects/statistics.

CORE END TO END, PRIORITIZE REAL FUNCTIONALITY:
- Drag/drop and file picker for actual local video; inspect browser metadata (duration, dimensions), playable source and correct errors for unsupported media. Keep source local; object URLs and cleanup, no silent uploads.
- Automatic full-video segmentation using chosen 15/30/60-second or custom duration, covering the full source with final short remainder. Make mode transparently 'Split by duration', not AI highlights. Allow editable clip titles, manual start/end, split, delete, duplicate and select multi-clip batch. Enforce valid ranges and no out-of-bounds/zero clips. Optional transcript-based breakpoints only if actually implemented.
- Preview chosen range with audio, play/pause, seek, readable timecodes, draggable trim handles and keyboard accessible numeric trim controls. Crop 9:16 (1080x1920), 1:1, 16:9, draggable/slider focal point, fit/fill, and zoom; show exactly what export will render.
- Captions: import SRT/VTT and/or manually add/edit timed captions, styles/size/color/position, safe-zone overlay and burn-in toggle. Sync captions to source timestamps and clip-relative export times. Download matching SRT. Do not fake speech recognition/AI analysis. No API keys required for core.
- Real export of selected clip and batch queue, progress and cancel. Prefer reliable browser processing via suitable available libraries (WebCodecs/muxing or FFmpeg WASM with actual runtime support). At minimum implement real canvas compositing + source audio + MediaRecorder, using supported MIME selection: MP4/H264 if supported, clearly labeled WebM fallback if needed, never mislabeled .mp4. Download actual generated cropped videos with captions and original audio. Explain real-time export if that path is used, and supported-browser/resource limits. Keep preview/export crop math identical. Handle export failures, abort cleanup, audio absent, and source switching. Can offer ZIP batch with real output files. Do not ship pretend progress or toast-only export. Do not download original file in place of rendered clip.
- Local project metadata persistence (IndexedDB or localStorage) with clear relink-source on reload if File cannot persist; project JSON export/import; undo/redo for edits. Local video files must never be falsely represented as retained.
- All visible navigation/actions must do something useful; eliminate placeholder 'coming soon' features and fabricated AI scoring.
- No auth/backend is needed for this local-first MVP. Do not require external paid AI services. Keep project unpublished; provide preview/editor for review.

Validate with build/typechecks and available browser testing. Use a short generated/test video including audio to confirm import -> split -> trim -> crop -> caption -> actual export path; inspect exported duration/dimensions/audio when possible. Test boundary clip validation and SRT clip-relative timing. Report exact implementation and any verification limits. Finish as much of this functional MVP as possible in this first build.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://reelcraft-clip-studio.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/16235142-99d8-44e3-b217-9aa33660305c).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Sequence Studio (beta)

Choose **Sequence Studio** in the workspace bar. It is a separate multitrack editor; the existing Shorts editor and its editable templates remain available. Sequence projects do not currently import Shorts project files or templates.

1. Import one or more local videos, audio files, or images. Select a source to preview it. Waveforms contain 128 sampled decoded peaks, not invented decorative data.
2. Drag media onto V1–V3 or A1–A3, or use the bin's append buttons. V3 is the top visual layer. Videos on video tracks retain their sound; placing the same source on an audio track adds another copy of that sound.
3. Drag clips to move them between compatible tracks. Use the inspector for exact frame start/duration and source-in trimming, volume, fit, position, scale, opacity and fades. Split at the playhead, undo/redo, or ripple-delete a non-overlapping clip on its own track. Lock tracks to prevent clip edits; M mutes sound and H hides picture independently.
4. Select a later clip and choose **Crossfade from previous**. This overlaps the two clips by up to half a second, fades the incoming picture over the outgoing picture and applies complementary linear audio gains. It rejects overlaps with a third clip. Moving or trimming a transition endpoint removes an invalid transition.
5. Save a `.reelseq.json` project. Autosave retains the latest edit locally. Source files are not embedded or uploaded; after reloading/opening, relink each original file using its matching name, size and modification timestamp. Switching between workspaces retains the current sequence's file handles for this page session.
6. Export 720p, 1080p or 2160p at 24 or 30 fps, in landscape, portrait or square. Mediabunny decodes and composites each frame at its explicit timestamp. MP4/H.264/AAC is used when the browser supports those encoders, otherwise WebM/VP9/Opus. Files have the matching extension. Missing files, unsupported codecs and audio decode errors stop the export. Cancel releases decoder and encoder resources; per-operation timeouts prevent indefinite waits.

### Current limits

- Maximum 180-second sequence, 50 sources and 200 clips. Long sources can be trimmed into the sequence. Source metadata and waveforms are probed locally.
- Audio is prepared before playback/export, mixed at 48 kHz stereo, and clamped to avoid out-of-range samples. Mono is duplicated; multichannel sources use their first two channels (no surround downmix). Preparation can take time and memory. Lower track gains when multiple loud sources overlap.
- Preview defaults to 360p (Faster); choose 720p (Detail) in the program monitor when needed. Decoder sessions and canvas buffers are reused across seeks and edits, and prepared audio is reused across pause/seek until the sequence changes. Preview resolution does not affect export resolution. Preview can skip frames under load; export encodes every frame. Codec availability depends on the browser/device. This is a browser editor, not a full Premiere replacement.
- No proxies, nested sequences, advanced color tools, keyframes, multicam, transcription, cloud rendering or sequence-template conversion in this milestone.
- Before publishing, run a real-browser smoke test with video plus music: split/trim, crossfade, preview, export, cancel, reload/relink, and verify the exported file's sound and timing. The implementation environment could not launch Chromium because its socket creation was blocked; automated tests cover editing, mixing, component interactions and the encoder orchestration with mocked browser codecs.


### Video Enhancer and 4K UHD

In **Sequence Studio**, import your file, add it to V1, and use **Video Enhancer** in the inspector. Balanced, Low Light and Vivid are fixed starting presets; adjust exposure (-2 to +2 stops), contrast, saturation and sharpening for the footage. Toggle enhancement off to compare the original treatment, then back on to restore your settings. Reset and undo/redo are supported. Enhancement settings are saved in the project; older sequence files load with enhancement disabled.

Enhancement applies to the entire composited sequence, including images. Preview and export share a reusable WebGL shader pass with no CPU pixel readback. It adjusts existing pixels; it is not AI super-resolution, denoising, stabilization, HDR conversion or reconstruction of missing detail. The Low Light preset can also make existing noise more visible. The existing Shorts editor keeps its own controls.

The default export selection is now the highest offered resolution:

| Canvas | 2160p output |
| --- | --- |
| Landscape 16:9 | 3840 × 2160 (4K UHD) |
| Portrait 9:16 | 2160 × 3840 |
| Square 1:1 | 2160 × 2160 |

UHD export requests a 32 Mbps video bitrate. Lower-resolution inputs are upscaled; higher-resolution inputs are scaled to the selected output. Preview remains at 360p or 720p independently. The app checks encoder support at the exact output dimensions and frame rate, including audio support, before mixing/rendering. Unsupported UHD exports stop with a clear error instead of silently downscaling. If enhancement is enabled, insufficient GPU limits or context loss also stop the export rather than dropping the effect.

The existing 180-second sequence limit still applies. UHD rendering uses more GPU memory and produces larger in-memory download files, so device/browser capabilities may limit practical export size. Before publishing, verify original/enhanced comparison, image orientation, audio sync and exported file dimensions using real footage in a browser. Automated tests cover GPU orchestration with mocks, saved settings and export negotiation; they do not prove real-device shader rendering or UHD codec support.
