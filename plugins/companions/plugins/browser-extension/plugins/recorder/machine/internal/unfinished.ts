import { getConfig, watchConfig } from "@plugins/config_v2/server";
import { resolveHostPath } from "@plugins/infra/plugins/host-fs/server";
import { watchHostDir } from "@plugins/infra/plugins/host-fs/machine";
import { asUserPath } from "@plugins/infra/plugins/host-fs/plugins/user-path/core";
import { serveValue } from "@plugins/network/plugins/live/machine";
import { recorderConfig, unfinishedTabRecordings } from "../../core";
import { listUploads } from "./upload-store";

/**
 * The Recordings folder's unfinished recordings, listed from the folder
 * itself (the partials and their cursors — see `upload-store.ts`). Pushed
 * while read: a watch on the folder (any entry added or removed, a chunk's
 * cursor committed) and on the Recordings folder setting (a new folder is
 * another listing, its watch re-pointed); the endpoints also notify on their
 * own writes. Throttled: a recording commits a cursor every second.
 */
export const unfinishedServed = serveValue(unfinishedTabRecordings, {
  source: "external",
  changes: "notified",
  throttleMs: 2_000,
  loader: async () => {
    const configured = getConfig(recorderConfig).folder;
    if (configured === "") return { recordings: [] };
    const uploads = await listUploads(resolveHostPath(configured));
    return {
      recordings: uploads.map((u) => ({
        id: u.id,
        name: u.base,
        bytes: u.bytes,
        writtenAt: u.writtenAt,
      })),
    };
  },
  whileSubscribed: (_q, notify) => {
    // Each arm is a generation: a watch that resolves after a later arm (the
    // setting changed again while it armed) or the unsubscribe is released.
    let generation = 0;
    let folder: string | null = null;
    let release: (() => void) | null = null;
    const arm = (configured: string) => {
      if (configured === folder) return;
      folder = configured;
      const mine = ++generation;
      release?.();
      release = null;
      if (configured === "") return;
      // A watch that cannot be armed is a crash (unhandled), never a quiet
      // list that stops updating.
      void watchHostDir(asUserPath(resolveHostPath(configured)), () =>
        notify(),
      ).then((r) => {
        if (mine === generation) release = r;
        else r();
      });
    };
    const watcher = watchConfig(recorderConfig, (values) => {
      const first = folder === null;
      arm(values.folder);
      if (!first) notify();
    });
    return () => {
      generation += 1;
      watcher.dispose();
      release?.();
      release = null;
    };
  },
});
