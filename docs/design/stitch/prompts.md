# Stitch prompts: docs.umccr.org with Ask the docs

A staged set of prompts for designing docs.umccr.org and its OrcaSonar chat panel in
[Google Stitch](https://stitch.withgoogle.com). Each stage makes one screen (or one state board), so each result
can be checked and fixed before the next one builds on it.

Everything the prompts show, from page text to sample answers, comes from this public repository's
`app/site/` and `examples/`. Stitch is an external Google service: don't paste private knowledgebase content into
it.

## How to run them

1. **Design system first** (stage 0). Once the project holds it, the generation prompts describe layout and content
   only. Google's own Stitch skills warn that repeating colours or fonts in a generation prompt conflicts with the
   project's design system.
2. **One screen per prompt, in order.** Stage 1 is the anchor; later stages refer to it by name. Rename each screen
   in Stitch to the name given in its stage heading.
3. **Select the screen before an edit** (add it to the chat), and make one change per edit prompt. Finish edits
   with "Change nothing else."
4. **Keep prompts short.** Results drop components once a prompt gets long; everything here is well under 3,000
   characters.
5. **Duplicate a screen before a risky edit**, so a bad regeneration costs nothing.
6. Use the higher-quality generation mode for new screens and the faster one for small edits. Use Variations for
   exploring (stage 2 especially), with a low creative range for polish and a high one for alternative layouts.

## Stage 0: project and design system

1. New project, type **Web**.
2. Import [DESIGN.md](DESIGN.md) into the project's design system and set it as the project default.
3. If import isn't offered, set the theme by hand: light mode, custom primary colour `#2563eb`, font Inter,
   roundness about 8px. Then paste this block at the top of the stage 1 prompt, and only there:

```text
DESIGN SYSTEM (REQUIRED):
- Platform: Web, desktop-first
- Theme: light, clean and minimal, flat surfaces, 1px hairline borders, generous whitespace, no gradients
- Page background: White (#ffffff); subtle surface Slate 50 (#f8fafc) for code blocks and table headers
- Primary accent: Signal Blue (#2563eb) for links, primary buttons, the active navigation item and focus rings only
- Text: Slate 900 (#0f172a); secondary text Slate 500 (#64748b); borders Slate 200 (#e2e8f0)
- Status: green (#22c55e), amber (#f59e0b), red (#ef4444) for callouts and badges
- Type: Inter; body 16px with 1.65 line height in a text column no wider than 720px; UI text 14px; code in a monospace
- Corners: 8px buttons, inputs and code blocks; 12px cards and panels; pills for chips
```

## Stage 1: "Docs page"

The anchor screen. Spend the iterations here: every later screen inherits it.

```text
A documentation page on docs.umccr.org, the signed-in documentation site for staff of a cancer research centre. Professional, calm and modern: a reading surface first, chrome second. Flat surfaces, hairline dividers, generous whitespace, no imagery.

PLATFORM: Web, desktop, 1440px wide.

PAGE STRUCTURE:
1. Classification strip: a thin full-width neutral bar above the header with small centred text "Internal: UMCCR staff only".
2. Sticky header (56px): a small blue rounded-square logo with an open-book glyph, "UMCCR Docs", a thin divider, then the site name "UMCCR docs platform". On the right: a search field "Search this site" with a "/" key hint, a light/dark icon button, a source link "umccr/docs-platform", and a round account button with the initials "AL".
3. Left navigation (256px): "Catalogue", "Reading", and an expanded group "Publishing" with "Onboarding a repository" (active), "Authoring", "Publishing contract".
4. Main content, text column at most 720px:
   - Breadcrumbs: "All documentation / UMCCR docs platform / Publishing".
   - H1 "Onboarding a repository", lead: "Publishing a repository's documentation at docs.umccr.org/<slug>/. Your repository gets a configuration file and nothing else." Meta line: "Updated 15 Oct 2026 · Edit this page".
   - H2 "1. Choose a slug", a short paragraph, and a note callout: "The slug is permanent: renaming it moves the site's URL."
   - H2 "2. Add the configuration", a paragraph, and a code block with a copy button: "pip install --no-deps <docs-platform>/toolkit" and "umccr-docs serve" on two lines.
   - H2 "3. Register the site" with a table (Field, Example, Meaning): slug, my-service, the site's path; branch, main, pushes to this branch publish the site; docsPaths, docs/**, a push that changes none of these publishes nothing; stages, dev and prod, where it is published.
   - H2 "4. Push", a paragraph, and a tip callout: "Your site appears in the catalogue and in Ask the docs shortly after it publishes."
   - Previous and next cards: "Reading" and "Authoring".
5. Right rail (224px, sticky): "On this page" with the four H2s, the current one marked.
6. Footer: one small muted line "Source: umccr/docs-platform · commit 4f2c9a1e7b3d · built 15 Oct 2026 09:12 UTC · All UMCCR documentation".
7. Bottom-right floating pill button "Ask the docs" with a small sonar-ripple icon.
```

Check before moving on: body text reads at 16px, blue appears only on links, the active nav item and buttons, and
the classification strip is quiet rather than alarming.

## Stage 2: "Docs page, Ask open"

Select "Docs page" first. This sets the chat panel's look, so try Variations here (docked panel against a wide
floating panel) before settling.

