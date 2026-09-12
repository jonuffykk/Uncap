# Nitrate

Netflix decides your picture and sound quality from a handful of client-side signals. When one
of them reads wrong you get 720p and stereo on hardware that can do far better, and Netflix
never tells you which signal failed.

Nitrate corrects those signals, asks Netflix for the ladder it actually has, and shows you what
you are getting.

```
  UHD
  3840 × 2160

  ● Ultra HD confirmed from the decoder.

  video       15.35 Mb/s
  audio       Dolby Digital+ 5.1 HQ · 640 kb/s
  codec       hev1.1.6.L93.B0
  drm         hardware · playready sl3000
  upgrades    +8 profiles
  peak        pinned
```

## Picture

Netflix caps resolution by the screen it thinks you have, so Nitrate reports a 3840×2160
display with a wide-gamut, high dynamic range output chain.

It then upgrades the video ladder inside Netflix's own manifest request. `…-L40-…` becomes
`…-L50-…` and `…-L51-…`; `playready-h264mpl30-dash` gains `mpl40` and `hpl40`. The server then
offers the higher rungs instead of stopping at the one your client asked for.

## Sound

HE-AAC 5.1 and the high-quality stereo profile are requested on every browser, which is the
difference between stereo and surround on Chrome, Firefox and Opera. On PlayReady sessions,
meaning Edge on Windows, Dolby Digital Plus 5.1, 5.1 HQ and Atmos are requested too.

The readout names the format from the codec the decoder is actually fed, following the player's
mid-stream `changeType` switches, and the tier from the measured bitrate. 640 kb/s of `ec-3` is
DD+ 5.1 HQ. Atmos rides inside that same `ec-3` stream and only a receiver downstream can tell
the two apart, so Nitrate requests it but never claims it from a guess.

## Peak bitrate

Netflix ships its own A/V bitrate override behind `ctrl + alt + shift + B`. Nitrate drives that
panel once per title, selects the top video and audio stream, and closes it again. Nothing is
guessed at through internal APIs and the manifest is never touched.

## Every track

`showAllSubDubTracks` unlocks the dubs and subtitle languages Netflix hides based on your
locale.

## DRM

Widevine is negotiated at `HW_SECURE_ALL`, then `HW_SECURE_DECODE`, then whatever the page asked
for. PlayReady `…recommendation` is negotiated at robustness `3000`. Every negotiation result is
cached, so the same request is never issued twice.

Chromium now rejects `generateRequest()` on Media Foundation CDMs until `setServerCertificate()`
has been called. Nitrate keeps Netflix's PlayReady server certificate on the Netflix origin,
applies it the moment `MediaKeys` is created, holds `generateRequest()` until it lands, and on
`InvalidStateError` retries: first with the cached certificate, then after waiting up to three
seconds for the page to provision its own. The certificate survives a browser restart, so only
the very first load on a profile has to race for one. A rotated certificate gets rejected,
dropped, and replaced on the next run.

### About that console warning

```
com.microsoft.playready.recommendation.3000: Internal testing is highly recommended
prior to enabling PlayReady playback on Windows…
```

The browser prints that line, not this extension and not Netflix. It comes from
`MediaKeySystemAccessInitializerBase::GenerateWarningAndReportMetrics` in Blink, which emits it
unconditionally on Windows for every `requestMediaKeySystemAccess()` call naming a PlayReady
recommendation key system. Netflix makes two such calls, so on a clean profile with no
extensions it prints twice.

No page script or extension can suppress a console message the renderer writes itself. What
Nitrate can do is cut it down. DRM negotiations are cached by key system and configuration, so
Netflix's repeated request is answered from cache rather than issued again, and the
`…recommendation.3000` ladder makes exactly one native call, since its robustness has to stay
empty. Two warnings become one, and one is the floor, because playback needs at least one
access.

DevTools then attributes that warning to `core.js`, because `AddConsoleMessage` blames whichever
frame is on the stack and the call now passes through the cache. Blink is still the emitter.
The line moved, the cause did not. The half of the warning that can actually break playback is
handled above.

## The rule that keeps playback working

