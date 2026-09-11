const MILLENNIUM_IS_CLIENT_MODULE = true;
const pluginName = "lua_games_backup";

(window.PLUGIN_LIST || (window.PLUGIN_LIST = {}))[pluginName] ||= {};
window.MILLENNIUM_SIDEBAR_NAVIGATION_PANELS ||= {};

let PluginEntryPointMain = function () {
    return function (exports) {
        "use strict";

        const React = window.SP_REACT;
        const h = React && React.createElement;

        function parseReply(value) {
            let parsed = value;
            for (let attempt = 0; attempt < 3 && typeof parsed === "string"; attempt += 1) {
                try {
                    parsed = JSON.parse(parsed);
                } catch (_) {
                    break;
                }
            }
            return parsed;
        }

        async function callBackend(methodName, params) {
            if (!window.MILLENNIUM_API || typeof window.MILLENNIUM_API.callable !== "function") {
                throw new Error("Millennium callable API is unavailable");
            }
            const method = window.MILLENNIUM_API.callable(pluginName, methodName);
            const result = await method({ request_json: JSON.stringify(params || {}) });
            return parseReply(result);
        }

        function removeLegacyLibraryButton() {
            try {
                const current = window.__LUA_GAMES_BACKUP_DESKTOP_OBSERVER__;
                if (current && current.observer) current.observer.disconnect();
                delete window.__LUA_GAMES_BACKUP_DESKTOP_OBSERVER__;

                const popup = window.g_PopupManager &&
                    window.g_PopupManager.GetExistingPopup("SP Desktop_uid0");
                const targetDocument = popup && popup.m_popup && popup.m_popup.window &&
                    popup.m_popup.window.document;
                const visibleButton = targetDocument &&
                    targetDocument.getElementById("lua-games-backup-library-button");
                const hiddenButton = document.getElementById("lua-games-backup-library-button");
                if (visibleButton) visibleButton.remove();
                if (hiddenButton) hiddenButton.remove();
            } catch (error) {
                console.warn("[LuaGamesBackup] could not remove the legacy library button", error);
            }
        }

        function Panel() {
            const [status, setStatus] = React.useState(null);
            const [backupRoot, setBackupRoot] = React.useState("");
            const [cloudStatus, setCloudStatus] = React.useState(null);
            const [message, setMessage] = React.useState("Verificando os arquivos do LuaTools...");
            const [busy, setBusy] = React.useState(false);

            const loadStatus = React.useCallback(async (root) => {
                try {
                    const result = await callBackend("get_status", { root: root || "" });
                    setStatus(result);
                    if (!root && result && result.backup_root) setBackupRoot(result.backup_root);
                    setMessage("Plugin carregado e pronto para uso.");
                } catch (error) {
                    console.error("[LuaGamesBackup] get_status failed", error);
                    setMessage("O painel abriu, mas o backend do plugin não respondeu.");
                }
            }, []);

            React.useEffect(() => {
                loadStatus("");
            }, [loadStatus]);

            const loadCloudStatus = React.useCallback(async function () {
                try {
                    setCloudStatus(await callBackend("get_cloud_status", {}));
                } catch (_) {
                    setCloudStatus({ ok: false, configured: false, connected: false });
                }
            }, []);

            React.useEffect(() => {
                loadCloudStatus();
                const timer = window.setInterval(loadCloudStatus, 4000);
                return function () { window.clearInterval(timer); };
            }, [loadCloudStatus]);

            async function runLocal(methodName) {
                setBusy(true);
                try {
                    const result = await callBackend(methodName, { root: backupRoot });
                    setMessage((result && result.message) || "Operação concluída.");
                    await loadStatus(backupRoot);
                } catch (error) {
                    console.error("[LuaGamesBackup] local action failed", error);
                    setMessage("Não foi possível concluir a operação local.");
                } finally {
                    setBusy(false);
                }
            }

            async function runCloud(methodName) {
                setBusy(true);
                try {
                    const result = await callBackend(methodName, {});
                    setMessage((result && result.message) || "Operação concluída.");
                    window.setTimeout(loadCloudStatus, 1200);
                } catch (error) {
                    console.error("[LuaGamesBackup] cloud action failed", error);
                    setMessage("A ponte segura do Google Drive não respondeu. Configure e inicie a ponte incluída no plugin.");
                } finally {
                    setBusy(false);
                }
            }

            const section = {
                background: "rgba(0, 0, 0, 0.18)",
                borderRadius: "8px",
                padding: "12px",
                display: "flex",
                flexDirection: "column",
                gap: "9px"
            };
            const input = {
                width: "100%",
                boxSizing: "border-box",
                padding: "8px 10px",
                marginTop: "4px",
                border: "1px solid rgba(255,255,255,.18)",
                borderRadius: "4px",
                color: "#fff",
                background: "rgba(0,0,0,.28)"
            };
            const button = {
                padding: "8px 12px",
                border: 0,
                borderRadius: "4px",
                color: "#fff",
                background: "#1a9fff",
                cursor: busy ? "wait" : "pointer"
            };
            const unavailableButton = Object.assign({}, button, {
                opacity: .45,
                cursor: "not-allowed"
            });

            function googleLogin() {
                if (!(cloudStatus && cloudStatus.configured)) {
                    setMessage("O login do Google ainda não está disponível: falta adicionar o Client ID OAuth do aplicativo.");
                    return;
                }
                runCloud("connect_google_drive");
            }

            return h("div", {
                style: { padding: "14px", display: "flex", flexDirection: "column", gap: "12px" }
            },
                h("div", { style: { fontSize: "18px", fontWeight: 700 } }, "Lua Games Backup"),
                h("div", { style: { opacity: .82, lineHeight: 1.45 } },
                    "Salve os arquivos adicionados pelo LuaTools e restaure-os depois de reinstalar a Steam."
                ),
                h("div", { style: section },
                    h("div", { style: { fontWeight: 700 } }, "Backup local"),
                    h("label", null, "Pasta do backup",
                        h("input", {
                            style: input,
                            value: backupRoot,
                            onChange: (event) => setBackupRoot(event.target.value)
                        })
                    ),
                    h("div", { style: { opacity: .78 } }, status
                        ? ((status.has_lua_folder ? "LuaTools encontrado" : "LuaTools não encontrado") +
                            " · " + (status.has_manifest_folder ? "manifestos encontrados" : "manifestos não encontrados"))
                        : "Lendo a instalação da Steam..."
                    ),
                    h("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap" } },
                        h("button", { style: button, disabled: busy, onClick: () => runLocal("create_backup") }, "Criar backup local"),
                        h("button", {
                            style: button,
                            disabled: busy || !(status && status.has_backup),
                            onClick: () => runLocal("restore_latest")
                        }, "Restaurar último backup")
                    )
                ),
                h("div", { style: section },
                    h("div", { style: { fontWeight: 700 } }, "Google Drive"),
                    h("div", { style: { opacity: .82, lineHeight: 1.45 } },
                        "O login abre no navegador padrão. Selecione sua conta e autorize somente os dados privados deste aplicativo."
                    ),
                    h("div", { style: { opacity: .85 } }, cloudStatus && cloudStatus.connected
                        ? "Google Drive conectado"
                        : cloudStatus && cloudStatus.configured
                            ? "Conta Google ainda não conectada"
                            : "Login indisponível: falta cadastrar o aplicativo no Google"
                    ),
                    cloudStatus && cloudStatus.connected && h("div", { style: { opacity: .85 } }, cloudStatus.sync_message || "Sincronização automática iniciando…"),
                    h("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap" } },
                        h("button", { style: button, disabled: busy, onClick: googleLogin }, cloudStatus && cloudStatus.connected ? "Trocar conta Google" : "Entrar com Google"),
                        h("button", { style: cloudStatus && cloudStatus.connected ? button : unavailableButton, disabled: busy || !(cloudStatus && cloudStatus.connected), onClick: () => runCloud("cloud_backup") }, "Enviar backup"),
                        h("button", { style: cloudStatus && cloudStatus.connected ? button : unavailableButton, disabled: busy || !(cloudStatus && cloudStatus.connected), onClick: () => runCloud("cloud_restore") }, "Restaurar da nuvem")
                    )
                ),
                h("div", {
                    style: { padding: "10px", borderRadius: "5px", background: "rgba(26,159,255,.12)", lineHeight: 1.4 }
                }, message)
            );
        }

        exports.default = async function () {
            console.log("[LuaGamesBackup] frontend loaded");
            if (!React || !h) throw new Error("Steam React runtime is unavailable");

            removeLegacyLibraryButton();

            return {
                title: "Lua Games Backup",
                icon: h("span", { style: { fontWeight: 700 } }, "LB"),
                content: h(Panel)
            };
        };

        Object.defineProperty(exports, "__esModule", { value: true });
        return exports;
    }({});
};