```text
Create a new screen from "Docs page" with the Ask the docs panel open. Keep the header, left navigation and page content as they are.

PLATFORM: Web, desktop, 1440px.

CHANGES:
1. The floating "Ask the docs" button is gone. A 400px panel is docked to the right edge, full height below the header, separated by a hairline border, with no heavy shadow. It replaces the "On this page" rail; the content column narrows.
2. Panel header: a small sonar-ripple icon, the title "Ask the docs" and a muted subtitle "OrcaSonar". On the right, icon buttons "New conversation" and "Close".
3. Under it, one row: a segmented control "Ask" (selected) | "Search", and a switch "This site only" with a small chip "UMCCR docs platform".
4. Conversation:
   - The reader's question in a subtle blue-tinted block: "How do I add a site to docs.umccr.org?"
   - The answer as plain full-width paragraphs, no bubble and no avatar: "Add one entry to the site registry in docs-platform, naming your repository, branch and docs paths, and add a mkdocs.yml from the template to your repository. The next push to that branch publishes the site, to docs.dev.umccr.org first and then to docs.umccr.org."
   - A "Sources" label and three compact numbered source cards, each with page title as a link, the site name as a small chip and a one-line muted snippet: "Onboarding a repository", "Publishing contract", "Authoring".
   - A quiet row: "Was this helpful?" with thumbs-up and thumbs-down icon buttons, and a copy icon button.
5. Composer pinned to the panel bottom: a multi-line text area "Ask a follow-up…", a round send icon button, and below it a muted caption "Answers come only from UMCCR documentation and can be wrong: check the sources."
```

## Stage 3: "Ask states"

```text
Create a states board for the Ask the docs panel: three copies of the 400px panel from "Docs page, Ask open" side by side on a plain light canvas, each with a small caption above it. Same panel header, mode row and composer in each.

PLATFORM: Web, desktop, 1440px.

PANELS:
1. Caption "Welcome". Ask mode, empty conversation. A centred sonar-ripple icon, the heading "Ask the UMCCR documentation", and muted text: "Answers come only from UMCCR documentation and can be wrong: check the sources. Questions and answers are kept for 30 days to improve answers." Then four suggested-question chips, stacked: "How do I add a site to docs.umccr.org?", "What can an Obsidian vault site contain?", "How does a release reach prod?", "Who can read these sites?"
2. Caption "Answering". The question "What can an Obsidian vault site contain?", then half an answer in plain paragraphs ending in a text caret, a small "Answering…" status with a pulsing dot, and a "Stop" text button. No sources yet.
3. Caption "Search". The Search segment selected. A list of five passage results: page title as a link, a site chip, and a two-line muted snippet with the matched words highlighted. Under the list, muted text: "Search lists matching passages without writing an answer."
```

## Stage 4: "Ask problems"

The wording is the panel's real wording, so the designs drop straight into `umccr.js`.

```text
Create a second states board for the Ask the docs panel: four copies of the panel side by side, each with a caption. Each shows a problem explained calmly inside the conversation, under the reader's question, as an inline notice with an icon, one or two sentences and one action. No modals, no full-panel error pages. The composer stays visible.

PLATFORM: Web, desktop, 1440px.

PANELS:
1. Caption "Sign-in expired". Neutral notice: "Your sign-in has expired." with a primary button "Sign in again".
2. Caption "Daily allowance used". Amber notice: "Today's allowance for answers is used up. Try again tomorrow; Search still works." with an outline button "Switch to Search".
3. Caption "Unavailable". Red notice: "Chat is unavailable right now. Try again shortly." with an outline button "Retry".
4. Caption "Stopped early". A partial answer that stays readable, the sources that arrived, then a red notice "The answer stopped early." with an outline button "Retry".
```

## Stage 5: "Catalogue"

