import { useEffect, useRef, useState } from "react";
import {
  Download, FilePlus2, FolderOpen, Pause, Play, Redo2, Save, Scissors, Trash2, Undo2, Upload, X,
  Captions as CapIcon, Crop, Film, Clapperboard, Plus, Palette, Volume2, Type, Flag, Layers,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  ASPECTS, clampRange, clipCaptions, fmtTC, makeClips, parseSubtitles, splitClip, uid, validateClip,
  type Aspect, type Caption, type CaptionAnimation, type Clip, type Framing,
} from "@/lib/reelforge/core";
import { drawFrame } from "@/lib/reelforge/render";
import { downloadBlob, pickFormat } from "@/lib/reelforge/exporter";
import {
  activeClip, addMarker, cancelAll, cancelJob, commit, downloadClipSRT, downloadZip, enqueue, exportProjectJSON,
  getState, importProjectJSON, loadSource, media, newProjectAction, redo, removeJob, seek, setRt,
  undo, updateClip, useStore, type Tab,
} from "@/lib/reelforge/store";
import { audioGain, speedOf, outputDuration } from '@/lib/reelforge/editing';
import { ColorPanel, AudioPanel, SpeedControl, TitlesPanel, MarkersPanel, QualityControls } from './ToolPanels';
import { TemplatesPanel } from "./TemplatesPanel";
import { AutoCaptions } from "./AutoCaptions";
import { ANIMATIONS } from "@/lib/reelforge/caption-words";
import { Timeline } from './Timeline';
import { pickVideo } from "./EmptyStage";

function pickFile(accept: string, cb: (f: File) => void) {
  const i = document.createElement("input");
  i.type = "file";
  i.accept = accept;
  i.onchange = () => i.files?.[0] && cb(i.files[0]);
  i.click();
}

const inputCls =
  "h-8 w-full rounded-md border border-input bg-background/40 px-2 text-xs tc text-foreground outline-none focus:border-ring";
const Label = ({ children }: { children: React.ReactNode }) => (
  <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{children}</div>
);

function NumField({ value, onCommit, step = 0.1, label }: { value: number; onCommit: (n: number) => void; step?: number; label: string }) {
  const [v, setV] = useState(value.toFixed(2));
  useEffect(() => setV(value.toFixed(2)), [value]);
  const done = () => {
    const n = Number(v);
    if (Number.isFinite(n)) onCommit(n);
    else setV(value.toFixed(2));
  };
  return (
    <label className="block">
      <Label>{label}</Label>
      <input
        aria-label={label}
        className={inputCls}
        type="number"
        step={step}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={done}
        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
      />
    </label>
  );
}

// ---------------- Top bar ----------------
function TopBar() {
  const name = useStore((s) => s.project.name);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const source = useStore((s) => s.project.source);
  return (
    <header className="glass flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-x-0 border-t-0 px-3 py-1">
      <div className="flex items-center gap-2 pr-2">
        <Clapperboard className="h-4 w-4 text-primary" />
        <span className="font-display text-lg italic leading-none">ReelForge</span>
      </div>
      <input
        aria-label="Project name"
        className="h-7 w-48 rounded-md border border-transparent bg-transparent px-2 text-sm hover:border-input focus:border-ring outline-none"
        value={name}
        onChange={(e) => commit((p) => ({ ...p, name: e.target.value }), "name")}
      />
      <span className="hidden text-xs text-muted-foreground tc md:inline">
        {source ? `${source.name} · ${source.width}×${source.height} · ${fmtTC(source.duration)}` : ""}
      </span>
      <div className="ml-auto flex max-w-full flex-wrap items-center gap-1">
        <Button size="icon" variant="ghost" aria-label="Undo" disabled={!canUndo} onClick={undo}><Undo2 className="h-4 w-4" /></Button>
        <Button size="icon" variant="ghost" aria-label="Redo" disabled={!canRedo} onClick={redo}><Redo2 className="h-4 w-4" /></Button>
        <span className="mx-1 h-5 w-px bg-border" />
        <Button size="sm" variant="ghost" onClick={() => pickVideo(loadSource)}><Upload className="h-4 w-4" />Source</Button>
        <Button size="sm" variant="ghost" onClick={exportProjectJSON}><Save className="h-4 w-4" />Save</Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => pickFile(".json,application/json", (f) => importProjectJSON(f).then(() => toast.success("Project opened")).catch((e) => toast.error(e.message)))}
        >
          <FolderOpen className="h-4 w-4" />Open
        </Button>
        <Button size="sm" variant="ghost" onClick={() => confirm("Start a new empty project?") && newProjectAction()}>
          <FilePlus2 className="h-4 w-4" />New
        </Button>
      </div>
    </header>
  );
}

