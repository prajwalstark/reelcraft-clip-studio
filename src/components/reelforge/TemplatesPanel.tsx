import { useState } from "react";
import { ExternalLink, Layers, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { commit, media, seek, setRt, updateClip, useStore } from "@/lib/reelforge/store";
import { outputDuration, speedOf, titleOf } from "@/lib/reelforge/editing";
import {
  applyVideoTemplate,
  findTemplate,
  normalizeTemplate,
  VIDEO_TEMPLATES,
  type TemplateId,
  type TemplateSettings,
} from "@/lib/reelforge/templates";
import type { Clip } from "@/lib/reelforge/core";

const field = "w-full rounded-md border bg-background/60 px-2 py-2 text-xs";
export function TemplatesPanel({ clip }: { clip: Clip }) {
  const [chosen, setChosen] = useState<TemplateId>(clip.template?.id ?? "weekend");
  const [query, setQuery] = useState("");
  const selectedIds = useStore((s) => s.rt.selected);
  const clips = useStore((s) => s.project.clips);
  const preset = findTemplate(chosen) ?? VIDEO_TEMPLATES[0]!;
  const applied = normalizeTemplate(clip.template),
    title = titleOf(clip);
  const selected = clips.filter((c) => selectedIds.includes(c.id));
  const matches = VIDEO_TEMPLATES.filter((p) =>
    `${p.name} ${p.category} ${p.description}`.toLowerCase().includes(query.toLowerCase()),
  );
  const apply = (ids: string[]) => {
    if (!ids.length) return;
    media.video?.pause();
    commit((p) => ({
      ...p,
      clips: p.clips.map((c) => (ids.includes(c.id) ? applyVideoTemplate(c, preset.id) : c)),
    }));
    setRt({ playing: false });
    seek(clip.start);
  };
  const patch = (p: Partial<TemplateSettings>) => {
    if (applied) updateClip(clip.id, { template: { ...applied, ...p } }, `template-${clip.id}`);
  };
  const patchTitle = (p: Partial<typeof title>) =>
    updateClip(clip.id, { overlay: { ...title, ...p } }, `template-title-${clip.id}`);
  return (
    <section className="space-y-4" aria-label="Editable video templates">
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Layers className="size-4 text-primary" />
          Make it yours
        </div>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Five original Reelcraft styles inspired by the CapCut shortlist. Editable on your footage,
          with motion and text rendered into your exports.
        </p>
      </div>
      <input
        aria-label="Search templates"
        type="search"
        placeholder="Find a look: lifestyle, reveal…"
        className={field}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="Template styles">
        {matches.map((p) => (
          <button
            key={p.id}
            aria-pressed={chosen === p.id}
            aria-label={`Select ${p.name}`}
            onClick={() => setChosen(p.id)}
            className={`overflow-hidden rounded-lg border text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${chosen === p.id ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"}`}
          >
            <div
              aria-hidden="true"
              className="relative flex h-24 items-center justify-center overflow-hidden p-3"
              style={{
                background: `radial-gradient(ellipse at ${p.id === "prism" ? "90% 20%" : "20% 80%"}, ${p.accent}44, #10151e 80%)`,
              }}
            >
              <div
                className={`absolute inset-2 ${p.id === "rhythm" || p.id === "weekend" ? "border" : "border-l-2"}`}
                style={{ borderColor: `${p.accent}77` }}
              />
              <span className="relative text-center text-[10px] font-extrabold leading-snug tracking-widest text-white">
                {p.title}
              </span>
              <span
                className="absolute bottom-2 right-2 text-[8px] uppercase"
                style={{ color: p.accent }}
              >
                Style sketch
              </span>
              {applied?.id === p.id && (
                <Check className="absolute right-2 top-2 size-3 text-primary" />
              )}
            </div>
            <div className="p-2">
              <div className="text-xs font-semibold">{p.name}</div>
              <div className="mt-0.5 text-[10px] text-muted-foreground">{p.category}</div>
            </div>
          </button>
        ))}
      </div>
      {!matches.length && (
        <p role="status" className="text-xs text-muted-foreground">
          No matching styles. Try “lifestyle” or clear your search.
        </p>
      )}
      <div className="space-y-2 rounded-lg border bg-background/30 p-3">
        <h3 className="text-sm font-semibold">{preset.name}</h3>
        <p className="text-xs leading-relaxed text-muted-foreground">{preset.description}</p>
        <p className="text-[11px] text-muted-foreground">
          Applying replaces color and title styling. Trim, framing, speed, source audio and caption
          text stay intact. Undo restores the previous look.
        </p>
        <Button size="sm" className="w-full" onClick={() => apply([clip.id])}>
          Apply to this clip
        </Button>
        <Button
          size="sm"
          variant="secondary"
          className="w-full"
          disabled={!selected.length}
          onClick={() => apply(selected.map((c) => c.id))}
        >
          Apply to selected ({selected.length})
        </Button>
        <a
          href={preset.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[10px] text-muted-foreground underline underline-offset-2"
        >
          Inspiration: {preset.inspiration}
          <ExternalLink className="size-3" />
        </a>
      </div>
      {applied && (
        <div className="space-y-3 border-t pt-3" aria-label="Template customization">
          <h3 className="text-xs font-semibold">Customize {findTemplate(applied.id)?.name}</h3>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={applied.enabled}
              onChange={(e) => patch({ enabled: e.target.checked })}
            />
            Template motion & decorations
          </label>
          <p className="text-[10px] text-muted-foreground">
            Turning this off keeps your color and title edits.
          </p>
          <label className="block space-y-1 text-xs">
            Opening title
            <textarea
              aria-label="Template title"
              maxLength={300}
              className={field}
              value={title.text}
              onChange={(e) => patchTitle({ text: e.target.value })}
            />
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={title.enabled}
              onChange={(e) => patchTitle({ enabled: e.target.checked })}
            />
            Show title and subtitle
          </label>
          <label className="block space-y-1 text-xs">
            Subtitle
            <input
              aria-label="Template subtitle"
              maxLength={120}
              className={field}
              value={applied.subtitle}
              onChange={(e) => patch({ subtitle: e.target.value })}
            />
          </label>
          <label className="flex items-center justify-between text-xs">
            Accent color
            <input
              aria-label="Template accent"
              type="color"
              value={applied.accent}
              onChange={(e) => patch({ accent: e.target.value })}
            />
          </label>
          <label className="block space-y-1 text-xs">
            Opening title duration (output seconds)
            <input
              aria-label="Template title duration"
              className={field}
              type="number"
              min={0.1}
              max={outputDuration(clip)}
              step={0.1}
              value={Number(((title.end - title.start) / speedOf(clip)).toFixed(2))}
              onChange={(e) => {
                const value = e.target.valueAsNumber;
                if (Number.isFinite(value))
                  patchTitle({
                    start: clip.start,
                    end:
                      clip.start +
                      Math.min(outputDuration(clip), Math.max(0.1, value)) * speedOf(clip),
                  });
              }}
            />
          </label>
          <label className="block space-y-1 text-xs">
            Motion strength · {Math.round(applied.intensity * 100)}%
            <input
              aria-label="Template motion strength"
              className="w-full accent-[var(--primary)]"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={applied.intensity}
              onChange={(e) => patch({ intensity: Number(e.target.value) })}
            />
          </label>
          {applied.id === "rhythm" && (
            <label className="block space-y-1 text-xs">
              Pulse tempo · {applied.tempo} BPM
              <input
                aria-label="Template pulse tempo"
                className="w-full accent-[var(--primary)]"
                type="range"
                min={40}
                max={180}
                step={1}
                value={applied.tempo}
                onChange={(e) => patch({ tempo: Number(e.target.value) })}
              />
              <span className="block text-[10px] text-muted-foreground">
                Manual visual tempo. No beat detection or music is added.
              </span>
            </label>
          )}
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={applied.captionLook}
              onChange={(e) => patch({ captionLook: e.target.checked })}
            />
            Match existing captions to this style
          </label>
          <Button size="sm" variant="ghost" onClick={() => setRt({ tab: "titles" })}>
            Edit title size, position & timing
          </Button>
        </div>
      )}
      <p className="text-[10px] leading-relaxed text-muted-foreground">
        These are original single-clip designs, not imported CapCut projects. No CapCut footage,
        music or proprietary transitions are included. Preview and export use the same animation.
      </p>
    </section>
  );
}
