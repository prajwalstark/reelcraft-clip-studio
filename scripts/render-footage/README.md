# Landing-page footage

The landing page's videos are original renders of `scene.html` (Three.js), captured frame by frame
with headless Chromium and encoded with ffmpeg. Requires Playwright (`PW_PATH` may point at a global install).

```bash
node scripts/render-footage/capture.mjs hero 240 /tmp/frames/hero
node scripts/render-footage/capture.mjs ridge 144 /tmp/frames/ridge
# all-intra (-g 1) so every scroll seek lands on a keyframe
ffmpeg -framerate 30 -i /tmp/frames/hero/f%04d.jpg -c:v libx264 -pix_fmt yuv420p -preset slow -crf 27 -g 1 -tune film -movflags +faststart -an public/media/hero-scrub.mp4
ffmpeg -framerate 24 -i /tmp/frames/ridge/f%04d.jpg -c:v libx264 -pix_fmt yuv420p -preset slow -crf 25 -g 48 -tune film -movflags +faststart -an public/media/ridge-loop.mp4
```

`ridge` loops seamlessly (the terrain is built from sines whose period equals one loop).
