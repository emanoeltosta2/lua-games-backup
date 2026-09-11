// Read-only verification of the latest published snapshot against local files.
using System;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Reflection;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

internal static class VerifyCloudSync
{
    private static object Call(string name, params object[] args)
    {
        return typeof(Program).GetMethod(name, BindingFlags.Static | BindingFlags.NonPublic).Invoke(null, args);
    }
    private static Task<List<Dictionary<string, object>>> List(string query)
    {
        return (Task<List<Dictionary<string, object>>>)Call("ListFiles", query);
    }
    public static void Main()
    {
        try { Verify().GetAwaiter().GetResult(); }
        catch (Exception e) { Console.WriteLine("FAIL " + e.GetBaseException().Message); Environment.ExitCode = 1; }
    }
    private static async Task Verify()
    {
        ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
        string directory = AppDomain.CurrentDomain.BaseDirectory;
        var config = new JavaScriptSerializer().Deserialize<BridgeConfig>(File.ReadAllText(Path.Combine(directory, "oauth-client.json")));
        typeof(Program).GetField("Config", BindingFlags.Static | BindingFlags.NonPublic).SetValue(null, config);
        var roots = await List("name='LuaToolsManifestBackup' and mimeType='application/vnd.google-apps.folder' and trashed=false");
        if (roots.Count != 1) throw new Exception("Expected exactly one cloud backup root.");
        var snapshots = await List("'" + roots[0]["id"] + "' in parents and trashed=false");
        int completedCount = snapshots.Count(x => (bool)Call("IsSnapshot", x));
        int pendingCount = snapshots.Count(x => Convert.ToString(x["name"]).StartsWith("pending-", StringComparison.Ordinal));
        if (!snapshots.Any(x => (bool)Call("IsSnapshot", x)))
        {
            int pendingFiles = 0;
            foreach (var pending in snapshots)
                foreach (var folder in await List("'" + pending["id"] + "' in parents and trashed=false"))
                    pendingFiles += (await List("'" + folder["id"] + "' in parents and trashed=false")).Count;
            throw new Exception("First snapshot still uploading: " + pendingFiles + " files already in cloud.");
        }
        var latest = snapshots.Where(x => (bool)Call("IsSnapshot", x)).OrderByDescending(x => Convert.ToString(x["name"]), StringComparer.Ordinal).First();
        var folders = await List("'" + latest["id"] + "' in parents and trashed=false");
        if (Environment.GetCommandLineArgs().Contains("--inventory"))
        {
            Console.WriteLine("Completed snapshots: " + completedCount);
            Console.WriteLine("Pending snapshots: " + pendingCount);
            Console.WriteLine("Latest completed snapshot: " + latest["name"]);
            foreach (var folder in folders)
            {
                var inventory = await List("'" + folder["id"] + "' in parents and trashed=false");
                Console.WriteLine(Convert.ToString(folder["name"]) + ": " + inventory.Count + " files");
            }
            return;
        }
        string steam = directory;
        while (!File.Exists(Path.Combine(steam, "steam.exe"))) steam = Directory.GetParent(steam).FullName;
        int verified = 0;
        foreach (string kind in new[] { "stplug-in", "depotcache" })
        {
            var folder = folders.Single(x => Convert.ToString(x["name"]) == kind);
            var files = await List("'" + folder["id"] + "' in parents and trashed=false");
            string local = kind == "stplug-in" ? Path.Combine(steam, "config", kind) : Path.Combine(steam, kind);
            string[] localPaths = kind == "stplug-in"
                ? Directory.GetFiles(local, "*.lua")
                : (string[])Call("ReferencedManifests", Path.Combine(steam, "config", "stplug-in"), local);
            string[] names = localPaths.Select(Path.GetFileName).OrderBy(x => x, StringComparer.Ordinal).ToArray();
            if (!names.SequenceEqual(files.Select(x => Convert.ToString(x["name"])).OrderBy(x => x, StringComparer.Ordinal)))
                throw new Exception("Remote inventory differs: " + kind);
            foreach (var file in files)
            {
                using (var response = await (Task<HttpResponseMessage>)Call("Drive", "https://www.googleapis.com/drive/v3/files/" + file["id"] + "?alt=media", HttpMethod.Get, null))
                using (var sha = SHA256.Create())
                {
                    byte[] remote = await response.Content.ReadAsByteArrayAsync();
                    byte[] localBytes = File.ReadAllBytes(Path.Combine(local, Convert.ToString(file["name"])));
                    if (!sha.ComputeHash(remote).SequenceEqual(sha.ComputeHash(localBytes))) throw new Exception("Content mismatch in " + kind);
                    verified++;
                }
            }
            Console.WriteLine("PASS " + kind + ": " + files.Count + " files, inventory and SHA-256 match");
        }
        Console.WriteLine("PASS published cloud snapshot: " + verified + " verified files");
    }
}
