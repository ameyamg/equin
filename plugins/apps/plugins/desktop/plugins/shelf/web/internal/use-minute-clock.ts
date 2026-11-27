import { useEffect, useState } from "react";

/**
 * The current time, re-read at every minute boundary: the tray clock's
 * ticker. A clock, not polling — there is no source to watch for "the minute
 * changed", so a timeout is re-armed for the next boundary each time it fires
 * (aligned to the minute, unlike `useNow(60_000)`, whose tick lands anywhere
 * inside the minute and can show the old one for up to 59 s).
 */
export function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
      timer = setTimeout(
        () => {
          setNow(new Date());
          arm();
        },
        60_000 - (Date.now() % 60_000),
      );
    };
    arm();
    return () => clearTimeout(timer);
  }, []);
  return now;
}
