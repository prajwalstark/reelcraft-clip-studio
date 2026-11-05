// Generates a clearly-synthetic local test video (moving gradient, timecode, beeps).
import { pickFormat } from "./exporter";

export async function generateDemoVideo(seconds: number, onProgress: (p: number) => void): Promise<File> {
  const fmt = pickFormat();
  if (!fmt) throw new Error("MediaRecorder not supported");
  const W = 1280, H = 720;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d")!;
  const stream = c.captureStream(30);
  const ac = new AudioContext();
  const dest = ac.createMediaStreamDestination();
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  gain.gain.value = 0;
  osc.connect(gain).connect(dest);
  osc.start();
  dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
  const rec = new MediaRecorder(stream, { mimeType: fmt.mime });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  await ac.resume();
  rec.start(500);
  const t0 = performance.now();
  await new Promise<void>((res) => {
    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      const hue = (t * 30) % 360;
      g.fillStyle = `hsl(${hue} 55% 18%)`;
      g.fillRect(0, 0, W, H);
      g.fillStyle = `hsl(${(hue + 80) % 360} 80% 60%)`;
      g.beginPath();
      g.arc(W / 2 + Math.sin(t * 1.3) * 420, H / 2 + Math.cos(t) * 160, 90, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#fff";
      g.font = "700 64px monospace";
      g.textAlign = "center";
      g.fillText(`DEMO ${t.toFixed(2)}s`, W / 2, 110);
      const sec = Math.floor(t);
      osc.frequency.value = 330 + (sec % 4) * 110;
      gain.gain.value = t - sec < 0.25 ? 0.2 : 0;
      onProgress(Math.min(1, t / seconds));
      if (t >= seconds) return res();
      setTimeout(tick, 1000 / 30);
    };
    tick();
  });
  await new Promise<void>((r) => { rec.onstop = () => r(); rec.stop(); });
  stream.getTracks().forEach((t) => t.stop());
  osc.stop();
  await ac.close();
  return new File(chunks, `reelforge-demo.${fmt.ext}`, { type: fmt.mime.split(";")[0] ?? "video/webm" });
}
