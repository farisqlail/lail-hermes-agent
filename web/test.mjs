import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function findTestFiles(dir) {
  const files = [];
  const list = fs.readdirSync(dir, { recursive: true });
  for (const item of list) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    if (!stat.isDirectory() && item.endsWith('.test.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

async function run() {
  const testFiles = findTestFiles(path.join(__dirname, 'src'));
  if (testFiles.length === 0) {
    console.log('No test files found.');
    return;
  }

  console.log(`[test] Found ${testFiles.length} test files. Transpiling...`);
  
  // Transpile test files
  await esbuild.build({
    entryPoints: testFiles,
    bundle: true,
    platform: 'node',
    format: 'esm',
    outdir: path.join(__dirname, 'dist-test'),
    external: ['react', 'react-dom', 'node:test', 'node:assert'],
    logLevel: 'error',
  });

  console.log('[test] Running tests...');
  const distFiles = fs.readdirSync(path.join(__dirname, 'dist-test'), { recursive: true });
  const testJsFiles = distFiles
    .map(f => path.join(__dirname, 'dist-test', f))
    .filter(f => !fs.statSync(f).isDirectory() && f.endsWith('.js'));

  const result = spawnSync('node', ['--test', ...testJsFiles], { stdio: 'inherit' });
  
  // Clean up
  fs.rmSync(path.join(__dirname, 'dist-test'), { recursive: true, force: true });
  
  process.exit(result.status ?? 0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
