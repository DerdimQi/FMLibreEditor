// The keyboard shortcuts of the app: a letter or a digit with the main modifier of the system, which is Ctrl on Windows
// and Command on macOS. `App` listens for them; the command palette and the hover texts show them.

import { paletteText } from "./labels";

/** True on macOS, where the shortcuts take Command and are written with its sign. */
export const isMac = /mac/i.test(window.navigator.platform) || /Macintosh/.test(window.navigator.userAgent);

/** A shortcut: the main modifier with `key`, a lower-case letter or a digit, and with Shift when `shift` is set. */
export interface Shortcut {
  key: string;
  shift?: boolean;
}

/** The shortcuts that are no list's own; the lists take the digits in the order of their tabs (see `viewShortcut`). */
export const SHORTCUTS = {
  /** Opens the command palette, and closes it. */
  palette: { key: "k" },
  /** Puts the caret in the search box of the list on show. */
  find: { key: "f" },
  /** Reads the game again; while not connected, looks for the game again. */
  reload: { key: "r" },
  /** Presses Edit in the profile on show. */
  edit: { key: "e" },
  /** Presses Apply in the profile on show. */
  apply: { key: "s" },
} satisfies Record<string, Shortcut>;

/** The shortcut of the list whose tab is at `index`, from 0: the main modifier with 1, 2 and so on. */
export const viewShortcut = (index: number): Shortcut => ({ key: String(index + 1) });

/**
 * The letter or digit a key press stands for. A digit goes by where the key is, as the digits of a French keyboard
 * need Shift; a letter by what the layout types, and by where the key is when the layout types no Latin letter
 * (Russian, Korean), so that the shortcuts keep working there.
 */
function pressed(event: KeyboardEvent): string {
  const digit = /^Digit(\d)$/.exec(event.code);
  if (digit) {
    return digit[1];
  }
  const key = event.key.toLowerCase();
  if (/^[a-z0-9]$/.test(key)) {
    return key;
  }
  const letter = /^Key([A-Z])$/.exec(event.code);
  return letter ? letter[1].toLowerCase() : key;
}

/**
 * Whether `event` is `shortcut`. Alt rules it out: AltGr, which types the third sign of a key on many European
 * keyboards, reaches the page as Ctrl with Alt on Windows.
 */
export function matches(event: KeyboardEvent, shortcut: Shortcut): boolean {
  const modifier = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  return modifier && !event.altKey && event.shiftKey === Boolean(shortcut.shift) && pressed(event) === shortcut.key;
}

/** The keys of `shortcut` one by one, as they are shown: Ctrl, K on Windows; the signs of Command and K on macOS. */
export function shortcutKeys(shortcut: Shortcut): string[] {
  const key = shortcut.key.toUpperCase();
  if (isMac) {
    return [...(shortcut.shift ? ["⇧"] : []), "⌘", key];
  }
  return [paletteText.keys.ctrl, ...(shortcut.shift ? [paletteText.keys.shift] : []), key];
}

/** `shortcut` as one piece of text: "Ctrl+K" on Windows, "⌘K" on macOS. */
export function shortcutText(shortcut: Shortcut): string {
  return shortcutKeys(shortcut).join(isMac ? "" : "+");
}

/** `label` with its shortcut after it, for a hover text: "Reload data (Ctrl+R)". */
export function withShortcut(label: string, shortcut: Shortcut): string {
  return `${label} (${shortcutText(shortcut)})`;
}
