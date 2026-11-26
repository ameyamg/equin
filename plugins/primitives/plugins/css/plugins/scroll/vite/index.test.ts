import { describe, expect, it } from "bun:test";
import { createRequire } from "node:module";
import { transformAsync } from "@babel/core";
import type { ScrollSite } from "../core";
import scrollSiteBabelPlugin from "./index";

const ROOT = "/repo";
const FILE = `${ROOT}/src/thing.tsx`;
const SCROLL = "@plugins/primitives/plugins/css/plugins/scroll/web";
const COLUMN = "@plugins/primitives/plugins/css/plugins/column/web";

async function stamp(code: string): Promise<string> {
  const contribution = scrollSiteBabelPlugin({ repoRoot: ROOT });
  expect(contribution.appliesTo({ id: FILE, code })).toBe(true);
  const result = await transformAsync(code, {
    babelrc: false,
    configFile: false,
    filename: FILE,
    parserOpts: { sourceType: "module", plugins: ["jsx", "typescript"] },
    plugins: [contribution.plugin as never],
  });
  if (result?.code == null) throw new Error("babel returned no code");
  return result.code;
}

const site = (s: string) => `site: "src/thing.tsx#${s}"`;

describe("scroll site stamp", () => {
  it("stamps each Scroll / Column imported from its barrel with its call site", async () => {
    const out = await stamp(`
      import { Scroll } from "${SCROLL}";
      import { Column } from "${COLUMN}";
      export function Pane() {
        return <Column body={<Scroll className="h-full">{rows.map((r) => <Scroll key={r} />)}</Scroll>} />;
      }
      const Other = () => <Scroll />;
    `);
    expect(out).toContain(site("Pane#0"));
    expect(out).toContain(site("Pane#1"));
    // The one inside a .map callback belongs to the component it is written in.
    expect(out).toContain(site("Pane#2"));
    expect(out).toContain(site("Other#0"));
  });

  it("goes first, so a spread after it can carry the keep", async () => {
    const out = await stamp(`
      import { Scroll } from "${SCROLL}";
      function A(props) { return <Scroll {...props} />; }
    `);
    expect(out).toMatch(/<Scroll keep=\{\{[^}]*\}\} \{\.\.\.props\} \/>/);
  });

  it("leaves a written keep, another Scroll and a renamed import's original name alone", async () => {
    const out = await stamp(`
      import { Scroll as S } from "${SCROLL}";
      import { Scroll } from "./elsewhere";
      function A() { return <><S keep="pane" /><Scroll /><S keep={transient("why")} /><S /></>; }
    `);
    expect(out).toContain(`<S keep="pane" />`);
    expect(out).toContain(`<Scroll />`);
    // Only the last <S> has no keep: it is the first stamped in A.
    expect(out).toContain(site("A#0"));
    expect(out).not.toContain(site("A#1"));
  });

  it("runs before the React Compiler, so an outlined .map callback keeps its component", async () => {
    const contribution = scrollSiteBabelPlugin({ repoRoot: ROOT });
    // The artifact builder runs contributions in `order`; the compiler's is -100.
    expect(contribution.order).toBeLessThan(-100);
    const compiler = [
      createRequire(import.meta.url).resolve("babel-plugin-react-compiler"),
      { target: "19", compilationMode: "infer" },
    ];
    const result = await transformAsync(
      `
      import { Scroll } from "${SCROLL}";
      export function Pane({ rows }) {
        const [a] = useState(0);
        return <div><Scroll className={a} />{rows.map((r) => <Scroll key={r} />)}</div>;
      }`,
      {
        babelrc: false,
        configFile: false,
        filename: FILE,
        parserOpts: { sourceType: "module", plugins: ["jsx", "typescript"] },
        plugins: [contribution.plugin as never, compiler as never],
      },
    );
    const out = result?.code ?? "";
    // The compiler did outline the callback…
    expect(out).toContain("function _temp(");
    // …and it still names the component it was written in.
    expect(out).toContain(site("Pane#1"));
    expect(out).not.toContain(site("module#0"));
  });

  it("does not apply to a file importing neither barrel", () => {
    const { appliesTo } = scrollSiteBabelPlugin({ repoRoot: ROOT });
    expect(appliesTo({ id: FILE, code: `import { Scroll } from "./x";` })).toBe(
      false,
    );
    expect(appliesTo({ id: "/repo/src/x.ts", code: SCROLL })).toBe(false);
  });

  it("writes the ScrollSite shape Scroll reads", () => {
    // Compile-time agreement: the stamped literal is a ScrollSite.
    const stamped: ScrollSite = { kind: "site", site: "src/thing.tsx#A#0" };
    expect(stamped.kind).toBe("site");
  });
});
