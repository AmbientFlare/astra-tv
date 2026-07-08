# Vega Performance Reference

Local index for Astra performance work. Source docs are Amazon Vega SDK 0.23
pages, fetched July 6, 2026.

## Source Pages

- Improve App Performance: https://developer.amazon.com/docs/vega/0.23/improve-performance-overview.html
- App Performance Best Practices: https://developer.amazon.com/docs/vega/0.23/best_practices.html
- App Performance FAQ: https://developer.amazon.com/docs/vega/0.23/faq.html
- Concurrent Rendering: https://developer.amazon.com/docs/vega/0.23/concurrent-rendering.html
- Avoid Overdraw: https://developer.amazon.com/docs/vega/0.23/avoid-overdraw.html
- JavaScript Thread Performance: https://developer.amazon.com/docs/vega/0.23/js-thread-perf.html
- JavaScript Memory: https://developer.amazon.com/docs/vega/0.23/javascript-crash-memory.html
- Component Re-rendering: https://developer.amazon.com/docs/vega/0.23/investigate-component-re-render.html
- Detect Overdraw: https://developer.amazon.com/docs/vega/0.23/detect-overdraw.html

## Astra Checklist

- Keep focus handlers lightweight; do not run network calls, sorting, or heavy
  state cascades directly from `onFocus` / `onBlur`.
- Memoize repeated card/list components when props can remain stable.
- Use stable `FlatList` helpers (`renderItem`, `keyExtractor`, and
  `getItemLayout` where practical).
- Avoid anonymous work inside large list render paths when it causes repeated
  child renders.
- Gate debug logging in playback and Shaka/polyfill paths; warnings and errors
  can stay visible.
- Watch overdraw on artwork-heavy screens: backdrop + poster grids + overlays
  are likely hotspots.
- Profile on device with Activity Monitor, Memory Monitor, UI fluidity tools,
  React DevTools, and component re-render tooling before larger rewrites.