```text
The home page of docs.umccr.org: the catalogue of every UMCCR documentation site, and one place to ask or search across all of them. A working index for staff, not a marketing page: no hero image, no illustrations.

PLATFORM: Web, desktop, 1440px.

PAGE STRUCTURE:
1. The same header as "Docs page", with the site name "UMCCR documentation". No left navigation on this page.
2. Intro, left-aligned in a 1040px container: H1 "UMCCR documentation" and the lead "Documentation published by UMCCR teams. Each site is written and reviewed in its own repository and published here when it changes."
3. Ask bar: one wide input "Ask a question or search all UMCCR documentation" with a small sonar-ripple icon at its left, an "Ask | Search" segmented control inside its right edge, and three suggested-question chips under it.
4. A "SITES" section label with the count "2", then a three-column card grid. Each card: a monogram tile, the site title, a one-line description and a muted path. "UMCCR docs platform", "Catalogue of UMCCR documentation, onboarding and authoring conventions.", "/platform/". "Management knowledgebase", "Platform Services projects, decisions, priorities and working conventions.", "/management-knowledgebase/". A third card with a dashed border: "Publish your documentation" linking to "Onboarding a repository".
5. "Publishing your documentation" section: three link rows with an icon, title and one line: "Onboarding a repository: add a configuration file and register the site", "Authoring: what you can write, including Obsidian vaults", "Publishing contract: what the platform guarantees and enforces".
6. Footer: "All signed-in UMCCR readers can read every site." and the provenance line from "Docs page".
```

## Stage 6: "Search open"

Select "Docs page" first. This joins the site's own page search with Ask the docs, so a reader never has to choose
between the two boxes.

```text
Create a new screen from "Docs page" with the header search open. The page behind stays the same, slightly dimmed.

CHANGES:
1. The search field widens to 640px and holds the query "registry".
2. A dropdown panel under it, aligned with the field:
   - First row, highlighted as the keyboard selection: a sonar-ripple icon, "Ask the docs: registry", a muted hint "Get an answer with sources", and a return-key hint on the right.
   - A section label "ON THIS SITE" and four page results. Each has the page title, its heading path in muted text (for example "Onboarding a repository › 3. Register the site") and a one-line snippet with "registry" highlighted.
   - A row "Search all UMCCR documentation for registry".
   - A footer strip with key hints: "↑↓ move", "↵ open", "esc close".
```

## Stage 7: "Vault page" (optional)

How an Obsidian vault site, such as a team knowledgebase, looks. The content is the synthetic vault in
`examples/obsidian-vault/`.

```text
Create a new screen with the "Docs page" layout for a page from a team knowledgebase written in Obsidian. The header shows the site name "Example team".

PAGE STRUCTURE:
1. Left navigation: "Home", "Priorities", an expanded group "Projects" with "Alpha" (active), "Beta", "Gamma", and collapsed groups "Guides" and "Status".
2. Main content:
   - Breadcrumbs "All documentation / Example team / Projects" and the H1 "Alpha".
   - A properties panel under the title: a bordered box with a compact two-column key/value list, keys muted. Type: project. Status: a green "active" status badge. Priority: High. Lead: Ada. Members: Grace. Domains: a link chip "platform-area". Updated: 28 Sep 2026.
   - A paragraph with two internal links: "Depends on the beta project and follows Headings in the writing guide."
   - H2 "Actions" with a task list: "Draft the design" checked, and "Ship it" unchecked with a yellow text highlight.
   - A collapsed warning callout with a chevron, titled "Folded detail".
   - H2 "Active projects": a compact table with columns Name, Domains, Lead, Priority and three rows, and a muted caption under it "Built from the vault when the site was published".
3. Right rail "On this page": "Actions", "Active projects".
```

## Stage 8: "Mobile"

Two screens in one prompt. If Stitch merges them, run each part as its own prompt.

```text
Create two mobile web screens, 390px wide, matching "Docs page" and "Docs page, Ask open".

SCREEN 1, "Mobile docs page":
1. The thin classification strip, then a compact header: menu icon, logo, the site name "UMCCR docs platform" truncated, a search icon and the account initials.
2. Content: a back link "‹ Publishing", the H1 "Onboarding a repository", the lead, an "On this page" disclosure row, then the body with the note callout, a horizontally scrolling code block and a horizontally scrolling table.
3. A round floating "Ask the docs" button bottom-right with the sonar-ripple icon.

SCREEN 2, "Mobile Ask":
1. A full-screen sheet over the page with a drag handle, the title "Ask the docs", and "New conversation" and "Close" icons.
2. One row: "Ask | Search" segmented control and a "This site only" switch.
3. The same conversation as the desktop panel: question block, plain-text answer, three numbered source cards, the feedback row.
4. The composer fixed at the bottom: "Ask a follow-up…", a send button, and the muted caption "Answers can be wrong: check the sources."
```

## Stage 9: "Sign-in" and "Not found" (optional)

