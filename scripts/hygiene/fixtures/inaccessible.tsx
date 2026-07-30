// Expect: jsx-a11y(no-aria-hidden-on-focusable)
export function Inaccessible() {
  return <button aria-hidden="true">hidden but focusable</button>;
}
