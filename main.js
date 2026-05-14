const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const fs = require('fs/promises');
const net = require('net');
const path = require('path');

let mainWindow = null;
let clientSocket = null;
let tcpServer = null;
let mode = 'idle';
let nextClientId = 1;
const serverClients = new Map();

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function updateStatus(status, detail = '', nextMode = mode) {
  sendToRenderer('tcp-status', {
    mode: nextMode,
    status,
    detail,
    clients: getServerClientList()
  });
}

function getServerClientList() {
  return Array.from(serverClients.values(), (client) => ({
    id: client.id,
    address: client.address,
    port: client.port,
    label: client.label,
    connectedAt: client.connectedAt
  }));
}

function publishServerClients() {
  sendToRenderer('tcp-client-list', getServerClientList());
}

function validateEndpoint({ host, port }, hostLabel) {
  const normalizedHost = String(host || '').trim();
  const normalizedPort = Number(port);

  if (!normalizedHost) {
    throw new Error(`${hostLabel}不能为空`);
  }

  if (!Number.isInteger(normalizedPort) || normalizedPort < 1 || normalizedPort > 65535) {
    throw new Error('端口必须是 1 到 65535 之间的整数');
  }

  return {
    host: normalizedHost,
    port: normalizedPort
  };
}

function destroyClientSocket() {
  if (!clientSocket) {
    return;
  }

  clientSocket.removeAllListeners();
  clientSocket.destroy();
  clientSocket = null;
}

function endClientSocketGracefully() {
  if (!clientSocket) {
    return;
  }

  const currentSocket = clientSocket;
  clientSocket = null;
  currentSocket.removeAllListeners();
  currentSocket.on('error', () => {});
  currentSocket.end();
}

function destroyServerClient(clientId) {
  const client = serverClients.get(clientId);
  if (!client) {
    return;
  }

  client.socket.removeAllListeners();
  client.socket.destroy();
  serverClients.delete(clientId);
}

function endServerClientsGracefully() {
  for (const client of serverClients.values()) {
    client.socket.removeAllListeners();
    client.socket.on('error', () => {});
    client.socket.end();
  }
  serverClients.clear();
  publishServerClients();
}

function destroyServer() {
  endServerClientsGracefully();

  if (!tcpServer) {
    return;
  }

  tcpServer.removeAllListeners();
  try {
    tcpServer.close(() => {});
  } catch (_err) {
    tcpServer.closeAllConnections?.();
  }
  tcpServer = null;
}

function destroyAllConnections() {
  destroyClientSocket();
  destroyServer();
  mode = 'idle';
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 760,
    minWidth: 720,
    minHeight: 540,
    backgroundColor: '#f4f7fb',
    title: 'TCP 调试助手',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile('index.html');

  mainWindow.on('closed', () => {
    destroyAllConnections();
    mainWindow = null;
  });
}

function connectTCP({ host, port }) {
  const endpoint = validateEndpoint({ host, port }, '服务器地址');

  destroyAllConnections();
  mode = 'client';
  updateStatus('connecting', `${endpoint.host}:${endpoint.port}`, 'client');

  return new Promise((resolve, reject) => {
    let settled = false;
    const nextSocket = net.createConnection({
      host: endpoint.host,
      port: endpoint.port
    });

    clientSocket = nextSocket;
    nextSocket.setKeepAlive(true, 5000);
    nextSocket.setNoDelay(true);

    nextSocket.once('connect', () => {
      settled = true;
      updateStatus('connected', `${endpoint.host}:${endpoint.port}`, 'client');
      resolve({ success: true, mode: 'client', host: endpoint.host, port: endpoint.port });
    });

    nextSocket.on('data', (data) => {
      sendToRenderer('tcp-data', {
        mode: 'client',
        peer: {
          label: `${endpoint.host}:${endpoint.port}`,
          address: endpoint.host,
          port: endpoint.port
        },
        bytes: Array.from(data),
        byteLength: data.byteLength,
        receivedAt: Date.now()
      });
    });

    nextSocket.on('close', (hadError) => {
      if (clientSocket === nextSocket) {
        clientSocket = null;
      }

      if (mode === 'client') {
        updateStatus('disconnected', hadError ? '连接异常断开' : '连接已断开', 'client');
      }
    });

    nextSocket.on('error', (err) => {
      if (!settled) {
        settled = true;
        if (clientSocket === nextSocket) {
          clientSocket = null;
        }
        updateStatus('disconnected', err.message, 'client');
        reject(err);
        return;
      }

      sendToRenderer('tcp-event', {
        type: 'error',
        message: err.message
      });
    });
  });
}

