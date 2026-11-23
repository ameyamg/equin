import rule from "./no-raw-audio-context";
import { createRuleTester } from "@plugins/framework/plugins/tooling/plugins/lint/core/testing";

const ruleTester = createRuleTester();
const FILE = "/repo/plugins/foo/web/components/x.tsx";

ruleTester.run("no-raw-audio-context", rule, {
  valid: [
    { code: `const owned = openAudioContext();`, filename: FILE },
    { code: `void owned.requestResume();`, filename: FILE },
    // An offline context renders to a buffer; it never waits on a gesture.
    {
      code: `const c = new OfflineAudioContext(2, 100, 44100);`,
      filename: FILE,
    },
    // A stream's or a controller's resume() returns nothing to chain.
    { code: `from.resume();`, filename: FILE },
    { code: `music.resume();`, filename: FILE },
    { code: `const r = await ports.resume(id);`, filename: FILE },
    // A member of another object is not the global.
    { code: `const c = new audio.AudioContext();`, filename: FILE },
  ],
  invalid: [
    {
      code: `const ctx = new AudioContext();`,
      filename: FILE,
      errors: [{ messageId: "noRawConstruct" }],
    },
    {
      code: `const ctx = new window.webkitAudioContext();`,
      filename: FILE,
      errors: [{ messageId: "noRawConstruct" }],
    },
    {
      code: `void ctx.resume();`,
      filename: FILE,
      errors: [{ messageId: "noRawResume" }],
    },
    {
      code: `void graph?.ctx.resume();`,
      filename: FILE,
      errors: [{ messageId: "noRawResume" }],
    },
    {
      code: `async function f() { await ctx.resume(); }`,
      filename: FILE,
      errors: [{ messageId: "noRawResume" }],
    },
    {
      code: `ctx.resume().then(start);`,
      filename: FILE,
      errors: [{ messageId: "noRawResume" }],
    },
  ],
});
