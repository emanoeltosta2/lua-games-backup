$ErrorActionPreference = 'Stop'
$assemblyPath = Join-Path $PSScriptRoot '..\google-drive-bridge\LuaGamesBackup.GoogleDrive.pending.exe'
Add-Type -AssemblyName System.Web.Extensions
$assembly = [Reflection.Assembly]::LoadFile([IO.Path]::GetFullPath($assemblyPath))
$program = $assembly.GetType('Program')
$flags = [Reflection.BindingFlags]'NonPublic,Static'
$method = $program.GetMethod('TokenError', $flags)
$cases = @(
    @{ Body = '{"error":"invalid_request","error_description":"secret-value"}'; Expected = 'incompleta' },
    @{ Body = '{"error":"invalid_client"}'; Expected = 'credenciais' },
    @{ Body = '{"error":"invalid_grant"}'; Expected = 'expirou' },
    @{ Body = '{"error":"access_denied"}'; Expected = 'conta escolhida' },
    @{ Body = '{"access_token":"secret-value"}'; Expected = 'HTTP 400' },
    @{ Body = 'not JSON secret-value'; Expected = 'HTTP 400' }
)
foreach ($case in $cases) {
    $message = $method.Invoke($null, @($case.Body, 400))
    if (-not $message.Contains($case.Expected) -or $message.Contains('secret-value')) {
        throw 'Unexpected or unsafe OAuth error message.'
    }
}
Write-Output 'PASS: 6 OAuth error cases; no raw credentials exposed.'
