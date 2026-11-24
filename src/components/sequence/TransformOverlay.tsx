import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { type Prop, propAt } from "@/lib/sequence/keyframes";
import {
  type Item,
  type Placement,
  type Sequence,
  assetOf,
  bounds,
  dimensions,
  placement,
} from "@/lib/sequence/model";
import {
  CROP_PROP,
  type Edge,
  canTransform,
  cropFromDrag,
  hitTest,
  rotateFromDrag,
  scaleFromDrag,
  snapMove,
} from "@/lib/sequence/transform";

export type TransformValues = Partial<Record<Prop, number>>;
export interface TransformProps {
  sequence: Sequence;
  frame: number;
  selected: string | undefined;
  /** Hidden while playing or while the editor is busy. */
  active: boolean;
  onSelect: (c: Item) => void;
  /** `gesture` is the same for every update of one drag, so the editor can undo it as one step. */
  onTransform: (id: string, frame: number, values: TransformValues, gesture: string) => void;
  onDragging: (dragging: boolean) => void;
}

type Mode = "move" | "scale" | "rotate" | Edge;
interface Drag {
  mode: Mode;
  id: string;
  pointer: number;
  from: { x: number; y: number };
  at: Placement;
  scale: number;
  gesture: string;
  moved: boolean;
}

/** Snap distance on screen, in CSS pixels. */
const SNAP_PX = 8;
const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;
const deg = (v: number) => `${Math.round(v * 10) / 10}°`;
const EDGES: Edge[] = ["left", "right", "top", "bottom"];

/**
 * Direct manipulation on the program monitor: click the picture to select the clip on top,
 * drag to move it, drag a corner to scale it, drag the knob above it to rotate, and in Crop
 * mode drag an edge to crop. Moves snap to the frame's centre and edges, rotation to 90° (Shift:
 * 15° steps); hold Alt for free movement. Keys: arrows nudge, + / − scale, [ / ] rotate.
 */
