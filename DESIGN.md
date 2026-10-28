# Design

Song Fa HR is an operating tool: HR reviews ~110 rows a day on a desktop. Scanability and consistency outrank expression. The identity is carried by the Song Fa mark, one engineered typeface and a restrained palette taken from the logo, not by decoration.

## Palette (OKLCH, defined as tokens in `app/globals.css`)
- **Paper** warm off-white page, **raised** white for panels. Text is a blue-tinted near-black (`ink`), with `ink-soft` and `ink-faint` for secondary text. Never pure grey or pure black.
- **Brand blue** (`brand`, `brand-deep`, `brand-wash`) is the only interactive colour: primary buttons, focus ring, hover wash. It is the oval of the logo.
- **Ruby** (`ruby`) is the diamond of the logo. It lives in the mark only; it is not used for actions, so it never competes with the red of "absent".
- **Steel** is the dark navigation rail. Active item sits on a raised steel step, not a coloured stripe.
- **Status colours** (`present`, `late`, `absent`, `leave`, `excused`, `dayoff`) each have a text tone and a wash. Status is always a word plus a dot, never colour alone.

## Type
IBM Plex Sans (400/500/600), chosen for its engineered character and true tabular figures; Noto Sans Khmer is in the stack so Khmer names and notes render in a matching weight. Numerals are tabular everywhere (`font-feature-settings: 'tnum'`). Scale: 22 page title, 15 section, 14 body and table text, 13 labels, 12 table headers and badges. Body copy stays under 70 characters per line.

## Layout
- Fixed 232px steel rail on desktop; a top bar with a drawer below 1024px.
- Content is capped at 1240px. A page is a title, an optional one-line note, then the work: a form row and a table. No hero metrics, no icon-and-heading card grids, no nested cards.
- One table treatment: hairline rules, quiet header, right-aligned numeric columns, hover wash. Secondary columns drop out on narrow screens instead of forcing sideways scroll where the table is short.
- Touch: below 1024px or on any touch screen, buttons, fields and selects are 44px tall and text fields are 16px (iOS does not zoom on focus); desktop keeps 36px. Rows of fields align on their bottom edge, so a field that needs explaining puts it in the label ("To (optional)"), not in a hint below. Tables sit in a `TableWrap` (relative, scrolling, empty message pinned in view). The roster grid is dense by nature and keeps its small cells.
- Filters live in the URL (`?from=&to=&pin=`) so any view can be shared or bookmarked.

## Components
Button (primary / quiet / danger), Input, Field, StatusBadge, PageHeader, EmptyState, Table. Icons are `lucide-react` at one stroke weight. Depth is a soft blurred shadow used only on floating layers (the mobile drawer).

## States
Every list has an empty state that says what to do. Errors name the problem and the recovery. Hover, focus (2px brand ring), disabled and loading are all themed; selection colour, scrollbars and numerals are styled so no browser default shows through. Reduced motion is respected.

## Rules this system refuses
Gradient text, glass decoration, coloured side-borders on cards, hard offset shadows, kickers above headings, section numbers, emoji or unicode glyphs as icons, same-size card grids as page structure. `impeccable detect` runs clean on `app/` and `components/`.
