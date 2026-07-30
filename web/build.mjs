import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isWatch = process.argv.includes('--watch');

const buildOptions = {
  entryPoints: [path.join(__dirname, 'src/main.tsx')],
  bundle: true,
  minify: !isWatch,
  sourcemap: true,
  target: 'es2022',
  outdir: path.join(__dirname, '../hermes/static'),
  entryNames: 'app',
  logLevel: 'info',
};

function copyIndexHtml() {
  const src = path.join(__dirname, 'index.html');
  const dest = path.join(__dirname, '../hermes/static/index.html');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  console.log(`[build] Copied index.html to ${dest}`);
}

async function run() {
  copyIndexHtml();
  if (isWatch) {
    console.log('[build] Starting esbuild watch mode...');
    const ctx = await esbuild.context({
      ...buildOptions,
      plugins: [{
        name: 'on-rebuild',
        setup(build) {
          build.onEnd(result => {
            if (result.errors.length === 0) {
              copyIndexHtml();
            }
          });
        }
      }]
    });
    await ctx.watch();
  } else {
    await esbuild.build(buildOptions);
    copyIndexHtml();
    console.log('[build] Build completed successfully.');
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
