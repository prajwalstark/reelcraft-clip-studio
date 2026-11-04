import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Film, FlaskConical, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { loadSource, useStore } from "@/lib/reelforge/store";
import { generateDemoVideo } from "@/lib/reelforge/demo";

const Stage3D = lazy(() => import("./Stage3D"));

function hasWebGL() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

export function pickVideo(onFile: (f: File) => void) {
  const i = document.createElement("input");
  i.type = "file";
  i.accept = "video/*,.mp4,.mov,.webm,.mkv,.m4v";
  i.onchange = () => i.files?.[0] && onFile(i.files[0]);
  i.click();
}

export function EmptyStage({ relink }: { relink?: boolean }) {
  const [gl, setGl] = useState<boolean | null>(null);
  const [reduced, setReduced] = useState(false);
  const [demo, setDemo] = useState<number | null>(null);
  const [over, setOver] = useState(false);
  const loading = useStore((s) => s.rt.loading);
  const sourceError = useStore((s) => s.rt.sourceError);
  const source = useStore((s) => s.project.source);
  const par = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setGl(hasWebGL());
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const f = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", f);
    return () => mq.removeEventListener("change", f);
  }, []);

  const onMove = (e: React.PointerEvent) => {
    if (reduced || !par.current) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    par.current.style.transform = `translate3d(${x * -14}px, ${y * -10}px, 0)`;
  };

  return (
    <div
      className="relative flex h-full w-full flex-col items-center justify-center overflow-hidden stage-bg"
      onPointerMove={onMove}
      onDragOver={(e) => (e.preventDefault(), setOver(true))}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) void loadSource(f);
      }}
    >
      <div className="absolute inset-0" aria-hidden>
        {gl ? (
          <Suspense fallback={null}>
            <Stage3D reduced={reduced} />
          </Suspense>
        ) : gl === false ? (
          <div className="flex h-full items-center justify-center gap-4 opacity-70" data-scene-ready="fallback">
            {[0, 1, 2].map((i) => (
              <div key={i} className="tilt-card glass h-56 w-32 rounded-xl" />
            ))}
          </div>
        ) : null}
      </div>

      <div ref={par} className="relative z-10 flex max-w-md flex-col items-center text-center transition-transform duration-300 ease-out">
        <h1 className="font-display text-5xl leading-none tracking-tight md:text-6xl">
          {relink ? "Relink your source" : <>Cut long video<br /><em className="text-primary">into shorts.</em></>}
        </h1>
        <p className="mt-4 text-sm text-muted-foreground">
          {relink && source
            ? `Your clips and captions were saved, but browsers can't keep local video files. Re-select "${source.name}" to continue.`
            : "Drop a video. It stays on this device — nothing is uploaded."}
        </p>
        <div
          className={`glass mt-7 flex w-full flex-col items-center gap-3 rounded-2xl px-6 py-6 transition ${over ? "shadow-glow" : ""}`}
        >
          <Button variant="glow" size="lg" disabled={loading} onClick={() => pickVideo((f) => void loadSource(f))}>
            {loading ? <Loader2 className="animate-spin" /> : <Upload />}
            {relink ? "Select source file" : "Choose video"}
          </Button>
          <span className="text-xs text-muted-foreground">or drag & drop · MP4, MOV, WebM</span>
          {sourceError && <p role="alert" className="text-xs text-destructive">{sourceError}</p>}
        </div>
        {!relink && (
          <button
            className="mt-5 inline-flex items-center gap-1.5 rounded-full border border-dashed px-3 py-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-60"
            disabled={demo !== null}
            onClick={async () => {
              setDemo(0);
              try {
                const f = await generateDemoVideo(12, (p) => setDemo(p));
                await loadSource(f);
              } finally {
                setDemo(null);
              }
            }}
          >
            <FlaskConical className="size-3" />
            {demo === null ? "Optional demo: generate a 12s synthetic test video" : `Recording demo… ${Math.round(demo * 100)}%`}
          </button>
        )}
      </div>
      <Film className="absolute bottom-4 right-4 size-4 text-muted-foreground/40" aria-hidden />
    </div>
  );
}
