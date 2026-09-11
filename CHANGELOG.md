# Changelog

## 1.3.1

- Translates the installation and usage guide to English.

## 1.3.0

- Move o Client Secret OAuth para um intermediário privado no Google Apps Script.
- Mantém o Client ID e a configuração distribuível sem segredo no pacote público.
- Valida a troca real de login Google pelo intermediário antes de salvar o token local.

## 1.2.0

- Adiciona login integrado com o Google Drive usando OAuth 2.0 e PKCE.
- Sincroniza uma vez por inicialização da Steam e permite envio manual.
- Mantém somente o backup mais recente, apagando a versão anterior apenas após
  a publicação completa da nova versão.
- Preserva o backup da nuvem quando uma instalação nova não contém jogos Lua.
- Inclui somente manifestos referenciados por `setManifestid(...)`.
- Restaura sem sobrescrever arquivos locais existentes.
