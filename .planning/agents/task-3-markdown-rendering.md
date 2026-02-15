# Task 3: Upgrade brainstorm chat to proper markdown rendering

## Status: COMPLETE

## Summary
Replaced the custom regex-based `renderMarkdown()` function (~110 lines including the `formatInline` helper) in ChatMessage.tsx with `react-markdown` + `remark-gfm`. This adds full markdown support for AI responses including tables, nested lists, links, images, task lists, strikethrough, blockquotes, and horizontal rules.

## Changes Made

### Dependencies Added
- `react-markdown` (installed via npm)
- `remark-gfm` (installed via npm)

### Files Modified

**src/renderer/components/ChatMessage.tsx**
- Removed `formatInline()` function (~40 lines) - was doing regex-based bold/italic/code parsing
- Removed `renderMarkdown()` function (~70 lines) - was doing regex-based code block splitting and line-by-line parsing
- Added imports for `ReactMarkdown` and `remarkGfm`
- Replaced `{renderMarkdown(message.content)}` with a `<ReactMarkdown>` component with custom styled components matching the app's dark theme
- Updated file header comment to reflect new dependencies and capabilities
- User messages remain plain text with `whitespace-pre-wrap` (unchanged)

### Custom component overrides applied
- `h1`, `h2`, `h3` - sized headings with appropriate spacing
- `p` - paragraphs with bottom margin
- `ul`, `ol`, `li` - styled lists (disc/decimal)
- `code` - distinguishes inline vs block code via className presence
- `pre` - code block wrapper with dark background and border (matches previous style)
- `a` - links open in new tab with primary color
- `table`, `th`, `td` - bordered table cells with header styling
- `blockquote` - left border accent with italic text
- `hr` - themed horizontal rule

## Verification
- TypeScript: PASS (zero errors)
- Tests: PASS (99/99)

## What This Fixes
The old regex parser could not handle:
- Markdown tables
- Links and images
- Nested lists
- Blockquotes
- Strikethrough text
- Task lists (checkboxes)
- Complex mixed formatting

All of these now work correctly via react-markdown's proper AST-based parsing.
