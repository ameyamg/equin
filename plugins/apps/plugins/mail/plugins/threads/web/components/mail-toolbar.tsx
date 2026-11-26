import type { ReactNode } from "react";
import type {
  ToolbarArrangement,
  ToolbarParts,
} from "@plugins/primitives/plugins/data-view/core";
import {
  DataViewFilterChips,
  useDataViewControls,
} from "@plugins/primitives/plugins/data-view/web";
import { Center } from "@plugins/primitives/plugins/css/plugins/center/web";
import { Fill } from "@plugins/primitives/plugins/css/plugins/fill/web";
import { Line } from "@plugins/primitives/plugins/css/plugins/line/web";
import { Stack } from "@plugins/primitives/plugins/css/plugins/spacing/web";
import {
  Button,
  cn,
  ControlSizeProvider,
  Separator,
} from "@plugins/primitives/plugins/css/plugins/ui-kit/web";

/**
 * The list's reading column (the prototype's 860px): the DataView's
 * `measure`, so the rows are drawn in it; the toolbar centres the search box
 * on the same column through `--dv-measure`.
 */
export const MAIL_MEASURE = "53.75rem";

/** The toolbar's content on the body's column (`DataViewProps.measure`). */
const MAIL_COLUMN = "mx-auto w-full max-w-(--dv-measure)";

/**
 * Mail's toolbar: the view's search box over the list's column, the Filter
 * and Display (view settings) controls inside it after a divider; under it,
 * while the view is the user's own or edited (or a search narrows it), the
 * view's rules as chips with the view's Save / Discard.
 */
function MailToolbar({
  search,
  query,
  controls,
  foldedControls,
}: ToolbarParts): ReactNode {
  return (
    <Stack gap="none" className="px-xl rail-follow">
      <Line className="h-12">
        <div className={MAIL_COLUMN}>
          <ControlSizeProvider size="sm">
            <Line className="@container/mail-search h-8.5 gap-smd rounded-lg bg-card pr-xs pl-md focus-within:ring-1 focus-within:ring-input">
              <Fill className="h-full" data-mail-search>
                {search}
              </Fill>
              <Center axis="horizontal" className="h-5 px-2xs">
                <Separator orientation="vertical" className="bg-input" />
              </Center>
              <Line
                className={cn("gap-2xs", "@max-[420px]/mail-search:hidden")}
              >
                {controls}
              </Line>
              <Line className="@min-[420px]/mail-search:hidden">
                {foldedControls}
              </Line>
            </Line>
          </ControlSizeProvider>
        </div>
      </Line>
      <ViewRules query={query} />
    </Stack>
  );
}

/**
 * The active view's rules as chips — shown on the user's own views, and on a
 * built-in only once it is edited (its rules are what it IS, not something
 * to read every time) — with the working copy's Save / Discard.
 */
function ViewRules({ query }: { query: string }): ReactNode {
  const { viewModel, activeViewId } = useDataViewControls();
  const active = viewModel.instances.find(
    (r) => r.instance.id === activeViewId,
  );
  const locked = active?.instance.locked === true;
  const dirty = viewModel.dirtyFor(activeViewId);
  const { drafts, setRenamingId } = viewModel;
  if (active === undefined || (locked && !dirty && query === "")) return null;
  const saveAsNew = () => {
    if (drafts === null) return;
    setRenamingId(
      drafts.saveAsNew(activeViewId, { name: `${active.instance.name} copy` }),
    );
  };
  const actions =
    !dirty || drafts === null ? undefined : (
      <Line className="gap-xs">
        <Button variant="ghost" onClick={() => drafts.discard(activeViewId)}>
          Discard
        </Button>
        {locked ? (
          <Button onClick={saveAsNew}>Save as view</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={saveAsNew}>
              Save as new
            </Button>
            <Button onClick={() => drafts.save(activeViewId)}>Save view</Button>
          </>
        )}
      </Line>
    );
  return (
    <div className={cn(MAIL_COLUMN, "px-xs pb-xs")}>
      <DataViewFilterChips actions={actions} />
    </div>
  );
}

/** Mail's toolbar arrangement — `<DataView toolbar={mailToolbar}>`. */
export const mailToolbar: ToolbarArrangement = {
  id: "mail",
  forms: { search: "bare", controls: "ghost", creators: "round" },
  component: MailToolbar,
};
