import { useOpenPane } from "@plugins/primitives/plugins/pane/web";
import { cn } from "@plugins/primitives/plugins/css/plugins/ui-kit/web";
import { Line } from "@plugins/primitives/plugins/css/plugins/line/web";
import { Rigid } from "@plugins/primitives/plugins/css/plugins/rigid/web";
import { Fill } from "@plugins/primitives/plugins/css/plugins/fill/web";
import { yieldClass } from "@plugins/primitives/plugins/css/plugins/yield/web";
import {
  Text,
  type TextTone,
  type TextVariant,
} from "@plugins/primitives/plugins/css/plugins/text/web";
import { taskDetailPane } from "../panes";

/**
 * A task named by its title, linked to its detail — always ONE line, the title
 * ellipsized (full title on hover). A task title can run to paragraphs (a
 * dependency upgrade's lists every package), so a link that wraps took over
 * the task header's rows. The button is itself the line container, so the
 * ellipsis lands inside the title rather than clipping a whole unbreakable
 * button. `prefix` ("from") stays plain text before the link.
 *
 * Takes the remaining width of its row (a `Fill`): place it last.
 */
export function TaskLink({
  taskId,
  title,
  prefix,
  variant,
  tone,
}: {
  taskId: string;
  title: string;
  prefix?: string;
  variant?: TextVariant;
  tone?: TextTone;
}) {
  const openPane = useOpenPane();
  return (
    <Fill>
      <Line>
        {prefix !== undefined && (
          <Rigid>
            <Text variant={variant} tone={tone}>
              {`${prefix} `}
            </Text>
          </Rigid>
        )}
        <Line
          as="button"
          type="button"
          title={title}
          {...openPane.link(taskDetailPane, { taskId }, { mode: "swap" })}
          className={cn(
            yieldClass("x"),
            "hover:text-foreground underline underline-offset-2",
          )}
        >
          <Text variant={variant} tone={tone}>
            {title}
          </Text>
        </Line>
      </Line>
    </Fill>
  );
}
