// scroll's build-time contribution: every scroller is kept across a reload by
// default, under where it is written.
//
// A `<Scroll>` keeps its offset across a reload only under a name (auto-scroll's
// `useKeptScroll`, within the pane instance's keep scope). Asking each call site
// to write one meant every forgotten one lost the reader's place, found only
// after the fact by the dev loss detector (7 scrollers, 13 losses in two days).
// The name a scroller needs is where it is written, which the build knows: on
// every `<Scroll>` (and `<Column>`, whose body is one) imported from its barrel
// and written with no `keep`, this adds
//
//   keep={{ kind: "site", site: "plugins/…/file.tsx#Component#0" }}
//
// — the repo file, the component it is written in (`module` outside one), and
// its place among that component's stamped elements, so editing elsewhere in the
// file (lines moving) keeps the name; only a scroller added before it in the same
// component renumbers it. One call site rendered more than once at a time in a
// scope (a row's code block) has no identity per instance, so `Scroll` keeps it
// only while one instance is live (`instances: "many"`).
//
// The attribute goes FIRST, so a spread after it (`{...props}`) that carries a
// `keep` overrides it, as a written one would; an element with a written `keep`
// is left alone (a name, or `transient("<why>")`).
//
// Presence of this folder == presence of the default: removing it makes an unset
// `keep` keep nothing again, as it does in tests (no build pass there).
//
// CONSTRAINTS — kept fully self-contained (single file, no sibling imports) and
// with ZERO `@plugins` / `@babel/*` imports on purpose: this module is loaded by
// a runtime dynamic `import()` of its absolute path, where neither the
// `@plugins` alias nor extensionless `.ts` sibling resolution is available.
// Only `node:path` is imported; the babel `types` factory is handed in at
// runtime. The `{ kind: "site", site }` shape is `ScrollSite` in
// `core/index.ts`; a test asserts the two agree.

import { relative, sep } from "node:path";

/**
 * The components stamped, by the barrel they are imported from: a closed list
 * of the scroll primitives whose `keep` is a `ScrollKeep`.
 */
const STAMPED: ReadonlyArray<{ source: string; name: string }> = [
  {
    source: "@plugins/primitives/plugins/css/plugins/scroll/web",
    name: "Scroll",
  },
  {
    source: "@plugins/primitives/plugins/css/plugins/column/web",
    name: "Column",
  },
];

const KEEP_ATTR = "keep";
const JSX_FILE_RE = /\.[jt]sx$/;
const COMPONENT_NAME_RE = /^[A-Z]/;

// Minimal structural types for the babel surface we touch (we don't import
// `@babel/types`, see CONSTRAINTS above).
interface Node {
  type: string;
  [key: string]: unknown;
}
interface Binding {
  kind: string;
  path: { node: Node; parent: Node };
}
interface NodePath {
  node: Node;
  parentPath: NodePath | null;
  scope: { getBinding(name: string): Binding | undefined };
  getFunctionParent(): NodePath | null;
  traverse(visitor: Record<string, (path: NodePath) => void>): void;
}
interface BabelTypes {
  jsxAttribute(name: Node, value: Node): Node;
  jsxIdentifier(name: string): Node;
  jsxExpressionContainer(expression: Node): Node;
  objectExpression(properties: Node[]): Node;
  objectProperty(key: Node, value: Node): Node;
  identifier(name: string): Node;
  stringLiteral(value: string): Node;
}
interface PluginPass {
  filename?: string | null;
}

function nameOf(node: unknown): string | undefined {
  const n = node as Node | null | undefined;
  if (n === null || n === undefined) return undefined;
  if (n.type === "Identifier" && typeof n.name === "string") return n.name;
  if (n.type === "StringLiteral" && typeof n.value === "string") return n.value;
  return undefined;
}

/** The stamped component a JSX name refers to — by its import, never by spelling. */
function stampedComponent(path: NodePath, local: string): boolean {
  const binding = path.scope.getBinding(local);
  if (binding === undefined || binding.kind !== "module") return false;
  const spec = binding.path.node;
  if (spec.type !== "ImportSpecifier") return false;
  const decl = binding.path.parent;
  const source = nameOf(decl.source);
  const imported = nameOf(spec.imported);
  return STAMPED.some((s) => s.source === source && s.name === imported);
}

