// The FFI-free, import-free half: the argv shape of a disclaimed spawn. The
// helper itself is the `disclaimExec` dependency (`deps/` barrel).
export {
  disclaimArgv,
  execNamedArgv,
  spawnDisclaimWanted,
} from "./internal/disclaim-argv";
