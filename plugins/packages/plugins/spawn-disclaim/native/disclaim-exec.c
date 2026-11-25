// disclaim-exec — become the macOS responsible process of what you run.
//
//   disclaim-exec <program> [args…]
//       Replaces itself with <program> (POSIX_SPAWN_SETEXEC: same pid, stdio,
//       environment, signal dispositions and darwinbg tier), spawned with the
//       responsibility DISCLAIMED — so TCC attributes it and everything it
//       starts to <program> itself, not to whichever launchd job started this
//       process tree. <program> is looked up on PATH (posix_spawnp).
//
//   <named copy> --exec-named <program> [args…]
//       Run from a COPY of this file named for whoever the process works for
//       (an agent's conversation). Gives the process that file name as its
//       LaunchServices display name — what Activity Monitor lists — then
//       becomes <program> with a plain execv, argv[0] kept (so `ps` shows the
//       named path too). Run THROUGH the disclaim above
//       (`disclaim-exec <named copy> --exec-named <program> …`), the named
//       copy is the responsible process's path: TCC keeps charging it, and
//       naming it in prompts, after the exec (measured 2026-11-24: tccd's
//       `responsible_path` stays the copy, `binary_path` is <program>). The
//       copy is tiny, so macOS's first-exec scan of it is ~0.15 s, where a
//       named copy of a 344 MB <program> cost ~3.3 s.
//       A display name that cannot be set is one stderr line, and <program>
//       still runs: the name is what a list shows, not who is charged.
//
//   disclaim-exec --print-responsible [pid]
//       Prints the pid responsible for <pid> (default: this process). For
//       verification only.
//
// Both entry points are private SPI in libSystem (libquarantine), weak-imported
// so a macOS without them is a loud failure here rather than a load error.
// Every failure is one line on stderr and exit 127: the program never ran, and
// the caller (an agent launching claude) fails loudly.

#include <CoreFoundation/CoreFoundation.h>
#include <dlfcn.h>
#include <errno.h>
#include <spawn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

extern char **environ;

extern int responsibility_spawnattrs_setdisclaim(posix_spawnattr_t *attrs,
                                                 int disclaim)
    __attribute__((weak_import));
extern pid_t responsibility_get_pid_responsible_for_pid(pid_t pid)
    __attribute__((weak_import));

static void fail(const char *what, int err) {
  fprintf(stderr, "disclaim-exec: %s: %s\n", what, strerror(err));
  _exit(127);
}

static int print_responsible(int argc, char **argv) {
  if (!responsibility_get_pid_responsible_for_pid) {
    fprintf(stderr, "disclaim-exec: responsibility_get_pid_responsible_for_pid "
                    "is not in this macOS's libSystem\n");
    _exit(127);
  }
  pid_t pid = getpid();
  if (argc >= 3) {
    char *end = NULL;
    long parsed = strtol(argv[2], &end, 10);
    if (*argv[2] == '\0' || *end != '\0' || parsed <= 0) {
      fprintf(stderr, "disclaim-exec: not a pid: %s\n", argv[2]);
      _exit(127);
    }
    pid = (pid_t)parsed;
  }
  pid_t responsible = responsibility_get_pid_responsible_for_pid(pid);
  if (responsible <= 0) fail("responsibility_get_pid_responsible_for_pid", errno);
  printf("%d\n", (int)responsible);
  return 0;
}

// The LaunchServices display name of this process: private SPI (the one
// Chromium names its helper processes with), looked up at run time so a macOS
// without it costs the name, not the launch. Returns why it could not be set.
// The registration is the pid's: it survives the exec that follows.
static const char *set_display_name(const char *name) {
  void *ls = dlopen("/System/Library/Frameworks/CoreServices.framework/"
                    "Frameworks/LaunchServices.framework/LaunchServices",
                    RTLD_LAZY);
  if (!ls) return "LaunchServices could not be loaded";
  void (*connection_status)(uint64_t, void *) =
      dlsym(ls, "_LSSetApplicationLaunchServicesServerConnectionStatus");
  void (*check_in)(int, CFDictionaryRef) = dlsym(ls, "_LSApplicationCheckIn");
  CFTypeRef (*current_asn)(void) = dlsym(ls, "_LSGetCurrentApplicationASN");
  OSStatus (*set_item)(int, CFTypeRef, CFStringRef, CFTypeRef,
                       CFDictionaryRef *) =
      dlsym(ls, "_LSSetApplicationInformationItem");
  CFStringRef *name_key = dlsym(ls, "_kLSDisplayNameKey");
  if (!connection_status || !check_in || !current_asn || !set_item ||
      !name_key) {
    return "this macOS's LaunchServices lacks a symbol it needs";
  }
  connection_status(0, NULL);
  // -2: the current session. Background-only: no Dock icon, no menu bar.
  check_in(-2, CFBundleGetInfoDictionary(CFBundleGetMainBundle()));
  CFTypeRef asn = current_asn();
  if (!asn) return "LaunchServices gave this process no serial number";
  CFStringRef value =
      CFStringCreateWithCString(NULL, name, kCFStringEncodingUTF8);
  if (!value) return "the name is not UTF-8";
  if (set_item(-2, asn, *name_key, value, NULL) != 0) {
    return "_LSSetApplicationInformationItem refused it";
  }
  return NULL;
}

static int exec_named(int argc, char **argv) {
  if (argc < 3) {
    fprintf(stderr, "usage: <named copy> --exec-named <program> [args…]\n");
    _exit(127);
  }
  const char *slash = strrchr(argv[0], '/');
  const char *why = set_display_name(slash ? slash + 1 : argv[0]);
  if (why) {
    fprintf(stderr, "disclaim-exec: display name not set (%s): Activity "
                    "Monitor lists this process by its program's name\n", why);
  }
  // argv[0] stays this file's path: `ps` shows the name, and the program
  // finds itself through the kernel's path, not argv[0].
  char *program = argv[2];
  argv[2] = argv[0];
  execv(program, argv + 2);
  fprintf(stderr, "disclaim-exec: cannot run %s: %s\n", program,
          strerror(errno));
  _exit(127);
}

int main(int argc, char **argv) {
  if (argc >= 2 && strcmp(argv[1], "--print-responsible") == 0) {
    return print_responsible(argc, argv);
  }
  if (argc >= 2 && strcmp(argv[1], "--exec-named") == 0) {
    return exec_named(argc, argv);
  }
  if (argc < 2) {
    fprintf(stderr, "usage: disclaim-exec <program> [args…] | "
                    "disclaim-exec --print-responsible [pid]\n");
    _exit(127);
  }
  if (!responsibility_spawnattrs_setdisclaim) {
    fprintf(stderr, "disclaim-exec: responsibility_spawnattrs_setdisclaim is "
                    "not in this macOS's libSystem\n");
    _exit(127);
  }

  posix_spawnattr_t attrs;
  int rc = posix_spawnattr_init(&attrs);
  if (rc != 0) fail("posix_spawnattr_init", rc);
  rc = responsibility_spawnattrs_setdisclaim(&attrs, 1);
  if (rc != 0) fail("responsibility_spawnattrs_setdisclaim", rc);
  rc = posix_spawnattr_setflags(&attrs, POSIX_SPAWN_SETEXEC);
  if (rc != 0) fail("posix_spawnattr_setflags(POSIX_SPAWN_SETEXEC)", rc);

  // On success this never returns: the process image is replaced.
  rc = posix_spawnp(NULL, argv[1], NULL, &attrs, argv + 1, environ);
  fprintf(stderr, "disclaim-exec: cannot run %s: %s\n", argv[1], strerror(rc));
  _exit(127);
}
