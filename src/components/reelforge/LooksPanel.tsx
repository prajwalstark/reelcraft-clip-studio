import { useEffect, useState } from "react";
import { AlertTriangle, Palette, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { Clip } from "@/lib/reelforge/core";
import { gradeOf } from "@/lib/reelforge/editing";
import { lookGpuError } from "@/lib/reelforge/grading/gpu";
import {
  deleteLook,
  describeLook,
  getLook,
  importLook,
  useLooks,
} from "@/lib/reelforge/grading/library";
import { LOOK_ACCEPT } from "@/lib/reelforge/grading/looks";
import { commit, updateClip } from "@/lib/reelforge/store";

const field = "w-full rounded border bg-background p-2 text-xs";

function pickLookFile(onFile: (f: File) => void) {
  const i = document.createElement("input");
  i.type = "file";
  i.accept = LOOK_ACCEPT;
  i.onchange = () => i.files?.[0] && onFile(i.files[0]);
  i.click();
}

/** Imported looks (LUT / CDL) for the selected clip: choose, mix, import, share across clips. */
export function LooksPanel({ clip }: { clip: Clip }) {
  const looks = useLooks();
  const grade = gradeOf(clip);
  const current = grade ? getLook(grade.lookId) : null;
  const missing = !!grade && !current;
  const [gpuError, setGpuError] = useState<string | null>(null);
  useEffect(() => setGpuError(lookGpuError()), []);

  const setGrade = (lookId: string | null, intensity = grade?.intensity ?? 1) =>
    updateClip(clip.id, { grade: lookId ? { lookId, intensity } : undefined }, `grade-${clip.id}`);

  const onImport = () =>
    pickLookFile(async (file) => {
      try {
        const look = await importLook(file);
        setGrade(look.id, 1);
        toast.success(
          `Imported "${look.name}" (${describeLook(look)}) and applied it to this clip.`,
        );
      } catch (e) {
        toast.error(`${file.name}: ${(e as Error).message}`);
      }
    });

  const applyToAll = () => {
    if (!grade) return;
    commit((p) => ({ ...p, clips: p.clips.map((c) => ({ ...c, grade: { ...grade } })) }));
    toast.success("Applied this look to every clip.");
  };

  const removeFromLibrary = () => {
    if (!current) return;
    if (
      !confirm(
        `Delete "${current.name}" from your looks library? Clips in this project that use it will go back to no look.`,
      )
    )
      return;
    commit((p) => ({
      ...p,
      clips: p.clips.map((c) => (c.grade?.lookId === current.id ? { ...c, grade: undefined } : c)),
    }));
    void deleteLook(current.id);
  };

  return (
    <section
      aria-labelledby="looks-title"
      className="space-y-3 rounded-lg border border-primary/25 bg-primary/[0.04] p-3"
    >
      <h3 id="looks-title" className="flex items-center gap-1.5 text-xs font-semibold">
        <Palette className="h-3.5 w-3.5 text-primary" />
        Looks · LUT &amp; CDL
      </h3>

      {gpuError && (
        <p role="alert" className="flex gap-1.5 text-[11px] text-amber-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {gpuError} Looks can't be previewed or exported in this browser.
        </p>
      )}

      <label className="block text-xs">
        Look
        <select
          aria-label="Look"
          className={field}
          value={missing ? "__missing" : (grade?.lookId ?? "")}
          onChange={(e) => setGrade(e.target.value || null)}
        >
          <option value="">None</option>
          {missing && <option value="__missing">Missing look — re-import it</option>}
          {looks.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name} · {describeLook(l)}
            </option>
          ))}
        </select>
      </label>

      {missing && (
        <p role="alert" className="text-[11px] text-amber-400">
          This clip uses a look that isn't in this browser's library (projects store which look, not
          the file). Re-import it, or choose None — exports are blocked until then so the grade
          isn't silently dropped.
        </p>
      )}

      <label className="block text-xs">
        <span className="flex justify-between">
          <span>Intensity</span>
          <span className="tc text-muted-foreground">
            {Math.round((grade?.intensity ?? 1) * 100)}%
          </span>
        </span>
        <input
          aria-label="Look intensity"
          type="range"
          min={0}
          max={100}
          step={1}
          disabled={!current}
          value={Math.round((grade?.intensity ?? 1) * 100)}
          onChange={(e) => grade && setGrade(grade.lookId, Number(e.target.value) / 100)}
          className="w-full accent-[var(--color-primary)]"
        />
      </label>

      <div className="flex flex-wrap gap-1">
        <Button size="sm" onClick={onImport}>
          <Upload className="h-3.5 w-3.5" />
          Import look…
        </Button>
        <Button size="sm" variant="secondary" disabled={!current} onClick={applyToAll}>
          Apply to all clips
        </Button>
        <Button size="sm" variant="ghost" disabled={!current} onClick={removeFromLibrary}>
          <Trash2 className="h-3.5 w-3.5" />
          Delete look
        </Button>
      </div>

      <details className="text-[11px] leading-relaxed text-muted-foreground">
        <summary className="cursor-pointer text-foreground/80">
          Bring looks from DaVinci Resolve or Premiere Pro
        </summary>
        <ul className="mt-1.5 list-disc space-y-1 pl-4">
          <li>
            <strong>DaVinci Resolve:</strong> on the Color page, right-click a clip's thumbnail →{" "}
            <em>Generate LUT</em> → 33 or 65 Point Cube, then import the <code>.cube</code>.
          </li>
          <li>
            <strong>Premiere Pro:</strong> in the Lumetri Color panel menu choose{" "}
            <em>Export .cube</em>, then import it.
          </li>
          <li>
            Also supported: <code>.3dl</code> LUTs and ASC CDL (<code>.cdl</code>, <code>.cc</code>,{" "}
            <code>.ccc</code>). Resolve <code>.drx</code> and Premiere <code>.prfpset</code> presets
            can't be read — export a .cube instead.
          </li>
          <li>
            A LUT carries the colour transform only — masks, qualifiers, noise reduction and blur
            from the original grade don't come across.
          </li>
          <li>
            Match the LUT to your footage: most expect normal (Rec.709) video; camera LUTs (S-Log3,
            Apple Log…) only suit footage shot in that log format.
          </li>
          <li>
            Looks are kept in this browser. Projects remember which look a clip uses; on another
            browser, re-import it.
          </li>
        </ul>
      </details>
    </section>
  );
}
