// Generates PNG app icons from the Twemoji beer mug, on an amber rounded square.
// Run: node scripts/gen-icons.mjs
import sharp from "sharp";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const pub = join(here, "..", "public");
const emojiSvg = readFileSync(join(here, "beer-emoji.svg"));

const BG = "#f59e0b";
const CANVAS = 512;
const EMOJI = 320; // emoji box within the 512 canvas

// Amber rounded-square background (radius ~96 like the original icon.svg).
const bgSvg = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS}" height="${CANVAS}">` +
    `<rect width="${CANVAS}" height="${CANVAS}" rx="96" fill="${BG}"/></svg>`
);

async function build() {
  const emojiPng = await sharp(emojiSvg, { density: 384 })
    .resize(EMOJI, EMOJI, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  const offset = Math.round((CANVAS - EMOJI) / 2);
  const master = await sharp(bgSvg)
    .composite([{ input: emojiPng, top: offset, left: offset }])
    .png()
    .toBuffer();

  const targets = [
    ["icon-192.png", 192],
    ["icon-512.png", 512],
    ["apple-touch-icon.png", 180],
  ];
  for (const [name, size] of targets) {
    await sharp(master).resize(size, size).png().toFile(join(pub, name));
    console.log("  wrote", name, `(${size}x${size})`);
  }
}

build().then(() => console.log("icons done")).catch((e) => {
  console.error(e);
  process.exit(1);
});
