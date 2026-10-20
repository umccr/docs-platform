import { Amplify } from 'aws-amplify';
import { fetchAuthSession, signInWithRedirect, signOut, type JWT } from 'aws-amplify/auth';
import { Hub } from 'aws-amplify/utils';
import 'aws-amplify/auth/enable-oauth-listener';
import {
  isSignInLoop,
  oauthDomainFor,
  recentExchanges,
  safeReturnPath,
  SIGN_IN_FAILED_MESSAGE,
  SIGN_IN_PATH,
} from './paths';

/**
 * Cognito sign-in through the hosted UI with Google federation, as in the OrcaBus portal apps.
 *
 * Adapted from umccr/orcahouse-ui `src/lib/auth.ts` (configuration, return path, redirect errors) and
 * OrcaBus/orca-ui-v2 `src/context/AmplifyAuthProvider.tsx` (session detection, sign-out cleanup). The docs site is a
 * separate origin with its own app client, `docs-app-<stage>`, so it does not share the portal's session.
 *
 * Settings come from `/_auth/env.js` (`window.config`), written at deploy time by the docs hosting stack with the
 * same keys the portal's env.js uses.
 */

declare global {
  interface Window {
    /** Runtime config, set by `/_auth/env.js`. */
    config?: Record<string, string | undefined>;
  }
}

const RETURN_PATH_KEY = 'docs.return-path';
const SIGNED_OUT_KEY = 'docs.signed-out';
const EXCHANGES_KEY = 'docs.session-exchanges';
const COGNITO_STORAGE_PREFIX = 'CognitoIdentityServiceProvider';

let redirectError: string | null = null;
let redirectResult: Promise<boolean> = Promise.resolve(true);
let configured: boolean | null = null;

/** True on the page load that returns from the hosted UI with an authorization code. */
export const isReturningFromCognito = (): boolean => {
  const params = new URLSearchParams(window.location.search);
  return ['code', 'state'].every((key) => params.has(key));
};

/**
 * Configure Amplify once from the runtime config. Returns false when env.js did not provide the Cognito settings.
 */
export function configureAuth(): boolean {
  if (configured !== null) {
    return configured;
  }

  const runtime = window.config ?? {};
  const region = runtime.VITE_REGION || 'ap-southeast-2';
  const userPoolId = runtime.VITE_COG_USER_POOL_ID;
  const userPoolClientId = runtime.VITE_COG_APP_CLIENT_ID;
  const oauthDomain = runtime.VITE_OAUTH_DOMAIN;
  if (!userPoolId || !userPoolClientId || !oauthDomain) {
    configured = false;
    return configured;
  }

  // Listen before configure() starts completing a redirect: the outcome can settle before anything else runs.
  if (isReturningFromCognito()) {
    redirectResult = new Promise((resolve) => {
      const stop = Hub.listen('auth', ({ payload }) => {
        if (payload.event === 'signInWithRedirect') {
          stop();
          resolve(true);
        } else if (payload.event === 'signInWithRedirect_failure') {
          // Amplify's message can be the URL's error_description, which a link can set: log it, never show it.
          console.warn('Sign-in did not complete:', payload.data.error?.message);
          redirectError = SIGN_IN_FAILED_MESSAGE;
          stop();
          resolve(false);
        }
      });
    });
  }

  /**
   * Where Cognito returns the reader after sign-in and sign-out: this page, on the current host. This exact string
   * is registered for every docs host on the `docs-app` client; apply cognito_aai before changing it.
   */
  const appUrl = `${window.location.origin}${SIGN_IN_PATH}`;

  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId,
        userPoolClientId,
        loginWith: {
          oauth: {
            domain: oauthDomainFor(oauthDomain, region),
            scopes: ['openid', 'email', 'profile'],
            redirectSignIn: [appUrl],
            redirectSignOut: [appUrl],
            responseType: 'code',
          },
        },
      },
    },
  });

  configured = true;
  return configured;
}

/** Resolves once a returning hosted UI redirect has completed: true on success, false on failure. */
export const completeRedirect = (): Promise<boolean> => redirectResult;

/** The error from a failed hosted UI redirect on this page load, reported once. */
export function takeRedirectError(): string | null {
  const error = redirectError;
  redirectError = null;
  return error;
}

