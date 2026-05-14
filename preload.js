const { contextBridge, ipcRenderer } = require('electron');
const iconv = require('iconv-lite');

const TEXT_ENCODINGS = new Set(['utf8', 'ascii', 'latin1', 'gbk']);
const VIEW_ENCODINGS = new Set(['utf8', 'ascii', 'latin1', 'gbk', 'hex', 'ascii-hex']);

function normalizeBytes(bytes) {
  if (!Array.isArray(bytes) && !(bytes instanceof Uint8Array)) {
    throw new Error('数据必须是字节数组');
  }

  return Array.from(bytes, (byte) => {
    const value = Number(byte);
    if (!Number.isInteger(value) || value < 0 || value > 255) {
      throw new Error('字节值必须在 0 到 255 之间');
    }
    return value;
  });
}

function textToBytes(text, encoding) {
  const input = String(text ?? '');

  if (encoding === 'hex') {
    const normalized = input.replace(/[\s,;:|-]/g, '');
    if (!normalized) {
      return [];
    }
    if (normalized.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(normalized)) {
      throw new Error('十六进制内容必须由成对的 0-9、A-F 字符组成');
    }
    return Array.from(Buffer.from(normalized, 'hex'));
  }

  if (!TEXT_ENCODINGS.has(encoding)) {
    throw new Error(`不支持的发送编码: ${encoding}`);
  }

  const buffer = encoding === 'gbk'
    ? iconv.encode(input, 'gbk')
    : Buffer.from(input, encoding);

  return Array.from(buffer);
}

function bytesToText(bytes, encoding) {
  if (!VIEW_ENCODINGS.has(encoding)) {
    throw new Error(`不支持的接收编码: ${encoding}`);
  }

  const buffer = Buffer.from(normalizeBytes(bytes));

  if (encoding === 'hex') {
    return Array.from(buffer, (byte) => byte.toString(16).padStart(2, '0').toUpperCase()).join(' ');
  }

  if (encoding === 'ascii-hex') {
    return bytesToAsciiHex(buffer);
  }

  if (encoding === 'gbk') {
    return iconv.decode(buffer, 'gbk');
  }

  return buffer.toString(encoding);
}

function bytesToAsciiHex(buffer) {
  const rows = [];
  const bytesPerLine = 16;

  for (let offset = 0; offset < buffer.length; offset += bytesPerLine) {
    const slice = buffer.subarray(offset, offset + bytesPerLine);
    const hex = Array.from(slice, (byte) => byte.toString(16).padStart(2, '0').toUpperCase())
      .join(' ')
      .padEnd(bytesPerLine * 3 - 1, ' ');
    const ascii = Array.from(slice, (byte) => (byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.')).join('');
    rows.push(`${offset.toString(16).padStart(8, '0').toUpperCase()}  ${hex}  | ${ascii}`);
  }

  return rows.join('\n');
}

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('tcpAssistant', {
  connect: (host, port) => ipcRenderer.invoke('tcp-connect', { host, port }),
  listen: (host, port) => ipcRenderer.invoke('tcp-listen', { host, port }),
  sendBytes: (bytes, targetClientId = 'all') => ipcRenderer.invoke('tcp-send', {
    bytes: normalizeBytes(bytes),
    targetClientId
  }),
  disconnect: () => ipcRenderer.invoke('tcp-disconnect'),
  exportText: (defaultPath, content) => ipcRenderer.invoke('dialog-save-text', { defaultPath, content }),
  textToBytes,
  bytesToText,
  onData: (callback) => subscribe('tcp-data', callback),
  onStatus: (callback) => subscribe('tcp-status', callback),
  onClientList: (callback) => subscribe('tcp-client-list', callback),
  onEvent: (callback) => subscribe('tcp-event', callback)
});
