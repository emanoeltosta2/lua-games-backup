using System;
using System.IO;
using System.Reflection;
using System.Collections.Generic;

internal static class SyncTests
{
    private static string Hash(string path)
    {
        return (string)typeof(Program).GetMethod("Fingerprint", BindingFlags.NonPublic | BindingFlags.Static).Invoke(null, new object[] { path });
    }
    private static void Check(bool ok, string label)
    {
        if (!ok) throw new Exception(label);
        Console.WriteLine("PASS " + label);
    }
    public static void Main()
    {
        string root = Path.Combine(Path.GetTempPath(), "lua-backup-test-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path.Combine(root, "config", "stplug-in"));
        Directory.CreateDirectory(Path.Combine(root, "depotcache"));
        try
        {
            string empty = Hash(root);
            string lua = Path.Combine(root, "config", "stplug-in", "123.lua");
            File.WriteAllText(lua, "addappid(123)\n-- setManifestid(456, \"789\")");
            string manifest = Path.Combine(root, "depotcache", "456_789.manifest");
            File.WriteAllText(manifest, "first");
            string added = Hash(root);
            Check(empty != added, "new game detected");
            Check(added == Hash(root), "unchanged files stable");
            var time = File.GetLastWriteTimeUtc(lua);
            File.WriteAllText(lua, "addappid(123)\nsetManifestid(456, '789')");
            File.SetLastWriteTimeUtc(lua, time);
            Check(added != Hash(root), "content change with same timestamp detected");
            File.Delete(lua);
            Check(empty == Hash(root), "game removal detected");
            File.WriteAllText(lua, "setManifestid(456, \"789\")");
            File.WriteAllText(manifest, "first");
            string first = Hash(root);
            File.WriteAllText(manifest, "second");
            Check(first != Hash(root), "manifest update detected");
            string updated = Hash(root);
            File.WriteAllText(Path.Combine(root, "depotcache", "999_111.manifest"), "unrelated game");
            Check(updated != empty && updated == Hash(root), "unreferenced Steam manifest ignored");
            File.Delete(lua);
            Check(empty == Hash(root), "removed Lua also removes its manifest from selection");
            File.WriteAllText(Path.Combine(root, "depotcache", "ignore.tmp"), "partial");
            Check(empty == Hash(root), "unrelated temporary files ignored");
            var method = typeof(Program).GetMethod("IsSnapshot", BindingFlags.NonPublic | BindingFlags.Static);
            var item = new Dictionary<string, object> { { "name", "pending-2026" }, { "mimeType", "application/vnd.google-apps.folder" } };
            Check(!(bool)method.Invoke(null, new object[] { item }), "incomplete snapshot excluded");
            item["name"] = "2026-09-09T12-00-00Z";
            Check((bool)method.Invoke(null, new object[] { item }), "complete snapshot accepted");
            Directory.Delete(Path.Combine(root, "config", "stplug-in"));
            bool rejected = false;
            try { Hash(root); } catch (TargetInvocationException e) { rejected = e.InnerException is IOException; }
            Check(rejected, "missing source folder pauses sync");
            // Exercise the empty-installation guard before any Drive request.
            Directory.CreateDirectory(Path.Combine(root, "config", "stplug-in"));
            var flags = BindingFlags.NonPublic | BindingFlags.Static;
            typeof(Program).GetField("SteamDirectory", flags).SetValue(null, root);
            typeof(Program).GetField("Config", flags).SetValue(null, new BridgeConfig { clientId = "test.apps.googleusercontent.com", brokerUrl = "https://example.invalid" });
            typeof(Program).GetField("TokenPath", flags).SetValue(null, Path.Combine(root, "test-token.dat"));
            typeof(Program).GetMethod("SaveToken", flags).Invoke(null, new object[] { new OAuthToken { access_token = "test", refresh_token = "test" } });
            ((System.Threading.Tasks.Task)typeof(Program).GetMethod("AutoSync", flags).Invoke(null, null)).GetAwaiter().GetResult();
            string message = (string)typeof(Program).GetField("SyncMessage", flags).GetValue(null);
            Check(message.Contains("Nenhum jogo Lua encontrado"), "empty installation preserves cloud without a network request");
        }
        finally { Directory.Delete(root, true); }
    }
}
