import type { SleepClockReading } from "@plugins/packages/plugins/sleep-clock/plugins/history/core";
import { dlopen, ptr } from "bun:ffi";
import {
  clockStamp,
  stampBefore,
  type ClockStamp,
  type SleepStamp,
} from "@plugins/packages/plugins/sleep-clock/plugins/stamp/core";

// <time.h> clock ids on darwin. CLOCK_MONOTONIC_RAW is mach_continuous_time: it
// keeps running while the machine sleeps. CLOCK_UPTIME_RAW is mach_absolute_time:
// it pauses. Both are raw (no NTP slewing), so over any window
//   Δcontinuous − Δawake = time asleep in that window, exactly.
const CLOCK_MONOTONIC_RAW = 4;
const CLOCK_UPTIME_RAW = 8;

export type SleepReading =
  /** Milliseconds the machine was asleep since the previous read (0 on the first). */
  | { supported: true; sleptMs: number }
  /** This platform offers no such pair of clocks here — NOT "it did not sleep". */
  | { supported: false };

export interface SleepMeter {
  /** Sleep since the previous `read()` on this meter. Synchronous, ~1 µs. */
  read(): SleepReading;
}

/** How long the machine has been awake since boot: a clock that stops while it sleeps. */
export type AwakeClockReading =
  | { supported: true; awakeMs: number }
  /** This platform offers no such clock here — NOT "no time passed". */
  | { supported: false };

interface LibSystem {
  clockNs(id: number): bigint;
  sysctl(name: string, buf: Uint8Array): number | null;
}

// libSystem's clock_gettime_nsec_np and sysctlbyname, dlopen'd LAZILY on first
// use — the same two reasons as packages/flock: no dlopen cost at module eval,
// and the module stays importable where FFI is not.
let lib: LibSystem | null = null;

function libSystem(): LibSystem {
  if (lib === null) {
    const { symbols } = dlopen("libSystem.B.dylib", {
      clock_gettime_nsec_np: { args: ["i32"], returns: "u64" },
      sysctlbyname: {
        args: ["ptr", "ptr", "ptr", "ptr", "usize"],
        returns: "i32",
      },
    });
    const sizeBuf = new BigUint64Array(1);
    lib = {
      clockNs: (id) => BigInt(symbols.clock_gettime_nsec_np(id)),
      // Fills `buf` with the value of sysctl `name`; returns the byte length
      // written, or null when the call fails (unknown name, buffer too small).
      sysctl(name, buf) {
        const cName = Buffer.from(`${name}\0`, "utf8");
        sizeBuf[0] = BigInt(buf.byteLength);
        const rc = symbols.sysctlbyname(
          ptr(cName),
          ptr(buf),
          ptr(sizeBuf),
          null,
          0,
        );
        return rc === 0 ? Number(sizeBuf[0]) : null;
      },
    };
  }
  return lib;
}

// IOKit's power root domain publishes the machine's current power
// capabilities as "System Capabilities" (IOPMPrivate.h's
// kIOPMSystemCapability* bits). A full wake has graphics; a dark wake — the
// maintenance / Power Nap wakes a lid-shut or idle Mac runs every ~15 min for
// a few seconds, network on TCP keep-alive only — has CPU (and network) but no
// graphics. Read the same lazy way, through bun:ffi.
const SYSTEM_CAPABILITY_GRAPHICS = 0x2;
const K_CF_STRING_ENCODING_UTF8 = 0x08000100;
const K_CF_NUMBER_SINT32_TYPE = 3;

interface PowerRoot {
  /** The root domain's "System Capabilities", or null when it cannot be read. */
  capabilities(): number | null;
}

let powerRoot: PowerRoot | null = null;

