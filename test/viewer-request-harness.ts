import * as nodeCrypto from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { renderViewerRequestCode } from '../infrastructure/stage/viewer-request';
import {
  SESSION_COOKIE_NAME,
  SessionPayload,
  signSessionCookieValue,
} from '../app/session/session-cookie';

/**
 * Runs the generated viewer-request CloudFront Function the way CloudFront evaluates it, with the runtime's `crypto`
 * module stood in for by Node's, which shares the HMAC API.
 */

export const TEST_HOST = 'docs.dev.umccr.org';
export const TEST_KID = '7';
/** 64 characters, like the keys the stack generates. */
export const TEST_KEY = 'k'.repeat(64);
export const TEST_SUB = 'reader-sub';

export type CfValue = { value: string };
export type CfQueryValue = { value: string; multiValue?: CfValue[] };

export interface CfRequest {
  uri: string;
  method: string;
  querystring: Record<string, CfQueryValue>;
  headers: Record<string, CfValue>;
  cookies: Record<string, CfValue>;
}

export interface CfResponse {
  statusCode: number;
  statusDescription?: string;
  headers?: Record<string, CfValue>;
  cookies?: Record<string, { value: string; attributes?: string }>;
}

export type ViewerRequestHandler = (event: { request: CfRequest }) => CfRequest | CfResponse;

export interface HarnessOptions {
  sites?: string[];
  canonicalHost?: string;
  /** The key generation deployed with the function. Defaults to {@link TEST_KID}. */
  keyId?: string;
  /** The key deployed with the function. Defaults to {@link TEST_KEY}. */
  key?: string;
}

export const loadViewerRequestHandler = (options: HarnessOptions = {}): ViewerRequestHandler => {
  const code = renderViewerRequestCode({
    sites: options.sites ?? ['platform', 'management-knowledgebase'],
    canonicalHost: options.canonicalHost,
    sessionKeyId: options.keyId ?? TEST_KID,
    sessionKey: options.key ?? TEST_KEY,
  }).replace("import crypto from 'crypto';", '');

  const sandbox: { handler?: ViewerRequestHandler } & Record<string, unknown> = {
    crypto: nodeCrypto,
    Buffer,
  };
  runInNewContext(code, sandbox);
  if (typeof sandbox.handler !== 'function') {
    throw new Error('generated viewer-request code does not declare handler()');
  }
  return sandbox.handler;
};

export const viewerRequest = (
  uri: string,
  init: {
    host?: string;
    cookie?: string;
    query?: Record<string, string | string[]>;
    headers?: Record<string, string>;
  } = {}
): CfRequest => ({
  uri,
  method: 'GET',
  querystring: Object.fromEntries(
    Object.entries(init.query ?? {}).map(([name, value]) =>
      Array.isArray(value)
        ? [name, { value: value[0], multiValue: value.map((item) => ({ value: item })) }]
        : [name, { value }]
    )
  ),
  headers: {
    host: { value: init.host ?? TEST_HOST },
    ...Object.fromEntries(
      Object.entries(init.headers ?? {}).map(([name, value]) => [name, { value }])
    ),
  },
  cookies: init.cookie ? { [SESSION_COOKIE_NAME]: { value: init.cookie } } : {},
});

export const sessionCookie = (
  overrides: Partial<SessionPayload> = {},
  key: string = TEST_KEY
): string => {
  const now = Math.floor(Date.now() / 1000);
  return signSessionCookieValue(
    { kid: TEST_KID, sub: TEST_SUB, aud: TEST_HOST, iat: now, exp: now + 3600, ...overrides },
    key
  );
};

export const isResponse = (result: CfRequest | CfResponse): result is CfResponse =>
  'statusCode' in result;
