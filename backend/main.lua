-- LuaTools Manifest Backup
-- This plugin never downloads content or changes Steam files automatically.

local fs = require("fs")
local logger = require("logger")
local millennium = require("millennium")
local http = require("http")
local json = require("json")

local function default_backup_root()
    local profile = os.getenv("USERPROFILE") or os.getenv("HOME") or "."
    return fs.join(profile, "Documents", "LuaToolsManifestBackup")
end

local function steam_paths()
    local steam = millennium.steam_path()
    return {
        lua = fs.join(steam, "config", "stplug-in"),
        manifests = fs.join(steam, "depotcache"),
    }
end

local function is_safe_root(path)
    return type(path) == "string" and #path > 3 and not path:find("%.%.[\\/]")
end

local function ensure_directory(path)
    if fs.exists(path) then return true end
    local ok, err = fs.create_directories(path)
    if not ok then return nil, err end
    return true
end

local function copy_extension(source, destination, extension, skip_existing)
    local copied, skipped, errors = 0, 0, {}
    if not fs.is_directory(source) then return copied, skipped, errors end

    local entries, err = fs.list(source)
    if not entries then return copied, skipped, { err } end

    for _, entry in ipairs(entries) do
        if entry.is_file and fs.extension(entry.name):lower() == extension then
            local target = fs.join(destination, entry.name)
            if skip_existing and fs.exists(target) then
                skipped = skipped + 1
            else
                local ok, copy_err = fs.copy(entry.path, target, false)
                if ok then copied = copied + 1 else table.insert(errors, copy_err or entry.name) end
            end
        end
    end
    return copied, skipped, errors
end

local function latest_revision(root)
    local revisions = fs.join(root, "revisions")
    if not fs.is_directory(revisions) then return nil end
    local entries = fs.list(revisions)
    if not entries then return nil end
    local latest = nil
    for _, entry in ipairs(entries) do
        if entry.is_directory and (not latest or entry.name > latest.name) then latest = entry end
    end
    return latest and latest.path or nil
end

local function result(ok, message, details)
    return { ok = ok, message = message, details = details or {} }
end

local function parameter(value, name)
    if type(value) == "table" then return value[name] end
    return value
end

local function current_plugin_directory()
    if not debug or not debug.getinfo then return nil end
    local ok, info = pcall(debug.getinfo, 1, "S")
    local source = ok and info and tostring(info.source or "") or ""
    source = source:gsub("^@", ""):gsub("/", "\\")
    return source:match("^(.*)\\backend\\[^\\]+$")
end

local function read_text(path)
    local file = io.open(path, "rb")
    if not file then return nil end
    local content = file:read("*a")
    file:close()
    return content
end

local function referenced_manifest_names(lua_directory)
    local selected = {}
    for _, entry in ipairs(fs.list(lua_directory) or {}) do
        if entry.is_file and fs.extension(entry.name):lower() == ".lua" then
            local content = (read_text(entry.path) or ""):lower()
            for depot, manifest in content:gmatch("setmanifestid%s*%(%s*(%d+)%s*,%s*['\"](%d+)['\"]") do
                selected[depot .. "_" .. manifest .. ".manifest"] = true
            end
        end
    end
    return selected
end

local function copy_named_files(source, destination, names, skip_existing)
    local copied, skipped, errors = 0, 0, {}
    for name in pairs(names) do
        local source_file, target = fs.join(source, name), fs.join(destination, name)
        if not fs.exists(source_file) then
            table.insert(errors, "Manifesto necessário não encontrado: " .. name)
        elseif skip_existing and fs.exists(target) then
            skipped = skipped + 1
        else
            local ok, copy_err = fs.copy(source_file, target, false)
            if ok then copied = copied + 1 else table.insert(errors, copy_err or name) end
        end
    end
    return copied, skipped, errors
end