The real sign-in page copies the UMCCR portal's sign-in card, so this one is the exception to the flat rules.

```text
Create the sign-in page for docs.umccr.org, a sibling of the UMCCR portal's sign-in. Dark theme on a deep navy background (#020617) with two very soft blue radial glows: the only screen in this project with a gradient.

PLATFORM: Web, desktop, 1440px, content centred and 448px wide.

PAGE STRUCTURE:
1. Brand block, centred: a 56px blue rounded-square logo with the open-book glyph, "UMCCR Docs", and a small uppercase, widely tracked muted subtitle "DOCUMENTATION".
2. A card in translucent dark slate with a hairline border and 12px corners:
   - "Welcome back" and "Sign in with your institutional UMCCR account to read UMCCR documentation."
   - A full-width outline button "Sign in with UMCCR account".
   - A divider with the small uppercase label "SECURE UMCCR SSO".
   - Muted centred text: "Access is restricted to authorised UMCCR personnel. By signing in you agree to the organisation's data governance policies."
3. Footer: "© 2026 UMCCR · University of Melbourne Centre for Cancer Research".
```

```text
Create a "Page not found" screen in the "Docs page" style: the same header without navigation, and a centred block with a small muted "404" label, the H1 "Page not found", the text "There is no documentation page at this address. It may have moved or been removed.", a primary button "Browse all UMCCR documentation" and a text link "Ask the docs instead".
```

## Stage 10: dark mode

Switch the design system to dark first and apply it to every screen; the DESIGN.md carries the dark palette. Then
fix drift one screen at a time:

```text
Create a dark mode version of this screen using the design system's dark palette: deep navy page, a slightly lighter slate for the Ask the docs panel, code blocks and dropdowns, slate hairline borders, light blue links, and the same blue for filled buttons. Keep the layout, content and spacing identical. No glows and no gradients.
```

## Refinement prompts

One change each. Select the screen first.

| When | Prompt |
| --- | --- |
| Blue is everywhere | `Use blue only for links, the active navigation item, the selected segment and primary buttons. Make every other blue fill or icon neutral slate. Change nothing else.` |
| Text is small or dense | `Set the main content's body text to 16px with a 1.65 line height and keep the text column at most 720px wide. Change nothing else.` |
| The panel looks like a consumer chatbot | `In the Ask the docs panel, remove chat bubbles, avatars and any robot or sparkle icons. Show the question as a tinted block and the answer as plain full-width paragraphs. Change nothing else.` |
| Sources are hard to scan | `Make the source cards in the Ask the docs panel easier to scan: a number badge, the page title as a link, the site name as a small chip and a one-line snippet. Change nothing else.` |
| Cards look heavy | `Remove resting shadows from cards, the header, the sidebars and the docked panel; keep a 1px border. Keep shadows only on dropdowns, menus and the mobile sheet. Change nothing else.` |
| A screen has drifted | `Make this screen's header identical to the header on "Docs page": height, logo, search field, icons and account button. Change nothing else.` |
| Show the environment | `In the header, add a small "DEV" pill right after "UMCCR Docs", for the development site only. Change nothing else.` |
| Account menu | `Show the account menu open under the initials button: the name "Ada Lovelace" and a muted email, then "All UMCCR documentation" and "Sign out". Change nothing else.` |

## Prototype links

Once the screens exist, link them and press Play to walk the flows:

- "Docs page" floating button → "Ask states" (Welcome) → "Docs page, Ask open".
- "Docs page" search field → "Search open"; its "Ask the docs: registry" row → "Docs page, Ask open".
- "Catalogue" site card → "Docs page"; its Ask bar → "Docs page, Ask open".
- "Mobile docs page" floating button → "Mobile Ask".

## After Stitch

Export the screens' HTML and the project's DESIGN.md. Building them means changing the theme in
`toolkit/src/umccr_docs/theme/` (template overrides, `umccr.css`, `umccr.js`) within what the platform allows:

- **Fonts are self-hosted.** The content pages' CSP allows no third-party requests, so Inter and the code font ship
  in the theme's assets rather than from Google Fonts.
- **Answers are plain text.** OrcaSonar returns the answer, then its citations as a list; render both as text.
  Inline citation markers inside the answer would need an API change.
- **Two searches.** The header search is each site's own MkDocs index; Ask and Search in the panel are OrcaSonar,
  across sites unless "This site only" is on. Stage 6 is where they meet.
- **The panel loads sign-in code only when opened**, so the launcher and the welcome state must render before a
  token exists.
- **New in these designs**, each small: "New conversation" (forget the conversation ID), "Stop" (abort the stream),
  copy answer, suggested questions, and the search dropdown's Ask row.
