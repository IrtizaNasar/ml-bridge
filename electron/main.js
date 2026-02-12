const { app, BrowserWindow, ipcMain, shell, dialog, powerSaveBlocker } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');

// Configure logging
autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';
log.info('App starting...');

const isDev = !app.isPackaged;

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
            backgroundThrottling: false,
            additionalArguments: [`--ws-port=${wsPort}`]
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

app.whenReady().then(async () => {
    // Prevent App Nap/Suspension
    powerSaveBlocker.start('prevent-app-suspension');

    // Check for updates
    if (!isDev) {
        log.info('Checking for updates...');
        autoUpdater.checkForUpdatesAndNotify();
    }

    autoUpdater.on('update-downloaded', (info) => {
        log.info('Update downloaded');
        dialog.showMessageBox({
            type: 'info',
            title: 'Update Ready',
            message: `Version ${info.version} is ready. Restart now to apply?`,
            buttons: ['Restart', 'Later']
        }).then((returnValue) => {
            if (returnValue.response === 0) autoUpdater.quitAndInstall();
        });
    });

    // Start WS Server first to get the correct port
    await startWebSocketServer();

    // Now create window with the correct injected port
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

// Global error handler for truly unexpected errors
process.on('uncaughtException', (err) => {
    console.error('CRITICAL UNCAUGHT EXCEPTION:', err);
    // Log but don't crash - let the app continue if possible
});

let wsServer = null;
let io = null;
let wsPort = 3100; // Will be updated if 3100 is busy

function startWebSocketServer() {
    return new Promise((resolve) => {
        const expressApp = express();
        expressApp.use(express.json());

        // CORS - Must be BEFORE static files to apply to worker script
        expressApp.use((req, res, next) => {
            res.header('Access-Control-Allow-Origin', '*');
            res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.header('Access-Control-Allow-Headers', 'Content-Type');
            next();
        });

        // Serve static files (client library)
        const publicPath = isDev
            ? path.join(__dirname, '../public')
            : path.join(process.resourcesPath, 'app.asar.unpacked/public');

        expressApp.use(express.static(publicPath));

        const httpServer = http.createServer(expressApp);
        io = new SocketIOServer(httpServer, {
            cors: {
                origin: "*",
                methods: ["GET", "POST"]
            }
        });

        io.on('connection', (socket) => {
            console.log('[WS] Client connected');
            socket.emit('status', { message: 'Connected to ML Bridge' });
            socket.on('disconnect', () => {
                console.log('[WS] Client disconnected');
            });
        });

        // Try to start server, with fallback ports if 3100 is busy
        function tryStartServer(port, maxAttempts = 10) {
            httpServer.listen(port, '0.0.0.0')
                .on('listening', () => {
                    wsPort = port;
                    console.log(`[WS] ML Bridge Server running on http://localhost:${wsPort}`);
                    wsServer = httpServer;
                    resolve(wsPort);
                })
                .on('error', (err) => {
                    if (err.code === 'EADDRINUSE' && maxAttempts > 1) {
                        console.log(`[WS] Port ${port} is busy, trying ${port + 1}...`);
                        tryStartServer(port + 1, maxAttempts - 1);
                    } else {
                        console.error('[WS] Failed to start server:', err);
                        resolve(null); // Continue without server?
                    }
                });
        }

        tryStartServer(3100);
    });
}

// IPC Handler to broadcast
ipcMain.handle('ws-broadcast', (event, channel, data) => {
    try {
        // Broadcast via ML Bridge's own WebSocket server
        if (io) {
            io.emit(channel, data);
        }

        // Debug: Log when serial protocol is detected
        // console.log('[WS-BROADCAST] Channel:', channel, 'Protocol:', data.protocol, 'DeviceId:', data.deviceId);

        // If protocol is 'serial' and deviceId is provided, send to Serial Bridge
        if (data.protocol === 'serial' && data.deviceId) {
            sendToSerialBridge(data.deviceId, data);
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

// Dynamic Serial Bridge URL (discovered via scan)
let serialBridgeUrl = "http://localhost:3000";
let serialBridgeConnected = false;

// Scan for Serial Bridge on ports 3000-3010
async function findSerialBridge() {
    // console.log('[Discovery] Scanning for Serial Bridge...');
    for (let port = 3000; port <= 3010; port++) {
        try {
            const url = `http://localhost:${port}`;
            const res = await fetch(`${url}/api/health`, { timeout: 500 });
            if (res.ok) {
                const data = await res.json();
                if (data.app === 'serial-bridge') {
                    console.log(`[Discovery] Found Serial Bridge at ${url}`);
                    serialBridgeUrl = url;
                    serialBridgeConnected = true;

                    // Notify frontend
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('serial-bridge-found', { url: serialBridgeUrl, port });
                        mainWindow.webContents.send('serial-bridge-status', { connected: true, url: serialBridgeUrl });
                    }
                    return url;
                }
            }
        } catch (e) {
            // Ignore connection errors, just try next port
        }
    }
    // console.log('[Discovery] Serial Bridge not found (yet).');
    serialBridgeConnected = false;

    // Notify frontend of failure
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('serial-bridge-status', { connected: false });
    }
    return null;
}

// Re-scan for Serial Bridge every 5 seconds (auto-discovery)
setInterval(() => {
    findSerialBridge();
}, 5000);

ipcMain.handle('scan-serial-bridge', async () => {
    return await findSerialBridge();
});

async function sendToSerialBridge(deviceId, predictionData) {
    // If we haven't found it yet, try one quick scan
    if (!serialBridgeConnected) {
        await findSerialBridge();
        if (!serialBridgeConnected) {
            console.warn('[Serial Bridge] Cannot send: Serial Bridge not found.');
            return;
        }
    }

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
        const currentLabel = predictionData.label;
        if (currentLabel === lastSentLabel) {
            return; // Skip - same prediction
        }
        lastSentLabel = currentLabel;
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
            // Classification formatting — label is human-readable class name
            const label = predictionData.label;

            if (predictionData.serialFormat === 'csv') {
                // CSV: label,confidence
                const confidence = predictionData.confidence || Math.max(...Object.values(predictionData.confidences || {}));
                message = `${label},${confidence.toFixed(2)}`;
            } else {
                // JSON: {"label":"Punch","confidence":0.85}
                message = JSON.stringify({
                    label: label,
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
                // JSON: {"Parameter 1":0.48,"Parameter 2":1.00}
                message = JSON.stringify(predictionData.regression);
            }
        }

        console.log(`[Serial Bridge] Sending to ${deviceId} via HTTP:`, message.substring(0, 100));

        // Serial Bridge uses HTTP POST to /api/send
        // Use the dynamically discovered URL
        const response = await fetch(`${serialBridgeUrl}/api/send`, {
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
        // Force a re-scan next time
        serialBridgeConnected = false;
    }
}

// IPC Handlers for Serial Bridge connection management
ipcMain.handle('serial-bridge-connect', () => {
    // Force a scan
    findSerialBridge();
    return { success: true, message: 'Scanning for Serial Bridge...' };
});

ipcMain.handle('serial-bridge-disconnect', () => {
    serialBridgeConnected = false;
    return { success: true };
});

ipcMain.handle('serial-bridge-status', () => {
    return {
        connected: serialBridgeConnected,
        url: serialBridgeConnected ? `${serialBridgeUrl}/api/send` : null
    };
});


// Universal Input Hub Placeholder
ipcMain.handle('get-app-version', () => app.getVersion());

// --- OSC Server Logic ---
const { Server: OscServer, Client: OscClient } = require('node-osc');
const dgram = require('dgram');
let oscServer = null;
let oscServerReady = false;

/**
 * Attempt to create and bind an OSC server with proper error handling.
 * node-osc's Server binds UDP synchronously in constructor, so we wrap it
 * to catch any binding failures gracefully.
 */
function createOscServer(port, host) {
    return new Promise((resolve, reject) => {
        let server = null;
        let settled = false;
        
        // Safety timeout - if no error within 200ms, assume success
        const timeout = setTimeout(() => {
            if (!settled) {
                settled = true;
                resolve(server);
            }
        }, 200);
        
        try {
            // Create the server - this internally creates and binds a UDP socket
            server = new OscServer(port, host);
            
            // Handle errors that occur after construction
            server.on('error', (err) => {
                if (!settled) {
                    settled = true;
                    clearTimeout(timeout);
                    try { server.close(); } catch (e) {}
                    reject(err);
                } else {
                    // Runtime error after successful startup
                    console.error(`[OSC] Runtime error on ${host}:${port}:`, err.message);
                }
            });
            
        } catch (e) {
            // Synchronous error during construction
            settled = true;
            clearTimeout(timeout);
            reject(e);
        }
    });
}

ipcMain.handle('osc-start', async (event, port = 12000) => {
    try {
        // Close any existing server first
        if (oscServer) {
            try { oscServer.close(); } catch (e) { }
            oscServer = null;
            oscServerReady = false;
        }

        console.log(`[Main] Starting OSC Server on port ${port}...`);

        // Try 0.0.0.0 first (allows external connections), fall back to 127.0.0.1
        // Fall back to 127.0.0.1 if 0.0.0.0 isn't available
        const hosts = ['0.0.0.0', '127.0.0.1'];
        let lastError = null;
        
        for (const host of hosts) {
            try {
                oscServer = await createOscServer(port, host);
                
                // Set up message handler
                oscServer.on('message', (msg) => {
                    try {
                        const address = msg[0];
                        const args = msg.slice(1);
                        const flatArgs = args.flat();
                        const numericArgs = flatArgs.filter(a => typeof a === 'number');

                        if (numericArgs.length > 0) {
                            const inputs = {};
                            numericArgs.forEach((val, idx) => {
                                inputs[`osc_${idx}`] = val;
                            });
                            if (mainWindow && !mainWindow.isDestroyed()) {
                                mainWindow.webContents.send('osc-data', inputs);
                            }
                        }
                    } catch (parseErr) {
                        console.error('[OSC] Message parse error:', parseErr.message);
                    }
                });

                oscServerReady = true;
                const accessType = host === '0.0.0.0' ? 'all interfaces' : 'localhost only';
                console.log(`[Main] ✓ OSC Server listening on ${host}:${port} (${accessType})`);
                return { 
                    success: true, 
                    message: `Listening on port ${port} (${accessType})`,
                    host,
                    port
                };
                
            } catch (e) {
                lastError = e;
                const reason = e.code === 'EADDRNOTAVAIL' ? 'address not available' :
                              e.code === 'EADDRINUSE' ? 'port already in use' :
                              e.message;
                console.warn(`[Main] OSC: Cannot bind to ${host}:${port} - ${reason}`);
            }
        }

        // All hosts failed
        const errorMsg = lastError?.code === 'EADDRINUSE' 
            ? `Port ${port} is already in use. Try a different port.`
            : `Could not start OSC server on port ${port}. Check network settings.`;
        throw new Error(errorMsg);

    } catch (e) {
        console.error("[Main] OSC Start Error:", e.message);
        oscServer = null;
        oscServerReady = false;
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

let oscClient = null;

ipcMain.handle('osc-send', async (event, ip, port, address, args) => {
    try {
        // Reuse client if same destination
        if (!oscClient || oscClient.host !== ip || oscClient.port !== port) {
            if (oscClient) {
                try { oscClient.close(); } catch (e) {}
            }
            oscClient = new OscClient(ip, port);
        }

        // Send: client.send(address, arg1, arg2, ...)
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
