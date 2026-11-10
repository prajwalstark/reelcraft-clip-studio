import { createFileRoute } from "@tanstack/react-router";
import { Landing } from "@/components/landing/Landing";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ReelForge — One film. Endless reels." },
      {
        name: "description",
        content:
          "Turn long-form video into vertical shorts. Split, trim, crop, caption and export — entirely in your browser.",
      },
      { property: "og:title", content: "ReelForge — One film. Endless reels." },
      {
        property: "og:description",
        content: "A local-first studio that turns one long video into a stack of vertical reels.",
      },
      { property: "og:type", content: "website" },
      { property: "og:image", content: "/media/hero-end.jpg" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "theme-color", content: "#040406" },
    ],
    links: [{ rel: "preload", href: "/media/hero-poster.jpg", as: "image" }],
  }),
  component: Landing,
});
