import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as esbuild from 'esbuild';

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
  const distBackendStaticDir = path.join(__dirname, '../dist-backend/hermes-engine/_internal/hermes/static');

  // 1. Sync Next.js static export
  if (fs.existsSync(outDir)) {
    copyDirRecursive(outDir, hermesStaticDir);
    console.log(`[build] Successfully synced Next.js export from ${outDir} to ${hermesStaticDir}`);

    if (fs.existsSync(path.dirname(distBackendStaticDir))) {
      copyDirRecursive(outDir, distBackendStaticDir);
      console.log(`[build] Successfully synced Next.js export to ${distBackendStaticDir}`);
    }
  } else {
    console.warn(`[build] Warning: ${outDir} does not exist yet.`);
  }

  // 2. Also bundle SPA fallback via esbuild into hermes/static
  try {
    await esbuild.build({
      entryPoints: [path.join(__dirname, 'src/main.tsx')],
      bundle: true,
      outfile: path.join(hermesStaticDir, 'app.js'),
      sourcemap: true,
      loader: { '.tsx': 'tsx', '.ts': 'ts', '.css': 'css' },
      define: { 'process.env.NODE_ENV': '"production"' },
    });
    console.log(`[build] Successfully bundled SPA app.js and app.css to ${hermesStaticDir}`);
  } catch (e) {
    console.warn('[build] Note: esbuild fallback bundle skipped:', e.message);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

