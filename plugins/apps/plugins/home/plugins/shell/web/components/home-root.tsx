import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import { Stack } from "@plugins/primitives/plugins/css/plugins/spacing/web";
import { Column } from "@plugins/primitives/plugins/css/plugins/column/web";

import { Home } from "../slots";

/**
 * The launcher screen (Home's index pane): a centred title block, then the sections (the app grid
 * with its capsule toolbar), in one column `min(932px, 100% − 40px)` wide —
 * seven 116px icon cells and their 16px gaps — centred in the tab.
 */
export function HomeRoot() {
  return (
    <Stack gap="none" className="relative h-full bg-background">
      <Column
        gap="none"
        className="h-full w-full"
        // The column body owns the single scroll, so the DataView's sticky
        // capsule pins to the top of the tab once the title scrolls away.
        body={
          // The container the page margin's query reads: the tab's width, not
          // the viewport's, so a narrow floating window gets the tighter margin.
          //
          // A block box, the column centred in it by `mx-auto` — never a grid
          // (`Center`): a grid's `auto` track grows to its content's
          // min-content width, so the column's `100%` would be the CONTENT's
          // width, not the tab's. The app grid's toolbar picks its layout from
          // its measured width, and the compact fold's min-content (its
          // sideways-scrolling views pill counts its full chip row) is wider
          // than the wide capsule's: on a ~400px tab the track flipped
          // 310 ↔ 382px every frame (report-1795711185-g5kpk7).
          <div className="@container/home">
            <Stack
              gap="xl"
              // eslint-disable-next-line spacing/no-adhoc-spacing -- the launcher's page margin (64px, 40px under 760px) and its column measure (seven 116px cells + 16px gaps + 24px, 20px gutters) are page geometry above the spacing ramp's largest step
              className="mx-auto w-[min(932px,calc(100%-40px))] py-[64px] @max-[760px]/home:py-[40px]"
            >
              <Stack
                as="header"
                gap="sm"
                align="center"
                className="text-center"
              >
                {/* The page's one headline: the display role, which Home's
                    theme sets to the mock's 34px semibold. */}
                <Text as="h1" variant="display">
                  Apps
                </Text>
                <Text as="p" variant="body" tone="faint">
                  Open an app to get started.
                </Text>
              </Stack>
              <Home.Section.Render />
            </Stack>
          </div>
        }
      />
    </Stack>
  );
}
