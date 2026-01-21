const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    getVersion: () => ipcRenderer.invoke('get-app-version'),
    // Add more IPC bridges here
    send: (channel, data) => {
        // Whitelist channels
        let validChannels = ["toMain"];
        if (validChannels.includes(channel)) {
            ipcRenderer.send(channel, data);
        }
    },
    on: (channel, func) => {
        let validChannels = ["fromMain", "sensor-data"];
        if (validChannels.includes(channel)) {
            // Deliberately strip event as it includes `sender` 
            ipcRenderer.on(channel, (event, ...args) => func(...args));
        }
    },
    // OSC Specific Bridge
    osc: {
        start: (port) => ipcRenderer.invoke('osc-start', port),
        stop: () => ipcRenderer.invoke('osc-stop'),
        onData: (callback) => {
            // Remove existing listener to avoid dupes? Or just add
            // For simplicity, we just add. Cleanup is up to caller logic or app reloads.
            ipcRenderer.on('osc-data', (event, data) => callback(data));
        },
        send: (ip, port, address, args) => ipcRenderer.invoke('osc-send', ip, port, address, args)
    },
    // WebSocket Bridge (for p5.js / external clients)
    ws: {
        broadcast: (channel, data) => ipcRenderer.invoke('ws-broadcast', channel, data)
    },
    // Serial Bridge (for Arduino device routing)
    serialBridge: {
        connect: () => ipcRenderer.invoke('serial-bridge-connect'),
        disconnect: () => ipcRenderer.invoke('serial-bridge-disconnect'),
        status: () => ipcRenderer.invoke('serial-bridge-status')
    },
    // File Management
    file: {
        saveDataset: (jsonString) => ipcRenderer.invoke('save-dataset', jsonString),
        loadDataset: () => ipcRenderer.invoke('load-dataset'),
        exportArduinoCode: (codeString) => ipcRenderer.invoke('export-arduino-code', codeString),
        saveZip: (buffer) => ipcRenderer.invoke('save-zip', buffer)
    }
});
