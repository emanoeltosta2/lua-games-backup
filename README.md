# LuaTools Manifest Backup

Plugin para Millennium v3.4+ que protege os jogos adicionados pelo LuaTools com backup local e no Google Drive:

- `Steam/config/stplug-in/*.lua`
- manifestos de `Steam/depotcache` referenciados pelos arquivos Lua

Ele não baixa jogos nem pesquisa conteúdo. Quando a conta Google está conectada,
faz uma verificação automática ao iniciar a Steam.

## Backup no Google Drive

O plugin inclui um pequeno serviço local para o login seguro no Google. Ele inicia automaticamente, usa OAuth 2.0 com PKCE, abre o navegador padrão e fica restrito a `127.0.0.1`; a senha da conta Google nunca passa pelo plugin nem é salva por ele. A autorização é protegida pelo Windows para o usuário atual. Os backups ficam na pasta privada de dados do aplicativo no Drive, usando somente o escopo `drive.appdata`.

Antes de distribuir o plugin, o desenvolvedor cria uma única vez um cliente OAuth do tipo **Desktop app** no Google Cloud, habilita a Google Drive API e copia somente o Client ID para `google-drive-bridge/oauth-client.json` (campo `clientId`; use `oauth-client.example.json` como modelo). O login usa PKCE e não distribui Client Secret, senha ou tokens de usuários.

O usuário final não instala dependências e não informa endereço nem token. Basta clicar em **Entrar com Google**, selecionar a conta no navegador e confirmar o acesso. Depois disso, os botões de envio e restauração são liberados automaticamente.

## Instalação

1. Baixe o arquivo `Lua-Games-Backup-v1.2.0.zip` na página de Releases.
2. Extraia a pasta `lua-games-backup` para `Steam/millennium/plugins/`.
3. Reinicie a Steam.
4. Em **Millennium → Plugins**, habilite **Lua Games Backup**.
5. Abra **Configure**, clique em **Entrar com Google** e autorize o aplicativo.

Não é necessário instalar Node.js, Bun, Python ou qualquer dependência externa.

## Uso

- **Enviar backup** atualiza imediatamente o backup do Google Drive.
- **Restaurar da nuvem** recupera o backup mais recente sem sobrescrever arquivos existentes.
- Com a conta conectada, o plugin verifica alterações uma vez a cada inicialização da Steam.
- O Google Drive mantém somente uma versão completa. A anterior é removida apenas
  depois que a nova versão foi enviada com sucesso.

Após reinstalar Steam e Millennium, conecte a mesma conta Google e clique em
**Restaurar da nuvem**. O plugin só adiciona arquivos que ainda não existam;
conflitos são ignorados. Reinicie a Steam em seguida.

## Estrutura do backup

O Google Drive mantém uma única versão completa e atualizada. Ela contém apenas os
arquivos `.lua`, os manifestos `.manifest` que eles referenciam e um `README.txt`
com a contagem de arquivos. A versão anterior só é removida após o envio da nova
versão terminar com sucesso.

## Limites e cuidados

### Sincronização automática Google Drive

Ao iniciar a Steam com o plugin habilitado, o serviço oculto verifica uma vez o conteúdo de
`config/stplug-in/*.lua` e `depotcache/*.manifest`. Com a conta conectada,
adições, alterações e exclusões desde o último backup geram uma nova versão completa.
São copiados todos os arquivos Lua e somente os manifestos citados por
`setManifestid(...)`; manifestos de outros jogos instalados na Steam são ignorados.
Não há varredura periódica. Mudanças feitas durante a sessão serão enviadas
na próxima inicialização da Steam ou pelo botão **Enviar backup**.
Não é necessário manter o painel Configure aberto. O painel mostra o estado.
Quando um Lua é removido, seus manifestos deixam de fazer parte do próximo backup.
Não são sincronizados os arquivos binários dos jogos.

Falhas de rede aguardam a próxima inicialização ou envio manual; versões incompletas não são
oferecidas para restauração. O backup anterior só é removido depois que a nova
versão foi enviada e publicada com sucesso. Assim, a nuvem mantém apenas um
backup completo e não acumula versões. Cada alteração envia uma versão completa.

Em uma instalação sem histórico local que já tenha backup na nuvem, o envio
automático aguarda **Restaurar da nuvem** ou **Enviar backup** (para confirmar
o uso dos arquivos deste computador). Isso protege o backup após formatação.
Uma instalação sem arquivos Lua nunca gera backup automático vazio, mesmo que
o histórico local tenha sobrevivido à reinstalação. Pastas ausentes também pausam o envio.
A restauração não sobrescreve arquivos
locais existentes; não há sincronização bidirecional entre computadores.

Formatação normalmente apaga o disco do sistema. Por isso, o botão de Google Drive é o caminho recomendado. O usuário continua responsável por usar software e conteúdo de acordo com as licenças, as leis e os termos aplicáveis.
