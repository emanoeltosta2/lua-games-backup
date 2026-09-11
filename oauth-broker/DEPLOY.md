# Serviço de login Google

Este diretório contém o único componente hospedado: ele mantém o segredo OAuth
do desenvolvedor fora do plugin público e troca/renova tokens. O backup nunca
passa por ele; o aplicativo Windows envia os arquivos diretamente ao Drive do
usuário.

## Publicação no Google Apps Script

1. Abra [script.google.com](https://script.google.com), crie um projeto e cole
   o conteúdo de `Code.gs`.
2. Em **Project Settings → Script properties**, crie `OAUTH_CLIENT_ID` e
   `OAUTH_CLIENT_SECRET` com os dois valores do cliente OAuth **Desktop** já
   criado no projeto Google Cloud.
3. Em **Deploy → New deployment**, selecione **Web app**, execute como a sua
   conta e permita acesso a **Anyone**. Copie a URL terminada em `/exec`.
4. Cole essa URL como `brokerUrl` em `google-drive-bridge/oauth-client.json` e
   recompile o executável antes de criar a release.

Não registre códigos, tokens ou requisições neste projeto. Se precisar trocar o
segredo OAuth, gere um novo no Google Cloud e atualize apenas a Script Property.
