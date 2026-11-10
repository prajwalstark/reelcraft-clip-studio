import { useEffect, useRef, useState } from "react";
import { Loader2, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { fmtTC, type Clip } from "@/lib/reelforge/core";
import {
  CUE_PRESETS,
  MAX_TRANSCRIBE_SECONDS,
  type CuePreset,
} from "@/lib/reelforge/autocaption-core";
import {
  LANGUAGES,
  MODELS,
  cancelAutoCaptions,
  isBusy,
  resetAutoCaptions,
  runAutoCaptions,
  useAutoCaptions,
  type ModelKey,
} from "@/lib/reelforge/autocaptions";
import { useStore } from "@/lib/reelforge/store";

const field =
  "h-8 w-full rounded-md border border-input bg-background/40 px-2 text-xs text-foreground outline-none focus:border-ring";
const label =
  "mb-1 block text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground";

const PRESET_LABELS: Record<CuePreset, string> = {
  punchy: "Punchy · 2–3 words",
  standard: "Standard · one line",
  sentences: "Sentences · two lines",
};

/** Settings survive tab switches and reloads (per browser, not part of the project). */
function usePref<T extends string>(key: string, fallback: T, allowed: readonly string[]) {
  const [v, setV] = useState<T>(fallback);
  useEffect(() => {
    try {
      const s = localStorage.getItem(`reelforge.autocap.${key}`);
      if (s !== null && allowed.includes(s)) setV(s as T);
    } catch {
      /* storage unavailable */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const update = (next: T) => {
    setV(next);
    try {
      localStorage.setItem(`reelforge.autocap.${key}`, next);
    } catch {
      /* storage unavailable */
    }
  };
  return [v, update] as const;
}

export function AutoCaptions({ clip }: { clip: Clip }) {
  const job = useAutoCaptions();
  const duration = useStore((s) => s.project.source?.duration ?? 0);
  const captions = useStore((s) => s.project.captions);
  const [scope, setScope] = usePref<"clip" | "source">("scope", "clip", ["clip", "source"]);
  const [model, setModel] = usePref<ModelKey>("model", "fast", Object.keys(MODELS));
  const [language, setLanguage] = usePref<string>(
    "language",
    "",
    LANGUAGES.map(([c]) => c),
  );
  const [preset, setPreset] = usePref<CuePreset>("preset", "standard", Object.keys(CUE_PRESETS));
  const [replace, setReplace] = useState(true);
  const busy = isBusy(job);

  const [start, end] = scope === "clip" ? [clip.start, clip.end] : [0, duration];
  const overlapping = captions.filter((c) => c.end > start && c.start < end).length;
  const tooLong = end - start > MAX_TRANSCRIBE_SECONDS;

  // Toast only on a transition observed while mounted, not when re-opening the tab later.
  const prev = useRef(job.status);
  useEffect(() => {
    const was = prev.current;
    prev.current = job.status;
    if (was === job.status || !isBusy({ ...job, status: was })) return;
    if (job.status === "done" && job.added)
      toast.success(`Added ${job.added} captions — review them below. Undo with Ctrl/⌘+Z.`);
    if (job.status === "done" && job.added === 0)
      toast.message("No speech was detected in that range.");
    if (job.status === "error" && job.error) toast.error(job.error);
  }, [job]);

  return (
    <section
      aria-labelledby="autocap-title"
      className="space-y-3 rounded-lg border border-primary/25 bg-primary/[0.04] p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 id="autocap-title" className="flex items-center gap-1.5 text-xs font-semibold">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          Auto-captions
        </h3>
        <span className="rounded-full border border-primary/30 px-2 py-0.5 text-[10px] text-primary">
          On-device
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label>
          <span className={label}>Range</span>
          <select
            aria-label="Transcription range"
            className={field}
            value={scope}
            disabled={busy}
            onChange={(e) => setScope(e.target.value as "clip" | "source")}
          >
            <option value="clip">This clip</option>
            <option value="source">Whole video</option>
          </select>
        </label>
        <label>
          <span className={label}>Model</span>
          <select
            aria-label="Speech model"
            className={field}
            value={model}
            disabled={busy}
            onChange={(e) => setModel(e.target.value as ModelKey)}
          >
            {(Object.keys(MODELS) as ModelKey[]).map((k) => (
              <option key={k} value={k}>
                {MODELS[k].label} ({MODELS[k].size})
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className={label}>Language</span>
          <select
            aria-label="Spoken language"
            className={field}
            value={language}
            disabled={busy}
            onChange={(e) => setLanguage(e.target.value)}
          >
            {LANGUAGES.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className={label}>Caption length</span>
          <select
            aria-label="Caption length"
            className={field}
            value={preset}
            disabled={busy}
            onChange={(e) => setPreset(e.target.value as CuePreset)}
          >
            {(Object.keys(CUE_PRESETS) as CuePreset[]).map((k) => (
              <option key={k} value={k}>
                {PRESET_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="tc text-[11px] text-muted-foreground">
        {fmtTC(start)} – {fmtTC(end)} · {Math.round(end - start)} s of audio
      </p>

      {overlapping > 0 && (
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={replace}
            disabled={busy}
            onChange={(e) => setReplace(e.target.checked)}
          />
          Replace the {overlapping} existing caption{overlapping === 1 ? "" : "s"} in this range
        </label>
      )}

      {busy ? (
        <div className="space-y-2" role="status" aria-live="polite">
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <span className="flex items-center gap-1.5 text-foreground/90">
              <Loader2 className="h-3 w-3 animate-spin" />
              {job.detail}
            </span>
            <Button size="sm" variant="ghost" className="h-6 px-2" onClick={cancelAutoCaptions}>
              <X className="h-3 w-3" />
              Cancel
            </Button>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300"
              style={{ width: `${Math.round(job.progress * 100)}%` }}
            />
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <Button
            size="sm"
            className="w-full"
            disabled={tooLong || end - start < 0.5}
            onClick={() => {
              resetAutoCaptions();
              void runAutoCaptions({
                start,
                end,
                model,
                language,
                preset,
                replace: overlapping > 0 && replace,
              });
            }}
          >
            <Sparkles className="h-3.5 w-3.5" />
            Generate captions
          </Button>
          {tooLong && (
            <p className="text-[11px] text-destructive">
              The whole video is over 60 minutes. Transcribe one clip at a time.
            </p>
          )}
          {job.status === "error" && job.error && (
            <p role="alert" className="text-[11px] text-destructive">
              {job.error}
            </p>
          )}
          {(job.status === "done" || job.status === "canceled") && (
            <p className="text-[11px] text-muted-foreground">{job.detail}</p>
          )}
        </div>
      )}

      <p className="text-[10.5px] leading-relaxed text-muted-foreground">
        Speech recognition runs in this browser with OpenAI's Whisper model. Your video and audio
        are never uploaded. The model downloads once from Hugging Face and is cached; it runs on
        your GPU when supported, otherwise on the CPU. Review the text — automatic transcripts make
        mistakes.
        {job.device &&
          ` Last run: ${job.device === "webgpu" ? "GPU (WebGPU)" : "CPU (WebAssembly)"}.`}
      </p>
    </section>
  );
}
