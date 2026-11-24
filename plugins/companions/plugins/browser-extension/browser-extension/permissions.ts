/**
 * The one-time microphone grant (`permissions.html`, opened by the panel's Mic
 * toggle): the offscreen recorder cannot show Chrome's prompt, a tab can.
 * Chrome keeps the answer for the extension's origin, so this page asks once,
 * says how it went, and closes itself once granted.
 */
const title = document.getElementById("title");
const detail = document.getElementById("detail");
if (title === null || detail === null)
  throw new Error("permissions.html lost its text");

try {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  for (const track of stream.getTracks()) track.stop();
  title.textContent = "Microphone allowed";
  detail.textContent =
    "You can close this tab: equin records your voice with the tab.";
  window.setTimeout(() => window.close(), 1200);
} catch (err) {
  title.textContent = "Microphone not allowed";
  detail.textContent =
    err instanceof Error && err.name === "NotAllowedError"
      ? "Allow it from the camera icon in the address bar, or in Chrome’s site settings for this extension."
      : `Chrome could not open the microphone: ${err instanceof Error ? err.message : String(err)}`;
}
