import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { EmptyStage } from "@/components/reelforge/EmptyStage";
import { Editor } from "@/components/reelforge/Editor";
import { Toaster } from "@/components/ui/sonner";
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
  const url = useStore((s) => s.rt.url);
  return (
    <main className="grain h-screen w-screen">
      {!url ? (
        <EmptyStage relink={missing} />
      ) : (
        <Editor />
      )}
      <Toaster theme="dark" />
    </main>
  );
}