Netflix validates the manifest request server-side against the session's DRM system and your
device entitlement. Send it a profile that does not belong there, such as a PlayReady-keyed
stream on a Widevine session or a codec your account cannot receive, and it rejects the whole
request. That is the E100 screen: *this title isn't available to watch instantly*.

So Nitrate never invents a profile. Every entry it adds is an entry Netflix itself put in the
request, promoted to a higher level or a better profile, reusing that entry's exact DRM suffix.
A codec family that is absent stays absent, and a family your browser cannot decode is never
promoted. The same rule makes the extension immune to Netflix renaming or retiring profiles.

Capability spoofing follows from the same idea. `isTypeSupported`, `canPlayType` and
`decodingInfo` are widened only within a codec family the browser genuinely decodes, so the
player cannot select a track that ends in a black screen.

## What it will not do

No extension can raise these:

| Limit | Why |
| --- | --- |
| 4K needs hardware DRM | PlayReady SL3000 on Windows, or FairPlay on macOS. Widevine L3 tops out at 1080p. |
| 4K needs a Premium plan | Server-side entitlement. |
| Atmos and DD+ need PlayReady | Netflix does not serve them over Widevine. |
| HEVC and AV1 need a decoder | Reported honestly in the popup under `decoders`. |
| HDR needs a real HDR chain | Netflix asks `isTypeSupportedWithFeatures`, which reads the actual display and OS state. Forcing it sends an HDR10 stream to an SDR panel and washes the picture out, so it is left alone. |

Bitrate is reported as encoded bitrate, meaning bytes divided by the media seconds those bytes
produced, rather than download throughput. It matches the figure in Netflix's own overlay
instead of your connection speed.

Nitrate does not bypass household verification or account sharing checks either. Those are
entitlement controls, not broken capability detection.

## Install

1. Download or clone this folder.
2. Open `chrome://extensions` or `edge://extensions`, turn on Developer mode, choose Load unpacked.
3. Select the folder. Open Netflix and reload any tab that was already open.

Chrome, Edge, Brave, Opera and Vivaldi, version 111 or newer.

Press `ctrl + shift + alt + N` on a Netflix page for the live overlay.

The page console prints `bridge connected · v3.0.0` once the extension is talking to the page.
If that line is missing, the tab is still running an older injection and needs a reload.

## Permissions

`storage` and `*://*.netflix.com/*`. That is the whole list. No network permission, no
analytics, no remote code, no accounts. Everything the popup shows is measured in your own
browser and never leaves it.

## Build

Only the stylesheet is generated:

```bash
npm install && npm run build
```

Tailwind's Play CDN is a script, and MV3 extension pages run under `script-src 'self'`, so
remote scripts do not execute in a popup at all. A remote stylesheet would execute, but it
breaks the popup offline, contacts a third party every time you open it, and counts as remote
code in Web Store review. Loading Lucide from a CDN has the same problem, so the five icons the
popup uses are inlined as SVG paths. Building locally is the correct configuration rather than a
workaround, and the result is a single 10 KB stylesheet.

## Layout

| File | |
| --- | --- |
| `core.js` | The engine. Runs in the page's main world at `document_start`. |
| `content.js` | Carries settings in and telemetry out. |
| `background.js` | Defaults, per-tab telemetry, toolbar badge. |
| `popup.html`, `popup.js`, `popup.css` | The readout and controls. |
| `build.mjs` | Generates `popup.css`. |

## Credits

The Netflix profile vocabulary and the bitrate override technique were learned from
[truedread/netflix-1080p](https://github.com/truedread/netflix-1080p) and
[lkmvip/netflix-4K-DDplus](https://github.com/lkmvip/netflix-4K-DDplus). Both replace Netflix's
player with a patched seven-megabyte copy, which breaks every time Netflix ships an update.
Nitrate hooks the live player instead, so there is nothing to keep in sync.

`fonts/plex-mono.woff2` is IBM Plex Mono, © IBM Corp., SIL Open Font License 1.1, see
`fonts/OFL.txt`. Icons are [Lucide](https://lucide.dev), ISC.

MIT. Not affiliated with Netflix.
