# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

This is a monorepo of Chrome extensions. Each extension lives in its own top-level directory with a `manifest.json` and `background.js` (no build step, no dependencies, no package.json).

## Extensions

- **copy-url-extension** — Copies current tab URL to clipboard via `Cmd+Shift+C` (Mac) / `Ctrl+Shift+C`. Shows a toast notification on the page.
- **tab-switcher-extension** — MRU tab switcher triggered by `Ctrl+Shift+Space`. Displays a macOS-style visual overlay and auto-selects after 800ms idle.

## Architecture

All extensions use **Chrome Manifest V3** with a service worker (`background.js`) as the sole entry point — no popup, options page, or content scripts as separate files. UI is injected into pages at runtime via `chrome.scripting.executeScript`.

Key patterns:
- Keyboard shortcuts are defined in `manifest.json` under `commands` and handled via `chrome.commands.onCommand`
- Injected UI uses inline styles with `z-index: 2147483647` to sit above all page content
- The tab switcher maintains an in-memory MRU list (capped at 20) using `chrome.tabs.onActivated`, `onRemoved`, and `chrome.windows.onFocusChanged`

## Development

No build tools, linters, or test frameworks. To test:
1. Open `chrome://extensions` in Chrome
2. Enable "Developer mode"
3. Click "Load unpacked" and select an extension's directory
4. Changes to `background.js` require clicking the reload icon on the extension card

## Conventions

- Plain vanilla JS — no frameworks, no transpilation
- Each extension is fully self-contained in its directory (manifest + background script)
- Overlay/toast CSS is constructed as JS strings, not separate `.css` files
