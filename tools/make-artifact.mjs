/**
 * Convert the single-file build into an artifact-shaped fragment.
 *
 * Artifact hosting supplies its own <!doctype>, <head> and <body>, so the
 * published file must be *content only*. This lifts the inlined <style> and
 * <script> out of the built document and re-emits them alongside the two mount
 * points, with no document-level tags of its own.
 *
 *   npm run build:single && node tools/make-artifact.mjs
 *   -> dist-single/artifact.html
 */

import { readFileSync, writeFileSync } from 'node:fs';

const SRC = new URL('../dist-single/index.html', import.meta.url).pathname;
const OUT = new URL('../dist-single/artifact.html', import.meta.url).pathname;

const html = readFileSync(SRC, 'utf8');

function extract(tag) {
  const open = html.indexOf(`<${tag}`);
  if (open === -1) throw new Error(`No <${tag}> found in the build output`);
  const close = html.indexOf(`</${tag}>`, open);
  if (close === -1) throw new Error(`Unterminated <${tag}> in the build output`);
  return html.slice(open, close + `</${tag}>`.length);
}

const style = extract('style');
const script = extract('script');

// Sanity: a self-contained artifact may not reference any external host. The
// CSP would block it silently, which is the worst possible failure mode.
const external = [...html.matchAll(/(?:src|href)="(https?:)?\/\/[^"]+"/g)].map((m) => m[0]);
if (external.length > 0) {
  throw new Error(`Build references external resources:\n  ${external.join('\n  ')}`);
}

const out = `${style}

<!--
  DEUS VULT — modern combined-arms hex tactics on the First Island Chain.
  Everything below is inlined: no network requests, no external fonts, no CDN.
  The board is WebGL (Pixi); the interface is plain HTML.
-->
<div id="board"></div>
<div id="hud"></div>

${script}
`;

writeFileSync(OUT, out, 'utf8');

const kb = (Buffer.byteLength(out) / 1024).toFixed(0);
console.log(`Wrote ${OUT} (${kb} kB, no external references)`);
