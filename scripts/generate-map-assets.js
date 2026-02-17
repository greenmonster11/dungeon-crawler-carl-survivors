#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'assets', 'maps');
const TILE_SIZE = 64;
const VARIANTS = 4;

const FLOOR_PALETTES = [
  ['#2a2a2e', '#252530', '#302828', '#333338'],
  ['#332211', '#2a1a0a', '#3a2a1a', '#443322'],
  ['#1a2a3a', '#1e2e3e', '#223344', '#2a3a4a'],
  ['#1a3a1a', '#224422', '#2a4a2a', '#1a331a'],
  ['#3a1a0a', '#4a2210', '#331100', '#552211'],
  ['#2a2233', '#332244', '#221a33', '#3a2a44'],
  ['#0a1a2a', '#0e2233', '#112a3a', '#0a2030'],
  ['#0a0a10', '#0e0a18', '#12101e', '#080812'],
  ['#2a1a1a', '#1a2a2a', '#2a2a1a', '#1a1a2a']
];

function makeRng(seed) {
  let s = seed >>> 0;
  return function rand() {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16)
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function tint(hex, amount) {
  const { r, g, b } = hexToRgb(hex);
  const nr = clamp(Math.round(r + amount), 0, 255);
  const ng = clamp(Math.round(g + amount), 0, 255);
  const nb = clamp(Math.round(b + amount), 0, 255);
  return `rgb(${nr},${ng},${nb})`;
}

function textureSvg({ base, floorIndex, variant }) {
  const rand = makeRng((floorIndex + 1) * 1000 + variant * 97);
  const lines = [];
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${TILE_SIZE}" height="${TILE_SIZE}" viewBox="0 0 ${TILE_SIZE} ${TILE_SIZE}">`);
  lines.push(`<rect width="${TILE_SIZE}" height="${TILE_SIZE}" fill="${base}"/>`);

  for (let i = 0; i < 36; i++) {
    const x = Math.floor(rand() * TILE_SIZE);
    const y = Math.floor(rand() * TILE_SIZE);
    const w = 1 + Math.floor(rand() * 2);
    const h = 1 + Math.floor(rand() * 2);
    const shade = tint(base, rand() > 0.5 ? 18 : -18);
    const op = (0.08 + rand() * 0.22).toFixed(3);
    lines.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${shade}" opacity="${op}"/>`);
  }

  for (let i = 0; i < 10; i++) {
    const x1 = Math.floor(rand() * TILE_SIZE);
    const y1 = Math.floor(rand() * TILE_SIZE);
    const x2 = clamp(x1 + Math.floor((rand() - 0.5) * 24), 0, TILE_SIZE);
    const y2 = clamp(y1 + Math.floor((rand() - 0.5) * 24), 0, TILE_SIZE);
    const crack = tint(base, -35);
    const op = (0.08 + rand() * 0.25).toFixed(3);
    lines.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${crack}" stroke-width="1" opacity="${op}"/>`);
  }

  lines.push(`<rect x="0" y="0" width="${TILE_SIZE}" height="${TILE_SIZE}" fill="none" stroke="${tint(base, -24)}" stroke-width="1" opacity="0.25"/>`);
  lines.push(`</svg>`);
  return lines.join('\n');
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (let floor = 1; floor <= FLOOR_PALETTES.length; floor++) {
    const palette = FLOOR_PALETTES[floor - 1];
    for (let variant = 0; variant < VARIANTS; variant++) {
      const svg = textureSvg({
        base: palette[variant % palette.length],
        floorIndex: floor - 1,
        variant: variant + 1
      });
      const fileName = `floor${floor}_tile${variant + 1}.svg`;
      fs.writeFileSync(path.join(OUT_DIR, fileName), svg, 'utf8');
    }
  }
  console.log(`Generated ${FLOOR_PALETTES.length * VARIANTS} map textures in ${OUT_DIR}`);
}

main();
