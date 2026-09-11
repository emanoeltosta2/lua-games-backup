const PLUGIN_LABEL = 'Lua Games Backup';
const ACTION_LABEL = process.argv[2] || 'Restart';

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
    if (!message.id || !pending.has(message.id)) return;
    const request = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  return {
    evaluate(expression) {
      const id = nextId++;
      socket.send(JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: { expression, awaitPromise: true, returnByValue: true }
      }));
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
    const sidebarClose = doc?.querySelector('.MillenniumDesktopSidebar_Title button');
    if (sidebarClose) sidebarClose.click();
    const steamMenu = Array.from(doc?.querySelectorAll('*') || []).find((element) => {
      const rect = element.getBoundingClientRect();
      return element.children.length === 0 && (element.textContent || '').trim() === 'Steam' && rect.width > 0 && rect.height > 0;
    });
    steamMenu?.click();
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 350));

  const openedMillennium = await client.evaluate(`(() => {
    for (const popup of window.g_PopupManager?.m_mapPopups?.values?.() || []) {
      const doc = popup?.m_popup?.window?.document;
      const item = Array.from(doc?.querySelectorAll('*') || []).find((element) => {
        const rect = element.getBoundingClientRect();
        return element.children.length === 0 && (element.textContent || '').trim() === 'Millennium' && rect.width > 0 && rect.height > 0;
      });
      if (item) { item.click(); return { ok: true }; }
    }
    return { ok: false, error: 'millennium_menu_item_missing' };
  })()`);
  if (!openedMillennium.result.value?.ok) throw new Error(JSON.stringify(openedMillennium.result.value));
  await new Promise((resolve) => setTimeout(resolve, 700));

  const openedPlugins = await client.evaluate(`(() => {
    const doc = window.g_PopupManager?.GetExistingPopup?.('SP Desktop_uid0')?.m_popup?.window?.document;
    const item = Array.from(doc?.querySelectorAll('*') || []).find((element) => {
      const rect = element.getBoundingClientRect();
      return element.children.length === 0 && (element.textContent || '').trim() === 'Plugins' && rect.width > 0 && rect.height > 0;
    });
    if (!item) return { ok: false, error: 'plugins_navigation_missing' };
    item.click();
    return { ok: true };
  })()`);
  if (!openedPlugins.result.value?.ok) throw new Error(JSON.stringify(openedPlugins.result.value));
  await new Promise((resolve) => setTimeout(resolve, 700));

  const opened = await client.evaluate(`(() => {
    const doc = window.g_PopupManager?.GetExistingPopup?.('SP Desktop_uid0')?.m_popup?.window?.document;
    if (!doc) return { ok: false, error: 'desktop_document_missing' };
    const labels = Array.from(doc.querySelectorAll('*')).filter((element) =>
      element.children.length === 0 && (element.textContent || '').trim() === ${JSON.stringify(PLUGIN_LABEL)}
    );
    const description = Array.from(doc.querySelectorAll('*')).find((element) =>
      element.children.length === 0 && (element.textContent || '').trim() === 'Backup e restauração dos arquivos LuaTools, com opção de Google Drive.'
    );
    const label = labels.find((element) => element.getBoundingClientRect().width > 0) || labels[0] || description;
    if (!label) return {
      ok: false,
      error: 'plugin_row_missing',
      visibleText: Array.from(doc.querySelectorAll('*'))
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          const text = (element.textContent || '').trim();
          return element.children.length === 0 && rect.width > 0 && rect.height > 0 && /Lua|Plugin|Backup/i.test(text);
        })
        .map((element) => ({ tag: element.tagName, text: (element.textContent || '').trim().slice(0, 160) }))
        .slice(0, 80)
    };
    let row = label;
    const diagnostics = [];
    for (let depth = 0; depth < 9 && row; depth += 1, row = row.parentElement) {
      const controls = Array.from(row.querySelectorAll('button, [role="button"]')).filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      diagnostics.push({
        depth,
        tag: row.tagName,
        className: typeof row.className === 'string' ? row.className : '',
        text: (row.textContent || '').trim().slice(0, 240),
        controls: controls.map((control) => ({
          tag: control.tagName,
          className: typeof control.className === 'string' ? control.className : '',
          text: (control.textContent || '').trim().slice(0, 80)
        }))
      });
      if (controls.length >= 1 && (row.textContent || '').includes('Backup e restauração')) {
        controls[controls.length - 1].click();
        return { ok: true, controls: controls.length };
      }
    }
    return { ok: false, error: 'plugin_dropdown_missing', diagnostics };
  })()`);
  if (opened.exceptionDetails) throw new Error(opened.exceptionDetails.exception?.description || opened.exceptionDetails.text);
  if (!opened.result.value?.ok) throw new Error(JSON.stringify(opened.result.value));

  await new Promise((resolve) => setTimeout(resolve, 500));
  if (ACTION_LABEL === '--menu') {
    console.log(JSON.stringify({ ok: true, menuOpened: true }));
    process.exitCode = 0;
  } else {
  const restarted = await client.evaluate(`(() => {
    const documents = [];
    const desktop = window.g_PopupManager?.GetExistingPopup?.('SP Desktop_uid0')?.m_popup?.window?.document;
    if (desktop) documents.push(desktop);
    for (const popup of window.g_PopupManager?.m_mapPopups?.values?.() || []) {
      const doc = popup?.m_popup?.window?.document;
      if (doc && !documents.includes(doc)) documents.push(doc);
    }
    for (const doc of documents) {
      const items = Array.from(doc.querySelectorAll('*')).filter((element) =>
        element.children.length === 0 && (element.textContent || '').trim() === ${JSON.stringify(ACTION_LABEL)}
      );
      const item = items.find((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      if (item) {
        item.click();
        return { ok: true, title: doc.title };
      }
    }
    return { ok: false, error: 'plugin_action_missing', action: ${JSON.stringify(ACTION_LABEL)} };
  })()`);
  if (restarted.exceptionDetails) throw new Error(restarted.exceptionDetails.exception?.description || restarted.exceptionDetails.text);
  if (!restarted.result.value?.ok) throw new Error(JSON.stringify(restarted.result.value));
  console.log(JSON.stringify(restarted.result.value));
  }
} finally {
  client.close();
}
