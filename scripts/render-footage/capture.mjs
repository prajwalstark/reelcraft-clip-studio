// usage: node capture.mjs <scene> <frames> <outDir> [start] [end] [w] [h]
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)(process.env.PW_PATH || "playwright");
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const [scene, nStr, outDir, s = "0", e, w = "1280", h = "720"] = process.argv.slice(2);
const N = +nStr;
const start = +s,
  end = e ? +e : N;
const here = path.dirname(new URL(import.meta.url).pathname);
const threeDir = path.resolve(here, "../../node_modules/three");
fs.mkdirSync(outDir, { recursive: true });

const server = http
  .createServer((req, res) => {
    const u = decodeURIComponent(req.url.split("?")[0]);
    const file = u.startsWith("/three/")
      ? path.join(threeDir, u.slice(7))
      : path.join(here, u === "/" ? "scene.html" : u);
    fs.readFile(file, (err, buf) => {
      if (err) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, {
        "content-type": file.endsWith(".js") ? "text/javascript" : "text/html",
      });
      res.end(buf);
    });
  })
  .listen(0);
const port = server.address().port;

const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
page.on("console", (m) => console.log("[page]", m.text()));
page.on("pageerror", (err) => console.log("[pageerror]", err.message));
await page.goto(`http://localhost:${port}/?scene=${scene}&w=${w}&h=${h}`);
await page.waitForFunction(() => window.ready === true, null, { timeout: 60000 });
const t0 = Date.now();
for (let i = start; i < end; i++) {
  const data = await page.evaluate(
    ([i, N]) => {
      window.renderAt(i, N);
      return window.capture();
    },
    [i, N],
  );
  fs.writeFileSync(
    path.join(outDir, `f${String(i).padStart(4, "0")}.jpg`),
    Buffer.from(data.split(",")[1], "base64"),
  );
  if (i % 20 === 0) console.log(scene, i, `${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
await browser.close();
server.close();
