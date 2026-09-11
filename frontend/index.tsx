import { definePlugin } from '@steambrew/client';
import React, { useEffect, useState } from 'react';

const PLUGIN_NAME = 'lua_games_backup';

type Result = { ok: boolean; message: string; details?: Record<string, number | string> };
type Status = {
  backup_root: string;
  latest_backup: string;
  has_lua_folder: boolean;
  has_manifest_folder: boolean;
  has_backup: boolean;
};
type CloudStatus = { ok: boolean; configured: boolean; connected: boolean; message?: string; sync_message?: string };

async function callBackend<T>(method: string, params: Record<string, string> = {}): Promise<T> {
  const callable = (window as any).MILLENNIUM_API?.callable;
  if (typeof callable !== 'function') throw new Error('Millennium callable API is unavailable');
  const response = await callable(PLUGIN_NAME, method)({ request_json: JSON.stringify(params) });
  if (typeof response !== 'string') return response as T;
  let parsed: unknown = response;
  for (let attempt = 0; attempt < 3 && typeof parsed === 'string'; attempt += 1) {
    try { parsed = JSON.parse(parsed); } catch { break; }
  }
  return parsed as T;
}

function removeLegacyLibraryButton() {
  const runtime = window as any;
  runtime.__LUA_GAMES_BACKUP_DESKTOP_OBSERVER__?.observer?.disconnect?.();
  delete runtime.__LUA_GAMES_BACKUP_DESKTOP_OBSERVER__;
  const targetDocument = runtime.g_PopupManager?.GetExistingPopup?.('SP Desktop_uid0')?.m_popup?.window?.document;
  targetDocument?.getElementById('lua-games-backup-library-button')?.remove();
  document.getElementById('lua-games-backup-library-button')?.remove();
}

function PluginContent() {
  const [root, setRoot] = useState('');
  const [cloudStatus, setCloudStatus] = useState<CloudStatus>();
  const [status, setStatus] = useState<Status>();
  const [message, setMessage] = useState('Preparando…');
  const [busy, setBusy] = useState(false);

  const refresh = async (chosenRoot = root) => {
    const next = await callBackend<Status>('get_status', { root: chosenRoot });
    setStatus(next);
    if (!root) setRoot(next.backup_root);
  };

  useEffect(() => { void refresh(); }, []);

  const refreshCloud = async () => {
    try { setCloudStatus(await callBackend<CloudStatus>('get_cloud_status')); }
    catch { setCloudStatus({ ok: false, configured: false, connected: false }); }
  };

  useEffect(() => {
    void refreshCloud();
    const timer = window.setInterval(() => void refreshCloud(), 4000);
    return () => window.clearInterval(timer);
  }, []);

  const localAction = async (method: 'create_backup' | 'restore_latest') => {
    setBusy(true);
    try {
      const result = await callBackend<Result>(method, { root });
      setMessage(result.message); await refresh(root);
    } catch { setMessage('Não foi possível concluir a operação local.'); }
    finally { setBusy(false); }
  };

  const cloudAction = async (method: 'connect_google_drive' | 'cloud_backup' | 'cloud_restore') => {
    setBusy(true);
    try {
      const result = await callBackend<Result>(method);
      setMessage(result.message);
      window.setTimeout(() => void refreshCloud(), 1200);
    } catch { setMessage('A ponte do Google Drive não respondeu. Verifique se ela está em execução.'); }
    finally { setBusy(false); }
  };

  const buttonStyle = { padding: '8px 12px', cursor: busy ? 'wait' : 'pointer' };
  const unavailableButtonStyle = { ...buttonStyle, opacity: 0.45, cursor: 'not-allowed' };
  const inputStyle = { width: '100%', boxSizing: 'border-box' as const, padding: 8 };
  const googleLogin = () => {
    if (!cloudStatus?.configured) {
      setMessage('O login do Google ainda não está disponível: falta adicionar o Client ID OAuth do aplicativo.');
      return;
    }
    void cloudAction('connect_google_drive');
  };
  return <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
    <div style={{ fontWeight: 600, fontSize: 16 }}>Lua Games Backup</div>
    <div style={{ opacity: 0.8 }}>Copia os arquivos LuaTools e os manifestos sem sobrescrever arquivos existentes durante uma restauração.</div>
    <label>Pasta de backup local (opcional)<input style={inputStyle} value={root} onChange={(event) => setRoot(event.target.value)} /></label>
    <div style={{ opacity: 0.8 }}>{status ? `${status.has_lua_folder ? 'LuaTools encontrado' : 'LuaTools não encontrado'} · ${status.has_manifest_folder ? 'manifestos encontrados' : 'manifestos não encontrados'}` : 'Lendo Steam…'}</div>
    <div style={{ display: 'flex', gap: 8 }}>
      <button style={buttonStyle} disabled={busy} onClick={() => void localAction('create_backup')}>Criar backup local</button>
      <button style={buttonStyle} disabled={busy || !status?.has_backup} onClick={() => void localAction('restore_latest')}>Restaurar backup local</button>
    </div>
    <hr style={{ width: '100%', opacity: 0.2 }} />
    <div style={{ fontWeight: 600 }}>Google Drive (opcional)</div>
    <div style={{ opacity: 0.8 }}>O login abre no navegador padrão. Selecione sua conta e autorize somente os dados privados deste aplicativo.</div>
    <div style={{ opacity: 0.85 }}>{cloudStatus?.connected ? 'Google Drive conectado' : cloudStatus?.configured ? 'Conta Google ainda não conectada' : 'Login indisponível: falta cadastrar o aplicativo no Google'}</div>
    {cloudStatus?.connected && <div style={{ opacity: 0.85 }}>{cloudStatus.sync_message || 'Sincronização automática iniciando…'}</div>}
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <button style={buttonStyle} disabled={busy} onClick={googleLogin}>{cloudStatus?.connected ? 'Trocar conta Google' : 'Entrar com Google'}</button>
      <button style={cloudStatus?.connected ? buttonStyle : unavailableButtonStyle} disabled={busy || !cloudStatus?.connected} onClick={() => void cloudAction('cloud_backup')}>Enviar ao Google Drive</button>
      <button style={cloudStatus?.connected ? buttonStyle : unavailableButtonStyle} disabled={busy || !cloudStatus?.connected} onClick={() => void cloudAction('cloud_restore')}>Restaurar do Google Drive</button>
    </div>
    <div style={{ opacity: 0.85 }}>{message}</div>
  </div>;
}

