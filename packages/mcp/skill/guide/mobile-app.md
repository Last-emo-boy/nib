# Mobile app screens

## Canvas

- Phone frames: 390 × 844 (iPhone 15/16), 393 × 852, or 360 × 800 for Android. Use one size for the whole flow.
- Lay screens out left to right in flow order, 80 to 120 apart, each named for its step: `"1 · Welcome"`, `"2 · Sign up"`.
- Set `clip: true` on the screen frame.

## Structure

```js
phone = Insert(document, {type: "frame", name: "Home", x: at.x, y: at.y, width: 390, height: 844, layout: "vertical", fill: "$bg", clip: true})
Insert(phone, {type: "frame", name: "Status bar", width: "fill_container", height: 54})
body = Insert(phone, {type: "frame", name: "Body", width: "fill_container", height: "fill_container", layout: "vertical", padding: [8, 20], gap: 20})
tabs = Insert(phone, {type: "frame", name: "Tab bar", width: "fill_container", height: 84, padding: [8, 12, 30, 12], justifyContent: "space_around", stroke: "$border", strokeWidth: {top: 1}, fill: "$bg"})
```

- Status bar 47 to 54 tall at the top; home indicator area about 34 at the bottom. Keep content out of both.
- Horizontal margins 16 to 24. Large title 28 to 34px at the top of root screens; 17px titles in navigation bars of pushed screens.
- Tab bar: 3 to 5 tabs, icon 24 plus a 10 to 11px label, the active tab in the accent color.

## Touch and type

- Touch targets at least 44 × 44, even when the visible icon is smaller (pad the frame).
- Body text 15 to 17px, secondary 13px, never below 11px.
- Lists: rows 52 to 64 tall with a leading icon or avatar, title and subtitle, and a trailing chevron or value. Insets for dividers start at the text, not the screen edge.
- Primary buttons full width (`width: "fill_container"`), 48 to 56 tall, radius 12 to 16, at the bottom of the content or pinned above the home indicator.

## Sheets and overlays

Bottom sheets: a frame with `layoutPosition: "absolute"` at the bottom of the screen, top corners rounded (`cornerRadius: [16, 16, 0, 0]`), a small grabber bar, and a dimmed overlay (`fill: "#00000066"`) behind it, also absolute and screen-sized.
