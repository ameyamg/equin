import {
  render,
  type RenderOptions,
  type RenderResult,
} from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import {
  PluginProvider,
  type LoadedPlugin,
} from "@plugins/framework/plugins/web-sdk/core";
import {
  createLiveStateHarness,
  type LiveStateHarness,
  type LiveStateHarnessOptions,
} from "./live-state-harness";

export interface RenderInAppOptions
  extends LiveStateHarnessOptions, Omit<RenderOptions, "queries"> {
  /**
   * The plugins the tree's slots read (their declarations and contributions),
   * as `PluginProvider` takes them. Default: none — every slot renders empty.
   */
  plugins?: readonly LoadedPlugin[];
}

/**
 * `render(ui)` under the provider stack the app mounts around every surface
 * (`web-core`'s `App`): the transport, the live-state client and its query
 * cache (`createLiveStateHarness` — a fresh pair per test, disposed when it
 * finishes), and the plugin registry. A component that starts reading live
 * data, an endpoint or a slot then keeps working in its tests instead of
 * throwing "must be used within a NotificationsProvider" — the class of
 * breakage hand-mounted stacks had (2026-11: agent-thread's go-sends).
 *
 * A `wrapper` passed in is mounted innermost, under the plugins.
 */
export function renderInApp(
  ui: ReactElement,
  {
    plugins = [],
    transport,
    queries,
    wrapper: Inner,
    ...options
  }: RenderInAppOptions = {},
): RenderResult & { harness: LiveStateHarness } {
  const harness = createLiveStateHarness({ transport, queries });
  const { Wrapper } = harness;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Wrapper>
      <PluginProvider plugins={plugins as LoadedPlugin[]}>
        {Inner ? <Inner>{children}</Inner> : children}
      </PluginProvider>
    </Wrapper>
  );
  const renderOptions: Omit<RenderOptions, "queries"> = { ...options, wrapper };
  return { ...render(ui, renderOptions), harness };
}
