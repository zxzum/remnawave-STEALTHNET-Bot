import sharp from "sharp";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(__dirname, "..", "public");
const srcIcon = readFileSync(resolve(publicDir, "favicon.png"));

const targets = [
  { out: "favicon.png", size: 1254 },
  { out: "icon-192.png", size: 192 },
  { out: "icon-512.png", size: 512 },
  { out: "icon-512-maskable.png", size: 512, pad: 0.12 },
  { out: "apple-touch-icon.png", size: 180 },
  { out: "favicon-32.png", size: 32 },
  { out: "favicon-16.png", size: 16 },
];

const roundedMask = async (size) => sharp(Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" fill="#000"/><rect width="${size}" height="${size}" rx="${Math.round(size * 0.18)}" fill="#fff"/></svg>`,
))
  .greyscale()
  .raw()
  .toBuffer();

async function generate() {
  for (const t of targets) {
    const size = t.size;
    const pad = t.pad ?? 0;
    const inner = Math.round(size * (1 - pad * 2));
    const offset = Math.round((size - inner) / 2);

    const iconBuffer = await sharp(srcIcon)
      .resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();

    const composed = await sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([{ input: iconBuffer, top: offset, left: offset }])
      .removeAlpha()
      .png()
      .toBuffer();

    await sharp(composed)
      .joinChannel(await roundedMask(size), { raw: { width: size, height: size, channels: 1 } })
      .png({ compressionLevel: 9 })
      .toFile(resolve(publicDir, t.out));

    console.log(`  ✓ ${t.out}  (${size}x${size}${pad ? `, ${Math.round(pad * 100)}% safe area` : ""})`);
  }
}

generate().catch((e) => {
  console.error("Icon generation failed:", e);
  process.exit(1);
});
