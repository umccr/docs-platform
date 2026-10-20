import * as fs from 'fs';
import * as path from 'path';

const VIEWER_REQUEST_TEMPLATE_PATH = path.join(
  __dirname,
  '..',
  '..',
  'app',
  'edge',
  'viewer-request.js'
);

/**
 * Matches the whole single-line `var CONFIG = {...};` declaration. Strict on purpose, as in the portal's
 * `renderSpaRewriteCode`: a looser pattern could replace half of a reformatted multi-line object.
 */
const CONFIG_DECLARATION = /^var CONFIG = \{[^\n]*\};$/m;

export interface ViewerRequestConfig {
  /** Slugs published to this stage. Any other first path segment is a 404. */
  readonly sites: string[];
  /** Host every other host redirects to, if set. */
  readonly canonicalHost?: string;
  /** ID of the session key, carried in every cookie as `kid`. */
  readonly sessionKeyId: string;
  /**
   * The session key. In the stack, a CDK token for a Secrets Manager dynamic reference, which CloudFormation
   * resolves during deployment, so the synthesized template never contains the key. The value is pasted into a
   * JavaScript string literal, which is why the stack generates it from letters and digits only.
   */
  readonly sessionKey: string;
}

/**
 * Bake the stage's configuration into the viewer-request function. CloudFront Functions take no environment
 * variables, so the values have to be generated into the source. Generating the slug table from the same registry
 * that creates the publisher roles keeps routing and publishing from drifting apart.
 */
export const renderViewerRequestCode = (config: ViewerRequestConfig): string => {
  const template = fs.readFileSync(VIEWER_REQUEST_TEMPLATE_PATH, 'utf8');

  if (!CONFIG_DECLARATION.test(template)) {
    throw new Error(
      `${VIEWER_REQUEST_TEMPLATE_PATH} must contain a single-line "var CONFIG = {...};" declaration for synth to ` +
        'replace. Restore it to one line before deploying.'
    );
  }

  const rendered = {
    sites: config.sites,
    canonicalHost: config.canonicalHost ?? '',
    keyId: config.sessionKeyId,
    key: config.sessionKey,
  };
  return stripComments(
    template.replace(CONFIG_DECLARATION, `var CONFIG = ${JSON.stringify(rendered)};`)
  );
};

/**
 * CloudFront Functions are limited to 10 KB of code, and the slug table grows with every site. The explanation
 * stays in the template; the deployed code drops block comments, whole-line `//` comments and blank lines. The
 * template has no `/*` or leading `//` inside a string, which this relies on.
 */
const stripComments = (code: string): string =>
  code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => line.trim() !== '' && !/^\s*\/\//.test(line))
    .join('\n');

/** CloudFront's limit on a function's code size, in bytes. */
export const CLOUDFRONT_FUNCTION_MAX_BYTES = 10 * 1024;
