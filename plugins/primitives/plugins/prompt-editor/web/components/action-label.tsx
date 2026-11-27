/**
 * The action row is a named inline-size container, so an action can drop the
 * words it carries when the row runs short of room, without measuring.
 *
 * Why the row needs this at all: the prompt-template chips are an adaptive bar,
 * the row's one growing cell (`flex: 1 1 0%`). Its base size is 0, so when the
 * other actions' own widths add up past the row, free space is negative and the
 * bar resolves to 0px, ⋯ included (report-1795775490-e22fru). Making a sibling
 * merely shrinkable cannot give the bar anything: shrinking a sibling only
 * spreads the deficit among the siblings. A sibling must take a narrower FORM,
 * and the one sibling with a form to give is a labelled action.
 */
export const ACTION_ROW_CONTAINER = "@container/prompt-actions";

/**
 * A labelled action's words, hidden once the action row is narrower than
 * 20rem — the icon stays, and the button's tooltip / aria-label still name it.
 * Below that width the rigid actions plus a labelled button leave the template
 * bar no room for even its ⋯.
 */
export function ActionLabel({ children }: { children: React.ReactNode }) {
  return <span className="@max-[20rem]/prompt-actions:hidden">{children}</span>;
}
