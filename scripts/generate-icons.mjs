import sharp from 'sharp';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="64" fill="#5C6B73"/>
  <text x="256" y="320" font-family="Arial, sans-serif" font-size="220" font-weight="bold" fill="white" text-anchor="middle">CM</text>
</svg>`;

const iconsDir = join(__dirname, '..', 'public', 'icons');

async function generateIcons() {
    const svgBuffer = Buffer.from(svgContent);

    // Generate 192x192 icon
    await sharp(svgBuffer).resize(192, 192).png().toFile(join(iconsDir, 'icon-192.png'));
    console.log('Generated icon-192.png');

    // Generate 512x512 icon
    await sharp(svgBuffer).resize(512, 512).png().toFile(join(iconsDir, 'icon-512.png'));
    console.log('Generated icon-512.png');

    console.log('Done!');
}

generateIcons().catch(console.error);
