# Design craft

## Start from the content

Write the real copy first: actual headings, labels, numbers, names. Lorem ipsum hides problems (a label that wraps, a number that is too wide). Decide what the screen is for and what the one main action is; everything else supports it.

## Hierarchy

- One focal point per screen or section: the biggest, highest-contrast element.
- Three levels of text are usually enough: title, body, secondary (smaller or muted). Distinguish levels by size and weight together, not color alone.
- Group related items tightly and separate groups generously. Spacing inside a group should be clearly smaller than spacing between groups (8 vs 24, 16 vs 48).

## Spacing

- Use a scale and stick to it: 4, 8, 12, 16, 24, 32, 48, 64, 96. Put the common steps in variables.
- Padding inside containers is usually equal on all sides, or larger horizontally (`[12, 16]` for buttons, `[20, 24]` for cards).
- Align to edges. Elements in a column share a left edge; numbers in a table align right.

## Type

- One family is plenty for most UI; two at most (a display face for headings, a neutral one for everything else).
- Body text 14 to 16px on screens, line height 1.4 to 1.6. Headings tighter: 1.1 to 1.25, with slightly negative letter spacing at large sizes (-0.5 to -2px).
- Keep lines of reading text under about 75 characters: give paragraphs a `width` around 560 to 680px.
- Use real weights from the family (400, 500, 600, 700).

## Color

- Build from neutrals: a background, one or two surface levels, a border color, and three text colors (primary, secondary, muted). Add one accent for actions and selection, and semantic colors (success, warning, danger) only where they mean something.
- Check contrast: body text at least 4.5:1 against its background, large text 3:1. Muted grey on a grey surface is the usual failure.
- In dark themes, use dark grey surfaces rather than pure black, raise surfaces by making them lighter, and reduce the accent's saturation slightly.

## Surfaces and depth

- Separate areas with spacing first, then a background change, then a border, then a shadow. One of these is usually enough.
- Keep radii consistent: one value for small controls (6 to 8), one for cards (12 to 16), full rounding for pills and avatars.
- Shadows: soft and low (alpha 0.04 to 0.12), larger blur for higher elevation.

## Imagery and icons

- One icon set (lucide by default), one size per context (16 in dense UI, 20 to 24 in navigation), the same color as nearby text or muted.
- Image placeholders: a frame with a fixed size and a neutral fill, or an image fill with a real URL.

## Review checklist

Before reporting, take a screenshot and check:

- Nothing collapsed, overflowing, clipped, or overlapping by accident. The reply's Issues list is empty.
- Text is legible: sizes at least 12px, enough contrast, no orphaned single words in headings.
- Spacing follows the scale; edges line up; similar elements look the same.
- The main action is obvious. Empty, loading, and error states exist where the screen needs them.
- Names: frames and important nodes have meaningful names.
