/*
 * Lua Games Backup OAuth broker
 *
 * Deploy this file as a Google Apps Script web app. Set OAUTH_CLIENT_ID and
 * OAUTH_CLIENT_SECRET in Script Properties; never place the secret in this
 * repository, the plugin package, or the web-app source.
 */
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const LOOPBACK_REDIRECT = 'http://127.0.0.1:37462/oauth/callback';

function doPost(event) {
  try {
    const input = JSON.parse((event.postData && event.postData.contents) || '{}');
    const properties = PropertiesService.getScriptProperties();
    const clientId = properties.getProperty('OAUTH_CLIENT_ID');
    const clientSecret = properties.getProperty('OAUTH_CLIENT_SECRET');
    if (!clientId || !clientSecret) return reply(false, null, 'O serviço de login ainda não foi configurado.');

    let payload;
    if (input.action === 'exchange') {
      if (!input.code || !input.code_verifier || input.redirect_uri !== LOOPBACK_REDIRECT)
        return reply(false, null, 'A resposta de login é inválida ou expirou.');
      payload = {
        client_id: clientId,
        client_secret: clientSecret,
        code: input.code,
        code_verifier: input.code_verifier,
        grant_type: 'authorization_code',
        redirect_uri: LOOPBACK_REDIRECT,
      };
    } else if (input.action === 'refresh') {
      if (!input.refresh_token) return reply(false, null, 'A conexão Google não contém um token de renovação.');
      payload = {
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: input.refresh_token,
        grant_type: 'refresh_token',
      };
    } else {
      return reply(false, null, 'Operação de login inválida.');
    }

    const result = UrlFetchApp.fetch(TOKEN_ENDPOINT, {
      method: 'post',
      payload: payload,
      muteHttpExceptions: true,
    });
    if (result.getResponseCode() < 200 || result.getResponseCode() >= 300)
      return reply(false, null, 'O Google recusou a autorização. Entre com Google novamente.');

    const token = JSON.parse(result.getContentText());
    if (!token.access_token) return reply(false, null, 'O Google não forneceu um token de acesso.');
    return reply(true, token, null);
  } catch (_) {
    // Do not expose OAuth responses, codes, refresh tokens, or server details.
    return reply(false, null, 'Não foi possível concluir o login agora. Tente novamente.');
  }
}

function reply(ok, token, error) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: ok, token: token, error: error }))
    .setMimeType(ContentService.MimeType.JSON);
}
