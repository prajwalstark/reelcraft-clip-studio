import { useEffect, useRef, useState, type DragEvent } from "react";
import { toast } from "sonner";
import {
  type Sequence,
  type Asset,
  type Item,
  type TrackId,
  fresh,
  parseSequence,
  totalFrames,
  end,
  addItem,
  patchItem,
  deleteItem,
  splitItem,
  crossfade,
  changeFps,
  snapFrame,
  videoTrack,
  assetOf,
  transitionFrames,
} from "@/lib/sequence/model";
import { probe, download, exportSequence, type Files } from "@/lib/sequence/media";
import { SequencePreview } from "./SequencePreview";
import "./sequence.css";
const STORAGE = "reelcraft-sequence-v1";
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
function Numeric({
  label,
  value,
  onChange,
  step = 1,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(Math.round(value * 1000) / 1000)), [value]);
  return (
    <label className="seq-field">
      {label}
      <input
        type="number"
        value={draft}
        step={step}
        min={min}
        max={max}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft.trim() && Number.isFinite(Number(draft))) onChange(Number(draft));
          setDraft(String(value));
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
    </label>
  );
}
function Source({
  asset,
  file,
  active,
}: {
  active: boolean;
  asset: Asset | undefined;
  file: File | undefined;
}) {
  const media = useRef<HTMLMediaElement | null>(null);
  useEffect(() => {
    if (!active) media.current?.pause();
  }, [active]);
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!file) {
      setUrl("");
      return;
    }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return (
    <div className="seq-source">
      <div className="seq-panel-heading">SOURCE</div>
      {asset && url ? (
        <>
          {asset.kind === "image" ? (
            <img src={url} alt={asset.name} />
          ) : asset.kind === "video" ? (
            <video
              ref={(el) => {
                media.current = el;
              }}
              key={url}
              src={url}
              controls
              preload="metadata"
            />
          ) : (
            <audio
              ref={(el) => {
                media.current = el;
              }}
              key={url}
              src={url}
              controls
              preload="metadata"
            />
          )}
          <p>{asset.name}</p>
          <small>
            {asset.kind === "image" ? "Still image" : `${asset.duration.toFixed(2)} s`}
            {asset.hasAudio ? " · audio included" : ""}
          </small>
        </>
      ) : (
        <p className="seq-subtle">Select a media file to inspect it.</p>
      )}
    </div>
  );
}
function Waveform({ asset, item, fps }: { asset: Asset; item: Item; fps: number }) {
  if (!asset.peaks.length) return null;
  const count = 48;
  return (
    <svg
      className="seq-wave"
      viewBox={`0 0 ${count * 3} 24`}
      preserveAspectRatio="none"
      aria-label="Sampled audio waveform"
    >
      <title>Sampled audio waveform</title>
      {Array.from({ length: count }, (_, i) => {
        const time = item.sourceIn + ((i / count) * item.frames) / fps;
        const peak =
          asset.peaks[
            Math.min(
              asset.peaks.length - 1,
              Math.floor((time / asset.duration) * asset.peaks.length),
            )
          ] ?? 0;
        return (
          <rect
            key={i}
            x={i * 3}
            y={12 - peak * 11}
            width={2}
            height={Math.max(1, peak * 22)}
            rx={0.5}
          />
        );
      })}
    </svg>
  );
}
export default function SequenceStudio({ active = true }: { active?: boolean }) {
  const [sequence, setSequence] = useState<Sequence>(fresh),
    [files, setFiles] = useState<Files>(new Map()),
    [selected, setSelected] = useState(""),
    [source, setSource] = useState(""),
    [frame, setFrame] = useState(0);
  const [seekVersion, setSeekVersion] = useState(0);
  const seek = (next: number) => {
    setFrame(next);
    setSeekVersion((v) => v + 1);
  };
  const [undo, setUndo] = useState<Sequence[]>([]),
    [redo, setRedo] = useState<Sequence[]>([]),
    [busy, setBusy] = useState(""),
    [ready, setReady] = useState(false),
    [zoom, setZoom] = useState(40),
    [resolution, setResolution] = useState<720 | 1080>(720),
    [storageError, setStorageError] = useState("");
  const seqRef = useRef(sequence);
  seqRef.current = sequence;
  const importInput = useRef<HTMLInputElement>(null),
    openInput = useRef<HTMLInputElement>(null),
    relinkInput = useRef<HTMLInputElement>(null),
    relinkId = useRef(""),
    operation = useRef<AbortController | null>(null);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE);
      if (saved) setSequence(parseSequence(JSON.parse(saved)));
    } catch {
      setStorageError(
        "Saved sequence could not be restored. Open a saved .reelseq.json file to recover it.",
      );
    }
    setReady(true);
    return () => operation.current?.abort();
  }, []);
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(STORAGE, JSON.stringify(sequence));
    } catch {
      setStorageError("Autosave unavailable. Use Save project to keep your edit.");
    }
  }, [sequence, ready]);
  useEffect(() => {
    setFrame((f) => Math.min(f, Math.max(0, totalFrames(sequence) - 1)));
  }, [sequence]);
  const commit = (fn: (s: Sequence) => Sequence) => {
    try {
      const old = seqRef.current,
        next = fn(old);
      if (next === old) return;
      setUndo((h) => [...h.slice(-49), old]);
      setRedo([]);
      seqRef.current = next;
      setSequence(next);
    } catch (e) {
      toast.error(errorText(e));
    }
  };
  const clip = sequence.items.find((c) => c.id === selected),
    sourceAsset = sequence.assets.find((a) => a.id === source);
  const patch = (p: Partial<Item>) => {
    if (clip) commit((s) => patchItem(s, clip.id, p));
  };
  const missing = sequence.assets.filter((a) => !files.has(a.id)).length;
  const run = async (label: string, work: (signal: AbortSignal) => Promise<void>) => {
    if (operation.current) return;
    const c = new AbortController();
    operation.current = c;
    setBusy(label);
    try {
      await work(c.signal);
    } catch (e) {
      if (!c.signal.aborted) toast.error(errorText(e));
    } finally {
      if (operation.current === c) {
        operation.current = null;
        setBusy("");
      }
    }
  };
  const importFiles = (list: File[]) =>
    void run("Inspecting media…", async (signal) => {
      for (const file of list) {
        signal.throwIfAborted();
        if (seqRef.current.assets.length >= 50)
          throw new Error("Limit: 50 source files per sequence.");
        setBusy(`Inspecting ${file.name}…`);
        try {
          const a = await probe(file, signal);
          signal.throwIfAborted();
          setFiles((old) => new Map(old).set(a.id, file));
          commit((s) => ({ ...s, assets: [...s.assets, a] }));
          setSource(a.id);
        } catch (e) {
          if (signal.aborted) throw e;
          toast.error(`${file.name}: ${errorText(e)}`);
        }
      }
    });
  const relink = (file: File) =>
    void run("Checking replacement media…", async (signal) => {
      const asset = seqRef.current.assets.find((a) => a.id === relinkId.current);
      if (!asset) return;
      if (
        file.name !== asset.name ||
        file.size !== asset.size ||
        file.lastModified !== asset.lastModified
      )
        throw new Error("Choose the original file (matching name, size and modified date).");
      const checked = await probe(file, signal);
      if (
        checked.kind !== asset.kind ||
        Math.abs(checked.duration - asset.duration) > 0.05 ||
        checked.width !== asset.width ||
        checked.height !== asset.height ||
        checked.hasAudio !== asset.hasAudio
      )
        throw new Error("Media does not match the saved source.");
      signal.throwIfAborted();
      setFiles((old) => new Map(old).set(asset.id, file));
      toast.success(`Relinked ${asset.name}`);
    });
  const drop = (e: DragEvent<HTMLDivElement>, track: TrackId) => {
    e.preventDefault();
    if (busy) return;
    try {
      const data = JSON.parse(e.dataTransfer.getData("application/x-reelcraft"));
      const position =
        ((e.clientX - e.currentTarget.getBoundingClientRect().left) / zoom) * sequence.fps;
      if (data.item) {
        const c = sequence.items.find((c) => c.id === data.item);
        if (c)
          commit((s) =>
            patchItem(s, c.id, {
              track,
              start: snapFrame(s, position - (Number(data.offset) || 0), c.id),
            }),
          );
      } else if (data.asset)
        commit((s) => addItem(s, String(data.asset), track, snapFrame(s, position)));
    } catch {
      toast.error("Drag a media file from the bin or a clip from the timeline.");
    }
  };
  const timelineSeconds = Math.max(30, Math.ceil(totalFrames(sequence) / sequence.fps) + 5),
    width = timelineSeconds * zoom;
  return (
    <div className="sequence-studio">
      <header className="seq-header">
        <div>
          <span className="seq-eyebrow">REELCRAFT / EDIT</span>
          <h1>
            Sequence Studio <span>BETA</span>
          </h1>
        </div>
        <div className="seq-actions">
          <button
            disabled={!!busy}
            onClick={() => {
              if (sequence.items.length || sequence.assets.length) {
                if (!window.confirm("Start a new sequence? Save project first to keep this edit."))
                  return;
              }
              setSequence(fresh());
              setFiles(new Map());
              setUndo([]);
              setRedo([]);
              setSelected("");
              setSource("");
              setStorageError("");
            }}
          >
            New
          </button>
          <button disabled={!!busy} onClick={() => openInput.current?.click()}>
            Open project
          </button>
          <button
            disabled={!!busy}
            onClick={() =>
              download(
                new Blob([JSON.stringify(sequence, null, 2)], { type: "application/json" }),
                `${sequence.name.replace(/[^a-z0-9_-]/gi, "_")}.reelseq.json`,
              )
            }
          >
            Save project
          </button>
          <select
            aria-label="Export resolution"
            value={resolution}
            disabled={!!busy}
            onChange={(e) => setResolution(Number(e.target.value) as 720 | 1080)}
          >
            <option value={720}>720p</option>
            <option value={1080}>1080p</option>
          </select>
          <button
            className="seq-primary"
            disabled={!!busy || !sequence.items.length}
            onClick={() =>
              void run("Preparing export…", async (signal) => {
                const result = await exportSequence(
                  structuredClone(sequence),
                  new Map(files),
                  resolution,
                  signal,
                  setBusy,
                );
                signal.throwIfAborted();
                download(
                  result.blob,
                  `${sequence.name.replace(/[^a-z0-9_-]/gi, "_")}.${result.extension}`,
                );
                toast.success("Sequence exported.");
              })
            }
          >
            Export sequence ↗
          </button>
        </div>
      </header>
      <input
        ref={importInput}
        hidden
        type="file"
        multiple
        accept="video/*,audio/*,image/*"
        onChange={(e) => {
          importFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      <input
        ref={relinkInput}
        hidden
        type="file"
        accept="video/*,audio/*,image/*"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) relink(f);
          e.target.value = "";
        }}
      />
      <input
        ref={openInput}
        hidden
        type="file"
        accept=".json"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          if (
            (sequence.items.length || sequence.assets.length) &&
            !window.confirm("Open another sequence? Save project first to keep this edit.")
          )
            return;
          void run("Opening project…", async (signal) => {
            if (file.size > 2e6) throw new Error("Project file is too large.");
            const next = parseSequence(JSON.parse(await file.text()));
            signal.throwIfAborted();
            setSequence(next);
            setFiles(new Map());
            setUndo([]);
            setRedo([]);
            setSelected("");
            setSource("");
            setStorageError("");
          });
        }}
      />
      {busy && (
        <div className="seq-status" role="status">
          <span>{busy}</span>
          <button onClick={() => operation.current?.abort()}>Cancel</button>
        </div>
      )}
      {storageError && (
        <p className="seq-error" role="alert">
          {storageError}
        </p>
      )}
      {!!missing && (
        <p className="seq-notice">
          {missing} source file{missing === 1 ? "" : "s"} need relinking. Projects save edits; media
          stays on your device.
        </p>
      )}
      <fieldset disabled={!!busy} className="seq-workspace">
        <aside className="seq-bin">
          <div className="seq-panel-heading">
            <span>MEDIA BIN · {sequence.assets.length}</span>
            <button onClick={() => importInput.current?.click()}>+ Import</button>
          </div>
          <p className="seq-subtle">
            Drag media to a track, or use + V1 / + A1. Videos include their audio.
          </p>
          <div className="seq-assets">
            {!sequence.assets.length && (
              <button className="seq-import-empty" onClick={() => importInput.current?.click()}>
                ＋<strong>Bring your footage</strong>
                <span>
                  Videos, music and images
                  <br />
                  Multiple files supported
                </span>
              </button>
            )}
            {sequence.assets.map((a) => (
              <div
                key={a.id}
                className={`seq-asset ${source === a.id ? "is-selected" : ""}`}
                draggable={!busy && files.has(a.id)}
                onDragStart={(e) =>
                  e.dataTransfer.setData("application/x-reelcraft", JSON.stringify({ asset: a.id }))
                }
              >
                <button className="seq-asset-name" onClick={() => setSource(a.id)}>
                  <span>{a.kind === "video" ? "▣" : a.kind === "image" ? "▧" : "♫"}</span>
                  <strong>{a.name}</strong>
                </button>
                <small>
                  {a.kind === "image" ? "Image" : `${a.duration.toFixed(1)} s`} · {a.kind}
                </small>
                <div className="seq-actions">
                  {!files.has(a.id) ? (
                    <button
                      onClick={() => {
                        relinkId.current = a.id;
                        relinkInput.current?.click();
                      }}
                    >
                      Relink source
                    </button>
                  ) : (
                    <>
                      {a.kind !== "audio" && (
                        <button
                          onClick={() =>
                            commit((s) =>
                              addItem(
                                s,
                                a.id,
                                "V1",
                                Math.max(0, ...s.items.filter((c) => c.track === "V1").map(end)),
                              ),
                            )
                          }
                        >
                          + V1
                        </button>
                      )}
                      {a.hasAudio && (
                        <button
                          onClick={() =>
                            commit((s) =>
                              addItem(
                                s,
                                a.id,
                                "A1",
                                Math.max(0, ...s.items.filter((c) => c.track === "A1").map(end)),
                              ),
                            )
                          }
                        >
                          + A1
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
          <Source
            active={active}
            asset={sourceAsset}
            file={sourceAsset ? files.get(sourceAsset.id) : undefined}
          />
        </aside>
        <SequencePreview
          sequence={sequence}
          files={files}
          frame={frame}
          onFrame={setFrame}
          disabled={!!busy || !active}
          seekVersion={seekVersion}
        />
        <aside className="seq-inspector">
          <div className="seq-panel-heading">INSPECTOR</div>
          <label className="seq-field">
            Project name
            <input
              value={sequence.name}
              maxLength={80}
              onChange={(e) => commit((s) => ({ ...s, name: e.target.value }))}
            />
          </label>
          <div className="seq-field-pair">
            <label className="seq-field">
              Canvas
              <select
                value={sequence.aspect}
                onChange={(e) =>
                  commit((s) => ({ ...s, aspect: e.target.value as Sequence["aspect"] }))
                }
              >
                <option>16:9</option>
                <option>9:16</option>
                <option>1:1</option>
              </select>
            </label>
            <label className="seq-field">
              Frame rate
              <select
                value={sequence.fps}
                onChange={(e) => commit((s) => changeFps(s, Number(e.target.value) as 24 | 30))}
              >
                <option value={24}>24 fps</option>
                <option value={30}>30 fps</option>
              </select>
            </label>
          </div>
          {clip ? (
            <fieldset disabled={sequence.tracks.find((t) => t.id === clip.track)?.locked}>
              <h2>{assetOf(sequence, clip).name}</h2>
              <label className="seq-field">
                Track
                <select
                  value={clip.track}
                  onChange={(e) => patch({ track: e.target.value as TrackId })}
                >
                  {sequence.tracks.map((t) => (
                    <option key={t.id}>{t.id}</option>
                  ))}
                </select>
              </label>
              <div className="seq-field-pair">
                <Numeric
                  label="Start (frames)"
                  value={clip.start}
                  onChange={(v) => patch({ start: v })}
                  min={0}
                />
                <Numeric
                  label="Length (frames)"
                  value={clip.frames}
                  onChange={(v) => patch({ frames: v })}
                  min={1}
                />
              </div>
              <Numeric
                label="Source in (seconds)"
                value={clip.sourceIn}
                step={1 / sequence.fps}
                min={0}
                onChange={(v) => patch({ sourceIn: v })}
              />
              <Numeric
                label="Volume (%)"
                value={clip.volume * 100}
                min={0}
                max={100}
                onChange={(v) => patch({ volume: v / 100 })}
              />
              {videoTrack(clip.track) && (
                <>
                  <div className="seq-field-pair">
                    <Numeric
                      label="Position X (%)"
                      value={clip.x * 100}
                      min={0}
                      max={100}
                      onChange={(v) => patch({ x: v / 100 })}
                    />
                    <Numeric
                      label="Position Y (%)"
                      value={clip.y * 100}
                      min={0}
                      max={100}
                      onChange={(v) => patch({ y: v / 100 })}
                    />
                  </div>
                  <div className="seq-field-pair">
                    <Numeric
                      label="Scale (%)"
                      value={clip.scale * 100}
                      min={10}
                      max={300}
                      onChange={(v) => patch({ scale: v / 100 })}
                    />
                    <Numeric
                      label="Opacity (%)"
                      value={clip.opacity * 100}
                      min={0}
                      max={100}
                      onChange={(v) => patch({ opacity: v / 100 })}
                    />
                  </div>
                  <label className="seq-field">
                    Fit
                    <select
                      value={clip.fit}
                      onChange={(e) => patch({ fit: e.target.value as Item["fit"] })}
                    >
                      <option value="contain">Contain</option>
                      <option value="cover">Fill / crop</option>
                    </select>
                  </label>
                </>
              )}
              <div className="seq-field-pair">
                <Numeric
                  label="Fade in (frames)"
                  value={clip.fadeIn}
                  min={0}
                  onChange={(v) => patch({ fadeIn: v })}
                />
                <Numeric
                  label="Fade out (frames)"
                  value={clip.fadeOut}
                  min={0}
                  onChange={(v) => patch({ fadeOut: v })}
                />
              </div>
              <button onClick={() => commit((s) => crossfade(s, clip.id))}>
                Crossfade from previous · 0.5 s
              </button>
              {!!transitionFrames(sequence, clip) && (
                <p className="seq-subtle">Crossfade: {transitionFrames(sequence, clip)} frames</p>
              )}
              <p className="seq-subtle">Fades affect picture and audio. V3 overlays V2 and V1.</p>
            </fieldset>
          ) : (
            <div className="seq-inspector-empty">
              Select a timeline clip to trim, position, mix and add fades.
            </div>
          )}
        </aside>
      </fieldset>
      <section className="seq-timeline">
        <div className="seq-timeline-toolbar">
          <div className="seq-actions">
            <button
              disabled={!!busy || !undo.length}
              onClick={() => {
                const previous = undo.at(-1)!;
                setRedo((h) => [...h, sequence]);
                setUndo((h) => h.slice(0, -1));
                setSequence(previous);
              }}
            >
              ↶ Undo
            </button>
            <button
              disabled={!!busy || !redo.length}
              onClick={() => {
                const next = redo.at(-1)!;
                setUndo((h) => [...h, sequence]);
                setRedo((h) => h.slice(0, -1));
                setSequence(next);
              }}
            >
              ↷ Redo
            </button>
            <button
              disabled={!!busy || !clip}
              onClick={() => clip && commit((s) => splitItem(s, clip.id, frame))}
            >
              Split at playhead
            </button>
            <button
              disabled={!!busy || !clip}
              onClick={() => clip && commit((s) => deleteItem(s, clip.id))}
            >
              Delete
            </button>
            <button
              disabled={!!busy || !clip}
              onClick={() => clip && commit((s) => deleteItem(s, clip.id, true))}
            >
              Ripple delete (this track)
            </button>
          </div>
          <label>
            Zoom{" "}
            <input
              aria-label="Timeline zoom"
              type="range"
              min={15}
              max={100}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
            />
          </label>
        </div>
        <div className="seq-timeline-scroll">
          <div className="seq-ruler" style={{ width: width + 140 }}>
            <span className="seq-track-label">TIMELINE</span>
            <div style={{ width }}>
              {Array.from({ length: Math.ceil(timelineSeconds / 5) }, (_, i) => (
                <button
                  disabled={!!busy}
                  key={i}
                  style={{ left: i * 5 * zoom }}
                  onClick={() =>
                    seek(Math.min(i * 5 * sequence.fps, Math.max(0, totalFrames(sequence) - 1)))
                  }
                >
                  {i * 5}s
                </button>
              ))}
            </div>
          </div>
          {[...sequence.tracks.slice(0, 3).reverse(), ...sequence.tracks.slice(3)].map((t) => (
            <div key={t.id} className="seq-track" style={{ width: width + 140 }}>
              <div className="seq-track-label">
                <strong>{t.id}</strong>
                <div>
                  <button
                    disabled={!!busy}
                    aria-label={`${t.locked ? "Unlock" : "Lock"} ${t.id}`}
                    aria-pressed={t.locked}
                    onClick={() =>
                      commit((s) => ({
                        ...s,
                        tracks: s.tracks.map((x) =>
                          x.id === t.id ? { ...x, locked: !x.locked } : x,
                        ),
                      }))
                    }
                  >
                    {t.locked ? "🔒" : "Lock"}
                  </button>
                  <button
                    disabled={!!busy}
                    aria-label={`Mute ${t.id}`}
                    aria-pressed={t.muted}
                    onClick={() =>
                      commit((s) => ({
                        ...s,
                        tracks: s.tracks.map((x) =>
                          x.id === t.id ? { ...x, muted: !x.muted } : x,
                        ),
                      }))
                    }
                  >
                    M
                  </button>
                  {videoTrack(t.id) && (
                    <button
                      disabled={!!busy}
                      aria-label={`Hide ${t.id}`}
                      aria-pressed={t.hidden}
                      onClick={() =>
                        commit((s) => ({
                          ...s,
                          tracks: s.tracks.map((x) =>
                            x.id === t.id ? { ...x, hidden: !x.hidden } : x,
                          ),
                        }))
                      }
                    >
                      H
                    </button>
                  )}
                </div>
              </div>
              <div
                className={`seq-lane ${videoTrack(t.id) ? "video" : "audio"} ${t.locked ? "locked" : ""}`}
                style={{ width, backgroundSize: `${zoom * 5}px 100%` }}
                onDragOver={(e) => {
                  if (!t.locked && !busy) e.preventDefault();
                }}
                onDrop={(e) => drop(e, t.id)}
                onClick={(e) => {
                  if (e.target === e.currentTarget && !busy)
                    seek(
                      Math.min(
                        Math.round(
                          ((e.clientX - e.currentTarget.getBoundingClientRect().left) / zoom) *
                            sequence.fps,
                        ),
                        Math.max(0, totalFrames(sequence) - 1),
                      ),
                    );
                }}
              >
                {sequence.items
                  .filter((c) => c.track === t.id)
                  .sort((a, b) => a.start - b.start)
                  .map((c) => (
                    <button
                      key={c.id}
                      className={`seq-clip ${selected === c.id ? "selected" : ""} ${!files.has(c.assetId) ? "missing" : ""}`}
                      style={{
                        left: (c.start / sequence.fps) * zoom,
                        width: Math.max(5, (c.frames / sequence.fps) * zoom),
                      }}
                      disabled={!!busy}
                      draggable={!busy && !t.locked}
                      onDragStart={(e) =>
                        e.dataTransfer.setData(
                          "application/x-reelcraft",
                          JSON.stringify({
                            item: c.id,
                            offset:
                              ((e.clientX - e.currentTarget.getBoundingClientRect().left) / zoom) *
                              sequence.fps,
                          }),
                        )
                      }
                      onClick={() => {
                        setSelected(c.id);
                        setSource(c.assetId);
                      }}
                      title={`${assetOf(sequence, c).name} · ${c.frames} frames`}
                    >
                      <span>{assetOf(sequence, c).name}</span>
                      <Waveform asset={assetOf(sequence, c)} item={c} fps={sequence.fps} />
                      {!!transitionFrames(sequence, c) && (
                        <i
                          className="seq-crossfade"
                          style={{ width: (transitionFrames(sequence, c) / sequence.fps) * zoom }}
                        />
                      )}
                    </button>
                  ))}
                <div className="seq-playhead" style={{ left: (frame / sequence.fps) * zoom }} />
              </div>
            </div>
          ))}
        </div>
        <footer className="seq-footer">
          <span>Local editing · 3-minute sequence limit · {sequence.items.length}/200 clips</span>
          <span>Autosave stores edits, not media · Sampled waveforms</span>
        </footer>
      </section>
    </div>
  );
}
