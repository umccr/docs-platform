/*
 * The only script on docs.umccr.org pages besides the theme's own, and the Mermaid runtime it loads. Projects cannot
 * add scripts: every site shares one origin, and the sign-in page keeps Amplify's tokens in that origin's storage.
 *
 * 1. Account menu: shows who is signed in, read from the ID token Amplify stored at sign-in (the same
 *    CognitoIdentityServiceProvider.* keys the portal apps use). Display only; the edge enforces the session.
 * 2. Catalogue: renders the registered sites into #umccr-catalogue from /_platform/data/catalog.json, and the
 *    question box, which asks every site in the chat panel, into #umccr-ask.
 * 3. Search: the header's search results gain a row that asks the docs the same question and one that searches
 *    every site, both in the chat panel.
 * 4. Chat panel: asks OrcaSonar, UMCCR's documentation search and answer service. On first open it loads
 *    /_auth/env.js and /_auth/token.js, which hold the platform's Amplify code; OrcaSonar checks the reader's
 *    Cognito ID token, not the docs session cookie. Answers are Markdown, which the panel builds into elements
 *    itself, and titles and snippets are text: nothing OrcaSonar returns is ever parsed as HTML. ⌘K or Ctrl+K opens
 *    and closes it.
 * 5. Diagrams: Material draws each ```mermaid block with the theme's own copy of Mermaid, which loads on the first
 *    page that has one. See installMermaid.
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

  // ---------------------------------------------------------------------------------------------------------------
  // Icons: Octicons (MIT), the set the theme's own icons come from, drawn inline.

  var SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
  var ICONS = {
    plus: [
      'M7.75 2a.75.75 0 0 1 .75.75V7h4.25a.75.75 0 0 1 0 1.5H8.5v4.25a.75.75 0 0 1-1.5 0V8.5H2.75a.75.75 0 0 1 0-1.5H7V2.75A.75.75 0 0 1 7.75 2',
    ],
    close: [
      'M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.75.75 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.75.75 0 0 1-.734-.215L8 9.06l-3.22 3.22a.75.75 0 0 1-1.042-.018.75.75 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06',
    ],
    up: [
      'M8.347.631A.75.75 0 0 1 9.123.26l.238.04a3.25 3.25 0 0 1 2.591 4.098L11.494 6h.665a3.25 3.25 0 0 1 3.118 4.167l-1.135 3.859A2.75 2.75 0 0 1 11.503 16H6.586a3.75 3.75 0 0 1-2.184-.702A1.75 1.75 0 0 1 3 16H1.75A1.75 1.75 0 0 1 0 14.25v-6.5C0 6.784.784 6 1.75 6h3.417a.25.25 0 0 0 .217-.127ZM4.75 13.649l.396.33c.404.337.914.521 1.44.521h4.917a1.25 1.25 0 0 0 1.2-.897l1.135-3.859A1.75 1.75 0 0 0 12.159 7.5H10.5a.75.75 0 0 1-.721-.956l.731-2.558a1.75 1.75 0 0 0-1.127-2.14L6.69 6.611a1.75 1.75 0 0 1-1.523.889H4.75ZM3.25 7.5h-1.5a.25.25 0 0 0-.25.25v6.5c0 .138.112.25.25.25H3a.25.25 0 0 0 .25-.25Z',
    ],
    down: [
      'M7.653 15.369a.75.75 0 0 1-.776.371l-.238-.04a3.25 3.25 0 0 1-2.591-4.099L4.506 10h-.665A3.25 3.25 0 0 1 .723 5.833l1.135-3.859A2.75 2.75 0 0 1 4.482 0H9.43c.78.003 1.538.25 2.168.702A1.75 1.75 0 0 1 12.989 0h1.272A1.75 1.75 0 0 1 16 1.75v6.5A1.75 1.75 0 0 1 14.25 10h-3.417a.25.25 0 0 0-.217.127ZM11.25 2.351l-.396-.33a2.25 2.25 0 0 0-1.44-.521H4.496a1.25 1.25 0 0 0-1.199.897L2.162 6.256A1.75 1.75 0 0 0 3.841 8.5H5.5a.75.75 0 0 1 .721.956l-.731 2.558a1.75 1.75 0 0 0 1.127 2.14L9.31 9.389a1.75 1.75 0 0 1 1.523-.889h.417Zm1.5 6.149h1.5a.25.25 0 0 0 .25-.25v-6.5a.25.25 0 0 0-.25-.25H13a.25.25 0 0 0-.25.25Z',
    ],
    copy: [
      'M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z',
      'M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z',
    ],
    check: [
      'M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 .018-1.042.75.75 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0',
    ],
    send: [
      'M3.47 7.78a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1-.018 1.042.75.75 0 0 1-1.042.018L9 4.81v7.44a.75.75 0 0 1-1.5 0V4.81L4.53 7.78a.75.75 0 0 1-1.06 0',
    ],
  };

  function icon(name) {
    var svg = document.createElementNS(SVG_NAMESPACE, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('aria-hidden', 'true');
    ICONS[name].forEach(function (d) {
      var path = document.createElementNS(SVG_NAMESPACE, 'path');
      path.setAttribute('d', d);
      svg.appendChild(path);
    });
    return svg;
  }

  /** A button showing only an icon; `label` names it for screen readers and as its tooltip. */
  function iconButton(name, label) {
    var button = element('button', 'umccr-chat__icon');
    button.type = 'button';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.appendChild(icon(name));
    return button;
  }

  /**
   * Ask or Search: two buttons, Ask pressed at first. onChange(mode) runs whenever the mode is set afterwards, by the
   * reader or by set().
   */
  function modeSwitch(onChange) {
    var group = element('div', 'umccr-modes');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Ask or search');
    var buttons = {};
    function press(mode) {
      Object.keys(buttons).forEach(function (key) {
        buttons[key].setAttribute('aria-pressed', String(key === mode));
      });
    }
    function set(mode) {
      press(mode);
      onChange(mode);
    }
    ['ask', 'search'].forEach(function (mode) {
      var button = element('button', '', mode === 'ask' ? 'Ask' : 'Search');
      button.type = 'button';
      button.addEventListener('click', function () {
        set(mode);
      });
      buttons[mode] = button;
      group.appendChild(button);
    });
    press('ask');
    return { element: group, set: set };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // 2. Catalogue

  var ONBOARDING_URL = '/platform/onboarding/';

  /** Two letters for a site's card: the first letters of its first two words, leaving out "UMCCR". */
  function siteInitials(title) {
    var words = String(title || '')
      .split(/\s+/)
      .filter(function (word) {
        return word && word.toUpperCase() !== 'UMCCR';
      });
    var letters = words.length > 1 ? words[0].charAt(0) + words[1].charAt(0) : (words[0] || '').slice(0, 2);
    return letters.toUpperCase() || '?';
  }

  function siteCard(initials, title, description, path, href) {
    var card = element('a', 'umccr-catalogue__site');
    card.href = href;
    card.appendChild(element('span', 'umccr-catalogue__initials', initials));
    card.appendChild(element('span', 'umccr-catalogue__title', title));
    card.appendChild(element('span', 'umccr-catalogue__description', description));
    card.appendChild(element('span', 'umccr-catalogue__path', path));
    return card;
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
        var sites = catalogue.sites || [];
        target.textContent = '';
        var head = element('h2', 'umccr-catalogue__head', 'Sites');
        head.appendChild(element('span', 'umccr-catalogue__count', String(sites.length)));
        target.appendChild(head);

        var grid = element('div', 'umccr-catalogue');
        sites.forEach(function (site) {
          grid.appendChild(siteCard(siteInitials(site.title), site.title, site.description, site.url, site.url));
        });
        var add = siteCard(
          '+',
          'Publish your documentation',
          'Link a repository and publish its MkDocs or Obsidian documentation here.',
          'Onboarding a repository →',
          ONBOARDING_URL
        );
        add.className += ' umccr-catalogue__site--add';
        grid.appendChild(add);
        target.appendChild(grid);
      })
      .catch(function () {
        target.textContent = 'The catalogue could not be loaded. Refresh the page to try again.';
      });
  }

  /**
   * The catalogue's question box (#umccr-ask): asks, or searches, every site in the chat panel. The list it holds in
   * the page becomes its suggested questions.
   */
  function renderAsk() {
    var target = document.getElementById('umccr-ask');
    if (!target || target.getAttribute('data-loaded') || !chat) {
      return;
    }
    target.setAttribute('data-loaded', 'true');
    var suggestions = Array.prototype.map
      .call(target.querySelectorAll('li'), function (item) {
        return item.textContent.trim();
      })
      .filter(Boolean);
    target.textContent = '';
    target.className = 'umccr-ask';

    var mode = 'ask';
    var box = element('form', 'umccr-ask__box');
    var input = element('input', 'umccr-ask__input');
    input.type = 'text';
    input.maxLength = 2000;
    input.placeholder = 'Ask a question or search all UMCCR documentation…';
    input.setAttribute('aria-label', 'Ask a question or search all UMCCR documentation');
    box.appendChild(input);
    box.appendChild(
      modeSwitch(function (value) {
        mode = value;
      }).element
    );
    box.addEventListener('submit', function (event) {
      event.preventDefault();
      var text = input.value.trim();
      if (text) {
        input.value = '';
        chat.start(text, mode, true);
      }
    });
    target.appendChild(box);

    if (suggestions.length) {
      var row = element('div', 'umccr-ask__suggestions', 'Suggested:');
      suggestions.forEach(function (text) {
        var chip = element('button', 'umccr-ask__suggestion', text);
        chip.type = 'button';
        chip.addEventListener('click', function () {
          chat.start(text, 'ask', true);
        });
        row.appendChild(chip);
      });
      target.appendChild(row);
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // 3. Search

  function closeSearch() {
    var toggle = document.getElementById('__search');
    if (toggle && toggle.checked) {
      toggle.checked = false;
      toggle.dispatchEvent(new Event('change'));
    }
    if (document.activeElement && document.activeElement.blur) {
      document.activeElement.blur();
    }
  }

  /**
   * The header's search box says what it searches, and its results gain a row that asks the docs the same question
   * and one that searches every site, both in the chat panel. Both are links in the results, so Material's arrow keys
   * reach them.
   */
  function enhanceSearch() {
    var input = document.querySelector('.md-search__input');
    var output = document.querySelector('.md-search__output');
    var scrollwrap = output && output.querySelector('.md-search__scrollwrap');
    if (!input || !scrollwrap || !chat || output.querySelector('.umccr-search-ask')) {
      return;
    }
    input.placeholder = 'Search this site';

    var askRow = element('a', 'umccr-search-ask');
    askRow.href = '#umccr-chat';
    var allRow = element('a', 'umccr-search-all');
    allRow.href = '#umccr-chat';

    function update() {
      var query = input.value.trim();
      askRow.hidden = allRow.hidden = !query;
      askRow.textContent = '';
      askRow.appendChild(element('strong', '', 'Ask the docs:'));
      askRow.appendChild(document.createTextNode('“' + query + '”'));
      askRow.appendChild(element('span', '', '— get an answer with sources'));
      askRow.appendChild(element('kbd', '', '↵'));
      allRow.textContent = 'Search all UMCCR documentation for “' + query + '”';
    }

    function handOver(mode, allSites) {
      return function (event) {
        event.preventDefault();
        var query = input.value.trim();
        if (query) {
          closeSearch();
          chat.start(query, mode, allSites);
        }
      };
    }

    askRow.addEventListener('click', handOver('ask', false));
    allRow.addEventListener('click', handOver('search', true));
    input.addEventListener('input', update);
    update();
    scrollwrap.insertBefore(askRow, scrollwrap.firstChild);
    scrollwrap.appendChild(allRow);

    var keys = element('div', 'umccr-search-keys');
    [
      ['↑ ↓', 'navigate'],
      ['↵', 'open'],
      ['esc', 'close'],
    ].forEach(function (hint) {
      keys.appendChild(element('kbd', '', hint[0]));
      keys.appendChild(element('span', '', hint[1]));
    });
    output.appendChild(keys);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // 4. Chat panel

  var DOCS_ORIGIN = 'https://docs.umccr.org';
  var authLoading = null;
  // The panel's controls for the question box and the search rows, once it is on the page: chat.start(...).
  var chat = null;

  // An answer that sends nothing for this long has stalled, and a search that takes this long will not answer: the
  // panel stops waiting, so the reader can ask again. OrcaSonar sends text every few seconds while it answers.
  var ANSWER_STALL_MS = 90000;
  var SEARCH_TIMEOUT_MS = 45000;

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

  /** The site's name, as the header shows it. */
  function siteName() {
    var topic = document.querySelector('.md-header__topic .md-ellipsis');
    return topic ? topic.textContent.trim() : '';
  }

  /** A citation's link on this host: docs pages only, so dev answers link to dev pages. */
  function docsHref(url) {
    if (!url) {
      return null;
    }
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

  /** Aborts `controller` once `ms` pass without a call to kick(); stop() ends the watch. */
  function watchdog(controller, ms) {
    var timer = null;
    function kick() {
      clearTimeout(timer);
      timer = setTimeout(function () {
        controller.abort();
      }, ms);
    }
    kick();
    return {
      kick: kick,
      stop: function () {
        clearTimeout(timer);
      },
    };
  }

  /** `promise`, or a rejection as soon as `signal` aborts: Amplify's token refresh cannot be cancelled itself. */
  function untilAborted(promise, signal) {
    return new Promise(function (resolve, reject) {
      function abort() {
        reject(new Error('Stopped waiting'));
      }
      if (signal.aborted) {
        abort();
        return;
      }
      signal.addEventListener('abort', abort);
      promise.then(resolve, reject);
    });
  }

  /**
   * POST to OrcaSonar with the reader's token, refreshing it once on a 401. An abort of `signal`, when given, ends the
   * wait for the token, the response or its body.
   */
  function sonarPost(auth, path, payload, accept, signal) {
    function attempt(forceRefresh) {
      var pending = auth.getIdToken({ forceRefresh: forceRefresh });
      return (signal ? untilAborted(pending, signal) : pending).then(function (token) {
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
          signal: signal,
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

  /**
   * Parse a server-sent event stream, calling onEvent(name, data) for each event and onChunk() whenever bytes arrive.
   * Reading stops at the end of the stream, or at the first event for which onEvent returns true.
   */
  function readEvents(response, onEvent, onChunk) {
    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';
    var finished = false;

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
        finished = onEvent(name, parsed) === true;
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
        if (onChunk) {
          onChunk();
        }
        buffer += decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, '\n');
        var boundary = buffer.indexOf('\n\n');
        while (boundary !== -1 && !finished) {
          dispatch(buffer.slice(0, boundary));
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf('\n\n');
        }
        // A finished answer lets the connection go rather than wait for the server to close it.
        return finished ? reader.cancel().catch(function () {}) : pump();
      });
    }
    return pump();
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Markdown, for answers. An answer is parsed into a tree of plain objects ({tag, children}, with strings for text),
  // then built with createElement and text nodes. Nothing in it is ever parsed as HTML, so a tag in an answer shows
  // as text, and links keep to http(s), mailto and paths on this site. It covers what answers use: paragraphs,
  // headings, lists, quotes, fenced code, tables, rules, emphasis, code spans, links and citation markers such as [2].

  var FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
  var HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
  var RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
  var QUOTE = /^ {0,3}> ?(.*)$/;
  var LIST_ITEM = /^( {0,3})([-*+]|\d{1,9}[.)])(?:[ \t]+(.*)|[ \t]*)$/;
  var TABLE_RULE = /^ {0,3}\|?(?:[ \t]*:?-+:?[ \t]*\|)*[ \t]*:?-+:?[ \t]*\|?[ \t]*$/;
  var LINK = /^\[((?:[^[\]\\\n]|\\.)*)\]\([ \t]*<?([^\s<>()]*)>?(?:[ \t]+(?:"[^"\n]*"|'[^'\n]*'))?[ \t]*\)/;
  var ALPHANUMERIC = /[A-Za-z0-9]/;
  // Longest marks first. `_` emphasis must not start or end inside a word, so snake_case stays as it is.
  var EMPHASIS = [
    { pattern: /^\*\*\*(?=\S)([\s\S]*?\S)\*\*\*/, tags: ['em', 'strong'] },
    { pattern: /^\*\*(?=\S)([\s\S]*?\S)\*\*/, tags: ['strong'] },
    { pattern: /^__(?=\S)([\s\S]*?\S)__(?![A-Za-z0-9])/, tags: ['strong'] },
    { pattern: /^\*(?=[^\s*])([\s\S]*?[^\s*])\*/, tags: ['em'] },
    { pattern: /^_(?=[^\s_])([\s\S]*?[^\s_])_(?![A-Za-z0-9])/, tags: ['em'] },
    { pattern: /^~~(?=\S)([\s\S]*?\S)~~/, tags: ['del'] },
  ];
  var MARKDOWN_TAGS = [
    'p', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'table', 'thead', 'tbody', 'tr', 'th',
    'td', 'hr', 'br', 'strong', 'em', 'del', 'a',
  ];

  /** The tree for `markdown`: block nodes, each {tag, children}, with text as strings. */
  function markdownTree(markdown) {
    return blocks(String(markdown).replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n'));
  }

  function indentOf(line) {
    return line.length - line.replace(/^ +/, '').length;
  }

  function startsBlock(line) {
    return FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line);
  }

  /** Only a list item with text, and a numbered one only if it starts at 1, can interrupt a paragraph. */
  function interruptsParagraph(item) {
    return Boolean(item[3]) && (!/\d/.test(item[2]) || /^1[.)]$/.test(item[2]));
  }

  function blocks(lines) {
    var out = [];
    var paragraph = [];
    var i = 0;
    var match;

    function endParagraph() {
      if (paragraph.length) {
        out.push({ tag: 'p', children: inlines(paragraph.join('\n')) });
        paragraph = [];
      }
    }

    while (i < lines.length) {
      var line = lines[i];
      if (!line.trim()) {
        endParagraph();
        i += 1;
      } else if ((match = FENCE.exec(line)) && !(match[1].charAt(0) === '`' && match[2].indexOf('`') !== -1)) {
        endParagraph();
        i = fencedCode(lines, i, match[1], out);
      } else if ((match = HEADING.exec(line))) {
        endParagraph();
        // An answer's headings sit below the panel's own: # is h3, ## is h4, and so on.
        out.push({ tag: 'h' + Math.min(match[1].length + 2, 6), children: inlines(match[2] || '') });
        i += 1;
      } else if (RULE.test(line)) {
        endParagraph();
        out.push({ tag: 'hr', children: [] });
        i += 1;
      } else if (QUOTE.test(line)) {
        endParagraph();
        var quoted = [];
        while (i < lines.length && (match = QUOTE.exec(lines[i]))) {
          quoted.push(match[1]);
          i += 1;
        }
        out.push({ tag: 'blockquote', children: blocks(quoted) });
      } else if ((match = LIST_ITEM.exec(line)) && (!paragraph.length || interruptsParagraph(match))) {
        endParagraph();
        i = list(lines, i, out);
      } else if (i + 1 < lines.length && tableStarts(line, lines[i + 1])) {
        endParagraph();
        i = table(lines, i, out);
      } else {
        paragraph.push(line.replace(/^ +/, ''));
        i += 1;
      }
    }
    endParagraph();
    return out;
  }

  /** A fenced code block from lines[start] into out; one still open runs to the end. Returns the next line's index. */
  function fencedCode(lines, start, fence, out) {
    var mark = fence.charAt(0) === '`' ? '`' : '~';
    var close = new RegExp('^ {0,3}' + mark + '{' + fence.length + ',}[ \\t]*$');
    var code = [];
    var i = start + 1;
    while (i < lines.length && !close.test(lines[i])) {
      code.push(lines[i]);
      i += 1;
    }
    out.push({ tag: 'pre', children: [{ tag: 'code', children: [code.join('\n')] }] });
    return i + 1;
  }

  /**
   * A list from lines[start] into out. Returns the next line's index. A line indented past the item's marker belongs
   * to the item, which is how lists nest; blank lines between items keep the list going.
   */
  function list(lines, start, out) {
    var first = LIST_ITEM.exec(lines[start]);
    var ordered = /\d/.test(first[2]);
    var node = { tag: ordered ? 'ol' : 'ul', children: [] };
    if (ordered && parseInt(first[2], 10) !== 1) {
      node.start = parseInt(first[2], 10);
    }
    var i = start;
    var match;
    while (i < lines.length && (match = LIST_ITEM.exec(lines[i])) && /\d/.test(match[2]) === ordered) {
      var marker = match[1].length;
      var content = marker + match[2].length + 1;
      var item = [match[3] || ''];
      i += 1;
      while (i < lines.length) {
        var line = lines[i];
        if (!line.trim()) {
          var next = i;
          while (next < lines.length && !lines[next].trim()) {
            next += 1;
          }
          if (next === lines.length || indentOf(lines[next]) <= marker) {
            break;
          }
          for (; i < next; i += 1) {
            item.push('');
          }
        } else if (indentOf(line) > marker) {
          item.push(line.slice(Math.min(indentOf(line), content)));
          i += 1;
        } else if (!LIST_ITEM.test(line) && !startsBlock(line) && item[item.length - 1].trim()) {
          // The item's paragraph going on without an indent.
          item.push(line);
          i += 1;
        } else {
          break;
        }
      }
      var children = blocks(item);
      if (children.length && children[0].tag === 'p') {
        children = children[0].children.concat(children.slice(1));
      }
      node.children.push({ tag: 'li', children: children });
      var after = i;
      while (after < lines.length && !lines[after].trim()) {
        after += 1;
      }
      match = after > i && after < lines.length ? LIST_ITEM.exec(lines[after]) : null;
      if (match && /\d/.test(match[2]) === ordered) {
        i = after;
      }
    }
    out.push(node);
    return i;
  }

  /** A table row's cells: outer pipes dropped, `\|` kept as a pipe. */
  function cellsOf(row) {
    var text = row.trim();
    if (text.charAt(0) === '|') {
      text = text.slice(1);
    }
    if (text.charAt(text.length - 1) === '|' && text.charAt(text.length - 2) !== '\\') {
      text = text.slice(0, -1);
    }
    var cells = [];
    var cell = '';
    for (var i = 0; i < text.length; i += 1) {
      if (text.charAt(i) === '\\' && text.charAt(i + 1) === '|') {
        cell += '|';
        i += 1;
      } else if (text.charAt(i) === '|') {
        cells.push(cell.trim());
        cell = '';
      } else {
        cell += text.charAt(i);
      }
    }
    cells.push(cell.trim());
    return cells;
  }

  function tableStarts(header, rule) {
    return (
      header.indexOf('|') !== -1 &&
      rule.indexOf('|') !== -1 &&
      TABLE_RULE.test(rule) &&
      cellsOf(header).length === cellsOf(rule).length
    );
  }

  /** A table from lines[start] into out: its header, the rule under it, then rows until a line without a pipe. */
  function table(lines, start, out) {
    var head = cellsOf(lines[start]);
    function row(cells, tag) {
      return {
        tag: 'tr',
        children: head.map(function (_, column) {
          return { tag: tag, children: inlines(cells[column] || '') };
        }),
      };
    }
    var body = [];
    var i = start + 2;
    while (i < lines.length && lines[i].trim() && lines[i].indexOf('|') !== -1) {
      body.push(row(cellsOf(lines[i]), 'td'));
      i += 1;
    }
    var children = [{ tag: 'thead', children: [row(head, 'th')] }];
    if (body.length) {
      children.push({ tag: 'tbody', children: body });
    }
    out.push({ tag: 'table', children: children });
    return i;
  }

  /** A link an answer may make: http(s), mailto, or a path on this site. Anything else, javascript: above all, is not. */
  function safeHref(url) {
    return /^(?:https?:\/\/|mailto:)/i.test(url) || /^\/(?![\/\\])/.test(url) ? url : null;
  }

  /** Inline Markdown as nodes: strings, and {tag, children} for code, emphasis, links and breaks, {tag: 'cite', ref}. */
  function inlines(text) {
    var out = [];
    var plain = '';
    var i = 0;
    var match;

    function add(node) {
      if (typeof node === 'string') {
        plain += node;
        return;
      }
      if (plain) {
        out.push(plain);
        plain = '';
      }
      out.push(node);
    }

    while (i < text.length) {
      var ch = text.charAt(i);
      var before = text.charAt(i - 1);
      // Only these characters can start anything; for the rest, there is no need to look ahead.
      var rest = '`*_~[!<h\\\n'.indexOf(ch) === -1 ? '' : text.slice(i);
      if (!rest) {
        plain += ch;
        i += 1;
      } else if (ch === '\\' && /^\\[!-\/:-@[-`{-~]/.test(rest)) {
        plain += rest.charAt(1);
        i += 2;
      } else if (ch === '\n') {
        plain = plain.replace(/ +$/, '');
        add({ tag: 'br', children: [] });
        i += 1;
      } else if (ch === '`') {
        match = /^(`+)([\s\S]*?[^`])\1(?!`)/.exec(rest);
        if (match) {
          var code = match[2].replace(/\n/g, ' ');
          add({ tag: 'code', children: [/^ [\s\S]* $/.test(code) && code.trim() ? code.slice(1, -1) : code] });
          i += match[0].length;
        } else {
          // A run of backticks with nothing to close it is text.
          match = /^`+/.exec(rest);
          plain += match[0];
          i += match[0].length;
        }
      } else if ((match = emphasis(rest, before))) {
        add(match.node);
        i += match.length;
      } else if ((ch === '[' || (ch === '!' && rest.charAt(1) === '[')) && (match = LINK.exec(rest.slice(ch === '!' ? 1 : 0)))) {
        var image = ch === '!';
        var href = safeHref(match[2]);
        // An image becomes a link to it: the page's policy would not load it from elsewhere anyway.
        var label = image ? [match[1] || match[2]] : inlines(match[1]);
        if (href) {
          add({ tag: 'a', href: href, children: label });
        } else {
          label.forEach(add);
        }
        i += match[0].length + (image ? 1 : 0);
      } else if (ch === '[' && (match = /^\[(\d{1,2})\]/.exec(rest))) {
        add({ tag: 'cite', ref: parseInt(match[1], 10), children: [] });
        i += match[0].length;
      } else if (ch === '<' && (match = /^<((?:https?:\/\/|mailto:)[^\s<>]*)>/i.exec(rest))) {
        add({ tag: 'a', href: match[1], children: [match[1]] });
        i += match[0].length;
      } else if (ch === 'h' && !ALPHANUMERIC.test(before) && (match = /^https?:\/\/[^\s<>"]*[^\s<>"'.,:;!?)\]*_~]/.exec(rest))) {
        add({ tag: 'a', href: match[0], children: [match[0]] });
        i += match[0].length;
      } else {
        plain += ch;
        i += 1;
      }
    }
    if (plain) {
      out.push(plain);
    }
    return out;
  }

  /** Emphasis, strong or strikethrough at the start of `rest`, as {node, length}, or null. */
  function emphasis(rest, before) {
    if (rest.charAt(0) === '_' && ALPHANUMERIC.test(before)) {
      return null;
    }
    for (var e = 0; e < EMPHASIS.length; e += 1) {
      var match = EMPHASIS[e].pattern.exec(rest);
      if (match) {
        var node = { tag: EMPHASIS[e].tags[EMPHASIS[e].tags.length - 1], children: inlines(match[1]) };
        if (EMPHASIS[e].tags.length > 1) {
          node = { tag: EMPHASIS[e].tags[0], children: [node] };
        }
        return { node: node, length: match[0].length };
      }
    }
    return null;
  }

  /**
   * Closes what the shown part of an answer has opened on its last line, so that `**`, a backtick or a link's target
   * do not flash up as text before the rest arrives: open code or bold is closed, a mark with nothing after it yet is
   * held back, and a link whose target is still arriving shows its text. An open code fence needs nothing: the parser
   * shows it as code to the end.
   */
  function closeOpenMarks(partial) {
    if ((partial.match(/^ {0,3}(?:`{3,}|~{3,})/gm) || []).length % 2) {
      return partial;
    }
    var start = partial.lastIndexOf('\n') + 1;
    var line = partial.slice(start).replace(/!?\[([^\]\n]*)\]\([^)\s]*$/, '$1');
    if ((line.match(/`/g) || []).length % 2) {
      line = /`\s*$/.test(line) ? line.replace(/`\s*$/, '') : line + '`';
    } else {
      var outside = line.replace(/`[^`]*`/g, '');
      ['**', '~~'].forEach(function (mark) {
        if (outside.split(mark).length % 2 === 0) {
          line = line.replace(/\s+$/, '');
          line = line.slice(-2) === mark ? line.slice(0, -2) : line + mark;
        }
      });
    }
    return partial.slice(0, start) + line;
  }

  /** A citation marker: [n], linked to the cited page once the citations have arrived. */
  function citationMarker(ref, citations) {
    var marker = element('sup', 'umccr-chat__cite');
    var citation = citations && citations[ref];
    var href = citation && docsHref(citation.url);
    if (href) {
      var anchor = link('[' + ref + ']', href);
      anchor.title = citation.title || '';
      anchor.setAttribute('aria-label', 'Source ' + ref + (citation.title ? ': ' + citation.title : ''));
      marker.appendChild(anchor);
    } else {
      marker.textContent = '[' + ref + ']';
    }
    return marker;
  }

  /** Builds Markdown nodes into parent with createElement and text nodes only; `citations` maps a ref to its source. */
  function buildMarkdown(parent, nodes, citations) {
    nodes.forEach(function (node) {
      if (typeof node === 'string') {
        parent.appendChild(document.createTextNode(node));
        return;
      }
      if (node.tag === 'cite') {
        parent.appendChild(citationMarker(node.ref, citations));
        return;
      }
      if (MARKDOWN_TAGS.indexOf(node.tag) === -1) {
        buildMarkdown(parent, node.children || [], citations);
        return;
      }
      var child = document.createElement(node.tag);
      if (node.tag === 'a') {
        // Docs pages open here, on this host; anything else in a new tab, so the conversation stays.
        var page = docsHref(node.href);
        child.href = page || node.href;
        if (!page) {
          child.target = '_blank';
          child.rel = 'noopener noreferrer';
        }
      } else if (node.tag === 'ol' && node.start) {
        child.start = node.start;
      }
      buildMarkdown(child, node.children || [], citations);
      if (node.tag === 'table') {
        var scroller = element('div', 'umccr-chat__table');
        scroller.appendChild(child);
        child = scroller;
      }
      parent.appendChild(child);
    });
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Showing an answer as it is written

  // OrcaSonar's guardrail checks an answer about 1,000 characters at a time before releasing it, so text arrives in
  // bursts, a short answer often all at once. Each burst is shown at a steady pace instead: over about a second, and
  // never slower than this many characters a millisecond.
  var REVEAL_MS = 1000;
  var REVEAL_MIN_PER_MS = 0.12;
  // Until the first words come, the status changes from searching to writing after this long.
  var WRITING_AFTER_MS = 2000;

  function prefersReducedMotion() {
    return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  /** Runs change, then keeps the log scrolled to its end if it was there: a reader who scrolled up stays put. */
  function following(log, change) {
    var atEnd = log.scrollHeight - log.scrollTop - log.clientHeight < 48;
    change();
    if (atEnd) {
      log.scrollTop = log.scrollHeight;
    }
  }

  /**
   * An answer in container, shown as it arrives. add(text) for each delta, cite(citations) when they arrive, and
   * finish(then) when the stream ends: it resolves once everything received is on screen and then() has run. element is
   * the answer's own element.
   */
  function answerView(container, log) {
    var view = element('div', 'umccr-chat__answer');
    var status = element('p', 'umccr-chat__pending', 'Searching the documentation…');
    view.setAttribute('aria-busy', 'true');
    view.appendChild(status);
    container.appendChild(view);
    var writing = window.setTimeout(function () {
      status.textContent = 'Writing the answer…';
    }, WRITING_AFTER_MS);

    var text = '';
    var shown = 0;
    var drawn = 0;
    var rate = REVEAL_MIN_PER_MS;
    var citations = null;
    var finished = false;
    var frame = 0;
    var last = 0;
    var waiting = [];

    function draw(force) {
      var count = Math.floor(shown);
      if (count === drawn && !force) {
        return;
      }
      drawn = count;
      var partial = text.slice(0, count);
      following(log, function () {
        view.textContent = '';
        buildMarkdown(view, markdownTree(count < text.length || !finished ? closeOpenMarks(partial) : partial), citations);
      });
    }

    function settle() {
      if (!finished || shown < text.length) {
        return;
      }
      window.clearTimeout(writing);
      view.setAttribute('aria-busy', 'false');
      draw(true);
      waiting.splice(0).forEach(function (callback) {
        callback();
      });
    }

    function step(now) {
      frame = 0;
      shown = Math.min(text.length, shown + rate * (last ? Math.min(now - last, 100) : 16));
      last = now;
      draw(false);
      if (shown < text.length) {
        frame = window.requestAnimationFrame(step);
      } else {
        last = 0;
        settle();
      }
    }

    return {
      element: view,
      add: function (more) {
        if (!more) {
          return;
        }
        text += more;
        window.clearTimeout(writing);
        if (prefersReducedMotion() || document.hidden) {
          shown = text.length;
          draw(false);
          return;
        }
        rate = Math.max(REVEAL_MIN_PER_MS, (text.length - shown) / REVEAL_MS);
        if (!frame) {
          frame = window.requestAnimationFrame(step);
        }
      },
      cite: function (list) {
        citations = {};
        list.forEach(function (citation) {
          if (citation && citation.ref > 0) {
            citations[citation.ref] = citation;
          }
        });
        if (drawn > 0) {
          draw(true);
        }
      },
      finish: function (then) {
        finished = true;
        return new Promise(function (resolve) {
          waiting.push(function () {
            following(log, function () {
              if (then) {
                then();
              }
            });
            resolve();
          });
          if (!frame) {
            settle();
          }
        });
      },
    };
  }

  /**
   * Sources under an answer or search results, one card each with the site it is on. Cited ones are numbered and
   * ordered as the answer cites them.
   */
  function renderSources(container, citations, cited) {
    var items = (citations || []).filter(function (citation) {
      return citation && docsHref(citation.url);
    });
    if (!items.length) {
      return;
    }
    if (cited) {
      items.sort(function (a, b) {
        return (a.ref || 0) - (b.ref || 0);
      });
    }
    container.appendChild(element('p', 'umccr-chat__sources-title', 'Sources'));
    var list = element('ol', 'umccr-chat__sources');
    items.forEach(function (citation) {
      var href = docsHref(citation.url);
      var item = element('li', 'umccr-chat__source');
      if (cited && citation.ref > 0) {
        item.value = citation.ref;
        item.appendChild(element('span', 'umccr-chat__ref', String(citation.ref)));
      }
      item.appendChild(link(citation.title || citation.url, href));
      item.appendChild(element('span', 'umccr-chat__source-site', new URL(href).pathname.split('/')[1]));
      if (citation.snippet) {
        item.appendChild(element('span', 'umccr-chat__snippet', citation.snippet));
      }
      list.appendChild(item);
    });
    container.appendChild(list);
  }

  /** Under a finished answer: ratings, when OrcaSonar can record them, and a button that copies the answer. */
  function renderFeedback(container, auth, exchangeId, answer) {
    var row = element('div', 'umccr-chat__feedback');
    var label = element('span', 'umccr-chat__feedback-label', exchangeId ? 'Was this helpful?' : '');
    row.appendChild(label);
    if (exchangeId) {
      var ratings = [];
      [
        ['up', 'Helpful'],
        ['down', 'Not helpful'],
      ].forEach(function (choice) {
        var button = iconButton(choice[0], choice[1]);
        button.setAttribute('aria-pressed', 'false');
        button.addEventListener('click', function () {
          ratings.forEach(function (other) {
            other.disabled = true;
          });
          button.setAttribute('aria-pressed', 'true');
          label.textContent = 'Thanks for the feedback.';
          sonarPost(auth, '/feedback', { exchangeId: exchangeId, rating: choice[0] }, 'application/json').catch(
            function () {}
          );
        });
        ratings.push(button);
        row.appendChild(button);
      });
      row.appendChild(element('span', 'umccr-chat__feedback-divider'));
    }
    if (navigator.clipboard) {
      var copy = iconButton('copy', 'Copy the answer');
      copy.addEventListener('click', function () {
        navigator.clipboard.writeText(answer.innerText).then(
          function () {
            copy.replaceChild(icon('check'), copy.firstChild);
            copy.setAttribute('aria-label', 'Copied');
            window.setTimeout(function () {
              copy.replaceChild(icon('copy'), copy.firstChild);
              copy.setAttribute('aria-label', 'Copy the answer');
            }, 2000);
          },
          function () {}
        );
      });
      row.appendChild(copy);
    }
    container.appendChild(row);
  }

  /** The message for a 4xx or 5xx response, as an element to show. */
  function failure(response) {
    return errorMessage(response).then(function (message) {
      return element(
        'p',
        'umccr-chat__error',
        message ||
          (response.status === 429
            ? "Today's allowance for answers is used up. Try again tomorrow; Search still works."
            : 'Chat is unavailable right now. Try again shortly.')
      );
    });
  }

  function ask(state, query, container) {
    var view = answerView(container, state.log);
    // What follows the answer once it is all on screen: its sources and feedback, or an error.
    var ending = null;
    var sources = [];
    var payload = { query: query, sites: state.sites() };
    if (state.conversationId) {
      payload.conversationId = state.conversationId;
    }
    // Every chunk that arrives restarts the watch, so only an answer that has stalled is cut off.
    var controller = new AbortController();
    var stall = watchdog(controller, ANSWER_STALL_MS);

    /** An ending that keeps what arrived, with its sources, and says why the answer stopped. */
    function stopped(message) {
      return function () {
        renderSources(container, sources, true);
        container.appendChild(element('p', 'umccr-chat__error', message));
      };
    }

    var answered = sonarPost(state.auth, '/chat', payload, 'text/event-stream', controller.signal)
      .then(function (result) {
        if (result.signedOut) {
          ending = function () {
            container.appendChild(signInAgainMessage());
          };
          return;
        }
        if (!result.response.ok) {
          return failure(result.response).then(function (message) {
            ending = function () {
              container.appendChild(message);
            };
          });
        }
        var exchangeId = null;
        // An error or done event ends the answer, and reading stops there.
        return readEvents(
          result.response,
          function (name, data) {
            if (name === 'meta') {
              exchangeId = data.exchangeId;
              state.conversationId = data.conversationId || state.conversationId;
            } else if (name === 'delta') {
              view.add((data && data.text) || '');
            } else if (name === 'citations') {
              sources = Array.isArray(data) ? data : [];
              view.cite(sources);
            } else if (name === 'error') {
              ending = stopped((data && data.message) || 'The answer stopped early.');
            } else if (name === 'done') {
              ending = function () {
                renderSources(container, sources, true);
                renderFeedback(container, state.auth, exchangeId, view.element);
              };
            }
            return ending !== null;
          },
          stall.kick
        ).then(function () {
          if (!ending) {
            // The stream closed with neither done nor error, as when the connection drops: keep what arrived, and say so.
            ending = stopped('The answer stopped early.');
          }
        });
      })
      .catch(function (error) {
        if (!controller.signal.aborted) {
          throw error;
        }
        ending = stopped('The answer stalled, so the panel stopped waiting. Try asking again.');
      });
    // However the request ends, the answer finishes showing first.
    return answered.then(
      function () {
        stall.stop();
        return view.finish(ending);
      },
      function (error) {
        stall.stop();
        return view.finish(null).then(function () {
          throw error;
        });
      }
    );
  }

  function search(state, query, container) {
    var status = element('p', 'umccr-chat__pending', 'Searching the documentation…');
    container.appendChild(status);
    var controller = new AbortController();
    var timeout = watchdog(controller, SEARCH_TIMEOUT_MS);
    function show(change) {
      following(state.log, function () {
        if (status.parentNode) {
          status.parentNode.removeChild(status);
        }
        change();
      });
    }
    var payload = { query: query, sites: state.sites(), topK: 8 };
    return sonarPost(state.auth, '/search', payload, 'application/json', controller.signal)
      .then(function (result) {
        if (result.signedOut) {
          show(function () {
            container.appendChild(signInAgainMessage());
          });
          return;
        }
        if (!result.response.ok) {
          return failure(result.response).then(function (message) {
            show(function () {
              container.appendChild(message);
            });
          });
        }
        return result.response.json().then(function (body) {
          show(function () {
            if (!body.results || !body.results.length) {
              container.appendChild(element('p', '', 'Nothing in the documentation matched.'));
            } else {
              renderSources(container, body.results, false);
            }
          });
        });
      })
      .catch(function (error) {
        if (controller.signal.aborted) {
          show(function () {
            container.appendChild(element('p', 'umccr-chat__error', 'Search took too long. Try again.'));
          });
          return;
        }
        show(function () {});
        throw error;
      })
      .then(timeout.stop, function (error) {
        timeout.stop();
        throw error;
      });
  }

  function renderChat() {
    if (document.getElementById('umccr-chat')) {
      return;
    }
    var slug = currentSlug();
    var state = { auth: null, conversationId: null, busy: false, mode: 'ask' };
    var mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

    var launcher = element('button', 'umccr-chat__launcher', 'Ask the docs');
    launcher.type = 'button';
    launcher.setAttribute('aria-controls', 'umccr-chat');
    launcher.setAttribute('aria-expanded', 'false');
    launcher.setAttribute('aria-keyshortcuts', mac ? 'Meta+K' : 'Control+K');
    launcher.appendChild(element('kbd', '', mac ? '⌘K' : 'Ctrl K'));

    var panel = element('section', 'umccr-chat');
    panel.id = 'umccr-chat';
    panel.hidden = true;
    panel.setAttribute('aria-label', 'Ask the UMCCR documentation');

    var head = element('div', 'umccr-chat__head');
    head.appendChild(element('strong', 'umccr-chat__title', 'Ask the docs'));
    head.appendChild(element('span', 'umccr-chat__service', 'OrcaSonar'));
    var restart = iconButton('plus', 'New conversation');
    var close = iconButton('close', 'Close');
    head.appendChild(restart);
    head.appendChild(close);
    panel.appendChild(head);

    var toolbar = element('div', 'umccr-chat__toolbar');
    var modes = modeSwitch(function (mode) {
      state.mode = mode;
      updatePlaceholder();
    });
    toolbar.appendChild(modes.element);
    var scope = element('label', 'umccr-chat__scope');
    var scoped = document.createElement('input');
    scoped.type = 'checkbox';
    scoped.checked = Boolean(slug);
    scoped.disabled = !slug;
    scope.appendChild(scoped);
    scope.appendChild(document.createTextNode('This site only'));
    if (slug) {
      scope.appendChild(element('span', 'umccr-chat__site', siteName() || slug));
    }
    toolbar.appendChild(scope);
    panel.appendChild(toolbar);

    var log = element('div', 'umccr-chat__log');
    log.setAttribute('aria-live', 'polite');
    var empty = element(
      'p',
      'umccr-chat__empty',
      'Ask about anything in UMCCR documentation. Answers cite the pages they come from.'
    );
    log.appendChild(empty);
    panel.appendChild(log);
    state.log = log;

    var form = element('form', 'umccr-chat__form');
    var composer = element('div', 'umccr-chat__composer');
    var question = document.createElement('textarea');
    question.className = 'umccr-chat__question';
    question.rows = 1;
    question.maxLength = 2000;
    question.required = true;
    question.setAttribute('aria-label', 'Your question');
    composer.appendChild(question);
    var send = element('button', 'umccr-chat__send');
    send.type = 'submit';
    send.title = 'Send';
    send.setAttribute('aria-label', 'Send');
    send.appendChild(icon('send'));
    composer.appendChild(send);
    form.appendChild(composer);
    panel.appendChild(form);
    panel.appendChild(
      element(
        'p',
        'umccr-chat__notice',
        'Answers come only from UMCCR documentation and can be wrong: check the sources. ' +
          'Questions and answers are kept for 30 days to improve answers.'
      )
    );

    state.sites = function () {
      return scoped.checked && slug ? [slug] : undefined;
    };

    function updatePlaceholder() {
      if (state.mode === 'search') {
        question.placeholder = 'Search the documentation…';
      } else {
        question.placeholder = state.conversationId ? 'Ask a follow-up…' : 'Ask a question…';
      }
    }
    updatePlaceholder();

    /** The question box grows with its text, up to the height the stylesheet allows. */
    function fit() {
      question.style.height = 'auto';
      question.style.height = question.scrollHeight + 'px';
    }

    /** The panel starts below the header. */
    var header = document.querySelector('.md-header');
    function place() {
      if (header && !panel.hidden) {
        var top = Math.max(0, header.getBoundingClientRect().bottom);
        document.documentElement.style.setProperty('--umccr-chat-top', top + 'px');
      }
    }
    window.addEventListener('scroll', place, { passive: true });
    window.addEventListener('resize', place);

    function unavailable(message) {
      log.textContent = '';
      log.appendChild(element('p', 'umccr-chat__empty', message));
      send.disabled = true;
    }

    /** Opens or closes the panel. Opening loads the token helper, once; it resolves to whether chat can be used. */
    function setOpen(open) {
      panel.hidden = !open;
      document.documentElement.classList.toggle('umccr-chat-open', open);
      launcher.setAttribute('aria-expanded', String(open));
      if (!open) {
        return Promise.resolve(false);
      }
      place();
      question.focus();
      return loadAuth()
        .then(function (auth) {
          state.auth = auth;
          if (!auth.sonarApiUrl) {
            unavailable('Chat is not available on this site yet.');
          }
          return Boolean(auth.sonarApiUrl);
        })
        .catch(function () {
          unavailable('Chat could not start. Reload the page to try again.');
          return false;
        });
    }

    function setBusy(busy) {
      state.busy = busy;
      send.disabled = busy;
      restart.disabled = busy;
    }

    function submit(text) {
      if (!text || state.busy || !state.auth || !state.auth.sonarApiUrl) {
        return;
      }
      if (empty.parentNode) {
        empty.parentNode.removeChild(empty);
      }
      var turn = element('div', 'umccr-chat__turn');
      turn.appendChild(element('p', 'umccr-chat__query', text));
      log.appendChild(turn);
      // The new question comes into view; from then on the log follows the answer only while the reader is at its end.
      log.scrollTop = log.scrollHeight;
      question.value = '';
      fit();
      setBusy(true);
      (state.mode === 'search' ? search : ask)(state, text, turn)
        .catch(function () {
          following(log, function () {
            turn.appendChild(element('p', 'umccr-chat__error', 'Chat is unavailable right now. Try again shortly.'));
          });
        })
        .then(function () {
          setBusy(false);
          updatePlaceholder();
        });
    }

    launcher.addEventListener('click', function () {
      setOpen(true);
    });
    close.addEventListener('click', function () {
      setOpen(false);
      launcher.focus();
    });
    restart.addEventListener('click', function () {
      state.conversationId = null;
      log.textContent = '';
      log.appendChild(empty);
      updatePlaceholder();
      question.focus();
    });
    panel.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        setOpen(false);
        launcher.focus();
      }
    });
    document.addEventListener('keydown', function (event) {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && /^k$/i.test(event.key || '')) {
        event.preventDefault();
        setOpen(panel.hidden);
        if (panel.hidden) {
          launcher.focus();
        }
      }
    });

    question.addEventListener('input', fit);
    // Enter sends; Shift+Enter starts a new line.
    question.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        submit(question.value.trim());
      }
    });
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      submit(question.value.trim());
    });

    chat = {
      /** Opens the panel and asks, or searches, `text`: across every site when allSites is true. */
      start: function (text, mode, allSites) {
        modes.set(mode);
        if (allSites) {
          scoped.checked = false;
        }
        setOpen(true).then(function (ready) {
          if (ready && !state.busy) {
            submit(text);
          } else {
            question.value = text;
            fit();
          }
        });
      },
    };

    document.body.appendChild(launcher);
    document.body.appendChild(panel);
  }

  // What the build refuses in a page (docs/site/authoring.md, "Not allowed"): elements that run or embed code, event
  // handler attributes, and script URLs.
  var UNSAFE_ELEMENT = /^(script|iframe|frame|frameset|object|embed|base)$/i;
  var URL_ATTRIBUTE = /(^|:)(href|src|action|formaction)$/i;
  var SCRIPT_URL = /^(javascript|vbscript):/i;

  /** Why a diagram's SVG could run code if it were shown, or '' if it could not. */
  function unsafeDiagram(svg) {
    // A document parsed this way is inert: nothing in it runs or loads.
    var elements = new DOMParser().parseFromString(svg, 'text/html').getElementsByTagName('*');
    for (var i = 0; i < elements.length; i++) {
      var element = elements[i];
      if (UNSAFE_ELEMENT.test(element.localName)) {
        return 'a <' + element.localName + '> element';
      }
      for (var j = 0; j < element.attributes.length; j++) {
        var name = element.attributes[j].name;
        // Browsers ignore whitespace and control characters in a URL's scheme.
        var value = element.attributes[j].value.replace(/[\u0000-\u0020]+/g, '');
        if (/^on/i.test(name)) {
          return 'an event handler, ' + name;
        }
        if (URL_ATTRIBUTE.test(name) && SCRIPT_URL.test(value)) {
          return 'a script URL in ' + name;
        }
      }
    }
    return '';
  }

  // Material's diagram CSS predates two names in Mermaid 11's sequence diagrams, which then kept Mermaid's own grey
  // and purple: lifelines (.actor-line) and arrowheads (markers named <diagram>-arrowhead and -crosshead). Mermaid
  // scopes these to the diagram as it does Material's, and they come after its own rules, so they win.
  var DIAGRAM_CSS =
    '.actor-line{stroke:var(--md-mermaid-sequence-actor-line-color)}' +
    '[id$="-arrowhead"] path{fill:var(--md-mermaid-sequence-message-line-color);stroke:none}' +
    '[id$="-crosshead"] path{stroke:var(--md-mermaid-sequence-message-line-color)}';

  /**
   * Mermaid fits a diagram to the page, and writes its full width as the SVG's max-width. A diagram wider than the page
   * gets that width as its minimum too, but only while the stylesheet sets --umccr-diagram-full to 1: a click shows it
   * at full size, scrolling sideways, and another fits it again (umccr.css). Only the opening tag's style changes, with
   * the number read from it.
   */
  function zoomable(svg) {
    var page = document.querySelector('.md-content .md-typeset');
    var room = page ? page.clientWidth : Infinity;
    return svg.replace(/^(<svg\b[^>]*?\bstyle="max-width: )([\d.]+)(px;)/, function (tag, start, width, end) {
      if (Number(width) <= room) {
        return tag;
      }
      return (
        start + width + end +
        ' min-width: calc(var(--umccr-diagram-full, 0) * ' + width + 'px);' +
        ' cursor: var(--umccr-diagram-cursor, zoom-in);'
      );
    });
  }

  /**
   * Material draws a ```mermaid block (build.py) with the Mermaid runtime it finds as the global `mermaid`, or else
   * one it loads from unpkg.com, which the pages' Content Security Policy blocks. This stands in for that global: the
   * theme's copy, assets/umccr/mermaid/mermaid.min.js, loads on the first page with a diagram, with Mermaid's own
   * sanitising on (securityLevel 'strict'); and a diagram whose SVG still holds anything the build refuses in a page
   * stays as its text. A diagram that does not parse stays as its text too. Mermaid's own global is replaced by this
   * one as soon as it loads, so every diagram comes through here.
   */
  function installMermaid(script) {
    if (!script || !script.src) {
      return;
    }
    var source = new URL('mermaid/mermaid.min.js', script.src).href;
    var options = {};
    var runtime = null;
    var standIn;

    function load() {
      if (!runtime) {
        runtime = new Promise(function (resolve, reject) {
          var tag = document.createElement('script');
          tag.src = source;
          tag.onload = function () {
            var loaded = window.mermaid;
            window.mermaid = standIn;
            if (!loaded || loaded === standIn || typeof loaded.render !== 'function') {
              reject(new Error('Mermaid did not load from ' + source));
              return;
            }
            loaded.initialize(
              Object.assign({}, options, { securityLevel: 'strict', suppressErrorRendering: true })
            );
            resolve(loaded);
          };
          tag.onerror = function () {
            reject(new Error('Mermaid did not load from ' + source));
          };
          document.head.appendChild(tag);
        });
        // The next page with a diagram tries again.
        runtime.catch(function () {
          runtime = null;
        });
      }
      return runtime;
    }

    standIn = {
      /** Material sets its options once, before the first diagram: startOnLoad off, and its theme's CSS. */
      initialize: function (settings) {
        options = Object.assign({}, settings);
        options.themeCSS = (options.themeCSS || '') + DIAGRAM_CSS;
      },
      render: function (id, text) {
        return load()
          .then(function (mermaid) {
            return mermaid.render(id, text);
          })
          .then(function (result) {
            var svg = zoomable(result.svg);
            var problem = unsafeDiagram(svg);
            if (problem) {
              throw new Error('its SVG has ' + problem);
            }
            return { svg: svg };
          })
          .catch(function (error) {
            console.warn('A Mermaid diagram was not drawn:', error);
            throw error;
          });
      },
    };
    window.mermaid = standIn;

    // Events from inside a diagram reach the page as events on its div.mermaid.
    document.addEventListener('click', function (event) {
      var diagram = event.target instanceof Element && event.target.closest('.md-typeset div.mermaid');
      if (diagram) {
        diagram.classList.toggle('umccr-diagram-full');
      }
    });
  }

  function render() {
    renderAccount();
    renderChat();
    enhanceSearch();
    renderCatalogue();
    renderAsk();
  }

  // Outside a browser there is no page: the platform's tests load this file in Node to check the Markdown renderer,
  // the stream reader and the stall watchdog.
  if (typeof window === 'undefined') {
    if (typeof module === 'object' && module.exports) {
      module.exports = {
        markdownTree: markdownTree,
        closeOpenMarks: closeOpenMarks,
        safeHref: safeHref,
        readEvents: readEvents,
        watchdog: watchdog,
      };
    }
    return;
  }

  // Before Material draws the first page, on DOMContentLoaded; while this script runs, it knows its own URL.
  installMermaid(document.currentScript);

  // Material's instant navigation swaps pages without a full load and announces each one on document$.
  if (window.document$ && typeof window.document$.subscribe === 'function') {
    window.document$.subscribe(render);
  } else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }
})();
