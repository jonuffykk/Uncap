# Privacy policy

Last updated: 19 September 2026.

## Short version

Uncap collects nothing, sends nothing and stores nothing about you. It has no network permission,
so it cannot transmit data even if it wanted to.

## What is stored

Your settings, in `chrome.storage.local`, on your own machine. That is the enhancer mode and its
five sliders, the output size, the smooth motion rate, the compare split, the stream switches, the
theme, the badge and readout switches, your keyboard shortcuts, your allow list, and `bench`, which
holds what one frame of the filter measured on your own GPU so the popup can show it without
measuring again.

Uncap also keeps a short lived per tab reading in `chrome.storage.session` so the popup can show
what is playing. It holds resolution, frame rate, bitrate, codec name, DRM robustness, dropped frame
count, the screen size reported to the site, your real screen size, your monitor's refresh rate and
pixel density, which codec families your browser says it decodes in hardware, how many frames a
second the filter is drawing, and the filter's cost in milliseconds. It is deleted when the tab
closes and never leaves the browser.

On Netflix, Uncap caches Netflix's own PlayReady server certificate in that site's `localStorage` so
the first licence request of a later session does not have to race for one. That certificate is
Netflix's public key material, not yours.

## What is never collected

No browsing history, no page content, no cookies, no form input, no credentials, no analytics, no
telemetry, no crash reports, no advertising identifiers, no account.

The extension reads the Netflix title id and the YouTube video id inside the page in order to notice
that the video changed. Those ids stay in the page. They are not stored, not sent to the extension,
and not sent anywhere else. The same is true of the Netflix ESN, PBCID, xid, profile GUID and signed
media URLs.

The video enhancer never reads a pixel back out of the GPU. There is no `readPixels`, no
`getImageData` and no `toDataURL` in the code.

## Who the data is shared with

Nobody. There is no server, no third party service and no data transfer of any kind.

## Permissions

`storage` keeps the settings above. `scripting` registers the content script on a site you have
explicitly turned Uncap on for. Host access to `netflix.com` and `youtube.com` runs the two site
adapters. Access to any other site is optional, is never requested at install, and is granted one
origin at a time from the popup.

## Removing your data

Uninstalling Uncap removes everything it stored, and the Netflix certificate cache clears with that
site's data.

## Contact

Write to contato@andersonalves.site or open an issue on the repository.
