import { execFileSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = import.meta.dirname;
const input = join(root, `.tailwind.${process.pid}.css`);

const SOURCE = `@import "tailwindcss";
@source "./popup.html";
@source "./popup.js";

@font-face {
  font-family: "Plex Mono";
  src: url("fonts/plex-mono.woff2") format("woff2");
  font-weight: 400;
  font-style: normal;
  font-display: block;
}

@theme {
  --font-sans: ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif;
  --font-mono: "Plex Mono", ui-monospace, "SF Mono", Menlo, monospace;

  --color-ground: #0b0b0c;
  --color-line: #232327;
  --color-ink: #ebe9e4;
  --color-dim: #94918a;
  --color-mute: #64625d;
  --color-flare: #f2b441;
  --color-up: #7fd18a;

  --radius-xs: 2px;
}

@layer base {
  html { color-scheme: dark; -webkit-font-smoothing: antialiased; }
  body { background: var(--color-ground); color: var(--color-ink); font-family: var(--font-sans); }
  ::selection { background: var(--color-flare); color: var(--color-ground); }
  :focus-visible { outline: 1px solid var(--color-flare); outline-offset: 3px; }
}
`;

writeFileSync(input, SOURCE);
try {
  execFileSync(
    process.execPath,
    [join(root, 'node_modules/@tailwindcss/cli/dist/index.mjs'), '-i', input, '-o', join(root, 'popup.css'), '--minify'],
    { cwd: root, stdio: 'inherit' }
  );
} finally {
  rmSync(input, { force: true });
}
