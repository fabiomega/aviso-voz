# aviso-voz: prepares the voice runtime with nothing installed beforehand.
#
# Everything goes inside <Dados>\runtime (per user, no admin, no PATH change):
#   uv\uv.exe      the official uv binary, downloaded from GitHub
#   python\        a Python 3.12 that uv downloads and manages
#   venv\          the virtual environment with edge-tts and the Windows audio helpers
#   pronto.json    written last, only when everything works
#   estado.json    instalando | pronto | falhou, read by the plugin's panel
# Safe to run again: finished steps are skipped, a failed run resumes where it stopped.
# Kept in plain ASCII so Windows PowerShell 5.1 reads it the same in any locale.

param(
    [string]$Dados = "",
    [switch]$Forcar
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # Invoke-WebRequest is many times faster without the progress bar

if (-not $Dados) {
    if ($env:AVISO_VOZ_DIR) { $Dados = $env:AVISO_VOZ_DIR } else { $Dados = Join-Path $env:USERPROFILE '.claude\aviso-voz' }
}
$Runtime = Join-Path $Dados 'runtime'
$Log = Join-Path $Dados 'instalacao.log'
$Estado = Join-Path $Runtime 'estado.json'
$Pronto = Join-Path $Runtime 'pronto.json'
$Trava = Join-Path $Runtime 'instalando.lock'
$Versao = '1.0.0'
$Pacotes = @('edge-tts', 'comtypes', 'pycaw', 'psutil')

New-Item -ItemType Directory -Force -Path $Runtime | Out-Null

function Escrever-Log([string]$texto) {
    $linha = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $texto
    Add-Content -Path $Log -Value $linha -Encoding UTF8
}

function Gravar-Json([string]$caminho, $obj) {
    # UTF-8 without BOM: PowerShell 5.1's own UTF8 adds one, which JSON readers reject.
    $tmp = "$caminho.tmp"
    [IO.File]::WriteAllText($tmp, ($obj | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding $false))
    Move-Item -Force -Path $tmp -Destination $caminho
}

function Gravar-Estado([string]$fase, [string]$mensagem) {
    Gravar-Json $Estado @{ fase = $fase; mensagem = $mensagem; quando = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds(); versao = $Versao }
}

# Runs a native program and returns its exit code; its output (stderr too, where uv
# writes its progress) goes to the log. Stop must not turn stderr lines into errors.
function Rodar([string]$exe, [string[]]$argumentos) {
    $anterior = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $saida = & $exe @argumentos 2>&1 | ForEach-Object { "$_" }
        $codigo = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $anterior
    }
    $texto = ($saida | Out-String).Trim()
    if ($texto) { Escrever-Log $texto }
    $script:UltimaSaida = $texto
    return $codigo
}

# One install at a time: a fresh lock held by a live process wins.
if (Test-Path $Trava) {
    $idade = (Get-Date) - (Get-Item $Trava).LastWriteTime
    $dono = 0
    try { $dono = [int](Get-Content $Trava -Raw) } catch { }
    if ($idade.TotalMinutes -lt 20 -and $dono -and (Get-Process -Id $dono -ErrorAction SilentlyContinue)) {
        Escrever-Log "outra instalacao em andamento (pid $dono); saindo"
        exit 0
    }
}
Set-Content -Path $Trava -Value $PID -Encoding ASCII

$Py = Join-Path $Runtime 'venv\Scripts\python.exe'
$Pyw = Join-Path $Runtime 'venv\Scripts\pythonw.exe'

try {
    if ((Test-Path $Pronto) -and (Test-Path $Py) -and -not $Forcar) {
        Escrever-Log 'ja estava pronto'
        Gravar-Estado 'pronto' 'A voz ja estava pronta.'
        exit 0
    }
    Escrever-Log "inicio (dados: $Dados)"
    Gravar-Estado 'instalando' 'Preparando a voz pela primeira vez.'

    # TLS 1.2 for GitHub on older Windows 10 builds.
    try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }

    # 1. uv, the tool that downloads Python and the packages.
    $UvDir = Join-Path $Runtime 'uv'
    $Uv = Get-ChildItem -Path $UvDir -Recurse -Filter 'uv.exe' -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
    if (-not $Uv) {
        $arq = 'x86_64'
        if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { $arq = 'aarch64' }
        $url = "https://github.com/astral-sh/uv/releases/latest/download/uv-$arq-pc-windows-msvc.zip"
        $zip = Join-Path $Runtime 'uv.zip'
        Escrever-Log "baixando uv: $url"
        Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
        Escrever-Log ('uv baixado: {0:N1} MB' -f ((Get-Item $zip).Length / 1MB))
        if (Test-Path $UvDir) { Remove-Item -Recurse -Force $UvDir }
        Expand-Archive -Path $zip -DestinationPath $UvDir -Force
        Remove-Item -Force $zip
        $Uv = Get-ChildItem -Path $UvDir -Recurse -Filter 'uv.exe' | Select-Object -First 1 -ExpandProperty FullName
        if (-not $Uv) { throw 'uv.exe nao veio no arquivo baixado' }
    }
    Escrever-Log "uv: $Uv"

    # uv keeps its Python and cache inside the runtime folder, away from anything else on the PC.
    $env:UV_PYTHON_INSTALL_DIR = Join-Path $Runtime 'python'
    $env:UV_CACHE_DIR = Join-Path $Runtime 'cache'
    $env:UV_PYTHON_PREFERENCE = 'only-managed'
    $env:UV_NO_CONFIG = '1'

    # 2. The virtual environment with its own Python 3.12.
    $venvOk = $false
    if (Test-Path $Py) {
        $venvOk = ((Rodar $Py @('-c', 'import sys')) -eq 0)
    }
    if (-not $venvOk) {
        Escrever-Log 'criando o ambiente com Python 3.12'
        $codigo = Rodar $Uv @('venv', (Join-Path $Runtime 'venv'), '--python', '3.12', '--clear')
        if ($codigo -ne 0) { throw "uv venv falhou ($codigo)" }
    }

    # 3. The packages: edge-tts for the voice, the rest to hear when the Claude microphone is on.
    Escrever-Log ('instalando: ' + ($Pacotes -join ' '))
    $codigo = Rodar $Uv (@('pip', 'install', '--python', $Py) + $Pacotes)
    if ($codigo -ne 0) { throw "uv pip install falhou ($codigo)" }

    # 4. Proof that it all imports.
    $codigo = Rodar $Py @('-c', "import edge_tts, comtypes, pycaw, psutil; print('ok')")
    if ($codigo -ne 0 -or $script:UltimaSaida -notmatch 'ok') { throw "teste de importacao falhou: $($script:UltimaSaida)" }

    if (-not (Test-Path $Pyw)) { $Pyw = $Py }
    Gravar-Json $Pronto @{ python = $Py; pythonw = $Pyw; uv = $Uv; versao = $Versao; quando = (Get-Date -Format 's') }
    Gravar-Estado 'pronto' 'A voz esta pronta.'
    Escrever-Log 'pronto'
    exit 0
}
catch {
    $msg = $_.Exception.Message
    Escrever-Log "FALHOU: $msg"
    Gravar-Estado 'falhou' $msg
    exit 1
}
finally {
    Remove-Item -Force $Trava -ErrorAction SilentlyContinue
}
