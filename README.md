# Nitrate

Netflix decides your picture and sound from a handful of client-side signals. When one of them
reads low you get 720p and stereo on hardware that could do far better, and Netflix never tells
you which signal failed.

Nitrate pushes every one of those signals to the maximum the session can actually carry, and
then shows you exactly what you got.

```
  ● Nitrate                                                4.1.0

  UHD
  3840 × 2160
  ● Ultra HD confirmed from the decoder.

  video        15.35 Mb/s
  audio        Dolby Atmos · 768 kb/s
  dolby        atmos playing
  codec        hvc1.2.4.L153.B0
  range        HDR
  drm          hardware · playready sl3000
  decode       hardware
  dropped      1 / 935
  upgrades     +8 profiles
  peak         pinned
  decoders     h264 · hevc · av1 · vp9 · dd+ · he-aac · xhe-aac
  screen       3840 × 2160
  panel        1920 × 1080

  CONTROLS
  Engine                                                     ▮
  Video profiles                                             ▮
  Surround audio                                             ▮
  Peak bitrate                                               ▮
  Every track                                                ▮
  4K display report                                          ▮
  DRM negotiation                                            ▮
  Force HDR                                                  ▯
```

Every row is drawn only when it carries a value, so nothing ever reads as a dash. `screen` is
what Netflix is being told, `panel` is what you really have.

## Controls

| Switch | What it does |
| --- | --- |
| Engine | Master switch. Off releases every hook live, without a reload. |
| Video profiles | Promotes the level of every video profile in Netflix's own manifest request. |
| Surround audio | Adds the HE-AAC and, on PlayReady, Dolby Digital Plus profiles, and answers the spatial audio query yes so Atmos is offered. |
| Peak bitrate | Drives Netflix's own A/V override once per title and pins the top stream. |
| Every track | `showAllSubDubTracks`, which unlocks the dubs and subtitles hidden by locale. |
| 4K display report | Reports a 3840 × 2160 30-bit display no matter what panel you have. |
| DRM negotiation | Negotiates the strongest robustness first, and keeps the PlayReady certificate. |
| Force HDR | Off by default. Only worth turning on when the panel really is HDR. |

## Picture

Netflix caps resolution by the display it thinks you have, so Nitrate reports 3840 × 2160 at 30
bits across `screen`, `availWidth/Height`, `colorDepth`, `pixelDepth` and `outerWidth/Height`.
This is unconditional: a 1080p laptop panel still reports 4K, which is the single most important
input Netflix reads.

It then promotes the video ladder inside Netflix's own manifest request. `…-L30-…` gains `-L40`,
`-L41`, `-L50` and `-L51`; `h264mpl30-dash-cenc` gains `hpl40` and `mpl40`. The server offers
the higher rungs instead of stopping at the one the client asked for.

## Sound

HE-AAC 5.1 and the high quality stereo profile are requested on every browser, which is the
difference between stereo and surround on Chrome, Firefox and Opera. On PlayReady sessions —
Edge on Windows — Dolby Digital Plus 5.1, 5.1 HQ and Atmos are requested too.

Netflix does not serve Dolby over Widevine, and a Dolby profile on a Widevine manifest request is
rejected outright, taking the whole request with it. So that one is asked for only where it can
be answered.

### Dolby Atmos without the app

Atmos on the web has three client-side gates, and Nitrate opens the two that are openable.

The first is the profile. Netflix only returns an Atmos track if `ddplus-atmos-dash` is in the
manifest request, and it is added on every PlayReady session.

The second is the spatial query. Netflix asks the browser
`decodingInfo({ audio: { contentType: 'audio/mp4;codecs=ec-3', channels: 16, spatialRendering: true } })`,
and the specification says a browser must answer no unless the *current output device* renders
spatially without downmixing. So a receiver that is not in Atmos mode, or Windows spatial sound
left off, silently costs you Atmos even though the decoder, the plan and the title are all fine.
Nitrate answers that query yes. It is a safe thing to force: Atmos rides inside the same E-AC-3
stream as DD+ 5.1, so a device that cannot render the object layer still decodes the 5.1 core.
Netflix's own high quality Atmos stream is 768 kb/s against 640 for DD+ 5.1 HQ, which is how the
readout names it.

