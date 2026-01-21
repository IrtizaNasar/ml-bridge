const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const isDev = process.env.NODE_ENV === 'development';

let mainWindow;

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

            // Send initial status?
            socket.emit('status', { message: 'Connected to ML Bridge' });

            socket.on('disconnect', () => {
                console.log('[WS] Client disconnected');
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

        // If protocol is 'serial' and deviceId is provided, send to Serial Bridge
        if (data.protocol === 'serial' && data.deviceId) {
            sendToSerialBridge(data.deviceId, data);
        }

        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// Serial Bridge Client Connection
const socketIOClient = require('socket.io-client');
let serialBridgeSocket = null;

function connectToSerialBridge() {
    if (serialBridgeSocket && serialBridgeSocket.connected) {
        return;
    }

    try {
        serialBridgeSocket = socketIOClient('http://localhost:3000', {
            reconnection: true,
            reconnectionDelay: 1000,
            reconnectionAttempts: 5
        });

        serialBridgeSocket.on('connect', () => {
            console.log('[Serial Bridge] Connected to Serial Bridge server');
        });

        serialBridgeSocket.on('disconnect', () => {
            console.log('[Serial Bridge] Disconnected from Serial Bridge server');
        });

        serialBridgeSocket.on('connect_error', (error) => {
            console.log('[Serial Bridge] Connection error:', error.message);
        });
    } catch (e) {
        console.error('[Serial Bridge] Failed to connect:', e);
    }
}

function sendToSerialBridge(deviceId, predictionData) {
    if (!serialBridgeSocket || !serialBridgeSocket.connected) {
        console.log('[Serial Bridge] Not connected, attempting to connect...');
        connectToSerialBridge();
        return;
    }

    try {
        // Format data as JSON string (what Arduino expects)
        const message = JSON.stringify({
            label: predictionData.label,
            confidence: predictionData.confidence || Math.max(...Object.values(predictionData.confidences || {})),
            confidences: predictionData.confidences
        });

        console.log(`[Serial Bridge] Attempting to send to ${deviceId}:`, message.substring(0, 100));

        // Try multiple possible event names (we need to find the correct one)
        // Based on Serial Bridge client library pattern

        // Attempt 1: Direct send with arduinoId
        serialBridgeSocket.emit('send', {
            arduinoId: deviceId,
            data: message
        });

        // Attempt 2: Using 'serial-send' event
        serialBridgeSocket.emit('serial-send', {
            arduinoId: deviceId,
            data: message
        });

        // Attempt 3: Using 'write' event (common pattern)
        serialBridgeSocket.emit('write', {
            arduinoId: deviceId,
            data: message
        });

        // Attempt 4: Direct data emit
        serialBridgeSocket.emit('data', {
            arduinoId: deviceId,
            message: message
        });

        console.log('[Serial Bridge] Sent via multiple event names - check Serial Bridge server logs');
    } catch (e) {
        console.error('[Serial Bridge] Send error:', e);
    }
}

// IPC Handlers for Serial Bridge connection management
ipcMain.handle('serial-bridge-connect', () => {
    console.log('[Serial Bridge] Connection requested from renderer');
    connectToSerialBridge();
    return { success: true };
});

ipcMain.handle('serial-bridge-disconnect', () => {
    if (serialBridgeSocket) {
        console.log('[Serial Bridge] Disconnecting...');
        serialBridgeSocket.disconnect();
        serialBridgeSocket = null;
    }
    return { success: true };
});

ipcMain.handle('serial-bridge-status', () => {
    return {
        connected: serialBridgeSocket && serialBridgeSocket.connected,
        url: 'http://localhost:3000'
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
