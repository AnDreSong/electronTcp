const tcp = window.tcpAssistant;

const state = {
  mode: 'client',
  status: 'disconnected',
  recvBytes: 0,
  recvEntries: [],
  serverClients: [],
  endpoints: {
    client: { host: '127.0.0.1', port: '8080' },
    server: { host: '0.0.0.0', port: '8080' }
  }
};

const els = {
  modeInputs: Array.from(document.querySelectorAll('input[name="connectionMode"]')),
  hostLabel: document.getElementById('hostLabel'),
  hostInput: document.getElementById('hostInput'),
  portInput: document.getElementById('portInput'),
  connectBtn: document.getElementById('connectBtn'),
  sendBtn: document.getElementById('sendBtn'),
  clearSendBtn: document.getElementById('clearSendBtn'),
  clearRecvBtn: document.getElementById('clearRecvBtn'),
  clearLogBtn: document.getElementById('clearLogBtn'),
  exportBtn: document.getElementById('exportBtn'),
  sendInput: document.getElementById('sendInput'),
  sendEncoding: document.getElementById('sendEncoding'),
  recvEncoding: document.getElementById('recvEncoding'),
  appendNewline: document.getElementById('appendNewline'),
  autoScroll: document.getElementById('autoScroll'),
  targetField: document.getElementById('targetField'),
  targetClient: document.getElementById('targetClient'),
  recvOutput: document.getElementById('recvOutput'),
  recvCount: document.getElementById('recvCount'),
  logOutput: document.getElementById('logOutput'),
  statusIndicator: document.getElementById('statusIndicator'),
  statusText: document.getElementById('statusText'),
  themeToggle: document.getElementById('themeToggle'),
  sendByteHint: document.getElementById('sendByteHint')
};

function nowTime() {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false });
}

function addLog(message, type = 'info') {
  const line = document.createElement('div');
  line.className = `log-line log-${type}`;
  line.textContent = `[${nowTime()}] ${message}`;
  els.logOutput.appendChild(line);
  els.logOutput.scrollTop = els.logOutput.scrollHeight;
}

function getSelectedMode() {
  return els.modeInputs.find((input) => input.checked)?.value || 'client';
}

function persistCurrentEndpoint() {
  state.endpoints[state.mode] = {
    host: els.hostInput.value,
    port: els.portInput.value
  };
}

function isRunning() {
  return state.status === 'connected' || state.status === 'listening';
}

function isBusy() {
  return state.status === 'connecting';
}

function getSendText() {
  return els.appendNewline.checked ? `${els.sendInput.value}\n` : els.sendInput.value;
}

function updateModeUI() {
  const mode = state.mode;
  const endpoint = state.endpoints[mode];

  els.hostLabel.textContent = mode === 'client' ? '服务器地址' : '监听地址';
  els.hostInput.placeholder = mode === 'client' ? '192.168.1.100' : '0.0.0.0';
  els.hostInput.value = endpoint.host;
  els.portInput.value = endpoint.port;
  els.targetField.classList.toggle('hidden', mode !== 'server');

  if (isRunning()) {
    els.connectBtn.textContent = mode === 'server' ? '停止监听' : '断开';
  } else if (isBusy()) {
    els.connectBtn.textContent = mode === 'server' ? '启动中' : '连接中';
  } else {
    els.connectBtn.textContent = mode === 'server' ? '开始监听' : '连接';
  }
}

function updateControls() {
  const locked = isRunning() || isBusy();
  els.connectBtn.disabled = isBusy();
  els.hostInput.disabled = locked;
  els.portInput.disabled = locked;
  for (const input of els.modeInputs) {
    input.disabled = locked;
  }
  updateModeUI();
  updateSendState();
}

function updateSendState() {
  let byteLength = 0;
  let canSend = false;

  try {
    const text = getSendText();
    byteLength = tcp.textToBytes(text, els.sendEncoding.value).length;
    els.sendByteHint.textContent = `${byteLength} 字节`;
    els.sendByteHint.classList.remove('log-error');
  } catch (err) {
    els.sendByteHint.textContent = err.message;
    els.sendByteHint.classList.add('log-error');
  }

  if (byteLength > 0) {
    if (state.mode === 'client') {
      canSend = state.status === 'connected';
    } else {
      canSend = state.status === 'listening' && state.serverClients.length > 0;
    }
  }

  els.sendBtn.disabled = !canSend;
}