The third gate is the decoder, and that one is not forceable. AC-3 and E-AC-3 live behind the
`enable_platform_ac3_eac3_audio` build flag in Chromium. Microsoft turns it on in Edge, which is
why Edge reaches the Windows Dolby MFT and Chrome does not; there is no command-line switch or
`chrome://flags` entry that flips it in a stock Chrome build. Dolby on Chrome needs a custom
build, and nothing running inside the page can substitute for a decoder that was never compiled
in. The `dolby` row says which of the three is missing.

| Browser | Video ceiling | Audio ceiling |
| --- | --- | --- |
| Edge, Windows | 4K HEVC, HDR10 | Dolby Atmos, 768 kb/s |
| Chrome, Brave, Opera, Vivaldi | 4K HEVC, HDR10 | HE-AAC 5.1 |
| Firefox | 1080p H.264 | HE-AAC 5.1 |
| Safari, macOS | 4K HEVC, Dolby Vision | Dolby Atmos |

Atmos also needs the Premium plan and a title that ships an Atmos master. Neither is visible from
the page, so when the decoder and the session are both right and no Atmos track comes back, the
row reads `not offered here`.

## Peak bitrate

Netflix ships its own A/V bitrate override behind `ctrl + alt + shift + B`. Nitrate drives that
panel once per title, off screen, selects the top video and audio stream and closes it again.
Nothing is guessed at through internal APIs and the manifest is never touched.

## DRM

4K needs a hardware-backed CDM, so Widevine is negotiated at `HW_SECURE_ALL`, then
`HW_SECURE_DECODE`, then whatever the page asked for, and PlayReady `…recommendation` at
robustness `3000`. Every negotiation result is cached, so the same request is never issued twice.

Chromium rejects `generateRequest()` on Media Foundation CDMs until `setServerCertificate()` has
been called. Nitrate keeps Netflix's PlayReady server certificate on the Netflix origin, applies
it the moment `MediaKeys` is created, holds `generateRequest()` until it lands, and on
`InvalidStateError` retries: first with the cached certificate, then after waiting up to three
seconds for the page to provision its own. The certificate survives a browser restart, so only
the very first load on a profile has to race for one. A rotated certificate is rejected, dropped
and replaced on the next run.

### About that console warning

```
com.microsoft.playready.recommendation.3000: Internal testing is highly recommended
prior to enabling PlayReady playback on Windows…
```

The browser prints that line, not this extension and not Netflix. It comes from
`MediaKeySystemAccessInitializerBase::GenerateWarningAndReportMetrics` in Blink, which emits it
unconditionally on Windows for every `requestMediaKeySystemAccess()` call naming a PlayReady
recommendation key system. Netflix makes two such calls, so on a clean profile with no extensions
it prints twice. Caching the negotiation cuts it to one, and one is the floor, because playback
needs at least one access.

## HDR

Netflix asks about HDR through media capabilities, passing a transfer function, a colour gamut
and an HDR metadata type. That question is about your display, not your decoder, so the browser's
real answer passes straight through and is recorded.

The `range` row keeps the two apart. `HDR` means the browser agreed on its own. `HDR · forced`
means the answer was overridden, and it stays red rather than green unless the display had
already said yes, because a forced yes is not evidence of anything.

Force HDR is off by default for a reason no extension can fix: an HDR10 stream arrives in PQ and
Rec. 2020, and a panel that never asked for it displays that as if it were sRGB. The mid tones
lift, contrast collapses, and the picture looks flat and grey. If the browser already answers
yes, you get HDR with the switch off, and that is the case worth having.

## The rule that keeps playback working

Netflix validates the manifest request server-side against the session's DRM system and your
device entitlement. Send it a profile that does not belong there and it rejects the whole
request. That is the E100 screen: *this title isn't available to watch instantly*.

