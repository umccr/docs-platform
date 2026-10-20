/*
 * The only script on docs.umccr.org pages besides the theme's own. Projects cannot add scripts: every site shares
 * one origin, and the sign-in page keeps Amplify's tokens in that origin's storage.
 *
 * 1. Account menu: shows who is signed in, read from the ID token Amplify stored at sign-in (the same
 *    CognitoIdentityServiceProvider.* keys the portal apps use). Display only; the edge enforces the session.
 * 2. Catalogue: renders the registered sites into #umccr-catalogue from /_platform/data/catalog.json.
 * 3. Chat panel: asks OrcaSonar, UMCCR's documentation search and answer service. On first open it loads
 *    /_auth/env.js and /_auth/token.js, which hold the platform's Amplify code; OrcaSonar checks the reader's
 *    Cognito ID token, not the docs session cookie. Answers are Markdown, which the panel builds into elements
 *    itself, and titles and snippets are text: nothing OrcaSonar returns is ever parsed as HTML.
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
   * finish(then) when the stream ends: it resolves once everything received is on screen and then() has run.
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

  /** Sources under an answer or search results. Cited ones are numbered and ordered as the answer cites them. */
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
      var item = document.createElement('li');
      if (cited && citation.ref > 0) {
        item.value = citation.ref;
      }
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
                if (exchangeId) {
                  renderFeedback(container, state.auth, exchangeId);
                }
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
    state.log = log;

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
      // The new question comes into view; from then on the log follows the answer only while the reader is at its end.
      log.scrollTop = log.scrollHeight;
      question.value = '';
      state.busy = true;
      send.disabled = true;
      (mode === 'search' ? search : ask)(state, text, turn)
        .catch(function () {
          following(log, function () {
            turn.appendChild(element('p', 'umccr-chat__error', 'Chat is unavailable right now. Try again shortly.'));
          });
        })
        .then(function () {
          state.busy = false;
          send.disabled = false;
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

  // Material's instant navigation swaps pages without a full load and announces each one on document$.
  if (window.document$ && typeof window.document$.subscribe === 'function') {
    window.document$.subscribe(render);
  } else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }
})();
