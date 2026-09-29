const { app, BrowserWindow } = require('electron');
const { autoUpdater } = require('electron-updater');

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            webviewTag: true,
            preload: __dirname + '/preload.js'
        }
    });

    mainWindow.loadFile('index.html');
}

app.on('web-contents-created', (_event, contents) => {
    contents.on('did-attach-webview', (_attachEvent, webContents) => {
        webContents.on('before-input-event', (event, input) => {
            if (input.type === 'keyDown' && input.control && !input.alt && input.key.toLowerCase() === 'd') {
                event.preventDefault();
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('browser-save-bookmark');
                }
            }
        });

        webContents.setWindowOpenHandler(({ url }) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('browser-open-tab', url);
            }
            return { action: 'deny' };
        });
    });
});

app.whenReady().then(() => {
    createWindow();
    if (app.isPackaged) {
        autoUpdater.checkForUpdatesAndNotify().catch(error => {
            console.error('Automatic update check failed:', error);
        });
    }
});