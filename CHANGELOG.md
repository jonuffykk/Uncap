# Changelog

## 2.1.0

### Added

- EASU, the edge adaptive upscaler from AMD's FidelityFX Super Resolution 1.0, in place of
  Catmull-Rom. It measures the luma gradient in the four quadrants around each output pixel and
  builds an elliptical kernel stretched along the edge it found, so a diagonal is filtered along its
  own direction instead of across it. The result is clamped to the four nearest input pixels, so the
  kernel's negative lobes cannot ring.
- RCAS in place of plain contrast adaptive sharpening. It computes per channel how far a pixel can
  move before any neighbour clips, takes the tightest limit, and halves its strength where the local
  variation reads as noise rather than signal, which is what a compressed stream needs.
- A deblur control, and a neighbourhood clamp over the whole restore pass. Deblur, line thinning and
  denoise can now sharpen a line as hard as they like and still never produce a value outside the
  pixel's own three by three neighbourhood, which is the idea behind Anime4K's highlight clamp.
- The compare split is draggable. A knob on the seam can be moved anywhere across the frame, the
  position is remembered, and the shader seam and the canvas clip follow it live.
- Hardware DRM is now promoted by key system, not only by robustness. A site asking for PlayReady
  gets `com.microsoft.playready.recommendation.3000` tried first, and the popup says `promoted` when
  Uncap negotiated a better rung than the site asked for.
- An "allow every site now" button under settings, for people who would rather grant once than one
  origin at a time.

- The whole interface is the toolbar popup. There is no settings page to go and find, and nothing is
  reachable from only one place. Seven interface files became three, and the popup carries the live
  panel plus five ordered folds: details, tuning, stream, sites, general.
- Installing or updating reloads the Netflix and YouTube tabs you already had open, so the extension
  is working the moment it lands instead of asking you to reload. The popup still offers the button
  for any other site you granted.
- Per site profiles, import, export and reset are gone, along with the footer line that said which
  scope you were editing. One settings object, one place to edit it, no scope to keep track of. The
  service worker's write path collapsed to a plain storage write.
- Volume boost, up to five times, and a compressor that evens out loud and quiet. The audio graph is
  only attached to same origin or blob media, which is what a streaming player uses, so a cross
  origin track is left alone and named in the readout rather than being silently muted.
- `src/mask.js` and `src/drm.js` merged into `src/stream.js`, and `src/motion.js` folded into
  `src/render.js`. Ten source files became eight.
- The bundled Montserrat font is gone. The interface uses the system sans serif, so nothing is
  shipped and nothing is fetched.
- The comparison images are a real round trip now: a 640 by 360 master area downscaled to 320 by 180
  and brought back at 2x, which is what a player actually does to an encode, rather than a 3x stretch
  of a small synthetic frame that flattered neither side.

### Changed

- The default presets were retuned for the new passes. Balanced sharpens a little harder because
  RCAS is gentler than CAS at the same number, Sharp gains a touch of deblur, and Anime gains a
  strong deblur on top of the line work.
- `resampleSource` became `upscaleSource` and `refineSource` became `restoreSource`, and the stage
  the readout names changed from `refine` to `restore`.

## 2.0.0

A rewrite. Everything that decided picture quality was kept and re-derived; everything around it was
rebuilt, and the interpolator was replaced with one of our own.

### Added

- A pyramidal bidirectional optical flow interpolator, written from scratch against WebGL2. Both
  frames are reduced to luma at half resolution and their mip chain is the pyramid; the search runs
  coarse to fine over three rungs at a sixteenth, an eighth and a quarter of the video's width,
  matching a five tap cross at the matching level of detail, with a reach of roughly a hundred pixels
  of full resolution motion. It replaces the single level eighth resolution block search and the
  vendored neural runtime, so there is no model to download and nothing that needs WebGPU.
- An occlusion guard. The flow is estimated in both directions, and a pixel whose forward vector does
  not cancel the backward vector at the place it points to falls back to the nearest real frame. This
  is what removes the halo around a moving object where background is being uncovered.
- Sixteen bit flow precision on an ordinary RGBA8 target, packed two bytes per component, so the
  interpolator does not depend on float render targets and there is no second code path to keep.
- A custom enhancer mode with five sliders, and two new passes behind them. Line thinning warps each
  sample along the luma gradient so bright detail is pulled into dark line art. Deband replaces a
  pixel with its wide neighbourhood average where that neighbourhood is flat, with a small dither on
  top, which is what removes the terracing compressed skies get.
- A denoise pass, a three by three bilateral filter that keeps edges and flattens grain. It runs
  before the sharpen so grain is not amplified into the result.
- Any site, not just two. The image layer now runs on any HTML5 video once you allow the origin from
  the popup, and finds videos inside open shadow roots and same origin iframes. Netflix and YouTube
  keep their own stream adapters and stay on without asking.
- An allow list with wildcard patterns matched against hostname and path, for people who would rather
  name the sites than grant them one at a time.
- Per site profiles. A profile overrides your global settings on one hostname, and every toggle you
  touch while it is live is written into the profile instead of into your defaults.
- A settings page: theme, enhancer defaults, the stream switches, the allow list, the profile list,
  the shortcut editor, and import and export of the whole settings object as JSON.
- Output size as a real choice. Auto still measures the player box and your pixel ratio, Native
  leaves the frame at its own resolution, and 1080p, 1440p and 4K lock the output while keeping the
  source aspect.