export default definePlugin(() => {
  removeLegacyLibraryButton();
  const panel = { title: 'Lua Games Backup', icon: <span>LB</span>, content: <PluginContent /> };
  // The Plugins page is hosted in Steam's desktop popup, rather than the
  // SharedJSContext that loads this module.  Make the renderer visible there
  // too, so Millennium enables its native Configure command.
  const registerConfigurationPanel = () => {
    const desktopWindow = (window as any).g_PopupManager?.GetExistingPopup?.('SP Desktop_uid0')?.m_popup?.window;
    if (!desktopWindow) return false;
    desktopWindow.MILLENNIUM_SIDEBAR_NAVIGATION_PANELS ||= {};
    desktopWindow.MILLENNIUM_SIDEBAR_NAVIGATION_PANELS[PLUGIN_NAME] = panel;
    const targetDocument = desktopWindow.document as Document;
    const previous = desktopWindow.__LUA_GAMES_BACKUP_CONFIG_TOOLTIP_GUARD__;
    const guardedEvents = ['mouseover', 'mouseenter', 'mousemove', 'pointerover', 'pointerenter', 'pointermove'];
    if (previous?.document !== targetDocument || previous?.version !== 4) {
      if (previous?.host && previous?.handler) {
        (previous.events || guardedEvents).forEach((type: string) =>
          previous.host.removeEventListener(type, previous.handler, true)
        );
      }
      previous?.observer?.disconnect?.();
      const guardState: { top: string | null; left: string | null; stabilizing: boolean } = {
        top: null, left: null, stabilizing: false
      };
      const stabilizeMenu = () => {
        if (guardState.stabilizing) return;
        const menu = Array.from(targetDocument.querySelectorAll<HTMLElement>('.contextMenu')).find((candidate) => {
          const labels = Array.from(candidate.querySelectorAll('[role="menuitem"]'));
          return labels[0]?.textContent?.trim() === 'Lua Games Backup';
        });
        if (!menu) return;
        if (menu.style.top !== '0px' || menu.style.left !== '0px') {
          guardState.top = menu.style.top;
          guardState.left = menu.style.left;
        } else if (guardState.top && guardState.left) {
          guardState.stabilizing = true;
          menu.style.top = guardState.top;
          menu.style.left = guardState.left;
          guardState.stabilizing = false;
        }
        const configure = Array.from(menu.querySelectorAll('[role="menuitem"]'))
          .find((item) => item.textContent?.trim() === 'Configure');
        const tooltip = configure?.parentElement?.querySelector<HTMLElement>('[popover="manual"]');
        tooltip?.style.setProperty('display', 'none', 'important');
      };
      const handler = (event: Event) => {
        const target = event.target as Element | null;
        // Steam attaches the tooltip listener to the wrapper around Configure,
        // so that wrapper can be the first hover event target.
        const tooltipSource = target?.closest?.('.tool-tip-source');
        const item = target?.closest?.('[role="menuitem"]')
          || tooltipSource?.querySelector?.('[role="menuitem"]');
        if (!item || item.textContent?.trim() !== 'Configure') return;
        const menu = (tooltipSource || item).closest('.contextMenu');
        const labels = menu ? Array.from(menu.querySelectorAll('[role="menuitem"]')) : [];
        if (labels[0]?.textContent?.trim() !== 'Lua Games Backup') return;
        event.stopImmediatePropagation();
      };
      guardedEvents.forEach((type) => desktopWindow.addEventListener(type, handler, true));
      const observer = new desktopWindow.MutationObserver(stabilizeMenu);
      observer.observe(targetDocument.documentElement, {
        subtree: true, childList: true, attributes: true, attributeFilter: ['style']
      });
      stabilizeMenu();
      desktopWindow.__LUA_GAMES_BACKUP_CONFIG_TOOLTIP_GUARD__ = {
        document: targetDocument, host: desktopWindow, handler, events: guardedEvents, observer, version: 4
      };
    }
    window.setTimeout(() => (window as any).MILLENNIUM_STEAM_FORCE_RERENDER?.(), 0);
    return true;
  };
  if (!registerConfigurationPanel()) {
    // The desktop popup can be created well after SharedJSContext during a
    // full Steam startup. This timer only exists for that initial registration.
    let remainingAttempts = 240;
    const registrationTimer = window.setInterval(() => {
      if (registerConfigurationPanel() || --remainingAttempts <= 0) window.clearInterval(registrationTimer);
    }, 250);
  }
  return panel;
});