function openPowerRoot(): PowerRoot {
  const iokit = dlopen("/System/Library/Frameworks/IOKit.framework/IOKit", {
    IOServiceMatching: { args: ["ptr"], returns: "ptr" },
    IOServiceGetMatchingService: { args: ["u32", "ptr"], returns: "u32" },
    IORegistryEntryCreateCFProperty: {
      args: ["u32", "ptr", "ptr", "u32"],
      returns: "ptr",
    },
  });
  const cf = dlopen(
    "/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation",
    {
      CFStringCreateWithCString: {
        args: ["ptr", "ptr", "u32"],
        returns: "ptr",
      },
      CFNumberGetValue: { args: ["ptr", "i32", "ptr"], returns: "bool" },
      CFRelease: { args: ["ptr"], returns: "void" },
    },
  );
  // The C strings are held in locals across each call: a Buffer only reached
  // through `ptr()` could be collected before the call reads it.
  const rootName = Buffer.from("IOPMrootDomain\0", "utf8");
  const keyName = Buffer.from("System Capabilities\0", "utf8");
  // IOServiceGetMatchingService consumes the matching dictionary. Port 0 is
  // kIOMainPortDefault. The service and the key are held for the process's
  // life: one of each, read on every sleep-clock reading.
  const service = iokit.symbols.IOServiceGetMatchingService(
    0,
    iokit.symbols.IOServiceMatching(ptr(rootName)),
  );
  const key = cf.symbols.CFStringCreateWithCString(
    null,
    ptr(keyName),
    K_CF_STRING_ENCODING_UTF8,
  );
  const out = new Int32Array(1);
  return {
    capabilities() {
      if (service === 0 || key === null) return null;
      const num = iokit.symbols.IORegistryEntryCreateCFProperty(
        service,
        key,
        null,
        0,
      );
      if (num === null) return null;
      const ok = cf.symbols.CFNumberGetValue(
        num,
        K_CF_NUMBER_SINT32_TYPE,
        ptr(out),
      );
      cf.symbols.CFRelease(num);
      return ok ? out[0]! : null;
    },
  };
}

/**
 * Whether the machine is in a DARK wake right now: awake for maintenance
 * (no graphics capability), not for a person — `null` when it cannot tell.
 * ~10 µs.
 */
function readDarkWake(): boolean | null {
  const caps = (powerRoot ??= openPowerRoot()).capabilities();
  return caps === null ? null : (caps & SYSTEM_CAPABILITY_GRAPHICS) === 0;
}

function readNs(id: number): bigint {
  return libSystem().clockNs(id);
}

/** Cumulative sleep since boot, in ns. The two clocks are read a few hundred
 *  nanoseconds apart, so a reading can come out a hair off; callers clamp. */
function asleepNs(): bigint {
  const continuous = readNs(CLOCK_MONOTONIC_RAW);
  const awake = readNs(CLOCK_UPTIME_RAW);
  return continuous - awake;
}

// The boot session never changes within a process's life — read it once.
let bootSession: string | null = null;

function readBootSession(): string {
  if (bootSession === null) {
    const buf = new Uint8Array(64);
    const len = libSystem().sysctl("kern.bootsessionuuid", buf);
    if (len === null || len === 0) {
      throw new Error("sleep-clock: sysctl kern.bootsessionuuid failed");
    }
    // The value is NUL-terminated; the reported length includes the NUL.
    const end = buf.indexOf(0);
    bootSession = new TextDecoder().decode(
      buf.subarray(0, end === -1 ? len : end),
    );
  }
  return bootSession;
}

/** kern.waketime / kern.sleeptime are a `struct timeval` — on darwin (LP64)
 *  an i64 tv_sec and an i32 tv_usec padded to 16 bytes. */
function readTimevalMs(name: string): number | null {
  const buf = new Uint8Array(16);
  const len = libSystem().sysctl(name, buf);
  if (len === null || len < 12) return null;
  const view = new DataView(buf.buffer);
  const sec = Number(view.getBigInt64(0, true));
  const usec = view.getInt32(8, true);
  if (sec === 0 && usec === 0) return null;
  return sec * 1000 + usec / 1000;
}

/**
 * The machine's sleep clock right now: which boot, how long it has been asleep
 * in total since that boot, and when it last woke. Two readings of the same
 * boot differ in `asleepMs` by exactly the sleep between them; `wakeAtMs` places
 * the most recent of those sleeps on the wall clock.
 *
 * darwin only. Elsewhere `{ supported: false }` — a caller must not read that
 * as "no sleep".
 */
