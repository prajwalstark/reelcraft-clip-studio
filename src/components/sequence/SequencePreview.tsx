import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { addScopeSource, tapGradedFrame } from "@/lib/reelforge/grading/scopes";
import { type Sequence, totalFrames, dimensions } from "@/lib/sequence/model";
import { MediaSession, bounded, type Files } from "@/lib/sequence/media";
import { TransformOverlay, type TransformProps } from "./TransformOverlay";

export function SequencePreview({
  sequence,
  files,
  frame,
  onFrame,
  disabled,
  seekVersion,
  selected,
  onSelect,
  onTransform,
}: {
  sequence: Sequence;
  files: Files;
  frame: number;
  onFrame: (frame: number) => void;
  disabled: boolean;
  seekVersion: number;
  /** Direct manipulation in the monitor; omitted → view only. */
  selected?: string | undefined;
  onSelect?: TransformProps["onSelect"] | undefined;
  onTransform?: TransformProps["onTransform"] | undefined;
}) {
  const [quality, setQuality] = useState<360 | 720>(360);
  const latest = useRef(sequence);
  latest.current = sequence;
  const revision = useRef(0);
  // While dragging in the monitor, show each finished draw even if a newer edit has arrived,
  // so the picture follows the pointer instead of waiting for the drag to pause.
  const live = useRef(false);
  const canvas = useRef<HTMLCanvasElement>(null),
    current = useRef(frame),
    setter = useRef(onFrame);
  current.current = frame;
  setter.current = onFrame;
  const [playing, setPlaying] = useState(false),
    [preparing, setPreparing] = useState(false),
    [error, setError] = useState("");
  const stopRef = useRef<() => void>(() => {}),
    playRef = useRef<() => Promise<void>>(async () => {});
  const redrawRef = useRef<() => void>(() => {});
  // Draw the current frame again without stopping playback (e.g. when the scopes open).
  const refreshRef = useRef<() => void>(() => {});
  useEffect(() => {
    const controller = new AbortController(),
      session = new MediaSession(latest.current, files, controller.signal);
    const scratch = document.createElement("canvas");
    let cachedAudio: { sequence: Sequence; buffer: AudioBuffer | null } | undefined;
    let audioController: AbortController | undefined;
    let raf = 0,
      last = -1,
      drawing = false,
      source: AudioBufferSourceNode | undefined,
      context: AudioContext | undefined,
      anchor = 0,
      offset = 0,
      active = false,
      playToken = 0;
    const stop = () => {
      playToken++;
      audioController?.abort();
      audioController = undefined;
      active = false;
      source?.stop();
      source = undefined;
      if (context) void context.close().catch(() => {});
      context = undefined;
      setPlaying(false);
      setPreparing(false);
    };
    stopRef.current = stop;
    refreshRef.current = () => {
      last = -1;
    };
    redrawRef.current = () => {
      stop();
      last = -1;
      revision.current++;
      setError("");
    };
    setError("");
    setPlaying(false);
    setPreparing(false);
    const tick = () => {
      if (controller.signal.aborted) return;
      const sequence = latest.current;
      if (active) {
        const seconds =
          offset + (context ? context.currentTime - anchor : (performance.now() - anchor) / 1000);
        const next = Math.floor(seconds * sequence.fps);
        if (next >= totalFrames(sequence)) {
          stop();
          setter.current(Math.max(0, totalFrames(sequence) - 1));
        } else setter.current(next);
      }
      const wanted = current.current;
      if (!drawing && wanted !== last && canvas.current) {
        drawing = true;
        last = wanted;
        const size = dimensions(sequence, quality);
        if (scratch.width !== size.width || scratch.height !== size.height)
          Object.assign(scratch, size);
        const generation = revision.current;
        session.s = sequence;
        void session
          .draw(scratch, wanted)
          .then(() => {
            if (
              !controller.signal.aborted &&
              (generation === revision.current || live.current) &&
              (active || wanted === current.current)
            ) {
              const c = canvas.current;
              if (c) {
                if (c.width !== scratch.width) c.width = scratch.width;
                if (c.height !== scratch.height) c.height = scratch.height;
                const ctx = c.getContext("2d");
                ctx?.drawImage(scratch, 0, 0);
                // Feed the colour scopes (only while they're open; throttled inside).
                if (ctx) tapGradedFrame(ctx, 0, 0, c.width, c.height);
              }
            }
          })
          .catch((e) => {
            if (!controller.signal.aborted && generation === revision.current) {
              setError(e instanceof Error ? e.message : String(e));
              stop();
            }
          })
          .finally(() => {
            drawing = false;
          });
      }
      raf = requestAnimationFrame(tick);
    };
    playRef.current = async () => {
      stop();
      const token = playToken;
      const sequence = latest.current;
      setError("");
      setPreparing(true);
      audioController = new AbortController();
      const audioSignal = audioController.signal;
      const audioSession = new MediaSession(sequence, files, audioSignal);
      try {
        // Resume in the button's user gesture before asynchronous decoding.
        context = new AudioContext({ sampleRate: 48000 });
        await bounded(context.resume(), audioSignal);
        const audio =
          cachedAudio?.sequence === sequence ? cachedAudio.buffer : await audioSession.audio();
        audioSession.dispose();
        if (controller.signal.aborted || token !== playToken) return;
        cachedAudio = { sequence, buffer: audio };
        if (current.current >= totalFrames(sequence) - 1) setter.current(0);
        offset = current.current >= totalFrames(sequence) - 1 ? 0 : current.current / sequence.fps;
        anchor = context!.currentTime;
        if (audio) {
          source = context!.createBufferSource();
          source.buffer = audio;
          source.connect(context!.destination);
          source.start(0, offset);
        }
        active = true;
        setPreparing(false);
        setPlaying(true);
      } catch (e) {
        if (!controller.signal.aborted && token === playToken) {
          setError(e instanceof Error ? e.message : String(e));
          stop();
        }
      } finally {
        audioSession.dispose();
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      controller.abort();
      cancelAnimationFrame(raf);
      stop();
      session.dispose();
    };
  }, [files, quality]);
  useEffect(() => {
    redrawRef.current();
  }, [sequence, seekVersion]);
  useEffect(() => {
    if (disabled) stopRef.current();
  }, [disabled]);
  // The program monitor is a scope source (exports never are).
  useEffect(
    () => (canvas.current ? addScopeSource(canvas.current, () => refreshRef.current()) : undefined),
    [],
  );
  // Where the canvas is drawn inside the screen (it is letterboxed), for the overlay.
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number }>();
  useLayoutEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const measure = () =>
      setBox((old) => {
        const next = {
          left: c.offsetLeft,
          top: c.offsetTop,
          width: c.offsetWidth,
          height: c.offsetHeight,
        };
        return old &&
          old.left === next.left &&
          old.top === next.top &&
          old.width === next.width &&
          old.height === next.height
          ? old
          : next;
      });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(c);
    if (c.parentElement) observer.observe(c.parentElement);
    return () => observer.disconnect();
  }, []);
  return (
    <section className="seq-monitor">
      <div className="seq-panel-heading">
        <span>PROGRAM</span>
        <select
          aria-label="Preview quality"
          value={quality}
          disabled={disabled}
          onChange={(e) => setQuality(Number(e.target.value) as 360 | 720)}
        >
          <option value={360}>360p · Faster</option>
          <option value={720}>720p · Detail</option>
        </select>
        <span>
          {sequence.aspect} · {sequence.fps} fps
        </span>
      </div>
      <div className="seq-screen">
        <canvas ref={canvas} aria-label="Sequence program preview" />
        {onSelect && onTransform && box && box.width > 0 && sequence.items.length > 0 && (
          <div
            className="seq-xform-frame"
            style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
          >
            <TransformOverlay
              sequence={sequence}
              frame={frame}
              selected={selected}
              active={!disabled && !playing && !preparing}
              onSelect={onSelect}
              onTransform={onTransform}
              onDragging={(on) => {
                live.current = on;
              }}
            />
          </div>
        )}
        {!sequence.items.length && (
          <div className="seq-empty">
            Your sequence starts here<span>Import media, then drag it onto a track.</span>
          </div>
        )}
      </div>
      {error && (
        <p className="seq-error" role="alert">
          {error}
        </p>
      )}
      <div className="seq-transport">
        <button
          disabled={disabled || !sequence.items.length}
          onClick={() => (playing || preparing ? stopRef.current() : void playRef.current())}
        >
          {preparing ? "Cancel audio preparation" : playing ? "Pause" : "▶ Play"}
        </button>
        <span>
          {(frame / sequence.fps).toFixed(2)} / {(totalFrames(sequence) / sequence.fps).toFixed(2)}{" "}
          s
        </span>
        <span className="seq-subtle">Frame {frame}</span>
      </div>
      <input
        aria-label="Sequence playhead"
        type="range"
        min={0}
        max={Math.max(0, totalFrames(sequence) - 1)}
        step={1}
        value={Math.min(frame, Math.max(0, totalFrames(sequence) - 1))}
        disabled={disabled}
        onChange={(e) => {
          stopRef.current();
          onFrame(Number(e.target.value));
        }}
      />
    </section>
  );
}