function setStatus(status, detail = '', nextMode = state.mode) {
  state.status = status;
  if (nextMode === 'client' || nextMode === 'server') {
    state.mode = nextMode;
    for (const input of els.modeInputs) {
      input.checked = input.value === nextMode;
    }
  }

  els.statusIndicator.classList.remove('connected', 'connecting', 'listening', 'disconnected');
  els.statusIndicator.classList.add(status);

  if (status === 'connected') {
    els.statusText.textContent = detail ? `已连接 ${detail}` : '已连接';
  } else if (status === 'listening') {
    els.statusText.textContent = detail ? `监听中 ${detail}` : '监听中';
  } else if (status === 'connecting') {
    els.statusText.textContent = detail
      ? `${state.mode === 'server' ? '启动监听' : '连接中'} ${detail}`
      : (state.mode === 'server' ? '启动监听中' : '连接中');
  } else {
    els.statusText.textContent = detail || '未连接';
  }

  updateControls();
}

function validateEndpoint() {
  const host = els.hostInput.value.trim();
  const port = Number(els.portInput.value);
  const label = state.mode === 'server' ? '监听地址' : '服务器地址';

  if (!host) {
    addLog(`${label}不能为空`, 'error');
    els.hostInput.focus();
    return null;
  }

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    addLog('端口必须是 1 到 65535 之间的整数', 'error');
    els.portInput.focus();
    return null;
  }

  return { host, port };
}

async function start() {
  const endpoint = validateEndpoint();
  if (!endpoint) {
    return;
  }

  persistCurrentEndpoint();

  try {
    setStatus('connecting', `${endpoint.host}:${endpoint.port}`, state.mode);
    if (state.mode === 'server') {
      await tcp.listen(endpoint.host, endpoint.port);
      addLog(`已开始监听 ${endpoint.host}:${endpoint.port}`, 'success');
    } else {
      await tcp.connect(endpoint.host, endpoint.port);
      addLog(`已连接到 ${endpoint.host}:${endpoint.port}`, 'success');
    }
  } catch (err) {
    setStatus('disconnected', state.mode === 'server' ? '监听失败' : '连接失败', state.mode);
    addLog(`${state.mode === 'server' ? '监听失败' : '连接失败'}: ${err.message}`, 'error');
  }
}

async function stop() {
  try {
    await tcp.disconnect();
    state.serverClients = [];
    renderClientTargets();
    setStatus('disconnected', state.mode === 'server' ? '监听已停止' : '已断开', state.mode);
    addLog(state.mode === 'server' ? '已停止监听' : '已主动断开连接', 'info');
  } catch (err) {
    addLog(`停止失败: ${err.message}`, 'error');
  }
}

async function sendData() {
  let bytes;

  try {
    bytes = tcp.textToBytes(getSendText(), els.sendEncoding.value);
  } catch (err) {
    addLog(`发送内容编码失败: ${err.message}`, 'error');
    return;
  }

  if (bytes.length === 0) {
    addLog('发送内容为空', 'warning');
    return;
  }

  try {
    const targetClientId = state.mode === 'server' ? els.targetClient.value : 'all';
    const result = await tcp.sendBytes(bytes, targetClientId);
    const suffix = state.mode === 'server' ? `，目标 ${result.recipients} 个客户端` : '';
    addLog(`已发送 ${result.byteLength} 字节${suffix}`, 'success');
  } catch (err) {
    addLog(`发送失败: ${err.message}`, 'error');
    updateSendState();
  }
}

function renderRecvEntry(payload) {
  let text;
  try {
    text = tcp.bytesToText(payload.bytes, els.recvEncoding.value);
  } catch (err) {
    text = `解码失败: ${err.message}`;
  }

  const timestamp = new Date(payload.receivedAt).toLocaleTimeString('zh-CN', { hour12: false });
  const peer = payload.peer?.label ? ` 来自 ${payload.peer.label}` : '';
  const bytesLabel = `${payload.byteLength} 字节`;
  return {
    raw: payload,
    rendered: `[${timestamp}] 接收 ${bytesLabel}${peer}\n${text}`
  };
}

function refreshRecvOutput() {
  const rendered = state.recvEntries.map((entry) => renderRecvEntry(entry.raw).rendered).join('\n\n');
  els.recvOutput.textContent = rendered;

  if (els.autoScroll.checked) {
    els.recvOutput.scrollTop = els.recvOutput.scrollHeight;
  }
}