export function readSleepClock(): SleepClockReading {
  if (process.platform !== "darwin") return { supported: false };
  const ns = asleepNs();
  return {
    supported: true,
    boot: readBootSession(),
    asleepMs: ns > 0n ? Number(ns) / 1e6 : 0,
    wakeAtMs: readTimevalMs("kern.waketime"),
    sleepAtMs: readTimevalMs("kern.sleeptime"),
    // The wall instant of this reading: where a dark wake seen now is placed.
    atMs: Date.now(),
    darkWake: readDarkWake(),
  };
}

/**
 * The sleep clock right now as a stamp stores it (`{ boot, asleepMs }`), or
 * `null` where the platform cannot read it. Not exported: a sleep reading on
 * its own invites pairing it with a wall instant captured at another moment
 * (main-slots' unserved stamp did, across an awaited lock wait), and a sleep
 * between the two is then lost from every span judged from it. Read both
 * clocks at once with {@link clockStampNow}.
 */
function sleepStampNow(): SleepStamp | null {
  if (process.platform !== "darwin") return null;
  const ns = asleepNs();
  return { boot: readBootSession(), asleepMs: ns > 0n ? Number(ns) / 1e6 : 0 };
}

/**
 * This instant on both clocks — the wall clock and the sleep clock — the one
 * stamp every watchdog, lease and staleness judge takes at the start of what
 * it later ages (`awakeBetween(start, clockStampNow())`).
 */
export function clockStampNow(): ClockStamp {
  return clockStamp(Date.now(), sleepStampNow());
}

/**
 * This process's start on both clocks, exact whenever it is called: a sleep
 * between the start and the call is not in the stamp. The stamp to age a
 * process by from its start — `clockStampNow()` at its first line of JS is
 * already late, a Mac can sleep a quarter of an hour in between.
 */
export function processStartStamp(): ClockStamp {
  return stampBefore(
    clockStampNow(),
    Math.round(performance.timeOrigin),
    performance.now(),
  );
}

/**
 * The machine's awake clock right now (CLOCK_UPTIME_RAW): two readings differ by
 * the time the machine was AWAKE between them, sleep excluded — what a deadline
 * on work this machine runs should count. A JS timer does not: Bun's
 * `setTimeout` keeps running through sleep, so a 30-minute timer armed before a
 * night of dark wakes fires at the first wake past 30 wall-clock minutes, after
 * the work it bounds ran for a few of them.
 *
 * darwin only. Elsewhere `{ supported: false }`.
 */
export function readAwakeClock(): AwakeClockReading {
  if (process.platform !== "darwin") return { supported: false };
  return { supported: true, awakeMs: Number(readNs(CLOCK_UPTIME_RAW)) / 1e6 };
}

/**
 * A meter of machine sleep between successive reads.
 *
 * Why it exists: a laptop that naps for 5–17 s at a time (maintenance sleep on
 * battery) looks, to every timer-based instrument, exactly like a process that
 * froze for 5–17 s. On 2026-09-20 two unrelated backends filed identical
 * "event-loop stall" reports for the same naps. A wall-clock gap heuristic cannot
 * separate the two without also erasing real freezes; the OS can, because it keeps
 * one clock that pauses during sleep and one that does not.
 *
 * darwin only. Elsewhere `read()` answers `{ supported: false }` — a caller must
 * not read that as "no sleep".
 */
export function createSleepMeter(): SleepMeter {
  const first = readSleepClock();
  if (!first.supported) {
    return { read: () => ({ supported: false }) };
  }
  let lastAsleepMs = first.asleepMs;
  return {
    read(): SleepReading {
      const now = readSleepClock();
      if (!now.supported) return { supported: false };
      const sleptMs = now.asleepMs - lastAsleepMs;
      lastAsleepMs = now.asleepMs;
      // The two clocks are read a few hundred nanoseconds apart, so an awake
      // window can come out a hair negative.
      return { supported: true, sleptMs: sleptMs > 0 ? sleptMs : 0 };
    },
  };
}
