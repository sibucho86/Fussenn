const { contextBridge, ipcRenderer } = require("electron");
const beforeClose = new Set();
// Listen from the first moment. A close requested before the page has registered its
// handler (the UI is not interactive yet, so nothing can be unsaved) is answered at once,
// instead of the request being lost and the window refusing to close.
ipcRenderer.on("fussenn:save", async (_event, id) => {
  let ok = false;
  try { ok = (await Promise.all([...beforeClose].map((save) => save()))).every(Boolean); } catch { /* Keep the window open on failure. */ }
  ipcRenderer.send("fussenn:saved", id, ok === true);
});
contextBridge.exposeInMainWorld("fussennDesktop", {
  openLogin: (url) => ipcRenderer.invoke("fussenn:login", url),
  onBeforeClose: (save) => {
    beforeClose.add(save);
    return () => { beforeClose.delete(save); };
  },
});