// ---------------- Clip list ----------------
function ClipList() {
  const clips = useStore((s) => s.project.clips);
  const activeId = useStore((s) => s.rt.activeId);
  const selected = useStore((s) => s.rt.selected);
  const duration = useStore((s) => s.project.source?.duration ?? 0);
  const allSel = clips.length > 0 && selected.length === clips.length;
  return (
    <aside className="glass flex h-full w-full lg:w-60 shrink-0 flex-col border-y-0 border-l-0">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Shorts · {clips.length}</span>
        <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <input type="checkbox" checked={allSel} onChange={() => setRt({ selected: allSel ? [] : clips.map((c) => c.id) })} />
          All
        </label>
      </div>
      <div className="flex-1 space-y-1 overflow-y-auto px-2 pb-2" role="list">
        {clips.map((c) => {
          const err = validateClip(c, duration);
          const act = c.id === activeId;
          return (
            <div
              role="listitem"
              key={c.id}
              onClick={() => { setRt({ activeId: c.id }); seek(c.start); }}
              className={`cursor-pointer rounded-md border px-2 py-1.5 transition-colors ${act ? "border-primary/60 bg-primary/10" : "border-transparent hover:bg-accent"}`}
            >
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  aria-label={`Select ${c.title}`}
                  checked={selected.includes(c.id)}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => setRt({ selected: selected.includes(c.id) ? selected.filter((x) => x !== c.id) : [...selected, c.id] })}
                />
                <span className="flex-1 truncate text-sm">{c.title}</span>
                <span className="rounded bg-muted px-1 text-[10px] tc text-muted-foreground">{c.framing.aspect}</span>
              </div>
              <div className="pl-5 text-[11px] tc text-muted-foreground">
                {fmtTC(c.start)} → {fmtTC(c.end)} · {outputDuration(c).toFixed(1)}s output
              </div>
              {err && <div className="pl-5 text-[11px] text-destructive">{err}</div>}
            </div>
          );
        })}
      </div>
      <div className="border-t p-2">
        <Button size="sm" className="w-full" disabled={!selected.length} onClick={() => enqueue(selected)}>
          <Download className="h-4 w-4" />Export selected ({selected.length})
        </Button>
      </div>
    </aside>
  );
}

