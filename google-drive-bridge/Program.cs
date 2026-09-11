using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

internal sealed class BridgeConfig
{
    public string clientId { get; set; }
    public string brokerUrl { get; set; }
    public int port { get; set; }
}

internal sealed class BrokerResponse
{
    public bool ok { get; set; }
    public OAuthToken token { get; set; }
    public string error { get; set; }
}

internal sealed class OAuthToken
{
    public string access_token { get; set; }
    public string refresh_token { get; set; }
    public int expires_in { get; set; }
    public long expires_at { get; set; }
}

internal sealed class LocalRequest
{
    public string Method;
    public Uri Url;
    public string Body;
    public Dictionary<string, string> Headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
}

internal static class Program
{
    private const string Scope = "https://www.googleapis.com/auth/drive.appdata";
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    private static readonly HttpClient Http = new HttpClient();
    private static readonly string DataDirectory = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "data");
    private static readonly string SessionPath = Path.Combine(DataDirectory, "bridge-session.json");
    private static readonly string TokenPath = Path.Combine(DataDirectory, "google-token.dat");
    private static BridgeConfig Config;
    private static string BridgeToken;
    private static string RedirectUri;
    private static string PendingState;
    private static string PendingVerifier;
    private static readonly SemaphoreSlim SyncGate = new SemaphoreSlim(1, 1);
    private static volatile string SyncMessage = "Aguardando conexão com Google.";
    private static string SteamDirectory;
    private static Task SyncWorker;
    private static readonly object StartupLock = new object();
    private static string LastSteamSession;

    private static string[] ReferencedManifests(string luaFolder, string manifestFolder)
    {
        var selected = new SortedSet<string>(StringComparer.OrdinalIgnoreCase);
        if (!Directory.Exists(luaFolder)) throw new IOException("A pasta de arquivos Lua não foi encontrada.");
        var pattern = new Regex(@"setManifestid\s*\(\s*(\d+)\s*,\s*['""](\d+)['""]", RegexOptions.IgnoreCase);
        foreach (string lua in Directory.GetFiles(luaFolder, "*.lua"))
            foreach (Match match in pattern.Matches(File.ReadAllText(lua)))
                selected.Add(match.Groups[1].Value + "_" + match.Groups[2].Value + ".manifest");

        var paths = new List<string>();
        foreach (string name in selected)
        {
            string path = Path.Combine(manifestFolder, name);
            if (!File.Exists(path)) throw new IOException("O manifesto necessário " + name + " não foi encontrado no depotcache.");
            paths.Add(path);
        }
        return paths.ToArray();
    }

    // Hash contents, not timestamps. Only manifests explicitly referenced by
    // setManifestid in the Lua files belong to LuaTools games.
    private static string Fingerprint(string steam)
    {
        var entries = new List<string>();
        string luaFolder = Path.Combine(steam, "config", "stplug-in");
        string manifestFolder = Path.Combine(steam, "depotcache");
        string[] lua = Directory.Exists(luaFolder) ? Directory.GetFiles(luaFolder, "*.lua") : new string[0];
        string[] manifests = ReferencedManifests(luaFolder, manifestFolder);
        foreach (string file in lua.Concat(manifests).OrderBy(path => path, StringComparer.OrdinalIgnoreCase))
        {
            string relative = file.StartsWith(luaFolder, StringComparison.OrdinalIgnoreCase) ? "config/stplug-in" : "depotcache";
            using (var sha = SHA256.Create())
            using (var input = File.Open(file, FileMode.Open, FileAccess.Read, FileShare.Read))
                entries.Add(relative + "/" + Path.GetFileName(file) + ":" + Base64Url(sha.ComputeHash(input)));
        }
        using (var sha = SHA256.Create()) return Base64Url(sha.ComputeHash(Encoding.UTF8.GetBytes(String.Join("\n", entries))));
    }

    private static string BaselinePath()
    {
        OAuthToken token = LoadToken();
        if (token == null) throw new InvalidOperationException("Conecte a conta Google.");
        using (var sha = SHA256.Create())
            return Path.Combine(DataDirectory, "sync-" + Base64Url(sha.ComputeHash(Encoding.UTF8.GetBytes(token.refresh_token))) + ".txt");
    }

    private static async Task AutoSync()
    {
            if (!IsConfigured() || LoadToken() == null) { SyncMessage = "Conecte o Google e reinicie a Steam ou use Enviar backup."; return; }
            await SyncGate.WaitAsync();
            try
            {
                if (SteamDirectory == null) throw new IOException("Não foi possível localizar a Steam para sincronizar.");
                // Even a surviving local baseline must not publish an empty installation.
                string luaFolder = Path.Combine(SteamDirectory, "config", "stplug-in");
                if (!Directory.Exists(luaFolder) || Directory.GetFiles(luaFolder, "*.lua").Length == 0)
                { SyncMessage = "Nenhum jogo Lua encontrado. Backup da nuvem preservado; use Restaurar da nuvem."; return; }
                string current = Fingerprint(SteamDirectory);
                string baseline = BaselinePath();
                if (File.Exists(baseline) && File.ReadAllText(baseline) == current)
                {
                    Dictionary<string, int> cleanup = await CleanupCurrentBackups();
                    SyncMessage = cleanup["failed"] == 0
                        ? "Verificação concluída. Backup atual confirmado; versões antigas removidas."
                        : "Backup atual confirmado, mas algumas versões antigas não puderam ser removidas.";
                    return;
                }
                if (!File.Exists(baseline))
                {
                    string root = await RootFolder();
                    var previous = await ListFiles("'" + root + "' in parents and trashed=false");
                    if (previous.Exists(item => IsSnapshot(item)))
                    { SyncMessage = "Já existe backup na nuvem. Restaure-o ou clique em Enviar backup para usar os arquivos deste computador."; return; }
                }
                SyncMessage = "Sincronizando arquivos com Google Drive…";
                await Backup(SteamDirectory);
                SyncMessage = "Backup atualizado na inicialização. Próxima verificação ao reiniciar a Steam.";
            }
            catch (Exception error) { SyncMessage = "Sincronização pendente: " + error.Message + " Use Enviar backup ou reinicie a Steam para tentar novamente."; }
            finally { SyncGate.Release(); }
    }

    private static void SyncOnSteamStartup()
    {
        // The bridge survives Steam restarts. Deduplicate by actual Steam session,
        // not bridge lifetime or opening the settings panel.
        foreach (Process process in Process.GetProcessesByName("steam"))
        using (process)
        {
            if (SteamDirectory == null || !String.Equals(Path.GetDirectoryName(process.MainModule.FileName), SteamDirectory, StringComparison.OrdinalIgnoreCase)) continue;
            string session = process.Id + ":" + process.StartTime.ToUniversalTime().Ticks;
            lock (StartupLock)
            {
                if (LastSteamSession == session) return;
                LastSteamSession = session;
                SyncWorker = Task.Run(() => AutoSync());
            }
            return;
        }
    }

    private static bool IsSnapshot(Dictionary<string, object> item)
    {
        return Convert.ToString(item["mimeType"]) == "application/vnd.google-apps.folder"
            && !Convert.ToString(item["name"]).StartsWith("pending-", StringComparison.Ordinal);
    }

    private static async Task<Dictionary<string, int>> CleanupOlderSnapshots(string root, string keepId)
    {
        int removed = 0, failed = 0;
        List<Dictionary<string, object>> children = await ListFiles("'" + root + "' in parents and trashed=false");
        foreach (Dictionary<string, object> item in children)
        {
            string id = Convert.ToString(item["id"]);
            string name = Convert.ToString(item["name"]);
            bool managed = IsSnapshot(item) || (Convert.ToString(item["mimeType"]) == "application/vnd.google-apps.folder"
                && name.StartsWith("pending-", StringComparison.Ordinal));
            if (!managed || id == keepId) continue;
            try
            {
                using (await Drive("https://www.googleapis.com/drive/v3/files/" + id, HttpMethod.Delete)) { }
                removed++;
            }
            catch { failed++; }
        }
        return new Dictionary<string, int> { { "removed", removed }, { "failed", failed } };
    }

    private static async Task<Dictionary<string, int>> CleanupCurrentBackups()
    {
        string root = await RootFolder();
        List<Dictionary<string, object>> snapshots = await ListFiles("'" + root + "' in parents and trashed=false");
        snapshots.RemoveAll(item => !IsSnapshot(item));
        snapshots.Sort((left, right) => String.Compare(Convert.ToString(right["name"]), Convert.ToString(left["name"]), StringComparison.Ordinal));
        if (snapshots.Count == 0) return new Dictionary<string, int> { { "removed", 0 }, { "failed", 0 } };
        return await CleanupOlderSnapshots(root, Convert.ToString(snapshots[0]["id"]));
    }

    [STAThread]
    private static void Main()
    {
        ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
        bool first;
        using (var mutex = new Mutex(true, "Local\\LuaGamesBackupGoogleDriveBridge", out first))
        {
            if (!first) return;
            try { Run().GetAwaiter().GetResult(); }
            catch (Exception error)
            {
                Directory.CreateDirectory(DataDirectory);
                File.WriteAllText(Path.Combine(DataDirectory, "bridge-error.log"), error.ToString());
            }
        }
    }

    private static async Task Run()
    {
        string executableDirectory = AppDomain.CurrentDomain.BaseDirectory;
        string configPath = Path.Combine(executableDirectory, "oauth-client.json");
        Config = File.Exists(configPath)
            ? Json.Deserialize<BridgeConfig>(File.ReadAllText(configPath))
            : new BridgeConfig();
        if (Config.port <= 0) Config.port = 37462;
        RedirectUri = "http://127.0.0.1:" + Config.port + "/oauth/callback";
        BridgeToken = RandomUrlSafe(48);

        Directory.CreateDirectory(DataDirectory);
        for (DirectoryInfo dir = new DirectoryInfo(executableDirectory); dir != null; dir = dir.Parent)
            if (File.Exists(Path.Combine(dir.FullName, "steam.exe"))) { SteamDirectory = dir.FullName; break; }
        // Reserve the loopback port before replacing the session file. If an
        // instance is already alive, it remains the owner of its own token.
        var listener = new TcpListener(IPAddress.Loopback, Config.port);
        listener.Start();
        File.WriteAllText(SessionPath, Json.Serialize(new Dictionary<string, object>
        {
            { "port", Config.port },
            { "token", BridgeToken },
            { "pid", Process.GetCurrentProcess().Id }
        }));

        while (true)
        {
            TcpClient client = await listener.AcceptTcpClientAsync();
            Task.Run(() => Handle(client));
        }
    }

    private static async Task Handle(TcpClient client)
    {
        using (client)
        {
            NetworkStream stream = client.GetStream();
            try
            {
                LocalRequest request = ReadRequest(stream);
                string path = request.Url.AbsolutePath;
                if (path == "/oauth/callback")
                {
                    try
                    {
                        await SyncGate.WaitAsync();
                        try { await OAuthCallback(request, stream); }
                        finally { SyncGate.Release(); }
                    }
                    catch (Exception error)
                    {
                        WriteHtml(stream, "<h2>Não foi possível conectar ao Google Drive</h2><p>"
                            + WebUtility.HtmlEncode(error.Message)
                            + "</p><p>Volte à Steam e clique em Entrar com Google para tentar novamente.</p>");
                    }
                    return;
                }
                string suppliedToken;
                request.Headers.TryGetValue("X-LuaTools-Bridge-Token", out suppliedToken);
                if (String.IsNullOrEmpty(suppliedToken))
                {
                    Dictionary<string, string> query = ParseQuery(request.Url.Query);
                    query.TryGetValue("bridge_token", out suppliedToken);
                }
                if (!SecureEquals(suppliedToken, BridgeToken))
                {
                    WriteJson(stream, 401, new { error = "Acesso local não autorizado." });
                    return;
                }
                if (path == "/status")
                {
                    bool configured = IsConfigured();
                    WriteJson(stream, 200, new { configured = configured, connected = configured && LoadToken() != null, sync_message = SyncMessage });
                    return;
                }
                if (path == "/startup" && request.Method == "POST")
                {
                    SyncOnSteamStartup();
                    WriteJson(stream, 200, new { message = "Verificação de inicialização solicitada." });
                    return;
                }
                if (path == "/connect" && request.Method == "POST")
                {
                    if (!IsConfigured()) throw new InvalidOperationException("O Client ID OAuth do aplicativo ainda não foi configurado.");
                    PendingVerifier = RandomUrlSafe(64);
                    PendingState = RandomUrlSafe(32);
                    string challenge;
                    using (var sha = SHA256.Create()) challenge = Base64Url(sha.ComputeHash(Encoding.ASCII.GetBytes(PendingVerifier)));
                    string authorizationUrl = "https://accounts.google.com/o/oauth2/v2/auth?" + Form(new Dictionary<string, string>
                    {
                        { "client_id", Config.clientId },
                        { "redirect_uri", RedirectUri },
                        { "response_type", "code" },
                        { "scope", Scope },
                        { "access_type", "offline" },
                        { "prompt", "consent" },
                        { "code_challenge", challenge },
                        { "code_challenge_method", "S256" },
                        { "state", PendingState }
                    });
                    Process.Start(new ProcessStartInfo(authorizationUrl) { UseShellExecute = true });
                    WriteJson(stream, 200, new { message = "Selecione sua conta e confirme a autorização na página do Google." });
                    return;
                }

                if (path != "/v1/backup" && path != "/v1/restore")
                {
                    WriteJson(stream, path == "/connect" ? 405 : 404,
                        new { error = path == "/connect" ? "O login exige uma requisição POST." : "Rota não encontrada." });
                    return;
                }
                if (request.Method != "POST")
                {
                    WriteJson(stream, 405, new { error = "Esta operação exige uma requisição POST." });
                    return;
                }
                Dictionary<string, object> body = ReadJsonBody(request);
                string steamPath = body.ContainsKey("steam_path") ? Convert.ToString(body["steam_path"]) : "";
                if (String.IsNullOrWhiteSpace(steamPath) || !Directory.Exists(steamPath))
                    throw new InvalidOperationException("A pasta da Steam não foi encontrada.");

                if (path == "/v1/backup" && request.Method == "POST")
                {
                    await SyncGate.WaitAsync();
                    Dictionary<string, object> details;
                    try { details = await Backup(steamPath); }
                    finally { SyncGate.Release(); }
                    WriteJson(stream, 200, new { message = "Backup enviado ao Google Drive.", details = details });
                    return;
                }
                if (path == "/v1/restore" && request.Method == "POST")
                {
                    await SyncGate.WaitAsync();
                    Dictionary<string, object> details;
                    try { details = await Restore(steamPath); File.WriteAllText(BaselinePath(), Fingerprint(steamPath)); }
                    finally { SyncGate.Release(); }
                    WriteJson(stream, 200, new { message = "Backup restaurado. Reinicie a Steam.", details = details });
                    return;
                }
                WriteJson(stream, 404, new { error = "Rota não encontrada." });
            }
            catch (Exception error)
            {
                WriteJson(stream, 500, new { error = error.Message });
            }
        }
    }

    private static async Task OAuthCallback(LocalRequest request, NetworkStream stream)
    {
        Dictionary<string, string> query = ParseQuery(request.Url.Query);
        string state = query.ContainsKey("state") ? query["state"] : null;
        string code = query.ContainsKey("code") ? query["code"] : null;
        string denied = query.ContainsKey("error") ? query["error"] : null;
        if (!String.IsNullOrEmpty(denied)) throw new InvalidOperationException("A autorização foi cancelada.");
        if (String.IsNullOrEmpty(PendingState) || !SecureEquals(state, PendingState) || String.IsNullOrEmpty(code))
            throw new InvalidOperationException("A resposta de autorização é inválida ou expirou.");

        OAuthToken token = await BrokerToken(new Dictionary<string, string>
        {
            { "action", "exchange" },
            { "code", code },
            { "code_verifier", PendingVerifier },
            { "redirect_uri", RedirectUri }
        });
        // Never reuse a refresh token from a previously connected account.
        if (token == null || String.IsNullOrEmpty(token.access_token) || String.IsNullOrEmpty(token.refresh_token))
            throw new InvalidOperationException("O Google não forneceu autorização para manter a conexão. Tente entrar novamente.");
        token.expires_at = NowSeconds() + Math.Max(60, token.expires_in);
        SaveToken(token);
        PendingState = null;
        PendingVerifier = null;
        WriteHtml(stream, "<h2>Google Drive conectado</h2><p>Você já pode fechar esta aba e voltar à Steam.</p>");
    }

    private static bool IsConfigured()
    {
        return !String.IsNullOrWhiteSpace(Config.clientId)
            && Config.clientId.EndsWith(".apps.googleusercontent.com", StringComparison.OrdinalIgnoreCase)
            && !Config.clientId.StartsWith("COLE_", StringComparison.OrdinalIgnoreCase)
            && Uri.IsWellFormedUriString(Config.brokerUrl, UriKind.Absolute)
            && Config.brokerUrl.StartsWith("https://", StringComparison.OrdinalIgnoreCase);
    }

    // The broker keeps the OAuth client secret outside the distributed plugin.
    // It only exchanges/refreshes tokens; Drive requests still go directly from
    // this Windows process to the signed-in user's own Drive.
    private static async Task<OAuthToken> BrokerToken(Dictionary<string, string> values)
    {
        var response = await Http.PostAsync(Config.brokerUrl,
            new StringContent(Json.Serialize(values), Encoding.UTF8, "application/json"));
        string content = await response.Content.ReadAsStringAsync();
        if (!response.IsSuccessStatusCode)
            throw new InvalidOperationException("Não foi possível falar com o serviço seguro de login. Tente novamente.");
        BrokerResponse broker;
        try { broker = Json.Deserialize<BrokerResponse>(content); }
        catch { throw new InvalidOperationException("O serviço de login retornou uma resposta inválida."); }
        if (broker == null || !broker.ok || broker.token == null)
            throw new InvalidOperationException(String.IsNullOrWhiteSpace(broker == null ? null : broker.error)
                ? "O serviço seguro de login não concluiu a autorização."
                : broker.error);
        return broker.token;
    }

    private static string TokenError(string response, int status)
    {
        // Map known error codes; never display raw responses containing credentials.
        string code = "";
        try
        {
            var value = Json.Deserialize<Dictionary<string, object>>(response);
            object error;
            if (value != null && value.TryGetValue("error", out error)) code = Convert.ToString(error);
        }
        catch { }
        switch (code)
        {
            case "invalid_client": return "O Google não reconheceu as credenciais do aplicativo. A configuração do plugin precisa ser corrigida.";
            case "invalid_request": return "A solicitação de login está incompleta ou inválida. A configuração do plugin precisa ser corrigida.";
            case "invalid_grant": return "A autorização expirou, já foi utilizada ou foi revogada. Clique em Entrar com Google novamente.";
            case "access_denied": return "O Google não autorizou o acesso. Confirme a conta escolhida e tente novamente.";
            default: return "Não foi possível concluir a autorização com o Google (HTTP " + status + "). Tente novamente.";
        }
    }

    private static void SaveToken(OAuthToken token)
    {
        byte[] plain = Encoding.UTF8.GetBytes(Json.Serialize(token));
        byte[] protectedBytes = ProtectedData.Protect(plain, null, DataProtectionScope.CurrentUser);
        File.WriteAllText(TokenPath, Convert.ToBase64String(protectedBytes));
    }

    private static OAuthToken LoadToken()
    {
        try
        {
            if (!File.Exists(TokenPath)) return null;
            byte[] encrypted = Convert.FromBase64String(File.ReadAllText(TokenPath));
            byte[] plain = ProtectedData.Unprotect(encrypted, null, DataProtectionScope.CurrentUser);
            return Json.Deserialize<OAuthToken>(Encoding.UTF8.GetString(plain));
        }
        catch { return null; }
    }

    private static async Task<string> AccessToken()
    {
        OAuthToken token = LoadToken();
        if (token == null || String.IsNullOrEmpty(token.refresh_token)) throw new InvalidOperationException("Conecte sua conta Google primeiro.");
        if (!String.IsNullOrEmpty(token.access_token) && token.expires_at > NowSeconds() + 60) return token.access_token;
        OAuthToken refreshed = await BrokerToken(new Dictionary<string, string>
        {
            { "action", "refresh" },
            { "refresh_token", token.refresh_token }
        });
        refreshed.refresh_token = token.refresh_token;
        refreshed.expires_at = NowSeconds() + Math.Max(60, refreshed.expires_in);
        SaveToken(refreshed);
        return refreshed.access_token;
    }

    private static async Task<HttpResponseMessage> Drive(string url, HttpMethod method, HttpContent content = null)
    {
        var request = new HttpRequestMessage(method, url);
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", await AccessToken());
        request.Content = content;
        HttpResponseMessage response = await Http.SendAsync(request);
        if (!response.IsSuccessStatusCode) throw new InvalidOperationException("O Google Drive respondeu com HTTP " + (int)response.StatusCode + ".");
        return response;
    }

    private static async Task<string> CreateFolder(string name, string parent)
    {
        string metadata = Json.Serialize(new { name = name, mimeType = "application/vnd.google-apps.folder", parents = new[] { parent } });
        HttpResponseMessage response = await Drive("https://www.googleapis.com/drive/v3/files?fields=id", HttpMethod.Post,
            new StringContent(metadata, Encoding.UTF8, "application/json"));
        Dictionary<string, object> value = Json.Deserialize<Dictionary<string, object>>(await response.Content.ReadAsStringAsync());
        return Convert.ToString(value["id"]);
    }

    private static async Task<List<Dictionary<string, object>>> ListFiles(string query)
    {
        var output = new List<Dictionary<string, object>>();
        string page = "";
        do
        {
            string url = "https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=" + Uri.EscapeDataString(query)
                + "&pageSize=1000&fields=nextPageToken,files(id,name,mimeType)&pageToken=" + Uri.EscapeDataString(page);
            using (HttpResponseMessage response = await Drive(url, HttpMethod.Get))
            {
                var value = Json.Deserialize<Dictionary<string, object>>(await response.Content.ReadAsStringAsync());
                object files;
                if (value.TryGetValue("files", out files))
                    foreach (object item in (System.Collections.IEnumerable)files) output.Add((Dictionary<string, object>)item);
                page = value.ContainsKey("nextPageToken") ? Convert.ToString(value["nextPageToken"]) : "";
            }
        } while (!String.IsNullOrEmpty(page));
        return output;
    }

    private static async Task<string> RootFolder()
    {
        List<Dictionary<string, object>> found = await ListFiles("name='LuaToolsManifestBackup' and mimeType='application/vnd.google-apps.folder' and trashed=false");
        return found.Count > 0 ? Convert.ToString(found[0]["id"]) : await CreateFolder("LuaToolsManifestBackup", "appDataFolder");
    }

    private static async Task Upload(string filePath, string parent)
    {
        using (var form = new MultipartContent("related"))
        {
            form.Add(new StringContent(Json.Serialize(new { name = Path.GetFileName(filePath), parents = new[] { parent } }), Encoding.UTF8, "application/json"));
            var media = new ByteArrayContent(File.ReadAllBytes(filePath));
            media.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/octet-stream");
            form.Add(media);
            using (await Drive("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", HttpMethod.Post, form)) { }
        }
    }

    private static async Task<Dictionary<string, object>> Backup(string steamPath)
    {
        string before = Fingerprint(steamPath);
        string baseline = BaselinePath();
        string root = await RootFolder();
        string stamp = DateTime.UtcNow.ToString("yyyy-MM-ddTHH-mm-ss-fffZ");
        string snapshot = await CreateFolder("pending-" + stamp, root);
        string luaFolder = await CreateFolder("stplug-in", snapshot);
        string manifestFolder = await CreateFolder("depotcache", snapshot);
        string luaPath = Path.Combine(steamPath, "config", "stplug-in");
        string manifestPath = Path.Combine(steamPath, "depotcache");
        string[] lua = Directory.Exists(luaPath) ? Directory.GetFiles(luaPath, "*.lua") : new string[0];
        string[] manifests = ReferencedManifests(luaPath, manifestPath);
        foreach (string file in lua) await Upload(file, luaFolder);
        foreach (string file in manifests) await Upload(file, manifestFolder);
        if (Fingerprint(steamPath) != before)
            throw new IOException("Os arquivos mudaram durante o envio; a versão anterior foi preservada.");
        // Publish only after every upload succeeds. Pending snapshots are never restored.
        using (await Drive("https://www.googleapis.com/drive/v3/files/" + snapshot, new HttpMethod("PATCH"),
            new StringContent(Json.Serialize(new { name = stamp }), Encoding.UTF8, "application/json"))) { }
        File.WriteAllText(baseline, before);
        Dictionary<string, int> cleanup = await CleanupOlderSnapshots(root, snapshot);
        return new Dictionary<string, object> {
            { "lua", lua.Length }, { "manifests", manifests.Length }, { "snapshot", stamp },
            { "old_backups_removed", cleanup["removed"] }, { "cleanup_errors", cleanup["failed"] }
        };
    }

    private static async Task<Dictionary<string, object>> Restore(string steamPath)
    {
        string root = await RootFolder();
        List<Dictionary<string, object>> snapshots = await ListFiles("'" + root + "' in parents and trashed=false");
        snapshots.RemoveAll(item => !IsSnapshot(item));
        snapshots.Sort((left, right) => String.Compare(Convert.ToString(right["name"]), Convert.ToString(left["name"]), StringComparison.Ordinal));
        if (snapshots.Count == 0) throw new InvalidOperationException("Nenhum backup foi encontrado no Google Drive.");
        string snapshotId = Convert.ToString(snapshots[0]["id"]);
        List<Dictionary<string, object>> folders = await ListFiles("'" + snapshotId + "' in parents and trashed=false");
        int copied = 0, skipped = 0;
        foreach (Dictionary<string, object> folder in folders)
        {
            string folderName = Convert.ToString(folder["name"]);
            if (folderName != "stplug-in" && folderName != "depotcache") continue;
            string target = folderName == "stplug-in"
                ? Path.Combine(steamPath, "config", "stplug-in")
                : Path.Combine(steamPath, "depotcache");
            Directory.CreateDirectory(target);
            List<Dictionary<string, object>> files = await ListFiles("'" + Convert.ToString(folder["id"]) + "' in parents and trashed=false");
            foreach (Dictionary<string, object> file in files)
            {
                string name = Convert.ToString(file["name"]);
                if (String.IsNullOrEmpty(name) || name != Path.GetFileName(name) || name.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0
                    || !name.EndsWith(folderName == "stplug-in" ? ".lua" : ".manifest", StringComparison.OrdinalIgnoreCase))
                    throw new IOException("Nome de arquivo inválido no backup; restauração interrompida.");
                string destination = Path.Combine(target, name);
                if (File.Exists(destination)) { skipped++; continue; }
                HttpResponseMessage response = await Drive("https://www.googleapis.com/drive/v3/files/" + Convert.ToString(file["id"]) + "?alt=media", HttpMethod.Get);
                File.WriteAllBytes(destination, await response.Content.ReadAsByteArrayAsync());
                copied++;
            }
        }
        return new Dictionary<string, object> { { "copied", copied }, { "skipped", skipped }, { "snapshot", Convert.ToString(snapshots[0]["name"]) } };
    }

    private static Dictionary<string, object> ReadJsonBody(LocalRequest request)
    {
        return String.IsNullOrWhiteSpace(request.Body) ? new Dictionary<string, object>() : Json.Deserialize<Dictionary<string, object>>(request.Body);
    }

    private static LocalRequest ReadRequest(NetworkStream stream)
    {
        var reader = new StreamReader(stream, Encoding.UTF8, false, 4096, true);
        string requestLine = reader.ReadLine();
        if (String.IsNullOrWhiteSpace(requestLine)) throw new InvalidOperationException("Requisição local inválida.");
        string[] pieces = requestLine.Split(' ');
        var request = new LocalRequest { Method = pieces[0].ToUpperInvariant(), Url = new Uri("http://127.0.0.1:" + Config.port + pieces[1]), Body = "" };
        string line;
        while (!String.IsNullOrEmpty(line = reader.ReadLine()))
        {
            int separator = line.IndexOf(':');
            if (separator > 0) request.Headers[line.Substring(0, separator).Trim()] = line.Substring(separator + 1).Trim();
        }
        string lengthText;
        int length = request.Headers.TryGetValue("Content-Length", out lengthText) ? Int32.Parse(lengthText) : 0;
        if (length > 0)
        {
            char[] body = new char[length];
            int read = 0;
            while (read < length)
            {
                int count = reader.Read(body, read, length - read);
                if (count <= 0) break;
                read += count;
            }
            request.Body = new String(body, 0, read);
        }
        return request;
    }

    private static void WriteJson(NetworkStream stream, int status, object value)
    {
        byte[] bytes = Encoding.UTF8.GetBytes(Json.Serialize(value));
        WriteResponse(stream, status, "application/json; charset=utf-8", bytes);
    }

    private static void WriteHtml(NetworkStream stream, string body)
    {
        byte[] bytes = Encoding.UTF8.GetBytes("<!doctype html><meta charset=\"utf-8\"><title>Lua Games Backup</title><body style=\"font:16px system-ui;padding:40px;background:#101822;color:#fff\">" + body + "</body>");
        WriteResponse(stream, 200, "text/html; charset=utf-8", bytes);
    }

    private static void WriteResponse(NetworkStream stream, int status, string contentType, byte[] bytes)
    {
        string reason = status == 200 ? "OK" : status == 401 ? "Unauthorized" : status == 404 ? "Not Found" : "Error";
        byte[] header = Encoding.ASCII.GetBytes("HTTP/1.1 " + status + " " + reason + "\r\nContent-Type: " + contentType + "\r\nContent-Length: " + bytes.Length + "\r\nConnection: close\r\n\r\n");
        stream.Write(header, 0, header.Length);
        stream.Write(bytes, 0, bytes.Length);
    }

    private static string Form(Dictionary<string, string> values)
    {
        var parts = new List<string>();
        foreach (KeyValuePair<string, string> item in values)
            parts.Add(Uri.EscapeDataString(item.Key) + "=" + Uri.EscapeDataString(item.Value));
        return String.Join("&", parts);
    }

    private static Dictionary<string, string> ParseQuery(string query)
    {
        var output = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (string pair in (query ?? "").TrimStart('?').Split('&'))
        {
            if (String.IsNullOrEmpty(pair)) continue;
            string[] parts = pair.Split(new[] { '=' }, 2);
            output[Uri.UnescapeDataString(parts[0].Replace('+', ' '))] = parts.Length > 1 ? Uri.UnescapeDataString(parts[1].Replace('+', ' ')) : "";
        }
        return output;
    }

    private static string RandomUrlSafe(int bytes)
    {
        byte[] value = new byte[bytes];
        using (var random = RandomNumberGenerator.Create()) random.GetBytes(value);
        return Base64Url(value);
    }

    private static string Base64Url(byte[] bytes)
    {
        return Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    }

    private static bool SecureEquals(string left, string right)
    {
        if (String.IsNullOrEmpty(left) || String.IsNullOrEmpty(right)) return false;
        byte[] a = Encoding.UTF8.GetBytes(left), b = Encoding.UTF8.GetBytes(right);
        int difference = a.Length ^ b.Length;
        for (int index = 0; index < Math.Max(a.Length, b.Length); index++)
            difference |= a[index % a.Length] ^ b[index % b.Length];
        return difference == 0;
    }

    private static long NowSeconds()
    {
        return (long)(DateTime.UtcNow - new DateTime(1970, 1, 1)).TotalSeconds;
    }
}
