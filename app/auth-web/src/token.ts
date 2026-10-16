import { configureAuth, getIdToken } from './auth';

/**
 * The chat panel's view of the reader's sign-in, served as `/_auth/token.js`.
 *
 * Content pages carry no Amplify code. The theme's chat panel loads `/_auth/env.js` and then this script the first
 * time it opens, so only readers who use chat download Amplify. Amplify keeps its tokens in this origin's
 * localStorage, where the sign-in page put them, so this script sees the same session without another sign-in.
 *
 * OrcaSonar checks the Cognito ID token, the way the OrcaBus APIs do for the portal apps; the docs session cookie
 * belongs to docs.umccr.org and is never sent to OrcaSonar.
 */

export interface DocsAuth {
  /** OrcaSonar's API base URL for this stage, from `env.js`, or null when chat is not configured. */
  readonly sonarApiUrl: string | null;
  /**
   * A current ID token as a string, or null when the reader has no Cognito session (the panel then sends them
   * through `/_auth/`). `forceRefresh` asks Cognito for a new one, which the panel does once after a 401.
   */
  getIdToken(options?: { forceRefresh?: boolean }): Promise<string | null>;
}

declare global {
  interface Window {
    umccrDocsAuth?: DocsAuth;
  }
}

/** Refresh a token this close to expiry, so it cannot expire while a streamed answer is in flight. */
export const REFRESH_MARGIN_SECONDS = 120;

export const createDocsAuth = (now: () => number = Date.now): DocsAuth => ({
  sonarApiUrl: window.config?.VITE_SONAR_API_URL || null,

  async getIdToken(options) {
    if (!configureAuth()) {
      return null;
    }
    let token = await getIdToken(options);
    const expiresAt = token?.payload.exp;
    if (
      token &&
      !options?.forceRefresh &&
      typeof expiresAt === 'number' &&
      expiresAt - now() / 1000 < REFRESH_MARGIN_SECONDS
    ) {
      token = await getIdToken({ forceRefresh: true });
    }
    return token ? token.toString() : null;
  },
});

window.umccrDocsAuth = createDocsAuth();
