const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('flashBridge', {
    onBrowserOpenTab(callback) {
        ipcRenderer.on('browser-open-tab', (_event, url) => callback(url));
    },
    onBrowserSaveBookmark(callback) {
        ipcRenderer.on('browser-save-bookmark', () => callback());
    }
});
