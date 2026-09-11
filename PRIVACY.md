# Política de Privacidade — Lua Games Backup

Última atualização: 10 de setembro de 2026.

Lua Games Backup é um plugin de código aberto para o Millennium que permite ao
usuário salvar e restaurar arquivos do LuaTools no próprio Google Drive.

## Dados acessados

O plugin solicita somente o escopo `drive.appdata`. Essa permissão permite criar,
ler, atualizar e excluir exclusivamente os dados privados criados pelo próprio
Lua Games Backup na pasta de dados do aplicativo no Google Drive. O plugin não
pode ler documentos, fotos ou outros arquivos do usuário em "Meu Drive".

Os dados armazenados são os arquivos Lua do LuaTools e os manifestos Steam
explicitamente referenciados por esses arquivos.

## Armazenamento e compartilhamento

Os backups são enviados diretamente do computador do usuário para sua conta do
Google Drive. O desenvolvedor não mantém servidor intermediário, banco de dados,
telemetria ou sistema de anúncios e não recebe cópias dos arquivos ou tokens.

A autorização do Google é armazenada somente no computador do usuário e
protegida pelo Windows para a conta local atual. Nenhum dado é vendido ou
compartilhado com terceiros.

O uso das informações recebidas das APIs do Google segue a
[Política de Dados do Usuário dos Serviços de API do Google](https://developers.google.com/terms/api-services-user-data-policy),
incluindo os requisitos de Uso Limitado.

## Retenção e exclusão

O plugin mantém apenas o backup completo mais recente. A versão anterior é
excluída somente depois que a nova versão foi enviada com sucesso. O usuário
pode revogar o acesso a qualquer momento nas permissões da Conta Google e pode
remover os dados privados do aplicativo nas configurações do Google Drive.

## Contato

Dúvidas ou solicitações podem ser abertas na seção **Issues** do repositório
oficial do Lua Games Backup no GitHub.