- Remappable shortcuts. All four actions take any letter or digit, still under `ctrl + alt`, and the
  page reads the physical key so a non US layout behaves the same.
- Brazilian Portuguese and English throughout, with a check in CI that every key the interface asks
  for exists in both.
- Cross origin video is detected and named. A frame from another origin cannot be read by the page,
  which is a browser rule rather than a failure, and the popup says which of the two reasons applies
  instead of reporting a generic GPU error.
- YouTube premium bitrate rows are preferred when two menu rows share a height.
- Firefox and Safari builds, staged from one source by the release workflow, swapping the service
  worker for an event page and adding the gecko id.
- Releases that cut themselves. Raise the version in `manifest.json`, add the matching changelog
  section, push to `main`, and the workflow verifies everything, creates the tag, opens the release
  with that changelog section as its notes, and submits to whichever stores have credentials.

### Changed

- The telemetry loop is event paced rather than a fixed one second interval. A tab with nothing
  playing and no focus drops to one report every twenty seconds, which matters now that the extension
  can run on every site rather than two.
- Settings writes go through the service worker, which decides whether they belong to the active site
  profile or to your defaults. The popup and the page no longer write storage directly.
- The badge setting is cached in the worker rather than read from storage on every telemetry message.
- The scene cut guard is keyed to an absolute frame difference instead of a fraction of the
  photometric tolerance. Measured on the two cases it has to separate, a fully textured frame shifted
  sixteen pixels reads 0.15 while a hard cut reads 0.34; the old threshold sat at 0.14 and so stood
  the interpolator down on exactly the fast motion it was meant for.
- Modules moved under `src/`, the interface under `ui/`. `engine.js` became `core.js`, `enhance.js`
  became `render.js`, and `readout.js` became `hud.js`.
- The popup carries a footer that names which settings it is editing, global or this site, and
  creates or drops the site profile from there.
- The comparison images in `docs/` are both 642 by 360 renders of the same test frame, produced by
  the shaders in `src/gpu.js`. They were previously two different crops at two different sizes.

### Removed

- The vendored neural runtime and its model weights. The replacement is our own and needs no
  download, which also removes the non-commercial restriction those weights carried and the
  `web_accessible_resources` entry that exposed them.
- The `requestAdapter` call that produced a `powerPreference is currently ignored on Windows` warning
  in the extension's error log on every YouTube page.
- The `scripts/` folder. The packager and the message key check are four lines of inline node in the
  release workflow, which is the only place either was ever used.

### Fixed

- `generateMipmap` was called while the target texture was still attached to the bound framebuffer,
  which is feedback and leaves the mip chain undefined. The luma pyramid the whole search reads was
  being built from it.
- The coarse rungs of the search could run away on a flat cost surface and hand a large wrong vector
  to every rung below, which the finer rungs did not have the reach to undo. Every rung now tests the
  coarse guess against standing still and starts from whichever is cheaper, and a candidate has to
  beat the incumbent by one percent to be taken.
- `flat` is a reserved word in GLSL ES 3.00, so the deband pass would not have compiled with that
  local name. All shaders are now compiled and linked against a real WebGL2 context as part of
  development.
- The overlay canvas starts at zero by zero, so the first measurement always sizes the intermediate
  textures. A player that happened to land on the canvas default of 300 by 150 would have left them
  unsized.
- Turning off "run everywhere" no longer silences the filter on Netflix and YouTube, which the
  settings page says are always on.
- The settings page no longer repaints itself in response to its own writes, which made a slider jump
  while you were dragging it.

## 1.0.0

First release under the name Uncap. The project was previously called Nitrate.

### Added

- A WebGL2 enhancer with four settings: off, balanced, sharp and anime. Catmull-Rom resampling
  followed by contrast adaptive sharpening, plus luma heightmap line darkening in anime mode.
- YouTube support. The top quality rung is pinned through the player API, and through the player's
  own quality menu when the API refuses to hold it.
- A hook on `MediaSource.isTypeSupportedWithFeatures`, the Microsoft API that decides HDR on Edge for
  Windows. Forcing HDR through media capabilities alone left that door shut.
- Spatial audio forcing, so Netflix offers Atmos when the profile and the decoder are both present
  but the output device is not in Atmos mode.
- Optional per site access. The popup grants one origin at a time and never asks at install.
- Smooth motion, with a still guard that leaves subtitles, logos and letterbox bars untouched.
- Measured rates snapped to real ones. 23.98 is 24, 29.97 is 30, 59.9 hertz is 60.
- A survey of what this machine decodes in hardware, asked of `decodingInfo` at load with a real 4K
  60 fps frame, once per codec family. A family that only decodes in software is then declined so the
  site serves one the machine can hold, but never the last family standing.
- A watchdog on the YouTube rung. Four rough seconds of dropped frames steps it down one rung, up to
  three, and the popup says so while still naming the rung it gave up.
- Real GPU timing, with `gl.finish()` on both sides of one frame a second.
- A real shrink instead of a refusal. Below a ratio of one the resample switches from a bicubic
  kernel to an area average over the output pixel's whole footprint.
- A strain controller that sheds work in steps and puts each stage back when the machine catches up.
- A compare split, four keyboard shortcuts, and a corner readout carrying the numbers.

### Fixed

- Colour loss when the enhancer was on. The WebGL context now unpacks and presents in `display-p3`.
- The enhancer stands down on HDR video rather than flattening it onto a standard range canvas.
- The overlay canvas is positioned correctly inside padded containers and no longer sits above the
  player controls.
