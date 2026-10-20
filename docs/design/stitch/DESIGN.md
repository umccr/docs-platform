---
name: UMCCR Docs
description: Signed-in documentation for UMCCR staff, with OrcaSonar's "Ask the docs" panel on every page.
colors:
  signal-blue: '#2563eb'
  signal-blue-tint: '#eff6ff'
  signal-blue-text-dark: '#60a5fa'
  canvas: '#ffffff'
  canvas-dark: '#101922'
  surface-subtle: '#f8fafc'
  surface-subtle-dark: '#111418'
  surface-elevated-dark: '#1e252e'
  border: '#e2e8f0'
  border-dark: '#2d3540'
  text: '#0f172a'
  text-dark: '#f1f5f9'
  muted: '#64748b'
  muted-dark: '#9dabb9'
  status-success: '#22c55e'
  status-success-text: '#15803d'
  status-warning: '#f59e0b'
  status-warning-text: '#b45309'
  status-error: '#ef4444'
  status-error-text: '#b91c1c'
typography:
  display:
    fontFamily: 'Inter, system-ui, sans-serif'
    fontSize: '2rem'
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: '-0.02em'
  headline:
    fontFamily: 'Inter, system-ui, sans-serif'
    fontSize: '1.375rem'
    fontWeight: 600
    lineHeight: 1.3
  title:
    fontFamily: 'Inter, system-ui, sans-serif'
    fontSize: '1.125rem'
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: 'Inter, system-ui, sans-serif'
    fontSize: '1rem'
    fontWeight: 400
    lineHeight: 1.65
  ui:
    fontFamily: 'Inter, system-ui, sans-serif'
    fontSize: '0.875rem'
    fontWeight: 500
    lineHeight: 1.45
  caption:
    fontFamily: 'Inter, system-ui, sans-serif'
    fontSize: '0.75rem'
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: 'Inter, system-ui, sans-serif'
    fontSize: '0.6875rem'
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: '0.06em'
  code:
    fontFamily: 'JetBrains Mono, ui-monospace, monospace'
    fontSize: '0.875rem'
    fontWeight: 400
    lineHeight: 1.6
rounded:
  sm: '4px'
  md: '8px'
  lg: '12px'
  full: '9999px'
spacing:
  xs: '4px'
  sm: '8px'
  md: '16px'
  lg: '24px'
  xl: '32px'
  xxl: '48px'
components:
  button-primary:
    backgroundColor: '{colors.signal-blue}'
    textColor: '#ffffff'
    rounded: '{rounded.md}'
    height: '36px'
    padding: '0 16px'
  button-outline:
    backgroundColor: '{colors.canvas}'
    textColor: '{colors.text}'
    rounded: '{rounded.md}'
    height: '36px'
    padding: '0 16px'
  input:
    backgroundColor: '{colors.canvas}'
    textColor: '{colors.text}'
    rounded: '{rounded.md}'
    height: '36px'
    padding: '4px 12px'
  card:
    backgroundColor: '{colors.canvas}'
    textColor: '{colors.text}'
    rounded: '{rounded.lg}'
    padding: '16px'
  code-block:
    backgroundColor: '{colors.surface-subtle}'
    textColor: '{colors.text}'
    rounded: '{rounded.md}'
    padding: '16px'
---

# Design System: UMCCR Docs

## Overview

**North star: "The reference shelf beside the console."** docs.umccr.org is where UMCCR staff read how things work.
It belongs to the same family as the UMCCR portal (Orcabus LIMS Console): the same Signal Blue, the same cool slate
neutrals, the same navy dark mode, Inter, flat surfaces and hairline borders. It differs in one way: the portal is
dense telemetry, the docs are prose, so text is larger and the measure is narrow.

Mood: calm, clear, modern, trustworthy. A reading surface first and chrome second. Internal tool: no marketing hero,
no stock imagery, no illustrations.

## Colors