function ExecutePluginModule() {
    Promise.resolve().then(async function () {
        const moduleExports = PluginEntryPointMain();
        Object.assign(window.PLUGIN_LIST[pluginName], moduleExports, {
            __millennium_internal_plugin_name_do_not_use_or_change__: pluginName
        });

        const panel = await moduleExports.default();
        if (panel && panel.title !== undefined && panel.icon !== undefined && panel.content !== undefined) {
            const installConfigureTooltipGuard = (desktopWindow) => {
                const targetDocument = desktopWindow?.document;
                if (!targetDocument) return;

                const previous = desktopWindow.__LUA_GAMES_BACKUP_CONFIG_TOOLTIP_GUARD__;
                const guardedEvents = [
                    "mouseover", "mouseenter", "mousemove",
                    "pointerover", "pointerenter", "pointermove"
                ];
                if (previous?.document === targetDocument && previous?.version === 4) return;
                if (previous?.host && previous?.handler) {
                    (previous.events || guardedEvents).forEach((type) =>
                        previous.host.removeEventListener(type, previous.handler, true)
                    );
                }
                previous?.observer?.disconnect?.();

                const guardState = { top: null, left: null, stabilizing: false };
                const stabilizeMenu = () => {
                    if (guardState.stabilizing) return;
                    const menus = Array.from(targetDocument.querySelectorAll(".contextMenu"));
                    const menu = menus.find((candidate) => {
                        const labels = Array.from(candidate.querySelectorAll('[role="menuitem"]'));
                        return labels[0]?.textContent?.trim() === "Lua Games Backup";
                    });
                    if (!menu) return;

                    const top = menu.style.top;
                    const left = menu.style.left;
                    if (top !== "0px" || left !== "0px") {
                        guardState.top = top;
                        guardState.left = left;
                    } else if (guardState.top && guardState.left) {
                        guardState.stabilizing = true;
                        menu.style.top = guardState.top;
                        menu.style.left = guardState.left;
                        guardState.stabilizing = false;
                    }

                    const configure = Array.from(menu.querySelectorAll('[role="menuitem"]'))
                        .find((item) => item.textContent?.trim() === "Configure");
                    const tooltip = configure?.parentElement?.querySelector?.('[popover="manual"]');
                    if (tooltip) tooltip.style.setProperty("display", "none", "important");
                };

                // Millennium 2.x wraps Configure in an active tooltip even
                // when the item is enabled. Opening that tooltip also resets
                // the menu coordinates to (0, 0). Stop only the hover event
                // for this plugin's Configure item; click remains untouched.
                const handler = (event) => {
                    // The tooltip listener belongs to the wrapper, so the
                    // wrapper itself can be the first hover event target.
                    const tooltipSource = event.target?.closest?.(".tool-tip-source");
                    const item = event.target?.closest?.('[role="menuitem"]')
                        || tooltipSource?.querySelector?.('[role="menuitem"]');
                    if (!item || item.textContent?.trim() !== "Configure") return;
                    const menu = (tooltipSource || item).closest?.(".contextMenu");
                    if (!menu) return;
                    const labels = Array.from(menu.querySelectorAll('[role="menuitem"]'));
                    if (labels[0]?.textContent?.trim() !== "Lua Games Backup") return;
                    event.stopImmediatePropagation();
                };

                // React already has a delegated listener on document. Install
                // this on window so capture runs before that listener and the
                // broken tooltip never has a chance to schedule itself.
                guardedEvents.forEach((type) =>
                    desktopWindow.addEventListener(type, handler, true)
                );
                const observer = new desktopWindow.MutationObserver(stabilizeMenu);
                observer.observe(targetDocument.documentElement, {
                    subtree: true,
                    childList: true,
                    attributes: true,
                    attributeFilter: ["style"]
                });
                stabilizeMenu();
                desktopWindow.__LUA_GAMES_BACKUP_CONFIG_TOOLTIP_GUARD__ = {
                    document: targetDocument,
                    host: desktopWindow,
                    handler,
                    events: guardedEvents,
                    observer,
                    version: 4
                };
            };
            // Millennium's Plugins page runs inside the Steam desktop popup, a
            // different window from SharedJSContext.  Register in both places:
            // otherwise Millennium marks this plugin as "not configurable".
            // Hovering that disabled entry triggers a Steam tooltip bug which
            // resets the context menu position to the upper-left corner.
            const registerConfigurationPanel = () => {
                window.MILLENNIUM_SIDEBAR_NAVIGATION_PANELS[pluginName] = panel;
                const desktopWindow = window.g_PopupManager
                    ?.GetExistingPopup?.("SP Desktop_uid0")?.m_popup?.window;
                if (!desktopWindow) return false;
                desktopWindow.MILLENNIUM_SIDEBAR_NAVIGATION_PANELS ||= {};
                desktopWindow.MILLENNIUM_SIDEBAR_NAVIGATION_PANELS[pluginName] = panel;
                installConfigureTooltipGuard(desktopWindow);
                // Refresh the already-mounted Plugins page so it re-evaluates
                // the renderer registry after a plugin restart.
                window.setTimeout(() => window.MILLENNIUM_STEAM_FORCE_RERENDER?.(), 0);
                return true;
            };
            // At a full Steam startup SharedJSContext is created before the
            // desktop popup. Retry only during startup, then stop immediately.
            if (!registerConfigurationPanel()) {
                // Steam can take longer than ten seconds to create the desktop
                // popup after SharedJSContext has loaded. This is not sync work:
                // it is a temporary startup-only registration attempt.
                let remainingAttempts = 240;
                const registrationTimer = window.setInterval(() => {
                    if (registerConfigurationPanel() || --remainingAttempts <= 0) {
                        window.clearInterval(registrationTimer);
                    }
                }, 250);
            }
            await window.MILLENNIUM_BACKEND_IPC.postMessage(1, { pluginName: pluginName });
            console.log("[LuaGamesBackup] Quick Access panel registered");
        } else {
            console.warn("[LuaGamesBackup] invalid Quick Access panel");
        }
    }).catch(function (error) {
        console.error("[LuaGamesBackup] frontend initialization failed", error);
    });
}

ExecutePluginModule();
