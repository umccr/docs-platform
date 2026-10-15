import {
  completeRedirect,
  configureAuth,
  forgetCognitoSession,
  forgetSessionExchanges,
  getIdToken,
  hasCognitoSession,
  isReturningFromCognito,
  recordSessionExchange,
  rememberReturnPath,
  signIn,
  signOutEverywhere,
  takeRedirectError,
  takeReturnPath,
  takeSignedOut,
} from './auth';
import { sessionErrorMessage, SESSION_PATH, SIGN_IN_LOOP_MESSAGE } from './paths';

/**
 * The `/_auth/` page. States follow orcahouse-ui's AuthGate: checking → signed out (with an optional message) →
 * signed in, where "signed in" means the docs session cookie is set and the reader goes back to the page they asked
 * for.
 */

const element = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id);
  if (!found) {
    throw new Error(`Sign-in page is missing #${id}`);
  }
  return found as T;
};

function showChecking(text: string): void {
  element('status').textContent = text;
  element('status').hidden = false;
  element('signin').hidden = true;
}

function showSignIn(message?: string | null): void {
  const alert = element('message');
  alert.textContent = message ?? '';
  alert.hidden = !message;
  element('status').hidden = true;
  element('signin').hidden = false;
}

/**
 * Swap the Amplify ID token for the docs session cookie, then return to the requested page. The session Lambda
 * checks the token the way the OrcaBus API authorizers do before setting the cookie.
 */
async function exchangeForSession(): Promise<void> {
  const token = await getIdToken({ forceRefresh: true });
  if (!token) {
    // The Cognito session could not be renewed, so the next attempt must be a fresh sign-in.
    forgetCognitoSession();
    showSignIn(takeRedirectError());
    return;
  }

  let response: Response;
  try {
    response = await fetch(SESSION_PATH, {
      headers: { 'x-docs-id-token': token.toString() },
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    showSignIn(sessionErrorMessage('unavailable'));
    return;
  }

  if (response.status === 204) {
    if (recordSessionExchange()) {
      // The edge keeps sending the reader back despite fresh cookies: stop and explain rather than loop.
      showSignIn(SIGN_IN_LOOP_MESSAGE);
      return;
    }
    window.location.replace(takeReturnPath());
    return;
  }

  let code: string | undefined;
  try {
    code = ((await response.json()) as { error?: string }).error;
  } catch {
    // Not a session Lambda response; fall back to the generic message.
  }
  showSignIn(sessionErrorMessage(code));
}

async function startSignIn(button: HTMLButtonElement): Promise<void> {
  // The reader is retrying by hand, so any earlier loop no longer counts.
  forgetSessionExchanges();
  if (hasCognitoSession()) {
    // Still signed in to Cognito, for example after an error on this page. Amplify refuses a second sign-in while
    // one is active, so retry the exchange instead.
    showChecking('Checking sign-in…');
    await exchangeForSession();
    return;
  }

  button.disabled = true;
  button.textContent = 'Redirecting…';
  try {
    // Resolves as the browser leaves for the hosted UI.
    await signIn();
  } catch (error) {
    button.disabled = false;
    button.textContent = 'Sign in with UMCCR account';
    showSignIn(error instanceof Error ? error.message : 'Sign-in failed.');
  }
}

async function start(): Promise<void> {
  element('year').textContent = String(new Date().getFullYear());

  const params = new URLSearchParams(window.location.search);
  if (params.has('rd')) {
    rememberReturnPath(params.get('rd'));
  }

  const button = element<HTMLButtonElement>('signin-button');
  if (!configureAuth()) {
    button.disabled = true;
    showSignIn('Sign-in is not configured: the runtime config (env.js) did not load.');
    return;
  }
  button.addEventListener('click', () => void startSignIn(button));

  if (params.get('signout') === '1') {
    showChecking('Signing out…');
    await signOutEverywhere();
    return;
  }
  if (takeSignedOut()) {
    showSignIn('You have signed out.');
    return;
  }
  if (params.has('error')) {
    showSignIn(params.get('error_description') ?? 'Sign-in did not complete.');
    return;
  }

  if (isReturningFromCognito()) {
    showChecking('Completing sign-in…');
    if (!(await completeRedirect())) {
      showSignIn(takeRedirectError());
      return;
    }
    await exchangeForSession();
    return;
  }

  if (hasCognitoSession()) {
    // A returning reader: Amplify still holds a refresh token, so renew silently.
    showChecking('Checking sign-in…');
    await exchangeForSession();
    return;
  }

  showSignIn();
}

void start();
