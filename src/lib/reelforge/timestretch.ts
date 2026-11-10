// Pitch-preserving time-stretch (WSOLA: waveform-similarity overlap-add) for offline export
// of clips with a speed change. Real-time export relied on the browser's `preservesPitch`;
// offline encoding has to do it itself so 2× clips don't sound like chipmunks.

/**
 * Stretch planar audio by `speed` (2 = twice as fast, half the duration) without changing
 * pitch. All channels share one alignment, chosen on their mono mix, so stereo stays coherent.
 */
export function timeStretch(
  channels: Float32Array[],
  sampleRate: number,
  speed: number,
): Float32Array<ArrayBuffer>[] {
  const n = channels[0]?.length ?? 0;
  if (!channels.length || Math.abs(speed - 1) < 1e-6 || n === 0)
    return channels.map((c) => c.slice());
  const outLen = Math.max(1, Math.round(n / speed));
  const N = Math.max(64, Math.round(sampleRate * 0.04)); // 40 ms frames
  const Hs = Math.floor(N / 2); // 50 % overlap on output
  const Ha = Hs * speed; // analysis hop
  const tol = Math.round(sampleRate * 0.012); // ±12 ms search
  const win = Float32Array.from(
    { length: N },
    (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N),
  );
  const mono = new Float32Array(n);
  for (const ch of channels) for (let i = 0; i < n; i++) mono[i]! += ch[i]! / channels.length;
  const out = channels.map(() => new Float32Array(outLen + N));
  const norm = new Float32Array(outLen + N);
  const at = (i: number) => (i >= 0 && i < n ? mono[i]! : 0);

  let prev = 0; // input position of the previously placed frame
  for (let k = 0; k * Hs < outLen; k++) {
    const nominal = Math.round(k * Ha);
    let best = nominal;
    if (k > 0) {
      // Pick the frame near `nominal` whose start best continues the previous frame.
      const natural = prev + Hs;
      let bestScore = -Infinity;
      const lo = Math.max(0, nominal - tol);
      const hi = Math.min(n - 1, nominal + tol);
      for (let c = lo; c <= hi; c += 2) {
        let score = 0;
        for (let j = 0; j < N; j += 4) score += at(c + j) * at(natural + j);
        if (score > bestScore) {
          bestScore = score;
          best = c;
        }
      }
    }
    const o = k * Hs;
    for (let ci = 0; ci < channels.length; ci++) {
      const src = channels[ci]!;
      const dst = out[ci]!;
      for (let j = 0; j < N; j++) {
        const s = best + j;
        if (s >= 0 && s < n) dst[o + j]! += src[s]! * win[j]!;
      }
    }
    for (let j = 0; j < N; j++) norm[o + j]! += win[j]!;
    prev = best;
  }
  return out.map((d) => {
    const r = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) r[i] = norm[i]! > 1e-3 ? d[i]! / norm[i]! : 0;
    return r;
  });
}
