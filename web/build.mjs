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

  console.log('[build] Build completed successfully!');
}

run().catch((err) => {
  console.error('[build] Fatal error:', err.message);
  process.exit(1);
});
