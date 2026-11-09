import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState } from "react";
import { EmptyStage } from "@/components/reelforge/EmptyStage";
import { Editor } from "@/components/reelforge/Editor";
import { Toaster } from "@/components/ui/sonner";
import { hydrate, sourceMissing, useStore } from "@/lib/reelforge/store";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "ReelForge — Long video to shorts editor" },
      {
        name: "description",
        content: "Local-first editor that splits long videos into vertical shorts and Reels.",
      },
      { property: "og:title", content: "ReelForge — Long video to shorts editor" },
      {
        property: "og:description",
        content: "Split, crop, caption and export shorts in your browser.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

const SequenceStudio = lazy(() => import("@/components/sequence/SequenceStudio"));

function Index() {
  const [sequenceOpened, setSequenceOpened] = useState(false);
  const [workspace, setWorkspace] = useState<"shorts" | "sequence">("shorts");
  useEffect(() => hydrate(), []);
  const missing = useStore((s) => sourceMissing(s));
  const url = useStore((s) => s.rt.url);
  return (
    <main className="grain h-screen w-screen flex flex-col overflow-hidden">
      <nav
        aria-label="Editor workspace"
        className="flex shrink-0 items-center gap-2 border-b border-white/10 bg-[#101218] px-4 py-2 text-xs"
      >
        <button
          className="rounded px-3 py-1.5 aria-pressed:bg-white/10"
          aria-pressed={workspace === "shorts"}
          onClick={() => setWorkspace("shorts")}
        >
          Shorts editor
        </button>
        <button
          className="rounded px-3 py-1.5 aria-pressed:bg-white/10"
          aria-pressed={workspace === "sequence"}
          onClick={() => {
            setSequenceOpened(true);
            setWorkspace("sequence");
          }}
        >
          Sequence Studio · Beta
        </button>
      </nav>
      <div className="min-h-0 flex-1 overflow-auto">
        {sequenceOpened && (
          <div hidden={workspace !== "sequence"}>
            <Suspense fallback={<p className="p-8">Loading Sequence Studio…</p>}>
              <SequenceStudio active={workspace === "sequence"} />
            </Suspense>
          </div>
        )}
        {workspace === "shorts" && <>{!url ? <EmptyStage relink={missing} /> : <Editor />}</>}
      </div>
      <Toaster theme="dark" />
    </main>
  );
}
