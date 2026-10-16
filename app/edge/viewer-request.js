import crypto from 'crypto';

// CloudFront Function (viewer-request, runtime 2.0) on every behaviour of the docs distribution. It runs before the
// cache, so a request without a valid session never reaches cached or origin content.
//
// The CONFIG line below is REGENERATED AT SYNTH TIME with the sites published to the target stage, the canonical
// host and the session key; see renderViewerRequestCode() in ../viewer-request.ts. Keep it on one line: synth
// asserts it can replace it and fails if not. The literal default keeps this file valid JavaScript for eslint, and
// its empty key rejects every session.
//
// The key is not in the template CloudFormation stores: that holds a dynamic reference to the stack's Secrets
// Manager secret, which CloudFormation resolves while deploying this function. CloudFront Functions cannot call
// AWS APIs, so the deployed code has to contain it.
//
// Sign-in happens on the /_auth/ page with Amplify, as in the portal apps. That page exchanges the Cognito ID token
// for the __Host-docs_session cookie at /_auth/session (the session Lambda). This function only checks that cookie:
// CloudFront Functions can compute HMAC but cannot verify Cognito's RSA signatures. The cookie format is defined in
// ./session/session-cookie.ts; the two must agree.
//
// Runtime 2.0 supports a subset of ES2020: no optional chaining, object spread or computed property names here.
var CONFIG = { sites: ['platform'], canonicalHost: '', keyId: '', key: '' };

var SESSION_COOKIE = '__Host-docs_session';
var SIGN_IN_PAGE = '/_auth/';
var SESSION_ENDPOINT = '/_auth/session';
var SIGN_OUT_PATH = '/_auth/signout';
var PLATFORM_PREFIX = '/_platform/';
var PLATFORM_PUBLIC_PREFIX = '/_platform/public/';
var HOME = '/platform/';

// A key that never exists, so S3 answers 404 and the distribution serves its 404 page.
var NOT_FOUND_KEY = '/_platform/public/not-found';

// Served without a session. Everything else, including paths that do not exist, requires one, so an unauthenticated
// reader learns nothing about which pages exist.
var PUBLIC_FILES = {
  '/robots.txt': '/_platform/public/robots.txt',
  '/favicon.ico': '/_platform/public/favicon.ico',
};

// Clock skew allowed on a cookie's issued-at time, in seconds.
var CLOCK_SKEW = 60;

// Shortest session key accepted; the stack generates 64 characters. Matches MIN_SESSION_KEY_LENGTH in
// ./session/session-cookie.ts.
var MIN_KEY_LENGTH = 32;

var LAST_SEGMENT_HAS_EXTENSION = /\.[A-Za-z0-9]+$/;

function handler(event) {
  var request = event.request;
  var uri = request.uri;
  var host = request.headers.host ? request.headers.host.value : '';

  if (CONFIG.canonicalHost && host !== CONFIG.canonicalHost) {
    return redirect(301, 'https://' + CONFIG.canonicalHost + uri + queryString(request));
  }

  // --- Sign-in endpoints and public files: no session required ---

  if (uri === SESSION_ENDPOINT) {
    // The session Lambda scopes the cookie to the viewer's host, and signs only with the key this copy of the
    // function holds. Always overwrite both headers: never trust a client value.
    request.headers['x-docs-host'] = { value: host };
    if (hasKey()) {
      request.headers['x-docs-key-check'] = { value: keyCheck() };
    } else {
      delete request.headers['x-docs-key-check'];
    }
    return request;
  }
  if (uri === SIGN_OUT_PATH) {
    return withClearedSession(redirect(302, SIGN_IN_PAGE + '?signout=1'));
  }
  if (uri === '/_auth') {
    return redirect(301, SIGN_IN_PAGE + queryString(request));
  }
  if (uri.indexOf(SIGN_IN_PAGE) === 0) {
    if (uri === SIGN_IN_PAGE) {
      request.uri = SIGN_IN_PAGE + 'index.html';
    }
    return request;
  }
  if (Object.prototype.hasOwnProperty.call(PUBLIC_FILES, uri)) {
    request.uri = PUBLIC_FILES[uri];
    return request;
  }
  if (uri.indexOf(PLATFORM_PUBLIC_PREFIX) === 0) {
    return request;
  }

  // --- Everything below requires a signed-in reader ---

  if (!verifySession(request, host)) {
    return signInRequired(request);
  }

  if (uri === '/') {
    return redirect(302, HOME);
  }
  if (uri.indexOf(PLATFORM_PREFIX) === 0) {
    return request;
  }

  var segments = uri.split('/');
  var slug = segments[1];
  if (
    CONFIG.sites.indexOf(slug) === -1 ||
    segments.indexOf('..') !== -1 ||
    segments.indexOf('.') !== -1
  ) {
    request.uri = NOT_FOUND_KEY;
    return request;
  }

  // Clean URLs. MkDocs emits <page>/index.html and relative links that assume the trailing slash, so a directory
  // path without one is redirected rather than rewritten.
  var last = segments[segments.length - 1];
  if (segments.length === 2 || (last !== '' && !LAST_SEGMENT_HAS_EXTENSION.test(last))) {
    return redirect(301, uri + '/' + queryString(request));
  }
  request.uri = '/sites' + uri + (last === '' ? 'index.html' : '');
  return request;
}

