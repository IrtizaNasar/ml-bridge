const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const isDev = process.env.NODE_ENV === 'development';

let mainWindow;
let connectedSockets = new Set(); // Track Socket.IO connections for cleanup

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1200,
        minHeight: 700,
        backgroundColor: '#0a0a0a',
        titleBarStyle: 'hiddenInset',
        trafficLightPosition: { x: 16, y: 16 },
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
        },
        // Icon path will be added later
    });

    // Load the app
    if (isDev) {
        mainWindow.loadURL('http://localhost:5173');
        mainWindow.webContents.openDevTools({ mode: 'detach' });
    } else {
        mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    }

    // Optimize window behavior
    mainWindow.on('ready-to-show', () => {
        mainWindow.show();
    });

    // External links
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('http')) {
            shell.openExternal(url);
        }
        return { action: 'deny' };
    });
}

app.whenReady().then(() => {
    startWebSocketServer();
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('before-quit', () => {
    console.log('[App] Cleaning up Socket.IO connections...');
    connectedSockets.forEach(socket => {
        socket.disconnect(true);
    });
    connectedSockets.clear();
    console.log('[App] Socket.IO cleanup complete');
});

// --- WebSocket Server Logic ---
const express = require('express');
const http = require('http');
const { Server: SocketIOServer } = require('socket.io');

let wsServer = null;
let io = null;
const WS_PORT = 3100;

function startWebSocketServer() {
    try {
        const expressApp = express();
        expressApp.use(express.json());

        // Serve static files (client library)
        // Access via: http://localhost:3100/ml-bridge.js
        // Use app.getAppPath() for production compatibility
        const publicPath = isDev
            ? path.join(__dirname, '../public')
            : path.join(process.resourcesPath, 'app.asar.unpacked/public');

        expressApp.use(express.static(publicPath));

        // CORS
        expressApp.use((req, res, next) => {
            res.header('Access-Control-Allow-Origin', '*');
            res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.header('Access-Control-Allow-Headers', 'Content-Type');
            next();
        });

        const httpServer = http.createServer(expressApp);
        io = new SocketIOServer(httpServer, {
            cors: {
                origin: "*",
                methods: ["GET", "POST"]
            }
        });

        io.on('connection', (socket) => {
            console.log('[WS] Client connected');
            connectedSockets.add(socket);

            socket.emit('status', { message: 'Connected to ML Bridge' });

            socket.on('disconnect', () => {
                console.log('[WS] Client disconnected');
                connectedSockets.delete(socket);
            });
        });

        httpServer.listen(WS_PORT, '0.0.0.0', () => {
            console.log(`[WS] Server running on http://localhost:${WS_PORT}`);
        });

        wsServer = httpServer;
    } catch (e) {
        console.error('[WS] Failed to start server:', e);
    }
}

// IPC Handler to broadcast
ipcMain.handle('ws-broadcast', (event, channel, data) => {
    try {
        // Broadcast via ML Bridge's own WebSocket server
        if (io) {
            io.emit(channel, data);
        }

        // Debug: Log when serial protocol is detected
        console.log('[WS-BROADCAST] Channel:', channel, 'Protocol:', data.protocol, 'DeviceId:', data.deviceId);

        // If protocol is 'serial' and deviceId is provided, send to Serial Bridge
        if (data.protocol === 'serial' && data.deviceId) {
            console.log('[WS-BROADCAST] Triggering Serial Bridge send to:', data.deviceId);
            sendToSerialBridge(data.deviceId, data);
        } else {
            console.log('[WS-BROADCAST] Not sending to Serial Bridge - protocol:', data.protocol, 'deviceId:', data.deviceId);
        }

        return { success: true };
    } catch (e) {
        console.error('[WS-BROADCAST] Error:', e);
        return { success: false, error: e.message };
    }
});

// Serial Bridge HTTP API (uses HTTP POST, not Socket.IO)
const fetch = require('electron-fetch').default;

// Throttle Serial Bridge sends to prevent flooding Arduino
let lastSerialSendTime = 0;
let lastSentLabel = null; // Track last sent label for change detection
const SERIAL_SEND_THROTTLE_MS = 500; // Send at most once per 500ms
async function sendToSerialBridge(deviceId, predictionData) {
    // Detect prediction type
    const isRegression = predictionData.regression !== undefined;
    const isClassification = predictionData.label !== undefined;

    if (!isClassification && !isRegression) {
        console.warn('[Serial Bridge] Unknown prediction type, skipping');
        return;
    }

    // Apply appropriate throttling
    if (isClassification) {
        // Classification: throttle by label change
        if (predictionData.label === lastSentLabel) {
            return; // Skip - same prediction
        }
        lastSentLabel = predictionData.label;
        lastSerialSendTime = Date.now();
    } else if (isRegression) {
        // Regression: time-based throttle only (values change continuously)
        const now = Date.now();
        if (now - lastSerialSendTime < SERIAL_SEND_THROTTLE_MS) {
            return;
        }
        lastSerialSendTime = now;
        lastSentLabel = null; // Reset for when switching back to classification
    }

    try {
        let message;

        if (isClassification) {
            // Classification formatting
            if (predictionData.serialFormat === 'csv') {
                // CSV: label,confidence
                const confidence = predictionData.confidence || Math.max(...Object.values(predictionData.confidences || {}));
                message = `${predictionData.label},${confidence.toFixed(2)}`;
            } else {
                // JSON: {"label":"class_1","confidence":0.85}
                message = JSON.stringify({
                    label: predictionData.label,
                    confidence: predictionData.confidence || Math.max(...Object.values(predictionData.confidences || {}))
                });
            }
        } else if (isRegression) {
            // Regression formatting
            if (predictionData.serialFormat === 'csv') {
                // CSV: comma-separated values (e.g., "0.48,1.00")
                const values = Object.values(predictionData.regression);
                message = values.map(v => v.toFixed(2)).join(',');
            } else {
                // JSON: {"out_1":0.48,"out_2":1.00}
                message = JSON.stringify(predictionData.regression);
            }
        }

        console.log(`[Serial Bridge] Sending to ${deviceId} via HTTP:`, message.substring(0, 100));

        // Serial Bridge uses HTTP POST to /api/send
        const response = await fetch('http://localhost:3000/api/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id: deviceId,
                data: message
            })
        });

        const result = await response.json();

        if (result.success) {
            console.log(`[Serial Bridge] ✓ Successfully sent to ${deviceId}`);
        } else {
            console.error('[Serial Bridge] ✗ Send failed:', result.error || 'Unknown error');
        }
    } catch (e) {
        console.error('[Serial Bridge] HTTP request error:', e.message);
    }
}

