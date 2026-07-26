import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { rankMatches } from "../search";

interface Props {
  names: string[];
  onSelect: (index: number) => void;
  /**
   * Lets App return focus here when a panel that had focus removes itself. Exposed as a
   * ref rather than an imperative `focus()` method because the anchor is the input
   * itself, and a method would be a second way to say the same thing.
   */
  inputRef?: React.Ref<HTMLInputElement>;
}

/**
 * Longest slice of the user's own query this echoes back.
 *
 * The input carries no `maxLength` and `query` was never capped — unlike the roster textarea,
 * which is pre-capped before it reaches state — so pasting a multi-megabyte string put the whole
 * thing into a VISIBLE, wrapping element and laid it out on the main thread. The third sink in
 * this app to need clamping, after the notice text and the import-error quoter.
 */
const ECHO_MAX = 60;
/** Hard cap on the input itself, so nothing downstream has to cope with a pasted megabyte. */
const MAX_QUERY_CHARS = 200;
const clampEcho = (text: string) => (text.length > ECHO_MAX ? `${text.slice(0, ECHO_MAX)}…` : text);

/** How many results the list shows. Enough to find someone, short enough to scan. */
const RESULT_LIMIT = 8;

/**
 * F8: find a person by fuzzy name ("jsmi" → "John Smith").
 *
 * A proper combobox rather than an input with a list stuck under it: the results
 * are reachable and announced with the arrow keys, which is the only way this is
 * usable without a mouse. Enter picks the active row, Escape clears the query.
 *
 * Escape STOPS PROPAGATION. There is a global Escape handler that clears
 * selection, and a user pressing Escape over a search box with text in it means
 * "clear this box" — falling through would clear both, and the first press would
 * appear to do the wrong thing.
 */
export default function PersonSearch({ names, onSelect, inputRef }: Props) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  // The component's own handle on its input, so `choose` can return focus there directly.
  // The global rescue would also catch this, but relying on a backstop for a case we know
  // about is worse than handling it: the backstop is for the cases nobody thought of.
  const ownInput = useRef<HTMLInputElement>(null);
  const rowId = (i: number) => `${listId}-r${i}`;

  const matches = useMemo(() => rankMatches(query, names, RESULT_LIMIT), [query, names]);
  const open = query.trim() !== "";
  // `active` is clamped rather than reset in an effect: the list changes on every
  // keystroke, and an effect that resets it would fight the arrow keys.
  const activeIndex = matches.length === 0 ? -1 : Math.min(active, matches.length - 1);

  const choose = (index: number) => {
    onSelect(index);
    // Clearing the query closes the listbox, unmounting the very option button a MOUSE user
    // just clicked — so focus would land on <body>. The keyboard path never leaves the
    // input and was unaffected, which is exactly why this went unnoticed.
    setQuery("");
    setActive(0);
    ownInput.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (matches.length === 0) return;
      const delta = e.key === "ArrowDown" ? 1 : -1;
      setActive((prev) => {
        const from = Math.min(prev, matches.length - 1);
        return (from + delta + matches.length) % matches.length;
      });
    } else if (e.key === "Enter") {
      if (activeIndex >= 0) {
        e.preventDefault();
        choose(matches[activeIndex].index);
      }
    } else if (e.key === "Escape") {
      // Claim Escape ONLY when there is a query to clear. Swallowing it
      // unconditionally means a user who left focus in an empty box — which is
      // where focus lands after picking a result, since choosing clears the query
      // — presses Escape and nothing happens anywhere, because the global handler
      // never sees the key. Found end-to-end, not by the unit suite.
      if (query === "") return;
      e.stopPropagation();
      setQuery("");
      setActive(0);
    }
  };

  return (
    <div id="search" className="glass">
      <input
        ref={(node) => {
          ownInput.current = node;
          if (typeof inputRef === "function") inputRef(node);
          else if (inputRef) (inputRef as React.RefObject<HTMLInputElement | null>).current = node;
        }}
        className="search-in"
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && activeIndex >= 0 ? rowId(activeIndex) : undefined}
        aria-label="Find a person"
        placeholder="Find a person…"
        maxLength={MAX_QUERY_CHARS}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
      />
      {open && (
        // The options are <button role="option">, not divs or list items. An ARIA
        // option is itself the interactive element, so nesting a button inside one
        // would create a second target; a bare div would be an unfocusable one. A
        // button is genuinely clickable and genuinely focusable, and tabIndex={-1}
        // keeps it out of the tab order, where the combobox contract says keyboard
        // access runs through the input's arrow keys and aria-activedescendant.
        <div className="search-list" id={listId} role="listbox" aria-label="Search results">
          {matches.map((m, i) => (
            <button
              key={m.index}
              id={rowId(i)}
              role="option"
              tabIndex={-1}
              aria-selected={i === activeIndex}
              className={"search-row" + (i === activeIndex ? " on" : "")}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(m.index)}
            >
              {names[m.index]}
            </button>
          ))}
        </div>
      )}
      {/* OUTSIDE the listbox, and a live region. A message inside `role="listbox"`
          that is not an `option` is not part of the list for a screen reader, so the
          zero-match state was visible and silent — the one state where silence is
          indistinguishable from a broken box. */}
      {/* Mounted unconditionally; only the TEXT is conditional. Appearing together with its
          first message is the pattern that makes a live region silent, which is the one state
          where silence is indistinguishable from a broken box. */}
      <div className="search-empty" role="status" aria-live="polite">
        {open && matches.length === 0 ? `Nobody matches “${clampEcho(query.trim())}”` : ""}
      </div>
    </div>
  );
}
