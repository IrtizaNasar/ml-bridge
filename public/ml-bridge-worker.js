/**
 * ML Bridge WebSocket Worker
 * Runs in separate thread to avoid browser throttling when window is hidden
 */

let socket = null;
let serverUrl = 'http://localhost:3100';

// Listen for messages from main thread
self.addEventListener('message', (event) => {
    const { type, data } = event.data;

    switch (type) {
        case 'CONNECT':
            if (data.serverUrl) {
                serverUrl = data.serverUrl;
            }
            connect();
            break;

        case 'DISCONNECT':
            disconnect();
            break;
    }
});

function connect() {
    // Import Socket.IO client in worker
    importScripts('https://cdn.socket.io/4.7.2/socket.io.min.js');

    console.log(`[MLBridge Worker] Connecting to ${serverUrl}...`);
    socket = io(serverUrl);

    socket.on('connect', () => {
        console.log('[MLBridge Worker] Connected!');
        self.postMessage({ type: 'STATUS', status: 'connected' });
    });

    socket.on('disconnect', () => {
        console.log('[MLBridge Worker] Disconnected');
        self.postMessage({ type: 'STATUS', status: 'disconnected' });
    });

    // Forward prediction events to main thread
    socket.on('prediction', (data) => {
        self.postMessage({ type: 'PREDICTION', data });
    });

    // Forward any other events
    socket.on('status', (data) => {
        self.postMessage({ type: 'SERVER_STATUS', data });
    });
}

function disconnect() {
    if (socket) {
        socket.disconnect();
        socket = null;
    }
}
