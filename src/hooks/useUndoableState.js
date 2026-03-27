import { useCallback, useRef, useState } from "react";

const MAX_HISTORY = 100;

export function useUndoableState(initial) {
  // snapshots[cursor] is the current state
  const [snapshots, setSnapshots] = useState([initial]);
  const [cursor, setCursor] = useState(0);

  // cursor needs to be readable inside setState without a stale-closure issue
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;

  const state = snapshots[cursor];

  const setState = useCallback((updater) => {
    setSnapshots((prev) => {
      const c = cursorRef.current;
      const next =
        typeof updater === "function" ? updater(prev[c]) : updater;
      // Truncate any future history, then append
      const trimmed = prev.slice(Math.max(0, c - MAX_HISTORY + 1), c + 1);
      return [...trimmed, next];
    });
    setCursor((c) => {
      const newCursor = Math.min(c + 1, MAX_HISTORY - 1);
      cursorRef.current = newCursor;
      return newCursor;
    });
  }, []);

  const undo = useCallback(() => {
    setCursor((c) => {
      const next = Math.max(0, c - 1);
      cursorRef.current = next;
      return next;
    });
  }, []);

  const redo = useCallback((snapshotsLen) => {
    setCursor((c) => {
      const next = Math.min(snapshotsLen - 1, c + 1);
      cursorRef.current = next;
      return next;
    });
  }, []);

  const clearHistory = useCallback((currentState) => {
    setSnapshots([currentState]);
    setCursor(0);
    cursorRef.current = 0;
  }, []);

  const canUndo = cursor > 0;
  const canRedo = cursor < snapshots.length - 1;

  return {
    state,
    setState,
    undo,
    redo: () => redo(snapshots.length),
    canUndo,
    canRedo,
    clearHistory,
  };
}
