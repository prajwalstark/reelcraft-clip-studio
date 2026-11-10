// The user's library of imported looks, kept in this browser (IndexedDB) — separate from kept
// media, so clearing media never deletes looks. Projects store only the look id + intensity.
import { useSyncExternalStore } from "react";
import type { Clip } from "../core";
import { lookGpuError, lookRenderer } from "./gpu";
import { parseLookFile, type Look } from "./looks";

const DB = "reelcraft-looks";
const STORE = "looks";
export const MAX_LOOK_FILE_BYTES = 20e6;

let looks: Look[] = [];
/** Looks deleted this session stay resolvable so already-queued exports still render them. */
const retired = new Map<string, Look>();
let loaded: Promise<void> | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export const getLooks = () => looks;
export const getLook = (id: string | null | undefined) =>
  id ? (looks.find((l) => l.id === id) ?? retired.get(id) ?? null) : null;
export function useLooks() {
  return useSyncExternalStore(
    (f) => (subs.add(f), () => subs.delete(f)),
    () => looks,
    () => looks,
  );
}

let dbPromise: Promise<IDBDatabase> | null = null;
function db() {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB unavailable"));
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Could not open the looks library"));
  }).catch((e) => {
    dbPromise = null;
    throw e;
  });
  return dbPromise;
}
async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>) {
  const d = await db();
  return new Promise<T>((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const req = run(t.objectStore(STORE));
    let result: T;
    req.onsuccess = () => (result = req.result);
    t.oncomplete = () => resolve(result);
    t.onabort = t.onerror = () => reject(t.error ?? req.error ?? new Error("Looks library failed"));
  });
}

/** Load the library once per page. Failure leaves an empty (session-only) library. */
export function loadLooks() {
  loaded ??= tx<Look[]>("readonly", (s) => s.getAll())
    .then((rows) => {
      looks = rows.sort((a, b) => a.addedAt - b.addedAt);
      emit();
    })
    .catch(() => {});
  return loaded;
}

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/** Parse and add a look file. Throws a readable error for unsupported or malformed files. */
export async function importLook(file: File): Promise<Look> {
  if (file.size > MAX_LOOK_FILE_BYTES)
    throw new Error("That file is too large to be a look (max 20 MB).");
  const { transform, title } = parseLookFile(file.name, await file.text());
  const look: Look = {
    id: uid(),
    name: (title || file.name.replace(/\.[^.]+$/, "")).slice(0, 80),
    file: file.name,
    transform,
    addedAt: Date.now(),
  };
  looks = [...looks, look];
  emit();
  try {
    await tx("readwrite", (s) => s.put(look));
  } catch {
    /* kept for this session only */
  }
  return look;
}

export async function deleteLook(id: string) {
  const look = looks.find((l) => l.id === id);
  if (!look) return;
  retired.set(id, look);
  looks = looks.filter((l) => l.id !== id);
  emit();
  try {
    await tx("readwrite", (s) => s.delete(id));
  } catch {
    /* nothing stored */
  }
}

export function describeLook(l: Look) {
  const t = l.transform;
  return t.kind === "lut3d"
    ? `3D LUT · ${t.size}³`
    : t.kind === "lut1d"
      ? `1D LUT · ${t.size}`
      : "ASC CDL";
}

/**
 * Throws before an export starts if the clip's look can't be rendered, so a grade is never
 * silently dropped from an exported file.
 */
export function assertGradeReady(clip: Clip) {
  const id = clip.grade?.lookId;
  if (!id || !(clip.grade!.intensity > 0)) return;
  if (!getLook(id))
    throw new Error(
      `"${clip.title}" uses a look that isn't in this browser's library. Re-import it, or set the look to None.`,
    );
  if (!lookRenderer())
    throw new Error(lookGpuError() ?? "Looks can't be rendered in this browser.");
}

/** Test hook. */
export async function _resetLooksForTests() {
  const p = dbPromise;
  dbPromise = null;
  loaded = null;
  looks = [];
  retired.clear();
  if (p) (await p.catch(() => null))?.close();
}
