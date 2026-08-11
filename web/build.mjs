import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function copyDirRecursive(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(destDir, { recursive: true });

  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);

    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

async function run() {
  const outDir = path.join(__dirname, 'out');
  const hermesStaticDir = path.join(__dirname, '../hermes/static');

  if (fs.existsSync(outDir)) {
    copyDirRecursive(outDir, hermesStaticDir);
    console.log(`[build] Successfully synced Next.js export from ${outDir} to ${hermesStaticDir}`);
  } else {
    console.warn(`[build] Warning: ${outDir} does not exist yet.`);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