function listenTCP({ host, port }) {
  const endpoint = validateEndpoint({ host, port }, '监听地址');

  destroyAllConnections();
  mode = 'server';
  updateStatus('connecting', `${endpoint.host}:${endpoint.port}`, 'server');

  return new Promise((resolve, reject) => {
    let settled = false;
    const server = net.createServer((socket) => registerServerClient(socket));
    tcpServer = server;

    server.once('listening', () => {
      settled = true;
      const address = server.address();
      const detail = typeof address === 'object' && address
        ? `${address.address}:${address.port}`
        : `${endpoint.host}:${endpoint.port}`;
      updateStatus('listening', detail, 'server');
      resolve({ success: true, mode: 'server', host: endpoint.host, port: endpoint.port });
    });

    server.on('error', (err) => {
      if (!settled) {
        settled = true;
        if (tcpServer === server) {
          tcpServer = null;
        }
        updateStatus('disconnected', err.message, 'server');
        reject(err);
        return;
      }

      sendToRenderer('tcp-event', {
        type: 'error',
        message: err.message
      });
    });

    server.on('close', () => {
      if (tcpServer === server) {
        tcpServer = null;
      }

      if (mode === 'server') {
        updateStatus('disconnected', '监听已停止', 'server');
      }
    });

    server.listen(endpoint.port, endpoint.host);
  });
}

function registerServerClient(socket) {
  const id = String(nextClientId);
  nextClientId += 1;

  const address = socket.remoteAddress || 'unknown';
  const port = socket.remotePort || 0;
  const label = `${address}:${port}`;
  const client = {
    id,
    socket,
    address,
    port,
    label,
    connectedAt: Date.now()
  };

  serverClients.set(id, client);
  socket.setKeepAlive(true, 5000);
  socket.setNoDelay(true);
  publishServerClients();

  sendToRenderer('tcp-event', {
    type: 'success',
    message: `客户端已接入: ${label}`
  });

  socket.on('data', (data) => {
    sendToRenderer('tcp-data', {
      mode: 'server',
      peer: {
        id,
        label,
        address,
        port
      },
      bytes: Array.from(data),
      byteLength: data.byteLength,
      receivedAt: Date.now()
    });
  });

  socket.on('close', (hadError) => {
    if (serverClients.delete(id)) {
      publishServerClients();
      sendToRenderer('tcp-event', {
        type: hadError ? 'error' : 'info',
        message: `客户端已断开: ${label}`
      });
    }
  });

  socket.on('error', (err) => {
    sendToRenderer('tcp-event', {
      type: 'error',
      message: `${label}: ${err.message}`
    });
  });
}

function sendBytes({ bytes, targetClientId = 'all' }) {
  if (!Array.isArray(bytes) && !(bytes instanceof Uint8Array)) {
    throw new Error('发送数据格式无效');
  }

  const buffer = Buffer.from(bytes);

  if (mode === 'client') {
    if (!clientSocket || !clientSocket.writable) {
      throw new Error('当前未连接到 TCP 服务');
    }

    clientSocket.write(buffer);
    return {
      success: true,
      byteLength: buffer.byteLength,
      recipients: 1
    };
  }

  if (mode === 'server') {
    const clients = targetClientId === 'all'
      ? Array.from(serverClients.values())
      : [serverClients.get(String(targetClientId))].filter(Boolean);

    const writableClients = clients.filter((client) => client.socket.writable);
    if (writableClients.length === 0) {
      throw new Error(targetClientId === 'all' ? '当前没有可发送的客户端' : '目标客户端不可用');
    }

    for (const client of writableClients) {
      client.socket.write(buffer);
    }

    return {
      success: true,
      byteLength: buffer.byteLength,
      recipients: writableClients.length
    };
  }

  throw new Error('当前未连接或监听 TCP');
}

ipcMain.handle('tcp-connect', async (_event, options) => connectTCP(options));

ipcMain.handle('tcp-listen', async (_event, options) => listenTCP(options));

ipcMain.handle('tcp-send', async (_event, payload) => sendBytes(payload));

ipcMain.handle('tcp-disconnect', async () => {
  if (mode === 'client') {
    endClientSocketGracefully();
  } else if (mode === 'server') {
    destroyServer();
  }
  mode = 'idle';
  updateStatus('disconnected', '主动断开连接');
  return { success: true };
});

ipcMain.handle('dialog-save-text', async (_event, { defaultPath, content }) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: '导出接收数据',
    defaultPath,
    filters: [
      { name: 'Text', extensions: ['txt', 'log'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });

  if (result.canceled || !result.filePath) {
    return { success: false, canceled: true };
  }

  await fs.writeFile(result.filePath, content, 'utf8');
  return { success: true, filePath: result.filePath };
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', () => {
  destroyAllConnections();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
