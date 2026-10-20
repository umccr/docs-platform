/**
 * Pure helpers for the docs sign-in page, kept free of browser and Amplify imports so they can be unit tested.
 */

/** The sign-in page. Also the Cognito callback and logout URL, registered per host in cognito_aai `app_docs.tf`. */
export const SIGN_IN_PATH = '/_auth/';

/** The session endpoint (the session Lambda behind CloudFront). */
export const SESSION_PATH = '/_auth/session';

const MAX_RETURN_PATH_LENGTH = 2048;

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/**
 * The path to return to after sign-in, or `/` when `raw` is not a safe same-host path.
 *
 * The edge function passes the requested path in `?rd=`. Only a plain absolute path on this host is accepted: no
 * scheme, no protocol-relative `//host`, no backslashes (which some browsers treat as `/`), no control characters,
 * and never the sign-in page itself, which would loop.
 */
export const safeReturnPath = (raw: string | null | undefined): string => {
  if (!raw || raw.length > MAX_RETURN_PATH_LENGTH) {
    return '/';
  }
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) {
    return '/';
  }
  if (CONTROL_CHARACTERS.test(raw)) {
    return '/';
  }
  if (raw === '/_auth' || raw.startsWith(SIGN_IN_PATH)) {
    return '/';
  }
  return raw;
};

/** SSM stores the hosted UI domain prefix (e.g. `data-portal-app-dev`); a full host name is passed through. */
export const oauthDomainFor = (domain: string, region: string): string =>
  domain.includes('.') ? domain : `${domain}.auth.${region}.amazoncognito.com`;

/** Shown when sign-in fails for a reason the page does not explain. */
export const SIGN_IN_FAILED_MESSAGE = 'Sign-in did not complete. Please try again.';

/** Error codes returned by the session Lambda; see `lambda/session/session.ts`. */
export const sessionErrorMessage = (code: string | undefined): string => {
  switch (code) {
    case 'invalid-token':
    case 'missing-token':
      return 'Your sign-in could not be verified. Please sign in again.';
    case 'unavailable':
      return 'Sign-in is temporarily unavailable. Please try again in a few minutes.';
    default:
      return SIGN_IN_FAILED_MESSAGE;
  }
};

/**
 * The message for an error the hosted UI returns in `?error=`. Only the code chooses it: `error_description` is free
 * text that anyone can put in a link to this page, so the page never shows it.
 */
export const oauthErrorMessage = (code: string | null): string =>
  code === 'access_denied'
    ? 'Sign-in was cancelled or refused. Sign in with your UMCCR account to continue.'
    : SIGN_IN_FAILED_MESSAGE;

/**
 * Session cookies issued this recently count towards a sign-in loop. Normally a reader gets one cookie per session
 * (8 hours); several within two minutes means the edge keeps rejecting them.
 */
export const SIGN_IN_LOOP_WINDOW_MS = 2 * 60 * 1000;

/** More cookies than this within the window is a loop. */
export const SIGN_IN_LOOP_LIMIT = 3;

export const SIGN_IN_LOOP_MESSAGE =
  'Signing in keeps repeating. Check that your browser allows cookies for this site, then try again in a minute.';

/**
 * The times of recent cookie exchanges after one more at `now`, dropping those outside the window and anything that
 * is not a timestamp (the list comes from sessionStorage).
 */
export const recentExchanges = (previous: unknown, now: number): number[] => [
  ...(Array.isArray(previous) ? previous : []).filter(
    (time): time is number =>
      typeof time === 'number' && time <= now && now - time < SIGN_IN_LOOP_WINDOW_MS
  ),
  now,
];

export const isSignInLoop = (exchanges: number[]): boolean => exchanges.length > SIGN_IN_LOOP_LIMIT;
