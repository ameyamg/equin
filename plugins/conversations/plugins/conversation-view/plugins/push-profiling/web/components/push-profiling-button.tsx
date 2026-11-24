import { linkProps } from "@plugins/primitives/plugins/link-gesture/web";
import { IconButton } from "@plugins/primitives/plugins/icon-button/web";
import { conversationPane } from "@plugins/conversations/plugins/conversation-view/web";
import { convPushProfilingPane } from "../panes";
import { symbol } from "@plugins/ui/plugins/icons/core";

const timelineIcon = symbol("timeline");

export function PushProfilingButton() {
  const { convId } = conversationPane.useParams();
  const { isOpen, toggle } = convPushProfilingPane.useToggle({
    conv: convId,
  });

  return (
    <IconButton
      icon={timelineIcon}
      label="Op profiling"
      variant={isOpen ? "secondary" : "ghost"}
      aria-pressed={isOpen}
      {...linkProps(toggle)}
    />
  );
}