// ---------------- Preview ----------------
function Preview() {
  const url = useStore((s) => s.rt.url);
  const clip = useStore((s) => activeClip(s));
  const playing = useStore((s) => s.rt.playing);
  const time = useStore((s) => s.rt.time);
  const safe = useStore((s) => s.rt.safeZone);
  const vref = useRef<HTMLVideoElement>(null);
  const cref = useRef<HTMLCanvasElement>(null);
  const aspect = clip?.framing.aspect ?? "9:16";
  const out = ASPECTS[aspect];
  const pw = Math.round(out.w / 2), ph = Math.round(out.h / 2);

  useEffect(() => {
    media.video = vref.current;
    return () => { media.video = null; };
  }, []);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const v = vref.current, c = cref.current;
      const s = getState();
      const cl = activeClip(s);
      if (!v || !c || !cl) return;
      if (v.playbackRate !== speedOf(cl)) v.playbackRate = speedOf(cl);
      v.preservesPitch = true;
      v.volume = audioGain(cl, v.currentTime);
      if (!v.paused) {
        if (v.currentTime >= cl.end - 0.02) { v.pause(); v.currentTime = cl.end; setRt({ playing: false }); }
        if (Math.abs(s.rt.time - v.currentTime) > 0.03) setRt({ time: v.currentTime });
      }
      const ctx = c.getContext("2d");
      if (ctx) drawFrame(ctx, v, c.width, c.height, cl.framing, s.project.burnIn ? s.project.captions : null, s.project.captionStyle, v.currentTime, cl);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const toggle = () => {
    const v = vref.current;
    if (!v || !clip) return;
    if (v.paused) {
      if (v.currentTime < clip.start || v.currentTime >= clip.end - 0.05) v.currentTime = clip.start;
      void v.play().then(() => setRt({ playing: true })).catch((e) => toast.error(e.message));
    } else { v.pause(); setRt({ playing: false }); }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 stage-bg p-4">
      <video ref={vref} src={url ?? undefined} className="hidden" playsInline preload="auto" onLoadedData={() => clip && seek(clip.start)} onPause={() => setRt({ playing: false })} />
      <div className="relative flex min-h-0 flex-1 items-center justify-center" style={{ width: "100%" }}>
        <div className="relative h-full max-w-full shadow-stage" style={{ aspectRatio: `${out.w}/${out.h}`, maxHeight: "100%" }}>
          <canvas ref={cref} width={pw} height={ph} aria-label="Short preview" className="h-full w-full rounded-md bg-background" onClick={toggle} />
          {safe && aspect === "9:16" && (
            <>
              <div className="pointer-events-none absolute inset-x-0 top-0 h-[10%] safe-hatch rounded-t-md" />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[20%] safe-hatch rounded-b-md" />
            </>
          )}
        </div>
      </div>
      <div className="glass flex w-full max-w-xl items-center gap-3 rounded-full px-3 py-1.5">
        <Button size="icon" variant="ghost" aria-label={playing ? "Pause" : "Play"} onClick={toggle} disabled={!clip}>
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </Button>
        <input
          aria-label="Seek within clip"
          type="range"
          className="min-w-0 flex-1 accent-[var(--primary)]"
          min={clip?.start ?? 0}
          max={clip?.end ?? 1}
          step={0.01}
          value={Math.min(clip?.end ?? 0, Math.max(clip?.start ?? 0, time))}
          onChange={(e) => seek(Number(e.target.value))}
        />
        <span className="w-32 text-right text-xs tc text-muted-foreground">
          {fmtTC(clip ? Math.max(0, time - clip.start) / speedOf(clip) : 0)} / {fmtTC(clip ? outputDuration(clip) : 0)}
        </span>
        <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <input type="checkbox" checked={safe} onChange={(e) => setRt({ safeZone: e.target.checked })} />Safe
        </label>
      </div>
    </div>
  );
}

// ---------------- Inspector tabs ----------------
function ClipTab({ clip }: { clip: Clip }) {
  const d = useStore((s) => s.project.source?.duration ?? 0);
  const seg = useStore((s) => s.project.segmentSeconds);
  const time = useStore((s) => s.rt.time);
  const [custom, setCustom] = useState(String(seg));
  const resplit = (n: number) => {
    if (!(n >= 0.5)) { toast.error("Duration must be at least 0.5s"); return; }
    if (getState().project.clips.length > 1 && !confirm(`Replace all clips with ${n}s segments?`)) return;
    commit((p) => ({ ...p, segmentSeconds: n, clips: makeClips(d, n, clip.framing) }));
    setRt({ activeId: getState().project.clips[0]?.id ?? null });
  };
  const err = validateClip(clip, d);
  return (
    <div className="space-y-4">
      <div>
        <Label>Split whole video by duration</Label>
        <div className="flex gap-1">
          {[15, 30, 60].map((n) => (
            <Button key={n} size="sm" variant={seg === n ? "default" : "secondary"} onClick={() => resplit(n)}>{n}s</Button>
          ))}
          <input aria-label="Custom segment seconds" className={`${inputCls} w-16`} value={custom} onChange={(e) => setCustom(e.target.value)} />
          <Button size="sm" variant="secondary" onClick={() => resplit(Number(custom))}>Split</Button>
        </div>
      </div>
      <label className="block">
        <Label>Title</Label>
        <input aria-label="Clip title" className={inputCls} value={clip.title} onChange={(e) => updateClip(clip.id, { title: e.target.value }, `title-${clip.id}`)} />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <NumField label="Start (s)" value={clip.start} onCommit={(n) => { const [s, e] = clampRange(n, clip.end, d); updateClip(clip.id, { start: s, end: e }); seek(s); }} />
        <NumField label="End (s)" value={clip.end} onCommit={(n) => { const [s, e] = clampRange(clip.start, n, d); updateClip(clip.id, { start: s, end: e }); seek(e); }} />
      </div>
      <SpeedControl clip={clip} />
      <div className="text-xs tc text-muted-foreground">Source length {(clip.end - clip.start).toFixed(2)}s {err && <span className="text-destructive">· {err}</span>}</div>
      <div className="flex flex-wrap gap-1">
        <Button size="sm" variant="secondary" onClick={() => { const [s, e] = clampRange(time, clip.end, d); updateClip(clip.id, { start: s, end: e }); }}>Set in = playhead</Button>
        <Button size="sm" variant="secondary" onClick={() => { const [s, e] = clampRange(clip.start, time, d); updateClip(clip.id, { start: s, end: e }); }}>Set out = playhead</Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            const r = splitClip(clip, time);
            if (!r) { toast.error("Playhead must be ≥0.5s inside the clip to split"); return; }
            commit((p) => ({ ...p, clips: p.clips.flatMap((c) => (c.id === clip.id ? r : [c])) }));
          }}
        >
          <Scissors className="h-3.5 w-3.5" />Split at playhead
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            const n: Clip = { ...clip, id: uid(), title: `${clip.title} copy`, framing: { ...clip.framing } };
            commit((p) => ({ ...p, clips: [...p.clips, n] }));
            setRt({ activeId: n.id });
          }}
        >
          <Plus className="h-3.5 w-3.5" />Duplicate
        </Button>
        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => commit((p) => ({ ...p, clips: p.clips.filter((c) => c.id !== clip.id) }))}>
          <Trash2 className="h-3.5 w-3.5" />Delete
        </Button>
      </div>
    </div>
  );
}

