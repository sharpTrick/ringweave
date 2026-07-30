import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { rankMatches } from "../search";
import { clampText } from "../io/clamp";

interface Props {
  names: string[];
  onSelect: (index: number) => void;
  inputRef?: React.Ref<HTMLInputElement>;
}

/** The query is echoed into a visible, wrapping element, so it is clamped before it gets there. */
const ECHO_MAX = 60;
/** Hard cap on the input itself, so nothing downstream has to cope with a pasted megabyte. */
const MAX_QUERY_CHARS = 200;
const clampEcho = (text: string) => clampText(text, ECHO_MAX);

const RESULT_LIMIT = 8;

/**
 * Escape STOPS PROPAGATION here: a global Escape handler clears the selection, and falling
 * through would clear both the box and the selection on one press.
 */
export default function PersonSearch({ names, onSelect, inputRef }: Props) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const ownInput = useRef<HTMLInputElement>(null);
  const rowId = (i: number) => `${listId}-r${i}`;

  const matches = useMemo(() => rankMatches(query, names, RESULT_LIMIT), [query, names]);
  const open = query.trim() !== "";
  // Clamped rather than reset in an effect: the list changes on every keystroke, and an effect
  // that reset it would fight the arrow keys.
  const activeIndex = matches.length === 0 ? -1 : Math.min(active, matches.length - 1);

  const choose = (index: number) => {
    onSelect(index);
    // Clearing the query closes the listbox, unmounting the option a MOUSE user just clicked, so
    // without the refocus below their focus lands on <body>.
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
      // Claimed ONLY when there is a query to clear: focus rests in an empty box after picking a
      // result, and swallowing Escape there means the global handler never sees the key.
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
        // `<button role="option">`: an ARIA option is itself the interactive element, so a nested
        // button would be a second target and a bare div an unfocusable one. `tabIndex={-1}` keeps
        // them out of the tab order, which the combobox contract routes through the input.
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
      {/* OUTSIDE the listbox — a non-`option` child of `role="listbox"` is not part of the list —
          and mounted unconditionally, since a region that appears with its first message is never
          announced. Either way the zero-match state would be silent. */}
      <div className="search-empty" role="status" aria-live="polite">
        {open && matches.length === 0 ? `Nobody matches “${clampEcho(query.trim())}”` : ""}
      </div>
    </div>
  );
}
