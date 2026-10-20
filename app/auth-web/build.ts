import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildSync } from 'esbuild';

/** Static files copied as they are, next to the bundled `app.js`. */
const STATIC_FILES = ['index.html', 'styles.css'];

let builtDirectory: string | undefined;

/**
 * Build the `/_auth/` sign-in page into a directory for `Source.asset`: `app.js` bundled from `src/main.ts` with
 * Amplify, `token.js` from `src/token.ts` for the chat panel, plus the static files. `env.js` is not part of the
 * build; the hosting stack writes it at deploy time, so one build serves every stage.
 *
 * Runs at synth, like the session Lambda's bundling, using the repository's own esbuild. The output is deterministic,
 * so the asset hash only changes when the page does. Built once per process and reused by every stage.
 */
export const buildAuthWeb = (): string => {
  if (builtDirectory) {
    return builtDirectory;
  }

  const outDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-auth-web-'));
  buildSync({
    entryPoints: {
      app: path.join(__dirname, 'src', 'main.ts'),
      token: path.join(__dirname, 'src', 'token.ts'),
    },
    outdir: outDirectory,
    bundle: true,
    minify: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    legalComments: 'none',
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'warning',
  });

  for (const file of STATIC_FILES) {
    fs.copyFileSync(path.join(__dirname, file), path.join(outDirectory, file));
  }

  builtDirectory = outDirectory;
  return outDirectory;
};
