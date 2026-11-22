/**
 * The Resource Timing entries a page keeps. A browser's own default is 250,
 * and past it records nothing more: a page of per-plugin artifacts outgrows
 * that during its boot, so the files fetched last — the ones a slow boot
 * waited for — would be missing from every reader. The shell raises it before
 * any file is asked for (`web-core`'s index.html spells this number inline).
 */
export const RESOURCE_TIMING_BUFFER_SIZE = 5_000;