/** Whether the element already carries a `keep` attribute. */
function hasKeep(attributes: Node[]): boolean {
  return attributes.some(
    (a) =>
      a.type === "JSXAttribute" &&
      (a.name as Node).type === "JSXIdentifier" &&
      (a.name as Node).name === KEEP_ATTR,
  );
}

/**
 * The component a JSX element is written in: the nearest enclosing capitalized
 * function (skipping `.map` callbacks, handlers, hooks), else `module`.
 */
function enclosingComponent(path: NodePath): string {
  let fn = path.getFunctionParent();
  while (fn !== null) {
    const own =
      fn.node.type === "FunctionDeclaration" ? nameOf(fn.node.id) : undefined;
    if (own !== undefined && COMPONENT_NAME_RE.test(own)) return own;
    // `const Name = () => …`, through `memo(…)` / `forwardRef(…)` wrappers.
    let up = fn.parentPath;
    while (up !== null && up.node.type === "CallExpression") up = up.parentPath;
    const bound =
      up?.node.type === "VariableDeclarator"
        ? nameOf(up.node.id)
        : up?.node.type === "AssignmentExpression"
          ? nameOf(up.node.left)
          : undefined;
    if (bound !== undefined && COMPONENT_NAME_RE.test(bound)) return bound;
    fn = fn.getFunctionParent();
  }
  return "module";
}

/**
 * Factory consumed by the artifact builder. `repoRoot` makes the stamped path
 * repo-relative. Applies to the JSX files that import a stamped component's
 * barrel.
 */
export default function scrollSiteBabelPlugin({
  repoRoot,
}: {
  repoRoot: string;
}) {
  return {
    // Before the React Compiler (-100): the call site is read off the code as
    // written, before the compiler restructures component bodies. The stamp
    // only adds a constant attribute, which the compiler memoizes like any.
    order: -200,
    appliesTo: ({ id, code }: { id: string; code: string }) =>
      JSX_FILE_RE.test(id.split("?")[0]!) &&
      STAMPED.some((s) => code.includes(s.source)),
    plugin: scrollSiteInner,
  };
  function scrollSiteInner({ types: t }: { types: BabelTypes }) {
    return {
      name: "scroll-site-keep",
      visitor: {
        // All the stamping happens on entering the program, in a walk of its
        // own: the React Compiler (ordered after this, see `order`) rewrites
        // the whole program on ITS program entry, outlining a capture-free
        // `rows.map((r) => <Scroll/>)` callback into a module-level `_temp`,
        // where the component it was written in is gone.
        Program(program: NodePath, state: PluginPass) {
          const filename = state.filename;
          if (!filename) return;
          const file = relative(repoRoot, filename.split("?")[0]!)
            .split(sep)
            .join("/");
          const counts = new Map<string, number>();
          program.traverse({
            JSXOpeningElement(path: NodePath) {
              const name = path.node.name as Node;
              if (
                name.type !== "JSXIdentifier" ||
                typeof name.name !== "string"
              )
                return;
              if (!stampedComponent(path, name.name)) return;
              const attributes = path.node.attributes as Node[];
              if (hasKeep(attributes)) return;
              const component = enclosingComponent(path);
              const n = counts.get(component) ?? 0;
              counts.set(component, n + 1);
              attributes.unshift(
                t.jsxAttribute(
                  t.jsxIdentifier(KEEP_ATTR),
                  t.jsxExpressionContainer(
                    t.objectExpression([
                      t.objectProperty(
                        t.identifier("kind"),
                        t.stringLiteral("site"),
                      ),
                      t.objectProperty(
                        t.identifier("site"),
                        t.stringLiteral(`${file}#${component}#${n}`),
                      ),
                    ]),
                  ),
                ),
              );
            },
          });
        },
      },
    };
  }
}
