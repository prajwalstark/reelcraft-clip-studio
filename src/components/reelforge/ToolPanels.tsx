import { Button } from "@/components/ui/button";
import { useStore, commit, updateClip, seek, addMarker } from "@/lib/reelforge/store";
import { type Clip } from "@/lib/reelforge/core";
import {
  audioOf,
  colorOf,
  DEFAULT_AUDIO,
  DEFAULT_COLOR,
  outputDuration,
  outputSize,
  settingsOf,
  speedOf,
  titleOf,
} from "@/lib/reelforge/editing";

const field = "w-full rounded border bg-background p-2 text-xs";
function Slider({
  label,
  value,
  min,
  max,
  step = 0.01,
  change,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  change: (n: number) => void;
}) {
  return (
    <label className="block space-y-1 text-xs">
      <span>
        {label} <b className="float-right tc">{value.toFixed(2)}</b>
      </span>
      <input
        className="w-full accent-[var(--primary)]"
        aria-label={label}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => change(Number(e.target.value))}
      />
    </label>
  );
}
function NumberInput({
  label,
  value,
  change,
  min = 0,
  max = 86400,
}: {
  label: string;
  value: number;
  change: (n: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <label className="block text-xs">
      {label}
      <input
        aria-label={label}
        className={field}
        type="number"
        min={min}
        max={max}
        step={0.1}
        value={value}
        onChange={(e) => {
          if (e.target.value !== "" && Number.isFinite(e.target.valueAsNumber))
            change(Math.min(max, Math.max(min, e.target.valueAsNumber)));
        }}
      />
    </label>
  );
}
export function ColorPanel({ clip }: { clip: Clip }) {
  const c = colorOf(clip);
  const set = (p: Partial<typeof c>) =>
    updateClip(clip.id, { color: { ...c, ...p } }, `color-${clip.id}`);
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Basic browser color adjustments. Applied to the video in preview and export; text stays
        sharp.
      </p>
      <label className="flex gap-2 text-xs">
        <input
          type="checkbox"
          checked={c.enabled}
          onChange={(e) => set({ enabled: e.target.checked })}
        />
        Enable color effects
      </label>
      <Slider
        label="Brightness"
        value={c.brightness}
        min={0}
        max={2}
        change={(n) => set({ brightness: n })}
      />
      <Slider
        label="Contrast"
        value={c.contrast}
        min={0}
        max={2}
        change={(n) => set({ contrast: n })}
      />
      <Slider
        label="Saturation"
        value={c.saturation}
        min={0}
        max={2}
        change={(n) => set({ saturation: n })}
      />
      <Slider
        label="Hue (degrees)"
        value={c.hue}
        min={-180}
        max={180}
        step={1}
        change={(n) => set({ hue: n })}
      />
      <Slider
        label="Blur (1080p pixels)"
        value={c.blur}
        min={0}
        max={20}
        step={0.5}
        change={(n) => set({ blur: n })}
      />
      <Button
        size="sm"
        variant="secondary"
        onClick={() => updateClip(clip.id, { color: { ...DEFAULT_COLOR } })}
      >
        Reset color
      </Button>
    </div>
  );
}
export function AudioPanel({ clip }: { clip: Clip }) {
  const a = audioOf(clip);
  const set = (p: Partial<typeof a>) =>
    updateClip(clip.id, { audio: { ...a, ...p } }, `audio-${clip.id}`);
  return (
    <div className="space-y-4">
      <label className="flex gap-2 text-xs">
        <input
          type="checkbox"
          checked={a.muted}
          onChange={(e) => set({ muted: e.target.checked })}
        />
        Mute clip audio
      </label>
      <Slider label="Volume" value={a.volume} min={0} max={1} change={(n) => set({ volume: n })} />
      <Slider
        label="Audio fade in (output seconds)"
        value={a.fadeIn}
        min={0}
        max={10}
        step={0.1}
        change={(n) => set({ fadeIn: n })}
      />
      <Slider
        label="Audio fade out (output seconds)"
        value={a.fadeOut}
        min={0}
        max={10}
        step={0.1}
        change={(n) => set({ fadeOut: n })}
      />
      <p className="text-xs text-muted-foreground">
        Overlapping fades scale to fit the {outputDuration(clip).toFixed(2)}s output. Volume and
        fades affect both preview and downloaded audio.
      </p>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => updateClip(clip.id, { audio: { ...DEFAULT_AUDIO } })}
      >
        Reset audio
      </Button>
    </div>
  );
}
export function SpeedControl({ clip }: { clip: Clip }) {
  return (
    <label className="block space-y-1 text-xs">
      Clip speed
      <select
        aria-label="Clip speed"
        className={field}
        value={speedOf(clip)}
        onChange={(e) => updateClip(clip.id, { speed: Number(e.target.value) })}
      >
        {[0.5, 1, 1.5, 2].map((n) => (
          <option key={n} value={n}>
            {n}×
          </option>
        ))}
      </select>
      <span className="block text-muted-foreground">
        Output: {outputDuration(clip).toFixed(2)}s. Source trim and title/caption times stay
        unchanged. Audio pitch preservation uses browser support.
      </span>
    </label>
  );
}
export function TitlesPanel({ clip }: { clip: Clip }) {
  const title = titleOf(clip);
  const duration = useStore((s) => s.project.source?.duration ?? clip.end);
  const set = (p: Partial<typeof title>) =>
    updateClip(clip.id, { overlay: { ...title, ...p } }, `overlay-${clip.id}`);
  return (
    <div className="space-y-3">
      <label className="flex gap-2 text-xs">
        <input
          type="checkbox"
          checked={title.enabled}
          onChange={(e) => set({ enabled: e.target.checked })}
        />
        Show title / lower third
      </label>
      <label className="block text-xs">
        Title text
        <textarea
          aria-label="Title text"
          maxLength={300}
          className={field}
          value={title.text}
          onChange={(e) => set({ text: e.target.value })}
        />
      </label>
      <p className="text-xs text-muted-foreground">
        Times use source seconds. Titles display only where they overlap this clip.
      </p>
      <NumberInput
        label="Title start (source s)"
        value={title.start}
        max={duration}
        change={(n) => set({ start: n, end: Math.max(n, title.end) })}
      />
      <NumberInput
        label="Title end (source s)"
        value={title.end}
        min={title.start}
        max={duration}
        change={(n) => set({ end: n })}
      />
      <Button
        size="sm"
        variant="secondary"
        onClick={() => set({ start: clip.start, end: clip.end })}
      >
        Use full clip range
      </Button>
      <Slider
        label="Title size (% height)"
        value={title.size}
        min={2}
        max={12}
        step={0.1}
        change={(n) => set({ size: n })}
      />
      <Slider
        label="Title horizontal position"
        value={title.x}
        min={0.1}
        max={0.9}
        change={(n) => set({ x: n })}
      />
      <Slider
        label="Title vertical position"
        value={title.y}
        min={0.1}
        max={0.9}
        change={(n) => set({ y: n })}
      />
      <label className="flex gap-2 text-xs">
        Title color
        <input
          aria-label="Title color"
          type="color"
          value={title.color}
          onChange={(e) => set({ color: e.target.value })}
        />
      </label>
      <label className="flex gap-2 text-xs">
        <input
          type="checkbox"
          checked={title.background}
          onChange={(e) => set({ background: e.target.checked })}
        />
        Title background
      </label>
    </div>
  );
}
export function MarkersPanel() {
  const markers = useStore((s) => s.project.markers);
  const time = useStore((s) => s.rt.time);
  return (
    <div className="space-y-3">
      <Button size="sm" onClick={() => addMarker(time)}>
        Add marker at playhead
      </Button>
      <p className="text-xs text-muted-foreground">
        Source timeline markers. Click a time to seek. M adds a marker.
      </p>
      {markers?.map((m) => (
        <div key={m.id} className="flex items-center gap-1">
          <button
            className="tc text-xs text-primary"
            aria-label={`Seek to ${m.name}`}
            onClick={() => seek(m.time)}
          >
            {m.time.toFixed(2)}s
          </button>
          <input
            aria-label={`Marker name ${m.id}`}
            className={field}
            value={m.name}
            onChange={(e) =>
              commit(
                (p) => ({
                  ...p,
                  markers:
                    p.markers?.map((x) => (x.id === m.id ? { ...x, name: e.target.value } : x)) ??
                    [],
                }),
                `marker-${m.id}`,
              )
            }
          />
          <button
            aria-label={`Delete ${m.name}`}
            className="px-2 text-destructive"
            onClick={() =>
              commit((p) => ({ ...p, markers: p.markers?.filter((x) => x.id !== m.id) ?? [] }))
            }
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
export function QualityControls({ clip }: { clip: Clip }) {
  const raw = useStore((s) => s.project.exportSettings),
    settings = settingsOf(raw),
    size = outputSize(clip, settings);
  return (
    <div className="space-y-2 rounded border p-2 text-xs">
      <label className="block">
        Resolution
        <select
          aria-label="Export resolution"
          className={field}
          value={settings.resolution}
          onChange={(e) =>
            commit((p) => ({
              ...p,
              exportSettings: {
                ...settings,
                resolution: Number(e.target.value) as 720 | 1080 | 2160,
              },
            }))
          }
        >
          <option value={720}>720p</option>
          <option value={1080}>1080p</option>
          <option value={2160}>4K (2160p)</option>
        </select>
      </label>
      <label className="block">
        Frame rate
        <select
          aria-label="Export frame rate"
          className={field}
          value={settings.fps}
          onChange={(e) =>
            commit((p) => ({
              ...p,
              exportSettings: { ...settings, fps: Number(e.target.value) as 24 | 30 },
            }))
          }
        >
          <option value={24}>24 fps</option>
          <option value={30}>30 fps</option>
        </select>
      </label>
      <p className="tc text-muted-foreground">
        {size.w}×{size.h} · {size.fps} fps · {size.bitrate / 1e6} Mbps target
      </p>
      <p className="text-muted-foreground">
        {settings.resolution === 2160
          ? "4K needs a WebCodecs encoder that supports this size (Chrome/Edge on most recent devices). If it isn't available, the export stops with a message rather than producing a smaller file. Files are about 4× larger than 1080p."
          : "With WebCodecs (Chrome, Edge, recent Safari/Firefox) every frame is encoded — none dropped; otherwise exports fall back to real-time capture, which can drop frames on busy devices."}{" "}
        Already queued jobs keep their original settings.
      </p>
    </div>
  );
}
