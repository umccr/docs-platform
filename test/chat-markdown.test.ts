import * as fs from 'fs';
import * as path from 'path';
import { runInThisContext } from 'vm';
import { describe, expect, test } from '@jest/globals';

/**
 * The chat panel's Markdown renderer, in the theme's umccr.js: OrcaSonar's answers are Markdown, and the panel builds
 * them into elements itself. These check the tree it builds from, which the panel turns into elements and text nodes,
 * and how the panel reads an answer's event stream and gives up on one that stalls.
 */

type MarkdownNode =
  string | { tag: string; children: MarkdownNode[]; href?: string; start?: number; ref?: number };

/** The part of a fetch Response the stream reader uses. */
interface StreamedResponse {
  body: {
    getReader(): {
      read(): Promise<{ done: boolean; value?: Uint8Array }>;
      cancel(): Promise<void>;
    };
  };
}

interface ChatMarkdown {
  markdownTree: (markdown: string) => MarkdownNode[];
  closeOpenMarks: (partial: string) => string;
  safeHref: (url: string) => string | null;
  readEvents: (
    response: StreamedResponse,
    onEvent: (name: string, data: unknown) => boolean | void,
    onChunk?: () => void
  ) => Promise<void>;
  watchdog: (controller: AbortController, ms: number) => { kick(): void; stop(): void };
}

const SCRIPT = path.join(
  __dirname,
  '..',
  'toolkit',
  'src',
  'umccr_docs',
  'theme',
  'assets',
  'umccr',
  'umccr.js'
);

/** The script as Node sees it: no window, so it exports the renderer instead of drawing a page. */
const load = (): ChatMarkdown => {
  const sandbox = { exports: {} };
  const run = runInThisContext(`(function (module) {${fs.readFileSync(SCRIPT, 'utf8')}\n})`) as (
    module: typeof sandbox
  ) => void;
  run(sandbox);
  return sandbox.exports as ChatMarkdown;
};

const { markdownTree, closeOpenMarks, safeHref, readEvents, watchdog } = load();

/** A tree as compact markup, for readable expectations. Text is escaped, so a `<` it holds shows as `&lt;`. */
const html = (nodes: MarkdownNode[]): string =>
  nodes
    .map((node) => {
      if (typeof node === 'string') {
        return node.replace(/&/g, '&amp;').replace(/</g, '&lt;');
      }
      if (node.tag === 'cite') {
        return `<cite ${node.ref}>`;
      }
      const href = node.href ? ` href="${node.href}"` : '';
      const start = node.start ? ` start="${node.start}"` : '';
      return `<${node.tag}${href}${start}>${html(node.children)}</${node.tag}>`;
    })
    .join('');

const render = (markdown: string) => html(markdownTree(markdown));

