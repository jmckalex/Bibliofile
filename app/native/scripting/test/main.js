// Minimal Electron main used by scripts/spike-bibliophile-bridge.sh to prove the
// native AppleScript -> JS bridge. It loads the native addon, registers a JS
// handler that echoes what it received, and stays alive (no window needed). An
// `osascript` query of `bibliophile query "hello"` should come back transformed
// by THIS JS function — proving the full native->JS->native->AppleScript loop.
const { app } = require('electron');
const path = require('path');

const scripting = require(path.join(__dirname, 'bibliophile_scripting.node'));

scripting.setHandler((command, arg) => {
  // A recognizably JS-computed result so a pass can't be faked by native code.
  return `JS received [${command}] arg=[${arg}] len=${arg.length} upper=${String(arg).toUpperCase()}`;
});

app.whenReady().then(() => {
  // Keep the process alive for AppleScript; no UI required for the bridge test.
});
app.on('window-all-closed', () => {
  /* stay running so osascript can reach us */
});
