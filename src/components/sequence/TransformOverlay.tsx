import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { type Prop, propAt } from "@/lib/sequence/keyframes";
import { type Item, type Sequence, assetOf, clipRect, dimensions } from "@/lib/sequence/model";
import { canTransform, hitTest, scaleFromDrag, snapMove } from "@/lib/sequence/transform";

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

interface Drag {
  mode: "move" | "scale";
  id: string;
  pointer: number;
  from: { x: number; y: number };
  x: number;
  y: number;
  scale: number;
  size: { w: number; h: number };
  gesture: string;
  moved: boolean;
}

/** Snap distance on screen, in CSS pixels. */
const SNAP_PX = 8;
const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;

/**
 * Direct manipulation on the program monitor: click the picture to select the clip on top,
 * drag to move it, drag a corner to scale it around its centre. Snaps to the frame's centre and
 * edges (hold Alt to move freely). Arrow keys nudge the selected clip; + and − scale it.
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
  // Canvas units: any frame size gives the same fractions; 1080 keeps numbers readable.
  const { width: W, height: H } = dimensions(sequence, 1080);
  const clip = sequence.items.find((c) => c.id === selected);
  const editable = active && canTransform(sequence, clip, frame);
  const rect = editable ? clipRect(sequence, clip!, frame, W, H) : null;

  const toCanvas = (e: { clientX: number; clientY: number }) => {
    const r = root.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / Math.max(1, r.width)) * W,
      y: ((e.clientY - r.top) / Math.max(1, r.height)) * H,
      perPx: W / Math.max(1, r.width),
    };
  };

  const start = (e: PointerEvent<HTMLDivElement>, mode: Drag["mode"], c: Item) => {
    const r = clipRect(sequence, c, frame, W, H);
    drag.current = {
      mode,
      id: c.id,
      pointer: e.pointerId,
      from: toCanvas(e),
      x: propAt(c, "x", frame),
      y: propAt(c, "y", frame),
      scale: propAt(c, "scale", frame),
      size: { w: r.w, h: r.h },
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
    const handle = (e.target as HTMLElement).closest("[data-handle]");
    if (handle && editable) return start(e, "scale", clip!);
    const p = toCanvas(e);
    // A click picks what you see: the topmost clip under the pointer. (A clip hidden under
    // another layer is still moved with its corner handles, the arrow keys or the inspector.)
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
    if (d.mode === "move") {
      const s = snapMove(
        d.x * W + (p.x - d.from.x),
        d.y * H + (p.y - d.from.y),
        d.size.w,
        d.size.h,
        W,
        H,
        SNAP_PX * p.perPx,
        snap,
      );
      setGuides({ x: s.guidesX, y: s.guidesY });
      setReadout(`X ${pct(s.x)} · Y ${pct(s.y)}`);
      onTransform(d.id, frame, { x: s.x, y: s.y }, d.gesture);
    } else {
      const scale = scaleFromDrag(d.scale, { x: d.x * W, y: d.y * H }, d.from, p, snap);
      setReadout(`Scale ${pct(scale)}`);
      onTransform(d.id, frame, { scale }, d.gesture);
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
      scale = propAt(clip!, "scale", frame);
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
                  : null;
    if (!values) return;
    e.preventDefault();
    onTransform(clip!.id, frame, values, `keys:${clip!.id}`);
  };

  const at = (v: number, extent: number) => `${(v / extent) * 100}%`;
  return (
    <div
      ref={root}
      className={`seq-xform ${active ? "" : "inactive"}`}
      tabIndex={editable ? 0 : -1}
      role="group"
      aria-label={
        editable
          ? `Move ${assetOf(sequence, clip!).name}: drag to move, drag a corner to scale, arrow keys nudge, + and − scale. Hold Alt to move without snapping.`
          : "Program monitor: click a clip to select it"
      }
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={onKeyDown}
    >
      {rect && (
        <div
          className="seq-xform-box"
          data-testid="transform-box"
          style={{
            left: at(rect.x, W),
            top: at(rect.y, H),
            width: at(rect.w, W),
            height: at(rect.h, H),
          }}
        >
          {(["nw", "ne", "sw", "se"] as const).map((corner) => (
            <span
              key={corner}
              data-handle={corner}
              className={`seq-xform-handle ${corner}`}
              aria-hidden="true"
            />
          ))}
        </div>
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
