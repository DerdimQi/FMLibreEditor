// The notice under the masthead once the game has loaded a save, or gone back to its main menu, since the editor read
// it: until the data is read again, nothing is written to the game and nothing frozen is held, as the lists may belong
// to another save. The game counts the saves it loads, which tells a load from a save; the Rust side reads that count.

import { useEffect, useState } from "react";
import { call } from "./api";
import { appText } from "./labels";

const text = appText.saveChanged;

/** How often the app is asked whether the game has loaded a save since it read it. */
const POLL_MS = 3000;

/**
 * Whether the game has loaded a save, or gone back to its main menu, since the data was read: asked while `connected`
 * every few seconds, and at once whenever the data was read again (`version`). A question left unanswered changes
 * nothing, and the next one is asked all the same.
 */
export function useSaveChanged(connected: boolean, version: number): boolean {
  const [changed, setChanged] = useState(false);

  useEffect(() => {
    if (!connected) {
      setChanged(false);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = async () => {
      try {
        const now = await call<boolean>("save_changed");
        if (!cancelled) {
          setChanged(now);
        }
      } catch {
        // No answer: the next question may get one.
      }
      if (!cancelled) {
        timer = setTimeout(ask, POLL_MS);
      }
    };
    void ask();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [connected, version]);

  return changed;
}

/** What has changed, and the button that reads the game again. */
export function SaveChangedNotice({ busy, onReload }: { busy: boolean; onReload: () => void }) {
  return (
    <div className="save-changed-notice" role="alert">
      <div className="compatibility-text">
        <strong>{text.title}</strong>
        <p>{text.text}</p>
      </div>
      <span className="update-actions">
        <button type="button" className="primary" disabled={busy} onClick={onReload}>
          {appText.reload}
        </button>
      </span>
    </div>
  );
}
