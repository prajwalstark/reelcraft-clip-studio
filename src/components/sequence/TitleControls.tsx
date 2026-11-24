import { type Ref, useId } from "react";
import {
  ANIMS,
  FONTS,
  LIMITS,
  MAX_TEXT,
  PRESETS,
  type Align,
  type AnimType,
  type Title,
} from "@/lib/sequence/titles";

/**
 * Inspector controls for a title clip. `onChange` receives the changed fields and a key, so
 * typing or dragging a slider coalesces into one undo step.
 */
export function TitleControls({
  title,
  onChange,
  onPreset,
  textRef,
  onApplyToCaptions,
}: {
  title: Title;
  onChange: (patch: Partial<Title>, key: string) => void;
  onPreset: (preset: (typeof PRESETS)[number]) => void;
  textRef?: Ref<HTMLTextAreaElement> | undefined;
  /** For auto-captions: give every caption this look, position and animation. */
  onApplyToCaptions?: (() => void) | undefined;
}) {
  const id = useId();
  const slider = (
    label: string,
    k: keyof typeof LIMITS,
    unit: number,
    suffix: string,
    disabled = false,
  ) => {
    const [lo, hi] = LIMITS[k];
    return (
      <label className="seq-field seq-slider">
        <span>
          {label}
          <output>
            {Math.round(title[k] * unit * 10) / 10}
            {suffix}
          </output>
        </span>
        <input
          type="range"
          min={lo * unit}
          max={hi * unit}
          step={unit >= 100 ? 0.5 : 0.05}
          value={title[k] * unit}
          disabled={disabled}
          onChange={(e) => onChange({ [k]: Number(e.target.value) / unit }, k)}
        />
      </label>
    );
  };
  return (
    <fieldset className="seq-title" aria-labelledby={`${id}-h`}>
      <h3 id={`${id}-h`}>Title</h3>
      <label className="seq-field">
        Text
        <textarea
          ref={textRef}
          value={title.text}
          maxLength={MAX_TEXT}
          rows={3}
          spellCheck
          onChange={(e) => onChange({ text: e.target.value }, "text")}
        />
      </label>
      {title.caption && onApplyToCaptions && (
        <button type="button" className="seq-apply-captions" onClick={onApplyToCaptions}>
          Apply this style to all captions
        </button>
      )}
      <div className="seq-actions seq-title-presets" role="group" aria-label="Title presets">
        {PRESETS.map((p) => (
          <button key={p.id} type="button" onClick={() => onPreset(p)}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="seq-field-pair">
        <label className="seq-field">
          Font
          <select
            value={title.font}
            onChange={(e) => onChange({ font: e.target.value as Title["font"] }, "font")}
          >
            {FONTS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <label className="seq-field">
          Weight
          <select
            value={title.weight}
            onChange={(e) =>
              onChange({ weight: Number(e.target.value) as Title["weight"] }, "weight")
            }
          >
            <option value={400}>Regular</option>
            <option value={700}>Bold</option>
            <option value={800}>Heavy</option>
          </select>
        </label>
      </div>
      {slider("Size", "size", 100, "% of height")}
      <div className="seq-field-pair">
        <label className="seq-field">
          Colour
          <input
            type="color"
            value={title.color}
            onChange={(e) => onChange({ color: e.target.value }, "color")}
          />
        </label>
        <div className="seq-field">
          Align
          <div className="seq-segmented" role="group" aria-label="Text alignment">
            {(["left", "center", "right"] as Align[]).map((a) => (
              <button
                key={a}
                type="button"
                aria-pressed={title.align === a}
                aria-label={`Align ${a}`}
                onClick={() => onChange({ align: a }, "align")}
              >
                {a === "left" ? "⇤" : a === "center" ? "↔" : "⇥"}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="seq-checks">
        <label>
          <input
            type="checkbox"
            checked={title.italic}
            onChange={(e) => onChange({ italic: e.target.checked }, "italic")}
          />
          Italic
        </label>
        <label>
          <input
            type="checkbox"
            checked={title.shadow}
            onChange={(e) => onChange({ shadow: e.target.checked }, "shadow")}
          />
          Shadow
        </label>
        <label>
          <input
            type="checkbox"
            checked={title.background !== null}
            onChange={(e) =>
              onChange({ background: e.target.checked ? "#0b0d12" : null }, "background")
            }
          />
          Background box
        </label>
      </div>
      {slider("Line spacing", "lineHeight", 1, "×")}
      <div className="seq-field-pair">
        {slider("Outline", "outline", 100, "%")}
        <label className="seq-field">
          Outline colour
          <input
            type="color"
            value={title.outlineColor}
            disabled={title.outline === 0}
            onChange={(e) => onChange({ outlineColor: e.target.value }, "outlineColor")}
          />
        </label>
      </div>
      {title.background !== null && (
        <div className="seq-field-pair">
          <label className="seq-field">
            Box colour
            <input
              type="color"
              value={title.background}
              onChange={(e) => onChange({ background: e.target.value }, "background")}
            />
          </label>
          {slider("Box opacity", "backgroundOpacity", 100, "%")}
        </div>
      )}
      <div className="seq-title-anims" role="group" aria-label="Title animation">
        <h3>Animation</h3>
        {(["animIn", "animOut"] as const).map((k) => {
          const a = title[k];
          const name = k === "animIn" ? "In" : "Out";
          return (
            <div key={k} className="seq-field-pair">
              <label className="seq-field">
                {name}
                <select
                  aria-label={`${name} animation`}
                  value={a?.type ?? ""}
                  onChange={(e) =>
                    onChange(
                      {
                        [k]: e.target.value
                          ? { type: e.target.value as AnimType, duration: a?.duration ?? 0.5 }
                          : undefined,
                      },
                      k,
                    )
                  }
                >
                  <option value="">None</option>
                  {ANIMS.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="seq-field seq-slider">
                <span>
                  {name} time
                  <output>{a ? `${a.duration.toFixed(2)} s` : "—"}</output>
                </span>
                <input
                  type="range"
                  aria-label={`${name} animation duration (seconds)`}
                  min={0.1}
                  max={3}
                  step={0.05}
                  disabled={!a}
                  value={a?.duration ?? 0.5}
                  onChange={(e) =>
                    a && onChange({ [k]: { ...a, duration: Number(e.target.value) } }, `${k}-d`)
                  }
                />
              </label>
            </div>
          );
        })}
        <p className="seq-subtle">
          Out plays the same motion in reverse at the end of the clip. Play or scrub to preview;
          fades and keyframes still apply on top.
        </p>
      </div>
      <p className="seq-subtle">
        Instrument Sans, Instrument Serif and JetBrains Mono look the same on every device; the
        system fonts depend on the computer that exports.
      </p>
    </fieldset>
  );
}
