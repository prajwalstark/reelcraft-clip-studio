// Keeps imported media in this browser's own storage (IndexedDB) so a refresh doesn't lose it.
// Files never leave the device: this is the same local, per-site storage a browser uses for
// offline data. Everything degrades gracefully — if storage is unavailable, full or turned off,
// the editors fall back to asking for the file again.

const DB = "reelcraft-media";
const STORE = "files";
const PREF = "reelcraft.rememberMedia";

export interface StoredFileMeta {
  name: string;
  size: number;
  lastModified: number;
}

interface Row extends StoredFileMeta {
  key: string;
  type: string;
  blob: Blob;
  savedAt: number;
}

export type SaveResult =
  { ok: true } | { ok: false; reason: "off" | "unsupported" | "quota" | "error"; message: string };

export const rememberMedia = () => {
  try {
    return localStorage.getItem(PREF) !== "off";
  } catch {
    return true;
  }
};
export function setRememberMedia(on: boolean) {
  try {
    localStorage.setItem(PREF, on ? "on" : "off");
  } catch {
    /* storage unavailable */
  }
}

let dbPromise: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB unavailable"));
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "key" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Could not open media storage"));
    req.onblocked = () => reject(new Error("Media storage is blocked by another tab"));
  }).catch((e) => {
    dbPromise = null;
    throw e;
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const t = d.transaction(STORE, mode);
        const req = run(t.objectStore(STORE));
        let result: T;
        req.onsuccess = () => (result = req.result);
        t.oncomplete = () => resolve(result);
        t.onabort = t.onerror = () =>
          reject(t.error ?? req.error ?? new Error("Media storage failed"));
      }),
  );
}

/** Bytes this site may still store, or null when the browser doesn't say. */
async function available(): Promise<number | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    if (!e || e.quota === undefined) return null;
    return e.quota - (e.usage ?? 0);
  } catch {
    return null;
  }
}

const fmt = (b: number) =>
  b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1e6))} MB`;

/** Store a copy of `file` under `key` (replacing any previous one). */
export async function saveMedia(key: string, file: File): Promise<SaveResult> {
  if (!rememberMedia())
    return { ok: false, reason: "off", message: "Not kept: remembering media is turned off." };
  if (typeof indexedDB === "undefined")
    return {
      ok: false,
      reason: "unsupported",
      message: "This browser can't keep media after a refresh.",
    };
  const room = await available();
  // Leave headroom: the browser needs space for the existing copy while it writes the new one.
  if (room !== null && file.size > room * 0.9)
    return {
      ok: false,
      reason: "quota",
      message: `Not kept: ${fmt(file.size)} is more than this browser lets the site store (${fmt(Math.max(0, room))} free).`,
    };
  try {
    // Ask the browser not to evict our data under storage pressure (best effort).
    void navigator.storage?.persist?.().catch(() => false);
    const row: Row = {
      key,
      name: file.name,
      size: file.size,
      lastModified: file.lastModified,
      type: file.type,
      blob: file,
      savedAt: Date.now(),
    };
    await tx("readwrite", (s) => s.put(row));
    return { ok: true };
  } catch (e) {
    const quota = e instanceof DOMException && e.name === "QuotaExceededError";
    return {
      ok: false,
      reason: quota ? "quota" : "error",
      message: quota
        ? `Not kept: not enough browser storage for ${fmt(file.size)}.`
        : "Not kept: the browser refused to store the file.",
    };
  }
}

/** The stored file for `key`, if it is the one described by `expect` (when given). */
export async function loadMedia(key: string, expect?: StoredFileMeta): Promise<File | null> {
  try {
    const row = await tx<Row | undefined>(
      "readonly",
      (s) => s.get(key) as IDBRequest<Row | undefined>,
    );
    if (!row) return null;
    if (
      expect &&
      (row.name !== expect.name ||
        row.size !== expect.size ||
        row.lastModified !== expect.lastModified)
    )
      return null;
    return row.blob instanceof File && row.blob.name === row.name
      ? row.blob
      : new File([row.blob], row.name, { type: row.type, lastModified: row.lastModified });
  } catch {
    return null;
  }
}

export async function forgetMedia(key: string) {
  try {
    await tx("readwrite", (s) => s.delete(key));
  } catch {
    /* nothing stored */
  }
}

/** Delete stored files whose key starts with `prefix` but isn't in `keep`. */
export async function pruneMedia(prefix: string, keep: Set<string>) {
  try {
    const keys = await tx<IDBValidKey[]>("readonly", (s) => s.getAllKeys());
    await Promise.all(
      keys
        .map(String)
        .filter((k) => k.startsWith(prefix) && !keep.has(k))
        .map((k) => forgetMedia(k)),
    );
  } catch {
    /* storage unavailable */
  }
}

/** Total bytes of stored media whose key starts with `prefix`. */
export async function storedBytes(prefix = ""): Promise<number> {
  try {
    const rows = await tx<Row[]>("readonly", (s) => s.getAll());
    return rows.filter((r) => r.key.startsWith(prefix)).reduce((a, r) => a + r.size, 0);
  } catch {
    return 0;
  }
}

/** Test hook: close and drop the cached connection. */
export async function _resetVaultForTests() {
  const p = dbPromise;
  dbPromise = null;
  if (p) (await p.catch(() => null))?.close();
}
