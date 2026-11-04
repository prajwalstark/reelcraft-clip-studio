import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { EmptyStage } from "@/components/reelforge/EmptyStage";
import { hydrate, sourceMissing, useStore } from "@/lib/reelforge/store";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "ReelForge — Long video to shorts editor" },
      { name: "description", content: "Local-first editor that splits long videos into vertical shorts and Reels." },
      { property: "og:title", content: "ReelForge — Long video to shorts editor" },
      { property: "og:description", content: "Split, crop, caption and export shorts in your browser." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

function Index() {
  useEffect(() => hydrate(), []);
  const missing = useStore((s) => sourceMissing(s));
  const clips = useStore((s) => s.project.clips);
  const url = useStore((s) => s.rt.url);
  return (
    <main className="grain h-screen w-screen">
      {!url ? (
        <EmptyStage relink={missing} />
      ) : (
        <div className="flex h-full items-center justify-center stage-bg p-8 text-center">
          <p className="text-sm text-muted-foreground">
            Source loaded · {clips.length} clips created by duration. The full editor panels are still being built.
          </p>
        </div>
      )}
    </main>
  );
}