- **Signal Blue** (#2563eb): links, primary buttons, the active navigation item, the selected segment, focus rings.
  In dark mode, links and active text use #60a5fa; filled buttons stay #2563eb.
- **Signal Blue Tint** (#eff6ff): the active navigation row and the reader's question in the chat panel.
- **Canvas** (#ffffff / dark #101922): the page.
- **Subtle surface** (#f8fafc / dark #111418): code blocks, table headers, the properties panel. Dark mode overlays
  (chat panel, dropdowns, popovers) use #1e252e.
- **Border** (#e2e8f0 / dark #2d3540): every divider, card, input and table rule. 1px.
- **Text** (#0f172a / dark #f1f5f9) and **Muted** (#64748b / dark #9dabb9) for secondary text, captions, icons.
- **Status**: success #22c55e, warning #f59e0b, error #ef4444 for borders, icons and badges. When status colours carry
  text, use #15803d, #b45309 and #b91c1c. Info and notes use Signal Blue: no fourth hue.

**The Signal Rarity Rule.** Blue means "you can act on this" or "you are here". It never fills large areas or
decorates static content.

## Typography

Inter only, carried by weight and size, with a monospace for code.

- Page title 32px/700, section heading 22px/600, sub-heading 18px/600.
- **Body 16px, line height 1.65, text column at most 720px (about 72 characters).** Prose is the product.
- UI text 14px/500: navigation, table of contents, chat panel, buttons.
- Captions 12px: provenance footer, metadata, hints. Labels 11px/600 uppercase, tracked 0.06em, for section labels.

## Layout

- Sticky header, 56px. Optional classification strip above it (e.g. "Internal: UMCCR staff only"), 28px, neutral.
- Desktop (1280px and up): left navigation 256px, centred content column, right "On this page" rail 224px.
- 960 to 1279px: the right rail folds into an "On this page" disclosure above the content.
- Under 960px: navigation in a drawer from the menu button.
- **Ask the docs panel**: docked to the right edge on desktop, 400px wide, full height below the header. While open
  it replaces the right rail and the content column narrows. On mobile it is a full-screen sheet.

## Elevation and shape

**Flat by default.** Cards, header, sidebars and the docked panel rest on a border only. Shadows appear only on
true overlays: dropdowns, the account menu, the search panel, the mobile sheet, and the floating launcher.
Corners: 4px for small controls and badges, 8px for buttons, inputs and code blocks, 12px for cards and panels,
pills for chips and segmented controls.

## Components

- **Callouts** (note, tip, warning, danger): 3px coloured left border, faint tint of the same hue, icon and bold title.
  Collapsible callouts show a chevron.
- **Code block**: subtle surface, optional filename tab, copy icon button top-right, horizontal scroll, never wraps.
- **Table**: hairline rules, subtle header row, 14px text, horizontal scroll on small screens.
- **Properties panel** (Obsidian frontmatter): bordered box under the page title, two-column key/value list, muted
  keys; status values as status badges.
- **Site card** (catalogue): monogram tile, title, one-line description, muted path; border turns blue on hover.
- **Ask the docs panel**: header with a small sonar-ripple glyph, "Ask the docs" and "OrcaSonar" as a muted
  subtitle; Ask | Search segmented control; "This site only" switch; conversation; composer pinned to the bottom.
  - The reader's question is a tinted block. The answer is plain paragraphs, full width: no bubble, no avatar.
  - **Sources** follow every answer as numbered cards: page title (link), site chip, one-line snippet.
  - Feedback is quiet: "Was this helpful?" with thumbs up and down.
  - Problems appear inline in the conversation as a notice with an icon, one or two sentences and one action.
- **Provenance footer**: one caption line with source repository, commit, build time and "All UMCCR documentation".

## Do and don't

- Do keep blue for links and actions only, and keep surfaces flat with 1px borders.
- Do give every new colour a dark-mode counterpart from the navy scale.
- Do keep sources visible and close to the answer: they are how readers check it.
- Don't use gradients, glows or glassmorphism, except on the sign-in page, which matches the portal's sign-in.
- Don't make the assistant a character: no robot, sparkle icons, purple "AI" gradients or chat avatars.
- Don't style answers beyond Markdown's basics (paragraphs, lists, code, small tables, links); titles and snippets
  are plain text.
