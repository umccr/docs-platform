import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, test } from '@jest/globals';
import { buildAuthWeb } from '../app/auth-web/build';
import {
  isSignInLoop,
  oauthDomainFor,
  oauthErrorMessage,
  recentExchanges,
  safeReturnPath,
  sessionErrorMessage,
  SIGN_IN_FAILED_MESSAGE,
  SIGN_IN_LOOP_LIMIT,
  SIGN_IN_LOOP_WINDOW_MS,
} from '../app/auth-web/src/paths';

/** The `/_auth/` sign-in page: return-path safety, config handling, loop detection and the built output. */

describe('safeReturnPath', () => {
  test.each([
    ['/platform/', '/platform/'],
    [
      '/management-knowledgebase/Projects/portal-hub/',
      '/management-knowledgebase/Projects/portal-hub/',
    ],
    ['/platform/search/?q=cognito#results', '/platform/search/?q=cognito#results'],
  ])('keeps the same-host path %s', (raw, expected) => {
    expect(safeReturnPath(raw)).toBe(expected);
  });

  test.each([
    [null],
    [undefined],
    [''],
    ['https://evil.example.com/'],
    ['//evil.example.com/'],
    ['/\\evil.example.com/'],
    ['javascript:alert(1)'],
    ['platform/'],
    ['/platform/\nSet-Cookie: x'],
    ['/_auth/'],
    ['/_auth/?rd=/platform/'],
    ['/_auth'],
    [`/${'a'.repeat(3000)}`],
  ])('replaces %p with the home page', (raw) => {
    expect(safeReturnPath(raw)).toBe('/');
  });
});

describe('oauthDomainFor', () => {
  test('expands the hosted UI domain prefix SSM stores', () => {
    expect(oauthDomainFor('data-portal-app-dev', 'ap-southeast-2')).toBe(
      'data-portal-app-dev.auth.ap-southeast-2.amazoncognito.com'
    );
  });

  test('keeps a full host name', () => {
    expect(oauthDomainFor('login.example.org', 'ap-southeast-2')).toBe('login.example.org');
  });
});

describe('sessionErrorMessage', () => {
  test('asks the reader to wait when sign-in is unavailable', () => {
    expect(sessionErrorMessage('unavailable')).toContain('try again in a few minutes');
  });

  test('falls back to a generic message', () => {
    expect(sessionErrorMessage(undefined)).toBe('Sign-in did not complete. Please try again.');
  });
});

describe('oauthErrorMessage', () => {
  test('explains a cancelled or refused sign-in', () => {
    expect(oauthErrorMessage('access_denied')).toContain('cancelled or refused');
  });

  // The page never echoes the URL: a link could otherwise put any text on the real sign-in page.
  test.each([[null], ['server_error'], ['Call 555-0100 to unlock your account']])(
    'shows the generic message for %p',
    (code) => {
      expect(oauthErrorMessage(code)).toBe(SIGN_IN_FAILED_MESSAGE);
    }
  );
});

describe('sign-in loop detection', () => {
  const now = 1_800_000_000_000;

  test(`allows ${SIGN_IN_LOOP_LIMIT} cookie exchanges in quick succession`, () => {
    let exchanges: number[] = [];
    for (let index = 0; index < SIGN_IN_LOOP_LIMIT; index++) {
      exchanges = recentExchanges(exchanges, now + index * 1000);
      expect(isSignInLoop(exchanges)).toBe(false);
    }
  });

  test('stops at the next one inside the window', () => {
    const exchanges = recentExchanges([now - 3000, now - 2000, now - 1000], now);
    expect(isSignInLoop(exchanges)).toBe(true);
  });

  test('forgets exchanges outside the window', () => {
    const edge = now - SIGN_IN_LOOP_WINDOW_MS;
    expect(recentExchanges([edge, edge + 1, edge + 2], now)).toEqual([edge + 1, edge + 2, now]);
    expect(isSignInLoop(recentExchanges([edge, edge, edge, edge], now))).toBe(false);
  });

  test.each([[null], ['[1,2]'], [{ length: 5 }], [['x', now - 1000, now + 5000]]])(
    'ignores whatever else sessionStorage held: %p',
    (stored) => {
      const exchanges = recentExchanges(stored, now);
      expect(exchanges.every((time) => typeof time === 'number' && time <= now)).toBe(true);
      expect(exchanges[exchanges.length - 1]).toBe(now);
    }
  );
});

describe('built sign-in page', () => {
  const directory = buildAuthWeb();

  test('contains the bundles and static files, but no env.js', () => {
    expect(fs.readdirSync(directory).sort()).toEqual([
      'app.js',
      'index.html',
      'styles.css',
      'token.js',
    ]);
    expect(fs.statSync(path.join(directory, 'app.js')).size).toBeGreaterThan(1000);
  });

  test("bundles the chat panel's token helper, which sets window.umccrDocsAuth", () => {
    const token = fs.readFileSync(path.join(directory, 'token.js'), 'utf8');
    expect(token).toContain('umccrDocsAuth');
    expect(token).toContain('VITE_SONAR_API_URL');
  });

  test('loads its runtime config before the bundle and has no inline script', () => {
    const html = fs.readFileSync(path.join(directory, 'index.html'), 'utf8');
    const scripts = [...html.matchAll(/<script([^>]*)>/g)].map((match) => match[1]);

    // The sign-in page's CSP is script-src 'self' with no 'unsafe-inline'.
    expect(scripts.every((attributes) => /\ssrc="/.test(attributes))).toBe(true);
    expect(html.indexOf('/_auth/env.js')).toBeLessThan(html.indexOf('/_auth/app.js'));
    expect(html).not.toMatch(/style="/);
  });

  test('bundles Amplify for the Google redirect', () => {
    const bundle = fs.readFileSync(path.join(directory, 'app.js'), 'utf8');
    expect(bundle).toContain('/_auth/session');
    expect(bundle).toContain('Google');
  });
});
