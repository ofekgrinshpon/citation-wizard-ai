import { useState, useCallback } from "react";

const GUEST_KEY = "guest_citation_count";
const MAX_GUEST_CITATIONS = 2;

export function useGuestLimit() {
  const [count, setCount] = useState(() => {
    const stored = localStorage.getItem(GUEST_KEY);
    return stored ? parseInt(stored, 10) : 0;
  });

  const isLocked = count >= MAX_GUEST_CITATIONS;
  const remaining = Math.max(0, MAX_GUEST_CITATIONS - count);

  const increment = useCallback((amount = 1) => {
    setCount((prev) => {
      const next = prev + amount;
      localStorage.setItem(GUEST_KEY, String(next));
      return next;
    });
  }, []);

  return { count, isLocked, remaining, increment, max: MAX_GUEST_CITATIONS };
}
