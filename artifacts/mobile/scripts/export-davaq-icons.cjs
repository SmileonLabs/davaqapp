// Derive every launcher/PWA icon from the approved black-and-white DAVAQ mark.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const expoRequire = createRequire(require.resolve('expo/package.json'));
const { generateImageAsync, generateFaviconAsync } = expoRequire('@expo/image-utils');
async function main() {
  const source = path.join(root, 'assets/images/davaq/queue.png');
  for (const [file, size] of [
    ['assets/images/davaq/app-icon-v2.png', 1024],
    ['assets/images/davaq/brand-icon.png', 1024],
    // Replace legacy Expo entry points as well; none should retain another app's artwork.
    ['assets/images/splash-icon.png', 1024],
    ['assets/images/splash.png', 1024],
    ['assets/images/icon.png', 1024],
    ['assets/images/favicon.png', 64],
    ['public/davaq-icon-192.png', 192], ['public/icon-192.png', 192],
    ['public/davaq-icon-512.png', 512], ['public/icon-512.png', 512],
    ['public/davaq-apple-touch-icon.png', 180], ['public/apple-touch-icon.png', 180],
    ['public/davaq-favicon-20261013.png', 64],
    ['../landing/public/davaq-favicon-20261013.png', 64],
    ['public/davaq-splash-20261013.png', 1024],
  ]) {
    const { source: png } = await generateImageAsync({ projectRoot: root }, {
      src: source, width: size, height: size, resizeMode: 'contain',
      backgroundColor: '#000000', removeTransparency: true,
    });
    fs.writeFileSync(path.join(root, file), png);
  }
  const favicon = await generateFaviconAsync(fs.readFileSync(source), [16, 32, 48, 64]);
  fs.writeFileSync(path.join(root, 'public/favicon.ico'), favicon);
  // Keep the landing page's legacy favicon URL consistent too.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><image width="1024" height="1024" href="data:image/png;base64,${fs.readFileSync(source).toString('base64')}"/></svg>`;
  fs.writeFileSync(path.join(root, 'assets/images/davaq/brand-mark.svg'), svg);
  fs.writeFileSync(path.resolve(root, '../landing/public/favicon.svg'), svg);
  fs.copyFileSync(path.join(root, 'assets/images/davaq/brand-foreground.png'),
    path.join(root, 'assets/images/adaptive-icon.png'));
  console.log('DAVAQ monochrome native/PWA icons and favicon exported.');
}
main().catch(error => { console.error(error.message); process.exit(1); });
