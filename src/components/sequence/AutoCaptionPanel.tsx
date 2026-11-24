import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { CUE_PRESETS, type CuePreset } from "@/lib/reelforge/autocaption-core";
import {
  LANGUAGES,
  MODELS,
  cancelAutoCaptions,
  isBusy,
  resetAutoCaptions,
  useAutoCaptions,
  type ModelKey,
} from "@/lib/reelforge/autocaptions";
import {
  CAPTION_LOOKS,
  type CaptionLook,
  captionsIn,
  runSequenceCaptions,
} from "@/lib/sequence/autocaptions";
import type { Files } from "@/lib/sequence/media";
import { type Item, type Sequence, type TrackId, end, totalFrames } from "@/lib/sequence/model";

const PRESET_LABEL: Record<CuePreset, string> = {
  punchy: "Punchy · 1–3 words",
  standard: "Standard · one line",
  sentences: "Sentences · longer",
};

/** Remembered choices (per browser). */
function usePref<T extends string>(key: string, initial: T, allowed: readonly string[]) {
  const [v, setV] = useState<T>(initial);
  useEffect(() => {
    try {
      const s = localStorage.getItem(`reelcraft.seq-autocap.${key}`);
      if (s !== null && allowed.includes(s)) setV(s as T);
    } catch {
      /* storage unavailable */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const update = (next: T) => {
    setV(next);
    try {
      localStorage.setItem(`reelcraft.seq-autocap.${key}`, next);
    } catch {
      /* storage unavailable */
    }
  };
  return [v, update] as const;
}

/**
 * Sequence Studio auto-captions: transcribe the timeline's audio on this device and add the
 * captions as title clips.
 */
export function AutoCaptionPanel({
  sequence,
  files,
  clip,
  getSequence,
  apply,
  onClose,
}: {
  sequence: Sequence;
  files: Files;
  /** The selected clip, for "under the selected clip". */
  clip: Item | undefined;
  getSequence: () => Sequence;
  apply: (edit: (s: Sequence) => Sequence) => void;
  onClose: () => void;
}) {
  const job = useAutoCaptions("sequence");
  const busy = isBusy(job);
  const uid = useId();
  const [model, setModel] = usePref<ModelKey>("model", "accurate", Object.keys(MODELS));
  const [language, setLanguage] = usePref<string>(
    "language",
    "",
    LANGUAGES.map(([c]) => c),
  );
  const [preset, setPreset] = usePref<CuePreset>("preset", "standard", Object.keys(CUE_PRESETS));
  const [look, setLook] = usePref<CaptionLook>(
    "look",
    "subtitle",
    CAPTION_LOOKS.map((l) => l.id),
  );
  const [reveal, setReveal] = usePref<"line" | "words">("reveal", "words", ["line", "words"]);
  const [track, setTrack] = usePref<TrackId>("track", "V3", ["V1", "V2", "V3"]);
  const [scope, setScope] = useState<"all" | "clip">("all");
  const [replace, setReplace] = useState(true);

  const total = totalFrames(sequence);
  const useClip = scope === "clip" && !!clip;
  const [start, stop] = useClip ? [clip!.start, end(clip!)] : [0, total];
  const earlier = captionsIn(sequence, track, start, stop).length;
  const locked = sequence.tracks.find((t) => t.id === track)?.locked;
  const hasSound = sequence.items.some(
    (c) => !c.title && sequence.assets.find((a) => a.id === c.assetId)?.hasAudio,
  );

  // Toast only for a run that finished while this panel was open.
  const prev = useRef(job.status);
  useEffect(() => {
    const was = prev.current;
    prev.current = job.status;
    if (was === job.status || !isBusy({ ...job, status: was })) return;
    if (job.status === "done" && job.added)
      toast.success(`Added ${job.added} captions on ${track}. Undo with the Undo button.`);
    if (job.status === "done" && job.added === 0)
      toast.message("No speech was detected in that range.");
    if (job.status === "error" && job.error) toast.error(job.error);
  }, [job, track]);

  const start_ = () =>
    void runSequenceCaptions(
      getSequence,
      files,
      { model, language, preset, look, reveal, track, start, end: stop, replace },
      apply,
    );

  const field = (label: string, control: ReactNode) => (
    <label className="seq-field">
      {label}
      {control}
    </label>
  );
  return (
    <section className="seq-autocap" aria-labelledby={`${uid}-h`}>
      <header>
        <h2 id={`${uid}-h`}>Auto-captions</h2>
        <span className="seq-badge">On-device</span>
        <button type="button" aria-label="Close auto-captions" onClick={onClose}>
          ✕
        </button>
      </header>
      <p className="seq-subtle">
        Transcribes what the sequence plays — muted tracks, volumes and fades included — and adds
        each caption as a title clip you can edit, restyle and move.
      </p>
      <fieldset disabled={busy} className="seq-autocap-grid">
        {field(
          "Range",
          <select
            value={useClip ? "clip" : "all"}
            onChange={(e) => setScope(e.target.value as "all" | "clip")}
          >
            <option value="all">Whole sequence</option>
            <option value="clip" disabled={!clip}>
              Under the selected clip
            </option>
          </select>,
        )}
        {field(
          "Put captions on",
          <select value={track} onChange={(e) => setTrack(e.target.value as TrackId)}>
            {(["V3", "V2", "V1"] as const).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>,
        )}
        {field(
          "Model",
          <select value={model} onChange={(e) => setModel(e.target.value as ModelKey)}>
            {(Object.keys(MODELS) as ModelKey[]).map((k) => (
              <option key={k} value={k}>
                {MODELS[k].label} · {MODELS[k].size}
              </option>
            ))}
          </select>,
        )}
        {field(
          "Language",
          <select value={language} onChange={(e) => setLanguage(e.target.value)}>
            {LANGUAGES.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>,
        )}
        {field(
          "Caption length",
          <select value={preset} onChange={(e) => setPreset(e.target.value as CuePreset)}>
            {(Object.keys(CUE_PRESETS) as CuePreset[]).map((k) => (
              <option key={k} value={k}>
                {PRESET_LABEL[k]}
              </option>
            ))}
          </select>,
        )}
        {field(
          "Look",
          <select value={look} onChange={(e) => setLook(e.target.value as CaptionLook)}>
            {CAPTION_LOOKS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>,
        )}
        {field(
          "Reveal",
          <select value={reveal} onChange={(e) => setReveal(e.target.value as "line" | "words")}>
            <option value="words">Word by word, as spoken</option>
            <option value="line">Whole caption</option>
          </select>,
        )}
        <label className="seq-autocap-check">
          <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
          Replace earlier auto-captions here{earlier ? ` (${earlier})` : ""}
        </label>
      </fieldset>
      {locked && (
        <p role="alert" className="seq-error">
          {track} is locked. Unlock it or pick another track.
        </p>
      )}
      {!hasSound && <p className="seq-subtle">Add a clip with sound to caption it.</p>}
      <div className="seq-actions">
        {busy ? (
          <button type="button" onClick={cancelAutoCaptions}>
            Cancel
          </button>
        ) : (
          <button
            type="button"
            className="seq-primary"
            disabled={!hasSound || !!locked || stop - start < sequence.fps / 2}
            onClick={() => {
              resetAutoCaptions();
              start_();
            }}
          >
            Generate captions
          </button>
        )}
        <span className="seq-subtle">
          {((stop - start) / sequence.fps).toFixed(1)} s · model downloads once, then runs offline
        </span>
      </div>
      {(busy || job.status === "done" || job.status === "canceled" || job.status === "error") && (
        <div className="seq-autocap-status" aria-live="polite">
          {busy && (
            <div
              className="seq-progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(job.progress * 100)}
            >
              <i style={{ width: `${Math.round(job.progress * 100)}%` }} />
            </div>
          )}
          {job.status === "error" ? (
            <p role="alert" className="seq-error">
              {job.error}
            </p>
          ) : (
            <p className="seq-subtle">{job.detail}</p>
          )}
        </div>
      )}
    </section>
  );
}