function handleData(payload) {
  state.recvBytes += payload.byteLength;
  state.recvEntries.push({ raw: payload });
  els.recvCount.textContent = String(state.recvBytes);
  refreshRecvOutput();

  const source = payload.peer?.label ? ` 来自 ${payload.peer.label}` : '';
  addLog(`收到 ${payload.byteLength} 字节${source}`, 'info');
}

function clearRecv() {
  state.recvBytes = 0;
  state.recvEntries = [];
  els.recvCount.textContent = '0';
  els.recvOutput.textContent = '';
}

async function exportRecv() {
  if (state.recvEntries.length === 0) {
    addLog('没有可导出的接收数据', 'warning');
    return;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const content = els.recvOutput.textContent || '';

  try {
    const result = await tcp.exportText(`tcp-received-${timestamp}.txt`, content);
    if (result.success) {
      addLog(`已导出到 ${result.filePath}`, 'success');
    }
  } catch (err) {
    addLog(`导出失败: ${err.message}`, 'error');
  }
}

function renderClientTargets() {
  const selected = els.targetClient.value;
  els.targetClient.textContent = '';

  const allOption = document.createElement('option');
  allOption.value = 'all';
  allOption.textContent = `所有客户端 (${state.serverClients.length})`;
  els.targetClient.appendChild(allOption);

  for (const client of state.serverClients) {
    const option = document.createElement('option');
    option.value = client.id;
    option.textContent = client.label;
    els.targetClient.appendChild(option);
  }

  if (selected && Array.from(els.targetClient.options).some((option) => option.value === selected)) {
    els.targetClient.value = selected;
  } else {
    els.targetClient.value = 'all';
  }

  updateSendState();
}

function applyTheme(theme) {
  const dark = theme === 'dark';
  document.body.classList.toggle('dark-theme', dark);
  els.themeToggle.textContent = dark ? '浅色' : '深色';
  localStorage.setItem('theme', theme);
}

function switchMode(nextMode) {
  if (nextMode === state.mode || isRunning() || isBusy()) {
    return;
  }

  persistCurrentEndpoint();
  state.mode = nextMode;
  setStatus('disconnected', '未连接', nextMode);
}

function bindEvents() {
  els.modeInputs.forEach((input) => {
    input.addEventListener('change', () => switchMode(getSelectedMode()));
  });

  els.connectBtn.addEventListener('click', () => {
    if (isRunning()) {
      stop();
    } else {
      start();
    }
  });

  els.sendBtn.addEventListener('click', sendData);
  els.clearSendBtn.addEventListener('click', () => {
    els.sendInput.value = '';
    updateSendState();
  });
  els.clearRecvBtn.addEventListener('click', clearRecv);
  els.clearLogBtn.addEventListener('click', () => {
    els.logOutput.textContent = '';
  });
  els.exportBtn.addEventListener('click', exportRecv);

  els.sendInput.addEventListener('input', updateSendState);
  els.sendEncoding.addEventListener('change', updateSendState);
  els.appendNewline.addEventListener('change', updateSendState);
  els.recvEncoding.addEventListener('change', refreshRecvOutput);
  els.targetClient.addEventListener('change', updateSendState);

  els.sendInput.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !els.sendBtn.disabled) {
      event.preventDefault();
      sendData();
    }
  });

  els.themeToggle.addEventListener('click', () => {
    applyTheme(document.body.classList.contains('dark-theme') ? 'light' : 'dark');
  });

  tcp.onData(handleData);
  tcp.onClientList((clients) => {
    state.serverClients = clients;
    renderClientTargets();
    if (state.status === 'listening') {
      els.statusText.textContent = `监听中，客户端 ${clients.length} 个`;
    }
  });
  tcp.onStatus(({ mode, status, detail, clients = [] }) => {
    const wasRunning = isRunning();
    setStatus(status, detail, mode);
    if (mode === 'server') {
      state.serverClients = clients;
      renderClientTargets();
    }
    if (status === 'disconnected' && detail && wasRunning && detail !== '主动断开连接') {
      addLog(`连接状态: ${detail}`, detail.includes('异常') ? 'error' : 'info');
    }
  });
  tcp.onEvent(({ type, message }) => addLog(message, type));
}

function init() {
  bindEvents();
  applyTheme(localStorage.getItem('theme') || 'light');
  setStatus('disconnected', '未连接', 'client');
  renderClientTargets();
  addLog('应用已启动');
}

init();
