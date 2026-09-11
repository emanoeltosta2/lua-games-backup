async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  return {
    evaluate(expression) {
      const id = nextId++;
      socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    close() { socket.close(); }
  };
}

const targets = await fetch('http://127.0.0.1:8080/json').then((response) => response.json());
const target = targets.find((candidate) => candidate.title === 'SharedJSContext');
if (!target) throw new Error('Steam SharedJSContext was not found.');
const client = await connect(target.webSocketDebuggerUrl);

try {
  await client.evaluate(`(() => {
    const doc = window.g_PopupManager?.GetExistingPopup?.('SP Desktop_uid0')?.m_popup?.window?.document;
    const steamMenu = Array.from(doc?.querySelectorAll('*') || []).find((element) => {
      const rect = element.getBoundingClientRect();
      return element.children.length === 0 && (element.textContent || '').trim() === 'Steam' && rect.width > 0 && rect.height > 0;
    });
    if (!steamMenu) return false;
    steamMenu.click();
    return true;
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 400));
  const result = await client.evaluate(`(() => {
    for (const popup of window.g_PopupManager?.m_mapPopups?.values?.() || []) {
      const doc = popup?.m_popup?.window?.document;
      const item = Array.from(doc?.querySelectorAll('*') || []).find((element) => {
        const rect = element.getBoundingClientRect();
        const label = (element.textContent || '').trim();
        return element.children.length === 0 && (label === 'Exit' || label === 'Sair') && rect.width > 0 && rect.height > 0;
      });
      if (item) { item.click(); return true; }
    }
    return false;
  })()`);
  if (!result.result.value) throw new Error('Steam Exit menu item was not found.');
} finally {
  client.close();
}