function hasKey() {
  return typeof CONFIG.key === 'string' && CONFIG.key.length >= MIN_KEY_LENGTH;
}

/** The session payload if the request carries a valid, unexpired cookie for this host; otherwise null. */
function verifySession(request, host) {
  if (!hasKey()) {
    return null;
  }
  var cookie = request.cookies[SESSION_COOKIE];
  if (!cookie || !cookie.value) {
    return null;
  }
  var parts = cookie.value.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') {
    return null;
  }

  var payload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch (e) {
    return null;
  }
  if (!payload || typeof payload.sub !== 'string') {
    return null;
  }
  // A cookie signed with an earlier key: rotated out, so the reader renews through sign-in.
  if (payload.kid !== CONFIG.keyId) {
    return null;
  }

  var now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= now) {
    return null;
  }
  if (typeof payload.iat !== 'number' || payload.iat > now + CLOCK_SKEW) {
    return null;
  }
  if (payload.aud !== host) {
    return null;
  }

  var expected = crypto
    .createHmac('sha256', CONFIG.key)
    .update(parts[0] + '.' + parts[1])
    .digest('base64url');
  return constantTimeEqual(expected, parts[2]) ? payload : null;
}

/**
 * Identifies this function's key to the session Lambda without revealing it. The Lambda refuses to sign with a
 * different key, so a reader is never handed a cookie this edge location would reject. Matches sessionKeyCheck() in
 * ./session/session-cookie.ts.
 */
function keyCheck() {
  return crypto
    .createHmac('sha256', CONFIG.key)
    .update('docs-key-check.' + CONFIG.keyId)
    .digest('base64url');
}

/**
 * Page navigations go to the sign-in page, which returns the reader here afterwards. Other requests (the theme's
 * instant navigation, the search index, images) get a bare 401, so the theme falls back to a full page load instead
 * of rendering the sign-in page as content.
 */
function signInRequired(request) {
  var mode = request.headers['sec-fetch-mode'];
  if (mode && mode.value !== 'navigate') {
    return { statusCode: 401, statusDescription: 'Unauthorized', headers: noStore() };
  }
  return redirect(302, SIGN_IN_PAGE + '?rd=' + encodeURIComponent(request.uri + queryString(request)));
}

function redirect(statusCode, location) {
  var headers = noStore();
  headers.location = { value: location };
  return {
    statusCode: statusCode,
    statusDescription: statusCode === 301 ? 'Moved Permanently' : 'Found',
    headers: headers,
  };
}

function withClearedSession(response) {
  var cookies = {};
  cookies[SESSION_COOKIE] = {
    value: '',
    attributes: 'Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0',
  };
  response.cookies = cookies;
  return response;
}

function noStore() {
  return { 'cache-control': { value: 'no-store' } };
}

/** Rebuild the query string exactly as received, so a redirect keeps it. */
function queryString(request) {
  var query = request.querystring;
  var parts = [];
  for (var name in query) {
    if (!Object.prototype.hasOwnProperty.call(query, name)) {
      continue;
    }
    var values = query[name].multiValue ? query[name].multiValue : [query[name]];
    for (var i = 0; i < values.length; i++) {
      parts.push(values[i].value === '' ? name : name + '=' + values[i].value);
    }
  }
  return parts.length ? '?' + parts.join('&') : '';
}

function constantTimeEqual(a, b) {
  if (typeof b !== 'string' || a.length !== b.length) {
    return false;
  }
  var difference = 0;
  for (var i = 0; i < a.length; i++) {
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return difference === 0;
}
