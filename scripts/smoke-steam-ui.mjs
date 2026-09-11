import { readFile } from 'node:fs/promises';

const DEBUG_ENDPOINT = 'http://127.0.0.1:8080/json';
const PLUGIN_NAME = 'lua_games_backup';
const BUTTON_ID = 'lua-games-backup-library-button';

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
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  });

  return {
    send(method, params = {}) {
      const id = nextId++;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    close() { socket.close(); }
  };
}

const targets = await fetch(DEBUG_ENDPOINT).then((response) => response.json());
const target = targets.find((candidate) => candidate.title === 'SharedJSContext');
if (!target) throw new Error('Steam SharedJSContext was not found on port 8080.');

const client = await connect(target.webSocketDebuggerUrl);
try {
  if (process.argv.includes('--inject')) {
  const bundle = await readFile(new URL('../.millennium/Dist/index.js', import.meta.url), 'utf8');
  const evaluation = await client.send('Runtime.evaluate', {
    expression: `(function () {\n${bundle}\n})()`,
    awaitPromise: true,
    returnByValue: true
  });
  if (evaluation.exceptionDetails) {
    throw new Error(evaluation.exceptionDetails.exception?.description || evaluation.exceptionDetails.text);
  }
  }

  await new Promise((resolve) => setTimeout(resolve, 3000));
  const inspect = await client.send('Runtime.evaluate', {
    expression: `(() => {
      const desktop = window.g_PopupManager?.GetExistingPopup?.('SP Desktop_uid0')?.m_popup?.window;
      const targetDocument = desktop?.document;
      const button = targetDocument?.getElementById(${JSON.stringify(BUTTON_ID)});
      const text = targetDocument?.body?.innerText || '';
      return {
        pluginRegistered: Boolean(window.PLUGIN_LIST?.[${JSON.stringify(PLUGIN_NAME)}]?.default),
        panelRegistered: Boolean(window.MILLENNIUM_SIDEBAR_NAVIGATION_PANELS?.[${JSON.stringify(PLUGIN_NAME)}]),
        buttonExists: Boolean(button),
        buttonPlacement: button?.dataset?.placement || null,
        buttonTitle: button?.title || null,
        panelVisible: text.includes('Lua Games Backup'),
        googleLoginVisible: text.includes('Entrar com Google'),
        manualBridgeFieldsVisible: text.includes('Endereço da ponte') || text.includes('Token local da ponte'),
        oauthConfigurationVisible: text.includes('Configuração OAuth do aplicativo necessária'),
        millenniumKeys: Object.keys(window.Millennium || {}).sort(),
        millenniumGlobals: Object.keys(window).filter((key) => /millennium/i.test(key)).sort(),
      millenniumApiKeys: Object.keys(window.MILLENNIUM_API || {}).sort(),
        pluginSelf: window.MILLENNIUM_API?.pluginSelf || null,
        privateFfiKeys: Object.keys(window.MILLENNIUM_PRIVATE_INTERNAL_FOREIGN_FUNCTION_INTERFACE_DO_NOT_USE || {}).sort(),
        callableLocations: {
          api: typeof window.MILLENNIUM_API?.callable,
          private: typeof window.MILLENNIUM_PRIVATE_INTERNAL_FOREIGN_FUNCTION_INTERFACE_DO_NOT_USE?.callable,
          lowerPrivate: typeof window.__private_millennium_ffi_do_not_use__?.callable
        },
        callableSource: String(window.MILLENNIUM_API?.callable || '').slice(0, 1000),
        callServerMethodSource: String(window.Millennium?.callServerMethod || '').slice(0, 1000)
      };
    })()`,
    returnByValue: true
  });
  const result = inspect.result.value;

  const backendCheck = await client.send('Runtime.evaluate', {
    expression: `(async () => {
      const getStatus = window.MILLENNIUM_API.callable(${JSON.stringify(PLUGIN_NAME)}, 'get_status');
      const getCloudStatus = window.MILLENNIUM_API.callable(${JSON.stringify(PLUGIN_NAME)}, 'get_cloud_status');
      const getRoot = window.MILLENNIUM_API.callable(${JSON.stringify(PLUGIN_NAME)}, 'get_default_backup_root');
      const activityIds = window.MILLENNIUM_API.callable('lua_tools_activity', 'get_lua_tools_appids');
      let root = await getRoot({ request_json: '{}' });
      let value = await getStatus({ request_json: JSON.stringify({ root: '' }) });
      let activity = await activityIds({});
      let cloud = await getCloudStatus({ request_json: '{}' });
      for (let attempt = 0; attempt < 3 && typeof root === 'string'; attempt += 1) {
        try { root = JSON.parse(root); } catch { break; }
      }
      for (let attempt = 0; attempt < 3 && typeof value === 'string'; attempt += 1) {
        try { value = JSON.parse(value); } catch { break; }
      }
      for (let attempt = 0; attempt < 3 && typeof cloud === 'string'; attempt += 1) {
        try { cloud = JSON.parse(cloud); } catch { break; }
      }
      return {
        responded: Boolean(value),
        rawStatusType: typeof value,
        rawRootType: typeof root,
        activityResponded: typeof activity !== 'undefined',
        activityType: typeof activity,
        steamPath: value?.steam_path || null,
        backupRoot: value?.backup_root || root?.backup_root || null,
        luaFolderFound: value?.has_lua_folder ?? null,
        manifestFolderFound: value?.has_manifest_folder ?? null,
        cloud
      };
    })()`,
    awaitPromise: true,
    returnByValue: true
  });
  if (backendCheck.exceptionDetails) {
    throw new Error(backendCheck.exceptionDetails.exception?.description || backendCheck.exceptionDetails.text);
  }
  result.backend = backendCheck.result.value;

  if (process.argv.includes('--open')) {
    await client.send('Runtime.evaluate', {
      expression: `window.Millennium.openQuickAccess({ plugin: ${JSON.stringify(PLUGIN_NAME)} })`,
      awaitPromise: true
    });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const afterClick = await client.send('Runtime.evaluate', {
      expression: `(() => {
        const desktop = window.g_PopupManager?.GetExistingPopup?.('SP Desktop_uid0')?.m_popup?.window;
        const text = desktop?.document?.body?.innerText || '';
        return {
          panelVisible: text.includes('Lua Games Backup'),
          googleLoginVisible: text.includes('Entrar com Google')
        };
      })()`,
      returnByValue: true
    });
    Object.assign(result, afterClick.result.value);
  }

  if (process.argv.includes('--click-google')) {
    const clickResult = await client.send('Runtime.evaluate', {
      expression: `(() => {
        const doc = window.g_PopupManager?.GetExistingPopup?.('SP Desktop_uid0')?.m_popup?.window?.document;
        const button = Array.from(doc?.querySelectorAll('button') || []).find((element) => (element.textContent || '').trim() === 'Entrar com Google');
        if (!button) return { clicked: false, error: 'button_missing' };
        button.click();
        return { clicked: true, disabled: button.disabled };
      })()`,
      returnByValue: true
    });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const messageCheck = await client.send('Runtime.evaluate', {
      expression: `(() => {
        const doc = window.g_PopupManager?.GetExistingPopup?.('SP Desktop_uid0')?.m_popup?.window?.document;
        const text = doc?.body?.innerText || '';
        return {
          authorizationRequested: text.includes('Selecione sua conta e confirme a autorização na página do Google.'),
          steamPathError: text.includes('A pasta da Steam não foi encontrada.'),
          missingClientId: text.includes('falta adicionar o Client ID OAuth do aplicativo')
        };
      })()`,
      returnByValue: true
    });
    result.googleClick = Object.assign({}, clickResult.result.value, messageCheck.result.value);
    if (!result.googleClick.authorizationRequested || result.googleClick.steamPathError) process.exitCode = 1;
  }

  console.log(JSON.stringify(result, null, 2));
  if (!result.pluginRegistered || !result.panelRegistered || result.buttonExists) {
    process.exitCode = 1;
  }
} finally {
  client.close();
}
