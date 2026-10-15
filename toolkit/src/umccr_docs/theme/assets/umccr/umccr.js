/*
 * The only script on docs.umccr.org pages besides the theme's own. Projects cannot add scripts: every site shares
 * one origin, and the sign-in page keeps Amplify's tokens in that origin's storage.
 *
 * 1. Account menu: shows who is signed in, read from the ID token Amplify stored at sign-in (the same
 *    CognitoIdentityServiceProvider.* keys the portal apps use). Display only; the edge enforces the session.
 * 2. Catalogue: renders the registered sites into #umccr-catalogue from /_platform/data/catalog.json.
 * 3. Chat panel: asks OrcaSonar, UMCCR's documentation search and answer service. On first open it loads
 *    /_auth/env.js and /_auth/token.js, which hold the platform's Amplify code; OrcaSonar checks the reader's
 *    Cognito ID token, not the docs session cookie. Answers and sources are rendered as text, never as HTML.
 */
(function () {
  'use strict';

  var COGNITO_PREFIX = 'CognitoIdentityServiceProvider.';

  function signedInUser() {
    try {
      var keys = Object.keys(window.localStorage);
      for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        if (key.indexOf(COGNITO_PREFIX) !== 0 || key.slice(-'.LastAuthUser'.length) !== '.LastAuthUser') {
          continue;
        }
        var clientPrefix = key.slice(0, -'LastAuthUser'.length);
        var username = window.localStorage.getItem(key);
        var token = username && window.localStorage.getItem(clientPrefix + username + '.idToken');
        if (!token) {
          continue;
        }
        var payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        var claims = JSON.parse(decodeURIComponent(escape(window.atob(payload))));
        var email = typeof claims.email === 'string' ? claims.email : '';
        var name =
          claims.name ||
          [claims.given_name, claims.family_name].filter(Boolean).join(' ') ||
          email.split('@')[0].split(/[._-]+/).map(function (part) {
            return part.charAt(0).toUpperCase() + part.slice(1);
          }).join(' ');
        return { name: name || 'Signed-in user', email: email };
      }
    } catch (error) {
      // Storage unavailable or a malformed token: fall back to the anonymous menu.
    }
    return null;
  }

  function initials(name) {
    return (
      name
        .split(/\s+/)
        .filter(Boolean)
        .map(function (part) {
          return part.charAt(0);
        })
        .join('')
        .slice(0, 2)
        .toUpperCase() || '?'
    );
  }

  function link(text, href) {
    var anchor = document.createElement('a');
    anchor.href = href;
    anchor.textContent = text;
    return anchor;
  }

  function renderAccount() {
    var header = document.querySelector('.md-header__inner');
    if (!header || header.querySelector('.umccr-account')) {
      return;
    }
    var user = signedInUser();

    var container = document.createElement('div');
    container.className = 'umccr-account';

    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'umccr-account__button';
    button.setAttribute('aria-haspopup', 'true');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-label', user ? 'Account: ' + user.name : 'Account');
    button.textContent = user ? initials(user.name) : '?';

    var menu = document.createElement('div');
    menu.className = 'umccr-account__menu';
    menu.hidden = true;

    if (user) {
      var identity = document.createElement('div');
      identity.className = 'umccr-account__identity';
      var strong = document.createElement('strong');
      strong.textContent = user.name;
      identity.appendChild(strong);
      if (user.email) {
        var email = document.createElement('span');
        email.textContent = user.email;
        identity.appendChild(email);
      }
      menu.appendChild(identity);
    }
    menu.appendChild(link('All UMCCR documentation', '/platform/'));
    menu.appendChild(link('Sign out', '/_auth/signout'));

    button.addEventListener('click', function (event) {
      event.stopPropagation();
      menu.hidden = !menu.hidden;
      button.setAttribute('aria-expanded', String(!menu.hidden));
    });
    document.addEventListener('click', function () {
      menu.hidden = true;
      button.setAttribute('aria-expanded', 'false');
    });

    container.appendChild(button);
    container.appendChild(menu);
    header.appendChild(container);
  }

  function renderCatalogue() {
    var target = document.getElementById('umccr-catalogue');
    if (!target || target.getAttribute('data-loaded')) {
      return;
    }
    target.setAttribute('data-loaded', 'true');
    target.textContent = 'Loading…';

    fetch('/_platform/data/catalog.json', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (response) {
        if (!response.ok) {
          throw new Error('HTTP ' + response.status);
        }
        return response.json();
      })
      .then(function (catalogue) {
        target.textContent = '';
        target.className = 'umccr-catalogue';
        (catalogue.sites || []).forEach(function (site) {
          var card = document.createElement('a');
          card.className = 'umccr-catalogue__site';
          card.href = site.url;
          var title = document.createElement('strong');
          title.textContent = site.title;
          var description = document.createElement('span');
          description.textContent = site.description || '';
          card.appendChild(title);
          card.appendChild(description);
          target.appendChild(card);
        });
      })
      .catch(function () {
        target.textContent = 'The catalogue could not be loaded. Refresh the page to try again.';
      });
  }

  // ---------------------------------------------------------------------------------------------------------------
  // 3. Chat panel

  var DOCS_ORIGIN = 'https://docs.umccr.org';
  var authLoading = null;

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = function () {
        reject(new Error('Could not load ' + src));
      };
      document.head.appendChild(script);
    });
  }

  /** The platform's token helper, loaded once, the first time the panel opens. */
  function loadAuth() {
    if (!authLoading) {
      authLoading = loadScript('/_auth/env.js')
        .then(function () {
          return loadScript('/_auth/token.js');
        })
        .then(function () {
          if (!window.umccrDocsAuth) {
            throw new Error('The sign-in helper did not load');
          }
          return window.umccrDocsAuth;
        });
      authLoading.catch(function () {
        authLoading = null;
      });
    }
    return authLoading;
  }

  function currentSlug() {
    var segment = window.location.pathname.split('/')[1] || '';
    return /^[a-z0-9-]+$/.test(segment) ? segment : '';
  }

  /** A citation's link on this host: docs pages only, so dev answers link to dev pages. */
  function docsHref(url) {
    try {
      var parsed = new URL(url, window.location.origin);
      if (parsed.origin !== DOCS_ORIGIN && parsed.origin !== window.location.origin) {
        return null;
      }
      return window.location.origin + parsed.pathname + parsed.hash;
    } catch (error) {
      return null;
    }
  }

  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text) {
      node.textContent = text;
    }
    return node;
  }

  function signInAgainMessage() {
    var message = element('p', 'umccr-chat__error', 'Your sign-in has expired. ');
    message.appendChild(
      link('Sign in again', '/_auth/?rd=' + encodeURIComponent(window.location.pathname))
    );
    return message;
  }

  /** Read a response's JSON error, for 4xx and 5xx answers. */
  function errorMessage(response) {
    return response
      .json()
      .then(function (body) {
        return (body && body.error && body.error.message) || '';
      })
      .catch(function () {
        return '';
      });
  }

  /** POST to OrcaSonar with the reader's token, refreshing it once on a 401. */
  function sonarPost(auth, path, payload, accept) {
    function attempt(forceRefresh) {
      return auth.getIdToken({ forceRefresh: forceRefresh }).then(function (token) {
        if (!token) {
          return { signedOut: true };
        }
        return fetch(auth.sonarApiUrl + path, {
          method: 'POST',
          mode: 'cors',
          credentials: 'omit',
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
            Accept: accept,
          },
          body: JSON.stringify(payload),
        }).then(function (response) {
          if (response.status === 401 && !forceRefresh) {
            return attempt(true);
          }
          return { response: response };
        });
      });
    }
    return attempt(false);
  }

  /** Parse a server-sent event stream, calling onEvent(name, data) for each event. */
  function readEvents(response, onEvent) {
    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';

    function dispatch(block) {
      var name = 'message';
      var data = [];
      block.split('\n').forEach(function (line) {
        if (line.indexOf('event:') === 0) {
          name = line.slice(6).trim();
        } else if (line.indexOf('data:') === 0) {
          data.push(line.slice(5).replace(/^ /, ''));
        }
      });
      if (data.length) {
        var parsed;
        try {
          parsed = JSON.parse(data.join('\n'));
        } catch (error) {
          parsed = data.join('\n');
        }
        onEvent(name, parsed);
      }
    }

    function pump() {
      return reader.read().then(function (chunk) {
        if (chunk.done) {
          if (buffer.trim()) {
            dispatch(buffer);
          }
          return;
        }
        buffer += decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, '\n');
        var boundary = buffer.indexOf('\n\n');
        while (boundary !== -1) {
          dispatch(buffer.slice(0, boundary));
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf('\n\n');
        }
        return pump();
      });
    }
    return pump();
  }

  function renderSources(container, citations) {
    var items = (citations || []).filter(function (citation) {
      return citation && docsHref(citation.url);
    });
    if (!items.length) {
      return;
    }
    container.appendChild(element('p', 'umccr-chat__sources-title', 'Sources'));
    var list = element('ol', 'umccr-chat__sources');
    items.forEach(function (citation) {
      var item = document.createElement('li');
      item.appendChild(link(citation.title || citation.url, docsHref(citation.url)));
      if (citation.snippet) {
        item.appendChild(element('span', 'umccr-chat__snippet', citation.snippet));
      }
      list.appendChild(item);
    });
    container.appendChild(list);
  }

  function renderFeedback(container, auth, exchangeId) {
    var row = element('div', 'umccr-chat__feedback');
    row.appendChild(element('span', '', 'Was this helpful?'));
    ['up', 'down'].forEach(function (rating) {
      var button = element('button', 'umccr-chat__rate', rating === 'up' ? 'Yes' : 'No');
      button.type = 'button';
      button.addEventListener('click', function () {
        row.textContent = 'Thanks for the feedback.';
        sonarPost(auth, '/feedback', { exchangeId: exchangeId, rating: rating }, 'application/json').catch(
          function () {}
        );
      });
      row.appendChild(button);
    });
    container.appendChild(row);
  }

  function failure(container, response) {
    return errorMessage(response).then(function (message) {
      if (response.status === 429) {
        container.appendChild(
          element(
            'p',
            'umccr-chat__error',
            message || "Today's allowance for answers is used up. Try again tomorrow; Search still works."
          )
        );
      } else {
        container.appendChild(
          element('p', 'umccr-chat__error', message || 'Chat is unavailable right now. Try again shortly.')
        );
      }
    });
  }

  function ask(state, query, container) {
    var answer = element('div', 'umccr-chat__answer');
    container.appendChild(answer);
    var payload = { query: query, sites: state.sites() };
    if (state.conversationId) {
      payload.conversationId = state.conversationId;
    }
    return sonarPost(state.auth, '/chat', payload, 'text/event-stream').then(function (result) {
      if (result.signedOut) {
        container.appendChild(signInAgainMessage());
        return;
      }
      if (!result.response.ok) {
        return failure(container, result.response);
      }
      var exchangeId = null;
      // An error or done event ends the answer: anything after it is ignored.
      var finished = false;
      return readEvents(result.response, function (name, data) {
        if (finished) {
          return;
        }
        if (name === 'meta') {
          exchangeId = data.exchangeId;
          state.conversationId = data.conversationId || state.conversationId;
        } else if (name === 'delta') {
          answer.textContent += data.text || '';
        } else if (name === 'citations') {
          renderSources(container, data);
        } else if (name === 'error') {
          finished = true;
          container.appendChild(
            element('p', 'umccr-chat__error', (data && data.message) || 'The answer stopped early.')
          );
        } else if (name === 'done') {
          finished = true;
          if (exchangeId) {
            renderFeedback(container, state.auth, exchangeId);
          }
        }
      });
    });
  }

  function search(state, query, container) {
    return sonarPost(state.auth, '/search', { query: query, sites: state.sites(), topK: 8 }, 'application/json').then(
      function (result) {
        if (result.signedOut) {
          container.appendChild(signInAgainMessage());
          return;
        }
        if (!result.response.ok) {
          return failure(container, result.response);
        }
        return result.response.json().then(function (body) {
          if (!body.results || !body.results.length) {
            container.appendChild(element('p', '', 'Nothing in the documentation matched.'));
            return;
          }
          renderSources(container, body.results);
        });
      }
    );
  }

  function renderChat() {
    if (document.getElementById('umccr-chat')) {
      return;
    }
    var slug = currentSlug();
    var state = { auth: null, conversationId: null, busy: false };

    var launcher = element('button', 'umccr-chat__launcher', 'Ask the docs');
    launcher.type = 'button';
    launcher.setAttribute('aria-controls', 'umccr-chat');
    launcher.setAttribute('aria-expanded', 'false');

    var panel = element('section', 'umccr-chat');
    panel.id = 'umccr-chat';
    panel.hidden = true;
    panel.setAttribute('aria-label', 'Ask the UMCCR documentation');

    var head = element('div', 'umccr-chat__head');
    head.appendChild(element('strong', '', 'Ask the docs'));
    var close = element('button', 'umccr-chat__close', 'Close');
    close.type = 'button';
    head.appendChild(close);
    panel.appendChild(head);

    panel.appendChild(
      element(
        'p',
        'umccr-chat__notice',
        'Answers come only from UMCCR documentation and can be wrong: check the sources. ' +
          'Questions and answers are kept for 30 days to improve answers.'
      )
    );

    var log = element('div', 'umccr-chat__log');
    log.setAttribute('aria-live', 'polite');
    panel.appendChild(log);

    var form = element('form', 'umccr-chat__form');
    var modes = element('div', 'umccr-chat__modes');
    ['ask', 'search'].forEach(function (mode) {
      var label = element('label', '', '');
      var input = document.createElement('input');
      input.type = 'radio';
      input.name = 'umccr-chat-mode';
      input.value = mode;
      input.checked = mode === 'ask';
      label.appendChild(input);
      label.appendChild(document.createTextNode(mode === 'ask' ? ' Ask' : ' Search'));
      modes.appendChild(label);
    });
    var scope = element('label', 'umccr-chat__scope', '');
    var scoped = document.createElement('input');
    scoped.type = 'checkbox';
    scoped.checked = Boolean(slug);
    scoped.disabled = !slug;
    scope.appendChild(scoped);
    scope.appendChild(document.createTextNode(' This site only'));
    modes.appendChild(scope);
    form.appendChild(modes);

    var question = document.createElement('textarea');
    question.className = 'umccr-chat__question';
    question.rows = 3;
    question.maxLength = 2000;
    question.required = true;
    question.placeholder = 'For example: how do I add a site to docs.umccr.org?';
    question.setAttribute('aria-label', 'Your question');
    form.appendChild(question);
    var send = element('button', 'umccr-chat__send', 'Send');
    send.type = 'submit';
    form.appendChild(send);
    panel.appendChild(form);

    state.sites = function () {
      return scoped.checked && slug ? [slug] : undefined;
    };

    function setOpen(open) {
      panel.hidden = !open;
      launcher.setAttribute('aria-expanded', String(open));
      if (open) {
        question.focus();
        loadAuth()
          .then(function (auth) {
            state.auth = auth;
            if (!auth.sonarApiUrl) {
              log.textContent = 'Chat is not available on this site yet.';
              send.disabled = true;
            }
          })
          .catch(function () {
            log.textContent = 'Chat could not start. Reload the page to try again.';
            send.disabled = true;
          });
      }
    }

    launcher.addEventListener('click', function () {
      setOpen(panel.hidden);
    });
    close.addEventListener('click', function () {
      setOpen(false);
      launcher.focus();
    });

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var text = question.value.trim();
      if (!text || state.busy || !state.auth || !state.auth.sonarApiUrl) {
        return;
      }
      var mode = form.querySelector('input[name="umccr-chat-mode"]:checked').value;
      var turn = element('div', 'umccr-chat__turn');
      turn.appendChild(element('p', 'umccr-chat__query', text));
      log.appendChild(turn);
      question.value = '';
      state.busy = true;
      send.disabled = true;
      (mode === 'search' ? search : ask)(state, text, turn)
        .catch(function () {
          turn.appendChild(element('p', 'umccr-chat__error', 'Chat is unavailable right now. Try again shortly.'));
        })
        .then(function () {
          state.busy = false;
          send.disabled = false;
          log.scrollTop = log.scrollHeight;
        });
    });

    document.body.appendChild(launcher);
    document.body.appendChild(panel);
  }

  function render() {
    renderAccount();
    renderCatalogue();
    renderChat();
  }

  // Material's instant navigation swaps pages without a full load and announces each one on document$.
  if (window.document$ && typeof window.document$.subscribe === 'function') {
    window.document$.subscribe(render);
  } else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }
})();