export function TransformOverlay({
  sequence,
  frame,
  selected,
  active,
  onSelect,
  onTransform,
  onDragging,
}: TransformProps) {
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [guides, setGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] });
  const [readout, setReadout] = useState("");
  const [cropping, setCropping] = useState(false);
  // Canvas units: any frame size gives the same fractions; 1080 keeps numbers readable.
  const { width: W, height: H } = dimensions(sequence, 1080);
  const clip = sequence.items.find((c) => c.id === selected);
  const editable = active && canTransform(sequence, clip, frame);
  const pl = editable ? placement(sequence, clip!, frame, W, H) : null;

  const toCanvas = (e: { clientX: number; clientY: number }) => {
    const r = root.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / Math.max(1, r.width)) * W,
      y: ((e.clientY - r.top) / Math.max(1, r.height)) * H,
      perPx: W / Math.max(1, r.width),
    };
  };

  const start = (e: PointerEvent<HTMLDivElement>, mode: Mode, c: Item) => {
    drag.current = {
      mode,
      id: c.id,
      pointer: e.pointerId,
      from: toCanvas(e),
      at: placement(sequence, c, frame, W, H),
      scale: propAt(c, "scale", frame),
      gesture: `drag:${mode}:${c.id}:${Date.now()}`,
      moved: false,
    };
    root.current?.setPointerCapture?.(e.pointerId);
    onDragging(true);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!active || e.button !== 0) return;
    e.preventDefault();
    root.current?.focus({ preventScroll: true });
    const handle = (e.target as HTMLElement).closest<HTMLElement>("[data-handle]")?.dataset[
      "handle"
    ];
    if (handle && editable) {
      const mode: Mode =
        handle === "rotate"
          ? "rotate"
          : handle.startsWith("crop-")
            ? (handle.slice(5) as Edge)
            : "scale";
      return start(e, mode, clip!);
    }
    const p = toCanvas(e);
    // A click picks what you see: the topmost clip under the pointer. (A clip hidden under
    // another layer is still moved with its handles, the arrow keys or the inspector.)
    const target = hitTest(sequence, frame, W, H, p.x, p.y);
    if (!target) return;
    if (target.id !== selected) onSelect(target);
    if (canTransform(sequence, target, frame)) start(e, "move", target);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointer) return;
    const p = toCanvas(e);
    const snap = !e.altKey;
    if (!d.moved && Math.hypot(p.x - d.from.x, p.y - d.from.y) < p.perPx * 2) return;
    d.moved = true;
    const anchor = { x: d.at.cx, y: d.at.cy };
    if (d.mode === "move") {
      const dx = p.x - d.from.x,
        dy = p.y - d.from.y;
      const b = bounds(d.at);
      const s = snapMove(
        { x: b.x + dx, y: b.y + dy, w: b.w, h: b.h },
        W,
        H,
        SNAP_PX * p.perPx,
        snap,
      );
      const x = Math.min(1, Math.max(0, (anchor.x + dx + s.dx) / W)),
        y = Math.min(1, Math.max(0, (anchor.y + dy + s.dy) / H));
      setGuides({ x: s.guidesX, y: s.guidesY });
      setReadout(`X ${pct(x)} · Y ${pct(y)}`);
      onTransform(d.id, frame, { x, y }, d.gesture);
    } else if (d.mode === "scale") {
      const scale = scaleFromDrag(d.scale, anchor, d.from, p, snap);
      setReadout(`Scale ${pct(scale)}`);
      onTransform(d.id, frame, { scale }, d.gesture);
    } else if (d.mode === "rotate") {
      const rotation = rotateFromDrag(d.at.rotation, anchor, d.from, p, {
        snap,
        step: e.shiftKey ? 15 : 0,
      });
      setReadout(`Rotation ${deg(rotation)}`);
      onTransform(d.id, frame, { rotation }, d.gesture);
    } else {
      const v = cropFromDrag(d.at, d.mode, d.at.crop, d.from, p);
      setReadout(`Crop ${d.mode} ${pct(v)}`);
      onTransform(d.id, frame, { [CROP_PROP[d.mode]]: v }, d.gesture);
    }
  };

  const end = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointer) return;
    drag.current = null;
    root.current?.releasePointerCapture?.(e.pointerId);
    setGuides({ x: [], y: [] });
    setReadout("");
    onDragging(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!editable) return;
    const step = e.shiftKey ? 0.05 : 0.005;
    const x = propAt(clip!, "x", frame),
      y = propAt(clip!, "y", frame),
      scale = propAt(clip!, "scale", frame),
      rotation = propAt(clip!, "rotation", frame);
    const turn = e.shiftKey ? 15 : 1;
    const values: TransformValues | null =
      e.key === "ArrowLeft"
        ? { x: x - step }
        : e.key === "ArrowRight"
          ? { x: x + step }
          : e.key === "ArrowUp"
            ? { y: y - step }
            : e.key === "ArrowDown"
              ? { y: y + step }
              : e.key === "+" || e.key === "="
                ? { scale: scale * (e.shiftKey ? 1.1 : 1.02) }
                : e.key === "-" || e.key === "_"
                  ? { scale: scale / (e.shiftKey ? 1.1 : 1.02) }
                  : e.key === "[" || e.key === "{"
                    ? { rotation: rotation - turn }
                    : e.key === "]" || e.key === "}"
                      ? { rotation: rotation + turn }
                      : null;
    if (!values) return;
    e.preventDefault();
    onTransform(clip!.id, frame, values, `keys:${clip!.id}`);
  };

  const at = (v: number, extent: number) => `${(v / extent) * 100}%`;
  // A rotated box: positioned by its unrotated rectangle, turned about the clip's position.
  const boxStyle = (r: { x: number; y: number; w: number; h: number }, p: Placement) => ({
    left: at(p.cx + r.x, W),
    top: at(p.cy + r.y, H),
    width: at(r.w, W),
    height: at(r.h, H),
    transform: p.rotation ? `rotate(${p.rotation}deg)` : undefined,
    transformOrigin: `${(-r.x / r.w) * 100}% ${(-r.y / r.h) * 100}%`,
  });
  return (
    <div
      ref={root}
      className={`seq-xform ${active ? "" : "inactive"}`}
      tabIndex={editable ? 0 : -1}
      role="group"
      aria-label={
        editable
          ? `Move ${assetOf(sequence, clip!).name}: drag to move, drag a corner to scale, drag the knob to rotate${cropping ? ", drag an edge to crop" : ""}. Arrow keys nudge, + and − scale, [ and ] rotate. Hold Alt to move without snapping.`
          : "Program monitor: click a clip to select it"
      }
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={onKeyDown}
    >
      {pl && cropping && (
        <div
          className="seq-xform-full"
          aria-hidden="true"
          style={boxStyle({ x: -pl.w / 2, y: -pl.h / 2, w: pl.w, h: pl.h }, pl)}
        />
      )}
      {pl && (
        <div
          className={`seq-xform-box ${cropping ? "cropping" : ""}`}
          data-testid="transform-box"
          style={boxStyle(pl.visible, pl)}
        >
          {(["nw", "ne", "sw", "se"] as const).map((corner) => (
            <span
              key={corner}
              data-handle={corner}
              className={`seq-xform-handle ${corner}`}
              aria-hidden="true"
            />
          ))}
          <span data-handle="rotate" className="seq-xform-rotate" aria-hidden="true" />
          {cropping &&
            EDGES.map((edge) => (
              <span
                key={edge}
                data-handle={`crop-${edge}`}
                className={`seq-xform-crop ${edge}`}
                aria-hidden="true"
              />
            ))}
        </div>
      )}
      {editable && (
        <button
          type="button"
          className="seq-xform-mode"
          aria-pressed={cropping}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setCropping((v) => !v)}
        >
          {cropping ? "Done cropping" : "Crop"}
        </button>
      )}
      {guides.x.map((g) => (
        <i key={`x${g}`} className="seq-guide v" style={{ left: at(g, W) }} />
      ))}
      {guides.y.map((g) => (
        <i key={`y${g}`} className="seq-guide h" style={{ top: at(g, H) }} />
      ))}
      {readout && (
        <span className="seq-xform-readout" aria-live="polite">
          {readout}
        </span>
      )}
    </div>
  );
}
