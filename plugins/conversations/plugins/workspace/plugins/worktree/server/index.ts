import type { ServerPluginDefinition } from "@plugins/framework/plugins/server-core/core";
import { Trigger } from "@plugins/infra/plugins/events/server";
import { conversationStatusChanged } from "@plugins/tasks/plugins/tasks-core/server";
import { Workspace } from "@plugins/conversations/plugins/workspace/server";
import {
  followCheckoutReaders,
  unfollowCheckoutReaders,
  fsmonitorOnConversationEndedJob,
  fsmonitorOnReadJob,
  fsmonitorReconcileJob,
  fsmonitorReconcileWarmup,
  fsmonitorReleaseJob,
} from "./internal/fsmonitor-job";
import { worktreePrepareJob } from "./internal/prepare-job";
import { checkoutProgress } from "./internal/tables-checkout-progress";
import { worktreeWorkspace } from "./internal/worktree-workspace";

export default {
  description:
    "The worktree workspace: a conversation runs in its attempt's git checkout of this repo (`.claude/worktrees/<id>`), with a forked DB and config dir — checked out by the supervised worktree.prepare job (a detached child a restart does not kill) that the spawn job requests and waits on, resumable while the checkout exists. Keeps git's fsmonitor daemon running for main's own checkout and for exactly the checkouts in use — whose attempt is still retained, or that someone reads now (a checkout watch open in main's backend: a tab showing a closed conversation's edited files, a file explorer over it) — main only: worktree.fsmonitor-reconcile at start and every 10 minutes, one pass at a time; worktree.fsmonitor-on-read for a checkout whose first reader came; worktree.fsmonitor-release for the one checkout whose conversation closed.",
  contributions: [
    Trigger({
      on: conversationStatusChanged,
      do: fsmonitorOnConversationEndedJob,
      with: {},
      oneShot: false,
    }),
  ],
  // Started here (not at module eval): the job it enqueues writes the DB.
  onReady: followCheckoutReaders,
  onShutdown: unfollowCheckoutReaders,
  register: [
    Workspace.define(worktreeWorkspace),
    checkoutProgress,
    worktreePrepareJob,
    fsmonitorReconcileJob,
    fsmonitorReleaseJob,
    fsmonitorOnReadJob,
    fsmonitorOnConversationEndedJob,
    fsmonitorReconcileWarmup,
  ],
} satisfies ServerPluginDefinition;