So Nitrate never invents a profile. Every entry it adds is an entry Netflix itself put in the
request, promoted to a higher level, reusing that entry's exact DRM suffix. A codec family that is
absent stays absent, which is also what makes the extension immune to Netflix renaming or
retiring profiles.

The same rule applies to decoders, and this is the one thing that cannot be forced. Claiming
HEVC on a machine with no HEVC decoder does not create one: Netflix believes the claim, sends an
HEVC track, and the real `addSourceBuffer` rejects it. The picture stops rather than improving.
So `isTypeSupported`, `canPlayType` and `decodingInfo` are widened only inside a family the
browser genuinely decodes, and levels are promoted only for those families. Everything that
Netflix *chooses* by — screen size, DRM robustness, profile level, bitrate — is forced flat out.

## What that leaves

| Limit | Why |
| --- | --- |
| 4K needs hardware DRM | PlayReady SL3000 on Windows, or FairPlay on macOS. Widevine L3 tops out at 1080p, server-side. |
| 4K needs a Premium plan | Server-side entitlement. |
| Atmos and DD+ need PlayReady and an E-AC-3 decoder | Netflix does not serve Dolby over Widevine, and only Edge ships the decoder on Windows. |
| HEVC and AV1 need a real decoder | Reported honestly under `decoders`. |
| HDR needs a real HDR chain | It can be forced, and usually should not be. |

Bitrate is reported as encoded bitrate, meaning bytes divided by the media seconds those bytes
produced, rather than download throughput. Netflix buffers minutes ahead, so the two differ by a
lot, and only the first one matches the figure in Netflix's own overlay.

Nitrate does not bypass household verification or account sharing checks. Those are entitlement
controls, not broken capability detection.

## Privacy

The whole permission list is `storage` and `*://*.netflix.com/*`. There is no network permission,
no analytics, no remote code, no account and no build step.

Only derived facts cross from the page to the extension: resolution, bitrate, codec names, DRM
robustness and the screen report. The ESN, the PBCID, the xid, the profile GUID, signed media
URLs and the title you are watching never leave the page.

## Install

1. Download or clone this folder.
2. Open `chrome://extensions` or `edge://extensions`, turn on Developer mode, choose Load unpacked.
3. Select the folder. Open Netflix and reload any tab that was already open.

Chrome, Edge, Brave, Opera and Vivaldi, version 111 or newer. Edge on Windows is the only browser
that reaches 4K on Netflix, because it is the only one with PlayReady SL3000.

`alt + shift + N` turns the engine on or off without opening the popup, and the shortcut is
editable at `chrome://extensions/shortcuts`.

The page console prints `bridge connected · v4.1.0` once the extension is talking to the page. If
that line is missing, the tab is still running an older injection and needs a reload. DevTools
resolves extension files from disk, so an orphaned tab shows you the new source while running the
old code.

## Layout

| File | |
| --- | --- |
| `core.js` | The engine. Runs in the page's main world at `document_start`. |
| `content.js` | Carries settings in and telemetry out, and retires itself if the extension reloads. |
| `background.js` | Defaults, per-tab telemetry, toolbar badge. |
| `popup.html`, `popup.js`, `popup.css` | The readout and the switches. Hand-written CSS, no framework. |
| `fonts/` | Montserrat, vendored so the popup never calls out. |

## Credits

The Netflix profile vocabulary and the bitrate override technique were learned from
[truedread/netflix-1080p](https://github.com/truedread/netflix-1080p) and
[lkmvip/netflix-4K-DDplus](https://github.com/lkmvip/netflix-4K-DDplus). Both replace Netflix's
player with a patched seven megabyte copy, which breaks every time Netflix ships an update.
Nitrate hooks the live player instead, so there is nothing to keep in sync.

Montserrat is © The Montserrat Project Authors, under the SIL Open Font License 1.1. See
`fonts/OFL-Montserrat.txt`.

MIT. Not affiliated with Netflix.