// IPC Handlers for Serial Bridge connection management
ipcMain.handle('serial-bridge-connect', () => {
    console.log('[Serial Bridge] Connection check - Serial Bridge uses HTTP, no persistent connection needed');
    return { success: true, message: 'Serial Bridge uses HTTP POST, no connection required' };
});

ipcMain.handle('serial-bridge-disconnect', () => {
    console.log('[Serial Bridge] Disconnect called - Serial Bridge uses HTTP, nothing to disconnect');
    return { success: true };
});

ipcMain.handle('serial-bridge-status', () => {
    return {
        connected: true, // HTTP is stateless, always "connected"
        url: 'http://localhost:3000/api/send'
    };
});

// Universal Input Hub Placeholder
ipcMain.handle('get-app-version', () => app.getVersion());

// --- OSC Server Logic ---
const { Server } = require('node-osc');
let oscServer = null;

ipcMain.handle('osc-start', async (event, port = 12000) => {
    try {
        if (oscServer) {
            oscServer.close();
            oscServer = null;
        }

        console.log(`[Main] Starting OSC Server on port ${port}...`);
        oscServer = new Server(port, '0.0.0.0', () => {
            console.log(`[Main] OSC Server is listening`);
        });

        oscServer.on('message', (msg) => {
            // Parse Wekinator-style arguments
            // msg format: [address, ...args]

            const args = msg.slice(1);

            // 1. Flatten arrays if any
            const flatArgs = args.flat();

            // 2. Filter for numbers only (ML inputs)
            const numericArgs = flatArgs.filter(a => typeof a === 'number');

            if (numericArgs.length > 0) {
                const inputs = {};
                numericArgs.forEach((val, idx) => {
                    inputs[`osc_${idx}`] = val; // Simple mapping
                });
                // Send to Renderer
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('osc-data', inputs);
                }
            }
        });

        return { success: true, message: `Listening on port ${port}` };

    } catch (e) {
        console.error("[Main] OSC Start Error:", e);
        return { success: false, error: e.message };
    }
});

ipcMain.handle('osc-stop', async () => {
    try {
        if (oscServer) {
            oscServer.close();
            oscServer = null;
            console.log(`[Main] OSC Server stopped`);
        }
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

const { Client } = require('node-osc');
let oscClient = null;

ipcMain.handle('osc-send', async (event, ip, port, address, args) => {
    try {
        // Reuse client if same destination
        if (!oscClient || oscClient.host !== ip || oscClient.port !== port) {
            if (oscClient) oscClient.close();
            oscClient = new Client(ip, port);
        }

        // Send: client.send(address, arg1, arg2, ...)
        // We unpack the spread args
        oscClient.send(address, ...args);
        return { success: true };

    } catch (e) {
        console.error("[Main] OSC Send Error:", e);
        return { success: false, error: e.message };
    }
});

// --- File Management ---
const fs = require('fs');

ipcMain.handle('save-dataset', async (event, jsonString) => {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
        title: 'Save Training Dataset',
        defaultPath: 'my-dataset.json',
        filters: [{ name: 'JSON', extensions: ['json'] }]
    });

    if (canceled || !filePath) return { success: false, canceled: true };

    try {
        fs.writeFileSync(filePath, jsonString, 'utf-8');
        return { success: true, filePath };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('load-dataset', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        title: 'Load Training Dataset',
        filters: [{ name: 'JSON', extensions: ['json'] }],
        properties: ['openFile']
    });

    if (canceled || filePaths.length === 0) return { success: false, canceled: true };

    try {
        const content = fs.readFileSync(filePaths[0], 'utf-8');
        return { success: true, content };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('export-arduino-code', async (event, codeString) => {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
        title: 'Export Arduino Header',
        defaultPath: 'model.h',
        filters: [{ name: 'C++ Header', extensions: ['h'] }]
    });

    if (canceled || !filePath) return { success: false, canceled: true };

    try {
        fs.writeFileSync(filePath, codeString, 'utf-8');
        return { success: true, filePath };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('save-zip', async (event, buffer) => {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
        title: 'Export Arduino Project',
        defaultPath: 'ml-bridge-export.zip',
        filters: [{ name: 'ZIP Archive', extensions: ['zip'] }]
    });

    if (canceled || !filePath) return { success: false, canceled: true };

    try {
        fs.writeFileSync(filePath, Buffer.from(buffer));
        return { success: true, filePath };
    } catch (e) {
        return { success: false, error: e.message };
    }
});