function Range({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (n: number) => void }) {
  return (
    <label className="block">
      <div className="flex justify-between"><Label>{label}</Label><span className="text-[10px] tc text-muted-foreground">{value.toFixed(2)}</span></div>
      <input aria-label={label} type="range" className="w-full accent-[var(--primary)]" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function FrameTab({ clip }: { clip: Clip }) {
  const f = clip.framing;
  const set = (p: Partial<Framing>, key = "frame") => updateClip(clip.id, { framing: { ...f, ...p } }, `${key}-${clip.id}`);
  return (
    <div className="space-y-4">
      <div>
        <Label>Aspect</Label>
        <div className="grid grid-cols-3 gap-1">
          {(Object.keys(ASPECTS) as Aspect[]).map((a) => (
            <Button key={a} size="sm" variant={f.aspect === a ? "default" : "secondary"} onClick={() => set({ aspect: a }, "aspect")}>{a}</Button>
          ))}
        </div>
        <div className="mt-1 text-[11px] text-muted-foreground">{ASPECTS[f.aspect].label}</div>
      </div>
      <div>
        <Label>Fit</Label>
        <div className="grid grid-cols-2 gap-1">
          <Button size="sm" variant={f.fit === "fill" ? "default" : "secondary"} onClick={() => set({ fit: "fill" }, "fit")}>Fill (crop)</Button>
          <Button size="sm" variant={f.fit === "fit" ? "default" : "secondary"} onClick={() => set({ fit: "fit" }, "fit")}>Fit (bars)</Button>
        </div>
      </div>
      <Range label="Zoom" value={f.zoom} min={1} max={3} step={0.01} onChange={(n) => set({ zoom: n })} />
      <Range label="Focus X" value={f.fx} min={0} max={1} step={0.01} onChange={(n) => set({ fx: n })} />
      <Range label="Focus Y" value={f.fy} min={0} max={1} step={0.01} onChange={(n) => set({ fy: n })} />
      <Button
        size="sm"
        variant="secondary"
        onClick={() => commit((p) => ({ ...p, clips: p.clips.map((c) => ({ ...c, framing: { ...f } })) }))}
      >
        Apply framing to all clips
      </Button>
    </div>
  );
}

function CaptionsTab({ clip }: { clip: Clip }) {
  const captions = useStore((s) => s.project.captions);
  const style = useStore((s) => s.project.captionStyle);
  const burnIn = useStore((s) => s.project.burnIn);
  const time = useStore((s) => s.rt.time);
  const d = useStore((s) => s.project.source?.duration ?? 0);
  const inClip = captions.filter((c) => c.end > clip.start && c.start < clip.end);
  const patch = (id: string, p: Partial<Caption>, key?: string) =>
    commit((pr) => ({ ...pr, captions: pr.captions.map((c) => (c.id === id ? { ...c, ...p } : c)).sort((a, b) => a.start - b.start) }), key);
  const setStyle = (p: Partial<typeof style>) => commit((pr) => ({ ...pr, captionStyle: { ...pr.captionStyle, ...p } }), "capstyle");
  return (
    <div className="space-y-3">
      <AutoCaptions clip={clip} />
      <div className="flex flex-wrap gap-1">
        <Button
          size="sm"
          onClick={() => {
            const s = Math.max(0, Math.min(time, d - 0.5));
            const c: Caption = { id: uid(), start: s, end: Math.min(d, s + 2), text: "New caption" };
            commit((p) => ({ ...p, captions: [...p.captions, c].sort((a, b) => a.start - b.start) }));
          }}
        >
          <Plus className="h-3.5 w-3.5" />Add at playhead
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            pickFile(".srt,.vtt,text/vtt", async (f) => {
              const caps = parseSubtitles(await f.text());
              if (!caps.length) { toast.error("No valid cues found in that file"); return; }
              commit((p) => ({ ...p, captions: [...p.captions, ...caps].sort((a, b) => a.start - b.start) }));
              toast.success(`Imported ${caps.length} captions`);
            })
          }
        >
          <Upload className="h-3.5 w-3.5" />Import SRT/VTT
        </Button>
        <Button size="sm" variant="secondary" onClick={() => downloadClipSRT(clip)} disabled={!clipCaptions(captions, clip.start, clip.end).length}>
          <Download className="h-3.5 w-3.5" />Clip SRT
        </Button>
      </div>
      <div className="text-[11px] text-muted-foreground">Times are source seconds. {inClip.length} of {captions.length} captions fall in this clip; SRT export is clip-relative.</div>
      <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
        {inClip.map((c) => (
          <div key={c.id} className="rounded-md border bg-background/30 p-2">
            <div className="mb-1 grid grid-cols-[1fr_1fr_auto] gap-1">
              <NumField label="In" value={c.start} onCommit={(n) => { const [s, e] = clampRange(n, c.end, d); patch(c.id, { start: s, end: e }); }} />
              <NumField label="Out" value={c.end} onCommit={(n) => { const [s, e] = clampRange(c.start, n, d); patch(c.id, { start: s, end: e }); }} />
              <Button size="icon" variant="ghost" aria-label="Delete caption" className="mt-4" onClick={() => commit((p) => ({ ...p, captions: p.captions.filter((x) => x.id !== c.id) }))}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
            <textarea aria-label="Caption text" className={`${inputCls} h-12 py-1 font-sans`} value={c.text} onChange={(e) => patch(c.id, { text: e.target.value }, `cap-${c.id}`)} />
          </div>
        ))}
      </div>
      <div className="space-y-2 border-t pt-3">
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={burnIn} onChange={(e) => commit((p) => ({ ...p, burnIn: e.target.checked }))} />Burn captions into exported video</label>
        <Range label="Size (% height)" value={style.size} min={2} max={9} step={0.1} onChange={(n) => setStyle({ size: n })} />
        <Range label="Vertical position" value={style.y} min={0.1} max={0.95} step={0.01} onChange={(n) => setStyle({ y: n })} />
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <label className="flex items-center gap-1"><input type="checkbox" checked={style.bg} onChange={(e) => setStyle({ bg: e.target.checked })} />Box</label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={style.uppercase} onChange={(e) => setStyle({ uppercase: e.target.checked })} />CAPS</label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={style.weight === 800} onChange={(e) => setStyle({ weight: e.target.checked ? 800 : 600 })} />Bold</label>
          <label className="flex items-center gap-1">Color<input type="color" aria-label="Caption color" value={style.color} onChange={(e) => setStyle({ color: e.target.value })} /></label>
        </div>
        <div className="grid grid-cols-[1fr_auto] items-end gap-2">
          <label className="text-xs">
            <Label>Word animation</Label>
            <select
              aria-label="Word animation"
              className={inputCls}
              value={style.animation ?? "none"}
              onChange={(e) => setStyle({ animation: e.target.value as CaptionAnimation })}
            >
              {ANIMATIONS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex h-8 items-center gap-1 text-xs">
            Accent
            <input
              type="color"
              aria-label="Animation accent color"
              value={style.accent ?? "#c8ff3d"}
              disabled={(style.animation ?? "none") === "none" || style.animation === "reveal"}
              onChange={(e) => setStyle({ accent: e.target.value })}
            />
          </label>
        </div>
        {(style.animation ?? "none") !== "none" && (
          <p className="text-[11px] text-muted-foreground">
            {ANIMATIONS.find((a) => a.id === style.animation)?.hint}.{" "}
            {inClip.length > 0 &&
              (inClip.every((c) => c.words?.length)
                ? "These captions use spoken word timing from Auto-captions."
                : `${inClip.filter((c) => c.words?.length).length} of ${inClip.length} captions here use spoken word timing from Auto-captions; the rest are timed by word length.`)}
          </p>
        )}
      </div>
    </div>
  );
}

function ExportTab({ clip }: { clip: Clip }) {
  const jobs = useStore((s) => s.rt.jobs);
  const clips = useStore((s) => s.project.clips);
  const [fmt, setFmt] = useState<string>("");
  useEffect(() => setFmt(pickFormat()?.label ?? "Not supported in this browser"), []);
  const done = jobs.filter((j) => j.status === "done").length;
  return (
    <div className="space-y-3">
      <QualityControls clip={clip} />
      <div className="text-[11px] text-muted-foreground">Output: {fmt}. Export renders in real time inside your browser; keep this tab visible. Nothing is uploaded.</div>
      <div className="flex flex-wrap gap-1">
        <Button size="sm" onClick={() => enqueue([clip.id])}><Film className="h-3.5 w-3.5" />Export this clip</Button>
        <Button size="sm" variant="secondary" onClick={() => enqueue(clips.map((c) => c.id))}>Export all ({clips.length})</Button>
        <Button size="sm" variant="ghost" onClick={cancelAll}>Cancel all</Button>
        <Button size="sm" variant="secondary" disabled={!done} onClick={() => void downloadZip()}>ZIP ({done})</Button>
      </div>
      <div className="space-y-2" aria-label="Export jobs">
        {jobs.length === 0 && <div className="text-xs text-muted-foreground">No exports yet.</div>}
        {jobs.map((j) => (
          <div key={j.id} className="rounded-md border bg-background/30 p-2" data-status={j.status}>
            <div className="flex items-center gap-2 text-xs">
              <span className="flex-1 truncate">{j.title}</span>
              <span className="tc text-muted-foreground">{j.status}{j.status === "rendering" ? ` ${Math.round(j.progress * 100)}%` : ""}</span>
              {(j.status === "queued" || j.status === "rendering") && (
                <Button size="icon" variant="ghost" aria-label="Cancel export" className="h-6 w-6" onClick={() => cancelJob(j.id)}><X className="h-3 w-3" /></Button>
              )}
              {j.status === "done" && j.blob && (
                <Button size="sm" variant="secondary" className="h-6 px-2" onClick={() => { if (j.blob && j.fileName) downloadBlob(j.blob, j.fileName); }}><Download className="h-3 w-3" />Download</Button>
              )}
              {j.status !== "queued" && j.status !== "rendering" && (
                <Button size="icon" variant="ghost" aria-label="Remove job" className="h-6 w-6" onClick={() => removeJob(j.id)}><Trash2 className="h-3 w-3" /></Button>
              )}
            </div>
            <div className="mt-1 h-1 overflow-hidden rounded bg-track">
              <div className={`h-full ${j.status === "error" ? "bg-destructive" : "bg-primary"}`} style={{ width: `${j.progress * 100}%` }} />
            </div>
            {j.meta && <div className="mt-1 text-[10px] tc text-muted-foreground">{j.meta}</div>}
            {j.error && <div className="mt-1 text-[11px] text-destructive">{j.error}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function Inspector() {
  const tab = useStore((s) => s.rt.tab);
  const clip = useStore((s) => activeClip(s));
  const tabs: Array<[Tab, string, React.ComponentType<{ className?: string }>]> = [
    ["templates", "Templates", Layers], ["clip", "Clip", Scissors], ["frame", "Frame", Crop], ["color", "Color", Palette], ["audio", "Audio", Volume2],
    ["titles", "Titles", Type], ["captions", "Captions", CapIcon], ["markers", "Markers", Flag], ["export", "Export", Download],
  ];
  return (
    <aside className="glass flex h-full w-full lg:w-80 shrink-0 flex-col border-y-0 border-r-0">
      <div role="tablist" className="grid grid-cols-3 gap-1 border-b p-1.5">
        {tabs.map(([id, label, Icon]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setRt({ tab: id })}
            className={`flex flex-col items-center gap-0.5 rounded-md py-1.5 text-[11px] ${tab === id ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-accent"}`}
          >
            <Icon className="h-4 w-4" />{label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {!clip ? (
          <div className="text-sm text-muted-foreground">No clip. Split the video to create shorts.</div>
        ) : tab === "templates" ? <TemplatesPanel key={clip.id} clip={clip} /> : tab === "clip" ? <ClipTab clip={clip} /> : tab === "frame" ? <FrameTab clip={clip} /> : tab === "captions" ? <CaptionsTab clip={clip} /> : tab === "color" ? <ColorPanel clip={clip} /> : tab === "audio" ? <AudioPanel clip={clip} /> : tab === "titles" ? <TitlesPanel clip={clip} /> : tab === "markers" ? <MarkersPanel /> : <ExportTab clip={clip} />}
      </div>
    </aside>
  );
}

export function Editor() {
  const [panel, setPanel] = useState("preview");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable=true], [role=slider]")) return;
      const mod = e.metaKey || e.ctrlKey;
      const state = getState(), clip = activeClip(state), key = e.key.toLowerCase();
      if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); }
      else if (mod && key === "k" && clip) {
        e.preventDefault();
        const parts = splitClip(clip, state.rt.time);
        if (parts) commit(p => ({ ...p, clips: p.clips.flatMap(c => c.id === clip.id ? parts : [c]) }));
        else toast.error("Playhead must be at least 0.5s inside the clip");
      } else if (!mod && !e.altKey && clip && (key === "i" || key === "o")) {
        e.preventDefault();
        const d = state.project.source?.duration ?? 0;
        const [start, end] = key === "i" ? clampRange(Math.min(state.rt.time, clip.end - .5), clip.end, d) : clampRange(clip.start, Math.max(state.rt.time, clip.start + .5), d);
        updateClip(clip.id, { start, end });
      } else if (!mod && !e.altKey && key === "m") { e.preventDefault(); addMarker(state.rt.time); }
      else if (!mod && !e.altKey && (key === "arrowleft" || key === "arrowright")) {
        e.preventDefault(); media.video?.pause(); setRt({ playing: false });
        seek(state.rt.time + (key === "arrowleft" ? -1 : 1) * (e.shiftKey ? 1 : 1 / state.rt.stepFps));
      } else if (e.code === "Space" && !t.closest("button")) {
        e.preventDefault();
        (document.querySelector('[aria-label="Play"],[aria-label="Pause"]') as HTMLButtonElement | null)?.click();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <nav aria-label="Editor panels" className="flex gap-1 border-b p-1 lg:hidden">
        {['clips', 'preview', 'tools'].map(id => <Button key={id} size="sm" variant={panel === id ? 'default' : 'ghost'} onClick={() => setPanel(id)}>{id === 'clips' ? 'Shorts' : id === 'preview' ? 'Preview' : 'Tools'}</Button>)}
      </nav>
      <div className="flex min-h-0 flex-1">
        <div className={`${panel === 'clips' ? 'flex' : 'hidden'} min-h-0 w-full lg:flex lg:w-auto`}><ClipList /></div>
        <div className={`${panel === 'preview' ? 'flex' : 'hidden'} min-w-0 flex-1 flex-col lg:flex`}>
          <Preview />
          <Timeline />
        </div>
        <div className={`${panel === 'tools' ? 'flex' : 'hidden'} min-h-0 w-full lg:flex lg:w-auto`}><Inspector /></div>
      </div>
    </div>
  );
}
