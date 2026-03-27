import { useCallback, useReducer } from "react";

const MAX_HISTORY = 80;

function reducer({ snapshots, cursor }, action) {
  switch (action.type) {
    case "SET": {
      const next =
        typeof action.p === "function" ? action.p(snapshots[cursor]) : action.p;
      // Truncate any future branch, then append the new snapshot
      const kept = snapshots.slice(Math.max(0, cursor - MAX_HISTORY + 1), cursor + 1);
      return { snapshots: [...kept, next], cursor: kept.length };
    }
    case "SILENT": {
      // Overwrite the current snapshot in-place — no new history entry.
      // Used for continuous updates (drag, style sliders) so the history
      // stack doesn't flood with 60 entries per second.
      const next =
        typeof action.p === "function" ? action.p(snapshots[cursor]) : action.p;
      const updated = snapshots.slice();
      updated[cursor] = next;
      return { snapshots: updated, cursor };
    }
    case "UNDO":
      return { snapshots, cursor: Math.max(0, cursor - 1) };
    case "REDO":
      return { snapshots, cursor: Math.min(snapshots.length - 1, cursor + 1) };
    case "CLEAR":
      return { snapshots: [action.p], cursor: 0 };
    default:
      return { snapshots, cursor };
  }
}

export function useUndoableState(initial) {
  const [{ snapshots, cursor }, dispatch] = useReducer(reducer, {
    snapshots: [initial],
    cursor: 0,
  });

  return {
    state:          snapshots[cursor],
    setState:       useCallback((p) => dispatch({ type: "SET",    p }), []),
    setStateSilent: useCallback((p) => dispatch({ type: "SILENT", p }), []),
    undo:           useCallback(()  => dispatch({ type: "UNDO" }), []),
    redo:           useCallback(()  => dispatch({ type: "REDO" }), []),
    clearHistory:   useCallback((p) => dispatch({ type: "CLEAR",  p }), []),
    canUndo:        cursor > 0,
    canRedo:        cursor < snapshots.length - 1,
  };
}
