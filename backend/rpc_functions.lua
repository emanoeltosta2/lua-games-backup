-- Compatibility layer for the Millennium 2.x RPC registry.
-- Millennium 3.4 only transports scalar FFI values reliably. Requests and
-- responses therefore cross the boundary as JSON strings.

local json = require("json")

local function decode_request(request_json)
    if type(request_json) ~= "string" or #request_json == 0 then return {} end
    local ok, value = pcall(json.decode, request_json)
    if not ok or type(value) ~= "table" then return {} end
    return value
end

local function encode_response(value)
    return json.encode(value)
end

---@ffi
function get_default_backup_root(_request_json)
    return encode_response({ backup_root = backup_get_default_backup_root() })
end

---@ffi
function get_status(request_json)
    return encode_response(backup_get_status(decode_request(request_json)))
end

---@ffi
function create_backup(request_json)
    return encode_response(backup_create_backup(decode_request(request_json)))
end

---@ffi
function restore_latest(request_json)
    return encode_response(backup_restore_latest(decode_request(request_json)))
end

---@ffi
function connect_google_drive(request_json)
    return encode_response(backup_connect_google_drive(decode_request(request_json)))
end

---@ffi
function get_cloud_status(_request_json)
    return encode_response(backup_get_cloud_status())
end

---@ffi
function cloud_backup(request_json)
    return encode_response(backup_cloud_backup(decode_request(request_json)))
end

---@ffi
function cloud_restore(request_json)
    return encode_response(backup_cloud_restore(decode_request(request_json)))
end