describe('chat panel Markdown', () => {
  test('renders an answer with a numbered list, bold, citation markers and a link', () => {
    const answer = [
      'The active projects are:',
      '',
      '1. **data-sharing-2026**: high priority [3]',
      '2. **file-manager-2**: high priority [3][4]',
      '',
      'See [Priorities](https://docs.umccr.org/management-knowledgebase/Priorities/).',
    ].join('\n');
    expect(render(answer)).toBe(
      '<p>The active projects are:</p>' +
        '<ol><li><strong>data-sharing-2026</strong>: high priority <cite 3></li>' +
        '<li><strong>file-manager-2</strong>: high priority <cite 3><cite 4></li></ol>' +
        '<p>See <a href="https://docs.umccr.org/management-knowledgebase/Priorities/">Priorities</a>.</p>'
    );
  });

  test('nests lists, keeps where a numbered list starts, and keeps a loose list together', () => {
    expect(render('- a\n  - b\n- c')).toBe('<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>');
    expect(render('3. three\n\n4. four')).toBe('<ol start="3"><li>three</li><li>four</li></ol>');
    expect(render('Steps:\n1. one\n2. two')).toBe('<p>Steps:</p><ol><li>one</li><li>two</li></ol>');
    expect(render('1. Build\n   ```sh\n   make test\n   ```')).toBe(
      '<ol><li>Build<pre><code>make test</code></pre></li></ol>'
    );
  });

  test('renders code, emphasis, quotes, rules, headings and line breaks', () => {
    expect(render('Run `umccr-docs check`, *then* ~~not~~ __this__ or ***both***.')).toBe(
      '<p>Run <code>umccr-docs check</code>, <em>then</em> <del>not</del> <strong>this</strong> or ' +
        '<em><strong>both</strong></em>.</p>'
    );
    expect(render('> quoted\n\n---\n\n## Steps\n\none\ntwo')).toBe(
      '<blockquote><p>quoted</p></blockquote><hr></hr><h4>Steps</h4><p>one<br></br>two</p>'
    );
    expect(render('```\n<b>kept</b> **as is**\n```')).toBe(
      '<pre><code>&lt;b>kept&lt;/b> **as is**</code></pre>'
    );
  });

  test('leaves snake_case, globs and arithmetic alone', () => {
    expect(render('Set doc_id and site_url; 2 * 3 * 4.')).toBe(
      '<p>Set doc_id and site_url; 2 * 3 * 4.</p>'
    );
  });

  test('renders a table', () => {
    expect(render('| Name | Lead |\n| --- | :---: |\n| `alpha` | Ada \\| Grace |')).toBe(
      '<table><thead><tr><th>Name</th><th>Lead</th></tr></thead>' +
        '<tbody><tr><td><code>alpha</code></td><td>Ada | Grace</td></tr></tbody></table>'
    );
  });

  test('a number in brackets is a citation marker, unless it is a link', () => {
    expect(render('See [1](https://example.org/) and [12], not [123] or [a].')).toBe(
      '<p>See <a href="https://example.org/">1</a> and <cite 12>, not [123] or [a].</p>'
    );
  });

  test('keeps HTML in an answer as text', () => {
    expect(
      render('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)> and <b>bold</b>')
    ).toBe(
      '<p>&lt;script>alert(1)&lt;/script></p><p>&lt;img src=x onerror=alert(1)> and &lt;b>bold&lt;/b></p>'
    );
  });

  test('links only to http(s), mailto and paths on this site', () => {
    expect(
      render(
        '[a](javascript:alert) [b](data:text/html,x) [c](//evil.example.com/) [d](/\\evil.example.com/) ' +
          '![e](javascript:alert)'
      )
    ).toBe('<p>a b c d e</p>');
    expect(
      render('[docs](/platform/) <https://github.com/umccr> and https://docs.umccr.org/x/.')
    ).toBe(
      '<p><a href="/platform/">docs</a> <a href="https://github.com/umccr">https://github.com/umccr</a> and ' +
        '<a href="https://docs.umccr.org/x/">https://docs.umccr.org/x/</a>.</p>'
    );
    expect(safeHref('mailto:platform@example.org')).toBe('mailto:platform@example.org');
    expect(safeHref('JavaScript:alert(1)')).toBeNull();
  });

  test('builds from a fixed set of elements only', () => {
    const tags = new Set<string>();
    const walk = (nodes: MarkdownNode[]) =>
      nodes.forEach((node) => {
        if (typeof node !== 'string') {
          tags.add(node.tag);
          walk(node.children);
        }
      });
    walk(
      markdownTree(
        '# h\n\n> q\n\n- a\n1. b\n\n```\nc\n```\n\n| x |\n| - |\n| y |\n\n---\n\n' +
          '**s** *e* ~~d~~ `c` [l](https://x.org/) [1]\nbr <iframe src=x></iframe> <svg onload=x>'
      )
    );
    const allowed = [
      ...['p', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'table'],
      ...['thead', 'tbody', 'tr', 'th', 'td', 'hr', 'br', 'strong', 'em', 'del', 'a', 'cite'],
    ];
    expect([...tags].filter((tag) => !allowed.includes(tag))).toEqual([]);
  });

  test('closes what a partly shown answer has opened on its last line', () => {
    expect(closeOpenMarks('Intro\n1. **data-sh')).toBe('Intro\n1. **data-sh**');
    expect(closeOpenMarks('Then **')).toBe('Then ');
    expect(closeOpenMarks('Run `make')).toBe('Run `make`');
    expect(closeOpenMarks('Run `')).toBe('Run ');
    expect(closeOpenMarks('See [Priorities](https://docs.um')).toBe('See Priorities');
    expect(closeOpenMarks('**done** and `code`')).toBe('**done** and `code`');
    expect(closeOpenMarks('```sh\nmake **')).toBe('```sh\nmake **');
  });
});

/** A response whose body yields `chunks`, then ends, or with `open`, never does; it records a cancel. */
const streamed = (chunks: string[], open = false) => {
  const encoder = new TextEncoder();
  const reads = { cancelled: false };
  let next = 0;
  const response: StreamedResponse = {
    body: {
      getReader: () => ({
        read: () =>
          next < chunks.length
            ? Promise.resolve({ done: false, value: encoder.encode(chunks[next++]) })
            : open
              ? new Promise(() => undefined)
              : Promise.resolve({ done: true }),
        cancel: () => {
          reads.cancelled = true;
          return Promise.resolve();
        },
      }),
    },
  };
  return { response, reads };
};

describe('answer stream', () => {
  test('reads events split across chunks, and reports every chunk', async () => {
    const { response } = streamed([
      'event: meta\ndata: {"exchangeId":"x1"}\n',
      '\nevent: delta\ndata: {"text":"Hi"}\n\n',
    ]);
    const events: Array<[string, unknown]> = [];
    let chunks = 0;
    await readEvents(
      response,
      (name, data) => {
        events.push([name, data]);
      },
      () => chunks++
    );
    expect(events).toEqual([
      ['meta', { exchangeId: 'x1' }],
      ['delta', { text: 'Hi' }],
    ]);
    expect(chunks).toBe(2);
  });

  test('stops at the event that ends the answer, though the server keeps the stream open', async () => {
    const { response, reads } = streamed(
      [
        'event: delta\ndata: {"text":"Hi"}\n\nevent: done\ndata: {}\n\n',
        'event: delta\ndata: {"text":"late"}\n\n',
      ],
      true
    );
    const names: string[] = [];
    await readEvents(response, (name) => {
      names.push(name);
      return name === 'done';
    });
    expect(names).toEqual(['delta', 'done']);
    expect(reads.cancelled).toBe(true);
  });
});

describe('stall watchdog', () => {
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  test('aborts once the time passes without a kick', async () => {
    const controller = new AbortController();
    watchdog(controller, 10);
    await sleep(30);
    expect(controller.signal.aborted).toBe(true);
  });

  test('starts the time again at each kick, and does nothing once stopped', async () => {
    const controller = new AbortController();
    const watch = watchdog(controller, 30);
    await sleep(20);
    watch.kick();
    await sleep(20);
    expect(controller.signal.aborted).toBe(false);
    watch.stop();
    await sleep(40);
    expect(controller.signal.aborted).toBe(false);
  });
});