local function bridge_files()
    local plugin = current_plugin_directory()
    if plugin then
        local directory = fs.join(plugin, "google-drive-bridge")
        local executable = fs.join(directory, "LuaGamesBackup.GoogleDrive.exe")
        if fs.exists(executable) then
            return executable, fs.join(directory, "data", "bridge-session.json")
        end
    end

    -- Alguns runtimes do Millennium ocultam o caminho do arquivo Lua em debug.
    -- Localizamos o diretório pelo manifesto, sem depender do nome da pasta.
    local plugins = fs.join(millennium.steam_path(), "millennium", "plugins")
    -- O pacote oficial usa este nome de pasta; a busca pelo manifesto abaixo
    -- continua cobrindo instalações que tenham sido renomeadas.
    local default_bridge = fs.join(plugins, "lua-games-backup", "google-drive-bridge")
    local default_executable = fs.join(default_bridge, "LuaGamesBackup.GoogleDrive.exe")
    if fs.exists(default_executable) then
        return default_executable, fs.join(default_bridge, "data", "bridge-session.json")
    end
    for _, entry in ipairs(fs.list(plugins) or {}) do
        if not entry.is_file then
            local directory = entry.path or fs.join(plugins, tostring(entry.name or ""))
            local manifest = read_text(fs.join(directory, "plugin.json")) or ""
            if manifest:match('"name"%s*:%s*"lua_games_backup"') then
                local bridge = fs.join(directory, "google-drive-bridge")
                local executable = fs.join(bridge, "LuaGamesBackup.GoogleDrive.exe")
                if fs.exists(executable) then
                    return executable, fs.join(bridge, "data", "bridge-session.json")
                end
            end
        end
    end
    return nil, nil
end

local function start_bridge()
    local executable = bridge_files()
    if not executable or not fs.exists(executable) then return false end
    local ok, started = pcall(function()
        local ffi = require("ffi")
        ffi.cdef[[
            int MultiByteToWideChar(unsigned int, unsigned long, const char*, int, unsigned short*, int);
            void* ShellExecuteW(void*, const unsigned short*, const unsigned short*, const unsigned short*, const unsigned short*, int);
        ]]
        local kernel = ffi.load("kernel32")
        local shell = ffi.load("shell32")
        local size = kernel.MultiByteToWideChar(65001, 0, executable, -1, nil, 0)
        if size <= 0 then return false end
        local path = ffi.new("unsigned short[?]", size)
        kernel.MultiByteToWideChar(65001, 0, executable, -1, path, size)
        return tonumber(ffi.cast("intptr_t", shell.ShellExecuteW(nil, nil, path, nil, nil, 0))) > 32
    end)
    return ok and started == true
end


local function bridge_connection()
    local _, session_path = bridge_files()
    if not session_path then return nil, "O serviço seguro do Google Drive não foi encontrado." end
    local function read_session()
        local file = io.open(session_path, "rb")
        if not file then return nil end
        local content = file:read("*a")
        file:close()
        local ok, value = pcall(json.decode, content)
        if not ok or type(value) ~= "table" or type(value.token) ~= "string" or not value.port then return nil end
        return { url = "http://127.0.0.1:" .. tostring(value.port), token = value.token }
    end
    local connection = read_session()
    if connection then return connection end
    start_bridge()
    local deadline = os.clock() + 1.0
    repeat connection = read_session() until connection or os.clock() >= deadline
    if not connection then return nil, "O serviço seguro do Google Drive não iniciou." end
    return connection
end

---@ffi
function backup_get_default_backup_root()
    return default_backup_root()
end

