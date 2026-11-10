import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Film,
  HardDrive,
  Loader2,
  Replace,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { rememberMedia } from "@/lib/media-vault";
import {
  getState,
  loadSource,
  removeSource,
  setKeepMedia,
  useStore,
  type KeepState,
} from "@/lib/reelforge/store";
import { pickVideo } from "./EmptyStage";

const fmtSize = (b: number) =>
  b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1e6))} MB`;

function KeepStatus({ keep, size }: { keep: KeepState; size: number }) {
  const [icon, text, tone] =
    keep.status === "saved"
      ? [
          <Check key="i" className="h-3.5 w-3.5" />,
          `Kept in this browser (${fmtSize(size)}) — it will be back after a refresh.`,
          "text-primary",
        ]
      : keep.status === "saving"
        ? [
            <Loader2 key="i" className="h-3.5 w-3.5 animate-spin" />,
            `Keeping a copy in this browser (${fmtSize(size)})…`,
            "text-muted-foreground",
          ]
        : keep.status === "failed"
          ? [
              <AlertTriangle key="i" className="h-3.5 w-3.5" />,
              `${keep.message ?? "Not kept."} You'll need to re-select it after a refresh.`,
              "text-amber-400",
            ]
          : keep.status === "off"
            ? [
                <HardDrive key="i" className="h-3.5 w-3.5" />,
                "Not kept — you'll need to re-select it after a refresh.",
                "text-muted-foreground",
              ]
            : [
                <HardDrive key="i" className="h-3.5 w-3.5" />,
                "Not kept yet.",
                "text-muted-foreground",
              ];
  return (
    <p role="status" className={`flex gap-2 px-2 py-1.5 text-[11px] leading-snug ${tone}`}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span>{text}</span>
    </p>
  );
}

/** Header menu for the source video: replace, remove, and whether it survives a refresh. */
export function SourceMenu() {
  const source = useStore((s) => s.project.source);
  const keep = useStore((s) => s.rt.keep);
  const [remember, setRemember] = useState(true);
  useEffect(() => setRemember(rememberMedia()), []);

  const replace = () =>
    pickVideo((file) => {
      const p = getState().project;
      const same = !!p.source && p.source.name === file.name && p.source.size === file.size;
      if (
        !same &&
        p.clips.length > 0 &&
        !confirm(
          `Replace "${p.source?.name ?? "the current video"}" with "${file.name}"?\n\nClips, captions and markers made for the current video will be reset. You can't undo this.`,
        )
      )
        return;
      void loadSource(file);
    });

  const remove = () => {
    if (!source) return;
    if (
      confirm(
        `Remove "${source.name}"?\n\nIts clips, captions and markers will be cleared and the copy kept in this browser will be deleted. You can't undo this.`,
      )
    )
      removeSource();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost" aria-label="Video source options">
          <Film className="h-4 w-4" />
          Video
          {keep.status === "saved" && (
            <Check className="h-3 w-3 text-primary" aria-label="kept in this browser" />
          )}
          <ChevronDown className="h-3 w-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="truncate text-xs">
          {source?.name ?? "No video loaded"}
        </DropdownMenuLabel>
        {source && <KeepStatus keep={keep} size={source.size} />}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={replace}>
          <Replace className="h-4 w-4" />
          Replace video…
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={remove}
          disabled={!source}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
          Remove video
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          checked={remember}
          onCheckedChange={(v) => {
            setRemember(v === true);
            setKeepMedia(v === true);
          }}
          onSelect={(e) => e.preventDefault()}
        >
          Remember video after refresh
        </DropdownMenuCheckboxItem>
        <p className="px-2 pb-1.5 text-[10.5px] leading-snug text-muted-foreground">
          The copy is stored only in this browser on this device — never uploaded. It uses disk
          space until you remove the video or turn this off (which also clears Sequence Studio
          media).
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
