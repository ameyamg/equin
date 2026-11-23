/**
 * Property reads that are probes, not uses: `await` asks for `then`, test
 * matchers and printers ask for these, and a symbol is always the runtime's
 * own question. A fake answers them `undefined`, as a plain object would.
 */
const PROBES: ReadonlySet<string> = new Set([
  "then",
  "toJSON",
  "constructor",
  "asymmetricMatch",
  "$$typeof",
  "nodeType",
]);

/**
 * A fake of contract `T` that implements only the members a test reaches —
 * the one sanctioned spelling of a partial fake (`test-layout/no-registered-partial-fake`
 * rejects `{ … } as unknown as T` handed to a registry).
 *
 * Reading any other member throws, naming the fake and the member — so a
 * reader the test did not anticipate fails with "fake ConversationRuntime has
 * no `subscribe`" at the read, instead of `x.subscribe is not a function` in
 * whoever reads the registry next. `members` is `Partial<T>`, so what IS
 * written is still type-checked against the contract.
 *
 * An OPTIONAL member the code under test probes (`x.dispose?.()`,
 * `if (x.onClose)`) throws too: give it explicitly, as `undefined` when the
 * test wants it absent.
 */
export function partialFake<T extends object>(
  name: string,
  members: Partial<T>,
): T {
  return new Proxy(members, {
    get(target, key, receiver) {
      if (typeof key === "symbol" || key in target)
        return Reflect.get(target, key, receiver) as unknown;
      if (PROBES.has(key)) return undefined;
      throw new Error(
        `[partialFake] fake ${name} has no \`${key}\`: the code under test reached a member this test did not fake — implement it in the fake's members`,
      );
    },
  }) as T;
}
