// Expect: react-hooks(exhaustive-deps)
import { useEffect, useState } from "react";
export function StaleDep({ id }: { id: number }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    setN(id + n);
  }, []);
  return <span>{n}</span>;
}