/** Whether Amplify holds tokens for any user on this origin (orca-ui-v2's fast path). */
export const hasCognitoSession = (): boolean => {
  try {
    return Object.keys(window.localStorage).some((key) => key.startsWith(COGNITO_STORAGE_PREFIX));
  } catch {
    return false;
  }
};

/**
 * A current ID token, or null when signed out. `forceRefresh` makes Cognito re-issue it from the refresh token, so a
 * disabled user or a revoked refresh token fails here instead of minting another docs session.
 */
export async function getIdToken(options?: { forceRefresh?: boolean }): Promise<JWT | null> {
  try {
    const { tokens } = await fetchAuthSession(options);
    return tokens?.idToken ?? null;
  } catch {
    return null;
  }
}

/** Sends the browser to the hosted UI, which forwards straight to Google. */
export async function signIn(): Promise<void> {
  await signInWithRedirect({ provider: 'Google' });
}

/** Signs out of Amplify and Cognito. Resolves as the browser leaves for the hosted UI logout endpoint. */
export async function signOutEverywhere(): Promise<void> {
  markSignedOut();
  try {
    // Revokes the refresh token, clears local tokens, then redirects through Cognito's /logout back to this page.
    await signOut();
  } finally {
    clearAuthStorage();
  }
}

/**
 * Drop Amplify's tokens after they failed to renew (a disabled user, an expired or revoked refresh token), so the
 * next "Sign in" starts a fresh sign-in instead of retrying a dead session.
 */
export function forgetCognitoSession(): void {
  clearAuthStorage();
}

/** Remove Amplify's tokens only; nothing else on this origin is touched. */
function clearAuthStorage(): void {
  try {
    Object.keys(window.localStorage)
      .filter((key) => key.startsWith(COGNITO_STORAGE_PREFIX))
      .forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // Storage unavailable: nothing to clear.
  }
}

/** Remember where to go after sign-in. The hosted UI round trip drops the query string, so it is kept here. */
export function rememberReturnPath(raw: string | null): void {
  try {
    window.sessionStorage.setItem(RETURN_PATH_KEY, safeReturnPath(raw));
  } catch {
    // Storage unavailable: the reader lands on the home page instead.
  }
}

/** The remembered return path, validated again on the way out, or `/`. */
export function takeReturnPath(): string {
  let path: string | null = null;
  try {
    path = window.sessionStorage.getItem(RETURN_PATH_KEY);
    window.sessionStorage.removeItem(RETURN_PATH_KEY);
  } catch {
    // Fall through to the home page.
  }
  return safeReturnPath(path);
}

function markSignedOut(): void {
  try {
    window.sessionStorage.setItem(SIGNED_OUT_KEY, '1');
  } catch {
    // The signed-out message is cosmetic.
  }
}

/** True once, on the first load after signing out. */
export function takeSignedOut(): boolean {
  try {
    const signedOut = window.sessionStorage.getItem(SIGNED_OUT_KEY) === '1';
    window.sessionStorage.removeItem(SIGNED_OUT_KEY);
    return signedOut;
  } catch {
    return false;
  }
}

/**
 * Record a successful cookie exchange, and report whether exchanges are repeating in a loop: the edge rejecting
 * every cookie this tab receives, usually because the browser blocks cookies for this site.
 */
export function recordSessionExchange(now: number = Date.now()): boolean {
  let previous: unknown = [];
  try {
    previous = JSON.parse(window.sessionStorage.getItem(EXCHANGES_KEY) ?? '[]');
  } catch {
    // Unreadable: count from this exchange.
  }
  const exchanges = recentExchanges(previous, now);
  try {
    window.sessionStorage.setItem(EXCHANGES_KEY, JSON.stringify(exchanges));
  } catch {
    // Storage unavailable: a loop cannot be detected, but sign-in still works.
  }
  return isSignInLoop(exchanges);
}

/** Count exchanges afresh, when the reader retries by hand. */
export function forgetSessionExchanges(): void {
  try {
    window.sessionStorage.removeItem(EXCHANGES_KEY);
  } catch {
    // Nothing to forget.
  }
}