---@ffi
function backup_get_status(root)
    root = parameter(root, "root")
    root = (type(root) == "string" and #root > 0) and root or default_backup_root()
    local paths = steam_paths()
    local latest = latest_revision(root)
    return {
        steam_path = millennium.steam_path(),
        lua_folder = paths.lua,
        manifest_folder = paths.manifests,
        backup_root = root,
        latest_backup = latest or "",
        has_lua_folder = fs.is_directory(paths.lua),
        has_manifest_folder = fs.is_directory(paths.manifests),
        has_backup = latest ~= nil,
    }
end

---@ffi
function backup_create_backup(root)
    root = parameter(root, "root")
    root = (type(root) == "string" and #root > 0) and root or default_backup_root()
    if not is_safe_root(root) then return result(false, "Escolha uma pasta de backup válida.") end

    local paths = steam_paths()
    local stamp = os.date("!%Y-%m-%dT%H-%M-%SZ")
    local revision = fs.join(root, "revisions", stamp)
    local lua_destination = fs.join(revision, "stplug-in")
    local manifest_destination = fs.join(revision, "depotcache")

    local ok, err = ensure_directory(lua_destination)
    if not ok then return result(false, "Não foi possível criar a pasta de backup: " .. tostring(err)) end
    ok, err = ensure_directory(manifest_destination)
    if not ok then return result(false, "Não foi possível criar a pasta de backup: " .. tostring(err)) end

    local lua_count, _, lua_errors = copy_extension(paths.lua, lua_destination, ".lua", false)
    local manifest_count, _, manifest_errors = copy_named_files(paths.manifests, manifest_destination, referenced_manifest_names(paths.lua), false)
    local errors = #lua_errors + #manifest_errors
    local metadata = io.open(fs.join(revision, "README.txt"), "w")
    if metadata then
        metadata:write("LuaTools Manifest Backup\nCreated: " .. stamp .. "\nLua files: " .. lua_count .. "\nManifest files: " .. manifest_count .. "\n")
        metadata:close()
    end
    if errors > 0 then
        return result(false, "Backup concluído parcialmente; alguns arquivos não puderam ser copiados.", { revision = revision, lua = lua_count, manifests = manifest_count, errors = errors })
    end
    return result(true, "Backup criado. Guarde esta pasta em outra unidade ou nuvem antes de formatar.", { revision = revision, lua = lua_count, manifests = manifest_count })
end

---@ffi
function backup_restore_latest(root)
    root = parameter(root, "root")
    root = (type(root) == "string" and #root > 0) and root or default_backup_root()
    local revision = latest_revision(root)
    if not revision then return result(false, "Nenhum backup encontrado nesta pasta.") end

    local paths = steam_paths()
    local ok, err = ensure_directory(paths.lua)
    if not ok then return result(false, "Não foi possível preparar a pasta Lua: " .. tostring(err)) end
    ok, err = ensure_directory(paths.manifests)
    if not ok then return result(false, "Não foi possível preparar a pasta de manifestos: " .. tostring(err)) end

    local lua_count, lua_skipped, lua_errors = copy_extension(fs.join(revision, "stplug-in"), paths.lua, ".lua", true)
    local manifest_count, manifest_skipped, manifest_errors = copy_extension(fs.join(revision, "depotcache"), paths.manifests, ".manifest", true)
    local errors = #lua_errors + #manifest_errors
    if errors > 0 then
        return result(false, "Restauração concluída parcialmente. Nenhum arquivo existente foi sobrescrito.", { lua = lua_count, manifests = manifest_count, skipped = lua_skipped + manifest_skipped, errors = errors })
    end
    return result(true, "Restauração concluída. Reinicie o Steam para ele recarregar os arquivos.", { lua = lua_count, manifests = manifest_count, skipped = lua_skipped + manifest_skipped })
end

local function bridge_request(path, payload)
    local connection, connection_error = bridge_connection()
    if not connection then return nil, connection_error end
    local function send(current)
        -- Use the generic entry point: the native post wrapper in Millennium
        -- 3.4 reads the wrong Lua stack argument and drops method/body/headers.
        return http.request(current.url .. path, {
            method = "POST",
            data = json.encode(payload or {}),
            headers = { ["Content-Type"] = "application/json", ["X-LuaTools-Bridge-Token"] = current.token },
            timeout = 60,
        })
    end
    local response, err = send(connection)
    if not response then
        start_bridge()
        local deadline = os.clock() + 0.8
        repeat until os.clock() >= deadline
        connection = bridge_connection()
        if connection then response, err = send(connection) end
    end
    if not response then return nil, err end
    local decoded = json.decode(response.body)
    if response.status < 200 or response.status >= 300 then
        return nil, (decoded and decoded.error) or ("A ponte respondeu com HTTP " .. tostring(response.status))
    end
    return decoded
end

---@ffi
function backup_connect_google_drive(params)
    local response, err = bridge_request("/connect", {})
    if not response then return result(false, err) end
    return result(true, response.message or "O navegador padrão foi aberto para você autorizar o Google Drive.")
end

---@ffi
function backup_get_cloud_status()
    local response, err = bridge_request("/status", {})
    if not response then return { ok = false, configured = false, connected = false, message = err } end
    return { ok = true, configured = response.configured == true, connected = response.connected == true, sync_message = response.sync_message }
end

---@ffi
function backup_cloud_backup(params)
    local response, err = bridge_request("/v1/backup", { steam_path = millennium.steam_path() })
    if not response then return result(false, err) end
    return result(true, response.message or "Backup enviado ao Google Drive.", response.details)
end

---@ffi
function backup_cloud_restore(params)
    local response, err = bridge_request("/v1/restore", { steam_path = millennium.steam_path() })
    if not response then return result(false, err) end
    return result(true, response.message or "Backup restaurado do Google Drive.", response.details)
end

-- Millennium 2.x discovers frontend-callable methods from this module.
require("rpc_functions")

local function on_load()
    logger:info("LuaTools Manifest Backup carregado")
    millennium.ready()
    -- Native hidden launch: no terminal and no need to open Configure.
    start_bridge()
    -- One background check per Steam process, even when the bridge is already running.
    bridge_request("/startup", {})
end

return { on_load = on_load }
