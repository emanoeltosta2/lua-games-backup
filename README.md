# LuaTools Manifest Backup

A Millennium v3.4+ plugin that protects games added through LuaTools by backing up the following files locally and to Google Drive:

- `Steam/config/stplug-in/*.lua`
- the `Steam/depotcache` manifests referenced by those Lua files

It does not download games or scan their content. When a Google account is connected, it performs an automatic check when Steam starts.

## Google Drive backup

Click **Sign in with Google**, choose an account in the browser, and approve the access request. The upload and restore buttons are enabled automatically.

Your Google password is never requested or stored by the plugin. The connection is protected for the current Windows user, and backups are stored in a private area of that user's Google Drive.

## Installation

1. Download `Lua-Games-Backup-v1.3.2.zip` from the Releases page.
2. Extract the `lua-games-backup` folder into `Steam/millennium/plugins/`.
3. Restart Steam.
4. In **Millennium → Plugins**, enable **Lua Games Backup**.
5. Open **Configure**, click **Sign in with Google**, and authorize the app.

Node.js, Bun, Python, and other external dependencies are not required.

## Usage

- **Send backup** immediately updates the Google Drive backup.
- **Restore from cloud** restores the latest backup without overwriting existing files.
- With an account connected, the plugin checks for changes once each time Steam starts.
- Google Drive keeps one complete version only. The previous version is removed only after the new version has uploaded successfully.

After reinstalling Steam and Millennium, connect the same Google account and click **Restore from cloud**. The plugin only adds files that do not already exist; conflicts are skipped. Restart Steam afterwards.

## Backup structure

Google Drive keeps one complete, up-to-date version. It contains only `.lua` files, the `.manifest` files they reference, and a `README.txt` with file counts. The previous version is deleted only after the new version has been uploaded successfully.

## Limits and safeguards

### Automatic Google Drive synchronization

When Steam starts with the plugin enabled, the hidden service checks `config/stplug-in/*.lua` and `depotcache/*.manifest` once. With an account connected, additions, changes, and deletions since the last backup create a new complete version. All Lua files are copied, but only manifests referenced by `setManifestid(...)` are included; manifests for other installed Steam games are ignored.

There is no periodic scan. Changes made while Steam is running are uploaded on the next Steam start or by using **Send backup**. The Configure panel does not need to stay open. When a Lua file is removed, its manifests are left out of the next backup. Game binary files are never synchronized.

Network failures wait for the next Steam start or a manual upload. Incomplete versions are never offered for restore. The previous cloud backup is deleted only after the new version has uploaded and been published successfully, so the cloud stores a single complete backup without accumulating old versions.

On an installation with no local history but an existing cloud backup, automatic upload waits for **Restore from cloud** or **Send backup** so that the user can confirm that this computer's files should be used. This protects the cloud backup after formatting a computer. An installation without Lua files never creates an automatic empty backup, even if a local history file survived a reinstall. Missing folders also pause uploads.

Restore never overwrites existing local files, and there is no two-way sync between computers. Formatting normally erases the system drive, so the Google Drive restore option is the recommended recovery path. Users remain responsible for using software and content according to applicable licenses, laws, and terms.
