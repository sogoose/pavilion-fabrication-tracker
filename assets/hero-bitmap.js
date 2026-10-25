/*
 * PROJECT / MOVING BITMAP
 * Converts the existing, same-origin hero MP4 to an ordered-dithered 1-bit
 * moving raster. The original video remains untouched and acts as a fallback.
 * Works only while on-screen, at <= 14 fps; respects reduced motion.
 */
(function () {
  "use strict";

  const hero = document.querySelector(".rev-hero-bitmap");
  const panel = hero && hero.querySelector(".rev-bitmap-panel");
  const video = hero && hero.querySelector(".rev-hero-video");
  const output = hero && hero.querySelector(".rev-bitmap-canvas");
  if (!hero || !panel || !video || !output) return;

  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const work = document.createElement("canvas");
  const input = work.getContext("2d", { willReadFrequently: true });
  const display = output.getContext("2d", { alpha: false });
  if (!input || !display) return;

  // 8 x 8 Bayer matrix: ordered dither, not randomly flickering noise.
  const bayer = [
    0,48,12,60,3,51,15,63,
    32,16,44,28,35,19,47,31,
    8,56,4,52,11,59,7,55,
    40,24,36,20,43,27,39,23,
    2,50,14,62,1,49,13,61,
    34,18,46,30,33,17,45,29,
    10,58,6,54,9,57,5,53,
    42,26,38,22,41,25,37,21
  ];
  const hasVideoFrame = typeof video.requestVideoFrameCallback === "function";
  let width = 0, height = 0, active = true, generation = 0, last = -1000;
  let painted = false;

  function resize() {
    const bounds = panel.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    // A visible blocky raster, rather than pretending a CSS dot overlay
    // is actual image processing. Cap processing work on large monitors.
    const w = Math.min(280, Math.max(150, Math.round(bounds.width / 3.25)));
    const h = Math.max(96, Math.round(w * bounds.height / bounds.width));
    if (w === width && h === height) return;
    width = w;
    height = h;
    work.width = output.width = width;
    work.height = output.height = height;
    painted = false;
  }

  function draw() {
    if (!width || !height || video.readyState < 2 || !video.videoWidth) return;
    try {
      const vw = video.videoWidth, vh = video.videoHeight;
      const ratio = width / height;
      const videoRatio = vw / vh;
      let sx = 0, sy = 0, sw = vw, sh = vh;
      if (videoRatio > ratio) {
        sw = vh * ratio;
        sx = (vw - sw) * 0.55;
      } else {
        sh = vw / ratio;
        sy = (vh - sh) * 0.5;
      }
      input.drawImage(video, sx, sy, sw, sh, 0, 0, width, height);
      const frame = input.getImageData(0, 0, width, height);
      const pixels = frame.data;

      // Map light industrial footage to a restrained white-on-charcoal image.
      // The Bayer threshold holds fine geometry in the print layers and arm.
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          const gray = pixels[i] * .2126 + pixels[i + 1] * .7152 + pixels[i + 2] * .0722;
          const adjusted = Math.min(255, Math.max(0, (gray - 104) * 1.32 + 123));
          const offset = (bayer[(y & 7) * 8 + (x & 7)] - 31.5) * 1.5;
          const light = adjusted + offset > 132;
          const value = light ? 238 : 20;
          pixels[i] = pixels[i + 1] = pixels[i + 2] = value;
          pixels[i + 3] = 255;
        }
      }
      display.putImageData(frame, 0, 0);
      if (!painted) {
        painted = true;
        hero.classList.add("rev-bitmap-ready");
      }
    } catch (_error) {
      // If reading frames is unsupported, fall back to the ordinary grayscale
      // video, rather than hiding the only moving image or throwing errors.
      hero.classList.remove("rev-bitmap-ready");
    }
  }

  function schedule(ticket) {
    const onFrame = function (timestamp) {
      if (ticket !== generation || !active || document.hidden || motion.matches) return;
      if (timestamp - last >= 70) {
        last = timestamp;
        draw();
      }
      schedule(ticket);
    };
    if (hasVideoFrame) video.requestVideoFrameCallback(onFrame);
    else window.requestAnimationFrame(onFrame);
  }

  function stop() {
    generation++;
    video.pause();
  }

  function start() {
    if (motion.matches || !active || document.hidden) {
      stop();
      if (motion.matches && video.readyState >= 2) draw(); // static processed frame
      return;
    }
    const ticket = ++generation;
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    const attempt = video.play();
    if (attempt && typeof attempt.then === "function") {
      attempt.then(function () {
        if (generation === ticket) schedule(ticket);
      }).catch(function () {
        if (generation === ticket && video.readyState >= 2) draw();
      });
    } else {
      schedule(ticket);
    }
  }

  video.addEventListener("loadeddata", function () { resize(); draw(); start(); });
  video.addEventListener("error", function () {
    hero.classList.remove("rev-bitmap-ready");
  });
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) stop();
    else start();
  });

  if (typeof IntersectionObserver !== "undefined") {
    new IntersectionObserver(function (entries) {
      active = entries[0].isIntersecting;
      if (active) start();
      else stop();
    }, { threshold: 0.03 }).observe(hero);
  }
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(function () {
      resize();
      if (video.readyState >= 2 && (painted || motion.matches)) draw();
    }).observe(panel);
  } else {
    window.addEventListener("resize", resize, { passive: true });
  }
  if (typeof motion.addEventListener === "function") {
    motion.addEventListener("change", start);
  }

  resize();
  if (video.readyState >= 2) { draw(); start(); }
})();
