import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import * as esbuild from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeRemoveDir(dirPath) {
  if (!fs.existsSync(dirPath)) return;
  try {
    fs.rmSync(dirPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // Silently ignore if locked temporarily
  }
}

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

/** Copy the export over a destination, dropping the previous `_next` first.
 *
 * A plain copy only ever adds, so every build left its hashed chunks behind —
 * the served directory had accumulated 34 `app/page-*.js` against the 3 a
 * build actually produces, going back weeks. Harmless-looking, and the reason
 * a stale cached index.html could keep booting an old app instead of failing:
 * the chunk names it referenced were all still there. Clearing `_next` makes
 * a stale entry point 404 loudly rather than silently serve last week's UI.
 * Only `_next` is cleared — the rest of the directory holds files this build
 * does not own. */
function syncExport(srcDir, destDir) {
  safeRemoveDir(path.join(destDir, '_next'));
  copyDirRecursive(srcDir, destDir);
}

function runNextBuild() {
  return new Promise((resolve, reject) => {
    const nextBin = path.join(__dirname, 'node_modules/next/dist/bin/next');
    const child = spawn(process.execPath, [nextBin, 'build'], {
      cwd: __dirname,
      stdio: 'inherit',
      shell: false,
    });

    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Next.js build failed with exit code ${code}`));
    });

    child.on('error', (err) => reject(err));
  });
}

async function run() {
  const isCopyOnly = process.argv.includes('--copy-out');
  const outDir = path.join(__dirname, 'out');
  const nextDir = path.join(__dirname, '.next');
  const hermesStaticDir = path.join(__dirname, '../hermes/static');
  const distBackendStaticDir = path.join(__dirname, '../dist-backend/hermes-engine/_internal/hermes/static');

  if (!isCopyOnly) {
    console.log('[build] Cleaning temporary build directories...');
    safeRemoveDir(nextDir);
    safeRemoveDir(outDir);
    await sleep(400);

    console.log('[build] Running Next.js static export...');
    try {
      await runNextBuild();
    } catch (err) {
      console.warn('[build] First attempt encountered lock, retrying once after cooldown...');
      safeRemoveDir(nextDir);
      safeRemoveDir(outDir);
      await sleep(1000);
      await runNextBuild();
    }
  }

  // 1. Sync Next.js static export
  if (fs.existsSync(outDir)) {
    syncExport(outDir, hermesStaticDir);
    console.log(`[build] Successfully synced Next.js export from ${outDir} to ${hermesStaticDir}`);

    if (fs.existsSync(path.dirname(distBackendStaticDir))) {
      syncExport(outDir, distBackendStaticDir);
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

  console.log('[build] Build completed successfully!');
}

run().catch((err) => {
  console.error('[build] Fatal error:', err.message);
  process.exit(1);
});
