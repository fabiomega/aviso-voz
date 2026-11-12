# aviso-voz: prepares the voice runtime with nothing installed beforehand.
#
# Everything goes inside <Dados>\runtime (per user, no admin, no PATH change):
#   uv\uv.exe      the official uv binary, downloaded from GitHub
#   python\        a Python 3.12 that uv downloads and manages
#   venv\          the virtual environment with edge-tts and the Windows audio helpers
#   pronto.json    written last, only when everything works
#   estado.json    the panel's live view: fase, etapa, pct, baixadoMB, totalMB, heartbeat
# Safe to run again: finished steps are skipped, a failed run resumes where it stopped.
# Kept in plain ASCII so Windows PowerShell 5.1 reads it the same in any locale.

param(
    [string]$Dados = "",
    [switch]$Forcar
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

if (-not $Dados) {
    if ($env:AVISO_VOZ_DIR) { $Dados = $env:AVISO_VOZ_DIR } else { $Dados = Join-Path $env:USERPROFILE '.claude\aviso-voz' }
}
$Runtime = Join-Path $Dados 'runtime'
$Log = Join-Path $Dados 'instalacao.log'
$Estado = Join-Path $Runtime 'estado.json'
$Pronto = Join-Path $Runtime 'pronto.json'
$Trava = Join-Path $Runtime 'instalando.lock'
$Versao = '1.1.0'
$Pacotes = @('edge-tts', 'comtypes', 'pycaw', 'psutil')

# The sizes behind the "MB" label of the bar.
$PythonMB = 21.0
$PacotesMB = 6.0

New-Item -ItemType Directory -Force -Path $Runtime | Out-Null

function Escrever-Log([string]$texto) {
    $linha = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $texto
    Add-Content -Path $Log -Value $linha -Encoding UTF8
}

function Gravar-Json([string]$caminho, $obj) {
    # UTF-8 without BOM, written to a temp file then moved, so a reader never sees half a file.
    $tmp = "$caminho.$PID.tmp"
    [IO.File]::WriteAllText($tmp, ($obj | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding $false))
    Move-Item -Force -Path $tmp -Destination $caminho
}

$script:Pct = 0.0
$script:Etapa = 'Preparando a voz natural'
$script:BaixadoMB = 0.0
$script:TotalMB = 40.0

# The panel polls this file; pct never goes backwards and the heartbeat says the installer is alive.
function Gravar-Estado([string]$fase, [string]$mensagem) {
    $agora = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    try {
        Gravar-Json $Estado ([ordered]@{
            fase = $fase; mensagem = $mensagem; etapa = $script:Etapa
            pct = [Math]::Round($script:Pct, 1); baixadoMB = [Math]::Round($script:BaixadoMB, 1); totalMB = [Math]::Round($script:TotalMB, 1)
            heartbeat = $agora; quando = $agora; versao = $Versao; pid = $PID
        })
    }
    catch { }   # a reader holding the file for a moment must not stop the install
}

function Progresso([double]$pct, [string]$etapa) {
    if ($pct -gt $script:Pct) { $script:Pct = [Math]::Min(100, $pct) }
    if ($etapa) { $script:Etapa = $etapa }
    Gravar-Estado 'instalando' $script:Etapa
}

function Tamanho-MB([string[]]$pastas) {
    $total = 0
    foreach ($p in $pastas) {
        if (Test-Path $p) {
            $soma = (Get-ChildItem -Path $p -Recurse -File -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
            if ($soma) { $total += $soma }
        }
    }
    return $total / 1MB
}

# Downloads with real byte progress (Invoke-WebRequest reports none and is slow on 5.1).
function Baixar([string]$url, [string]$destino, [double]$de, [double]$ate, [string]$etapa) {
    $req = [Net.HttpWebRequest]::Create($url)
    $req.UserAgent = 'aviso-voz-instalador'
    $req.Timeout = 60000
    $req.ReadWriteTimeout = 60000
    $resp = $req.GetResponse()
    try {
        $total = $resp.ContentLength
        if ($total -gt 0) { $script:TotalMB = ($total / 1MB) + $PythonMB + $PacotesMB }
        $entrada = $resp.GetResponseStream()
        $saida = [IO.File]::Create($destino)
        try {
            $buffer = New-Object byte[] 65536
            $lidos = 0L
            $relogio = [Diagnostics.Stopwatch]::StartNew()
            while (($n = $entrada.Read($buffer, 0, $buffer.Length)) -gt 0) {
                $saida.Write($buffer, 0, $n)
                $lidos += $n
                if ($relogio.ElapsedMilliseconds -ge 300) {
                    $relogio.Restart()
                    $script:BaixadoMB = $lidos / 1MB
                    $fracao = 0.5
                    if ($total -gt 0) { $fracao = $lidos / $total }
                    Progresso ($de + ($ate - $de) * $fracao) $etapa
                }
            }
            $script:BaixadoMB = $lidos / 1MB
        }
        finally { $saida.Close(); $entrada.Close() }
    }
    finally { $resp.Close() }
    Progresso $ate $etapa
}

# Runs uv (or python) as a child process, keeping the heartbeat and the bar moving while it works:
# the bar follows how much the watched folders grew, against the size expected for the step.
function Rodar([string]$exe, [string[]]$argumentos, [double]$de = -1, [double]$ate = -1, [string]$etapa = '', [string[]]$pastas = @(), [double]$esperadoMB = 0, [double]$baseMB = 0) {
    $out = Join-Path $Runtime "saida.$PID.txt"
    $err = Join-Path $Runtime "erro.$PID.txt"
    $citados = $argumentos | ForEach-Object { if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ } }
    $p = Start-Process -FilePath $exe -ArgumentList ($citados -join ' ') -NoNewWindow -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
    $null = $p.Handle   # keeps ExitCode readable after the process ends (PowerShell 5.1 quirk)
    $inicioMB = 0
    if ($pastas.Count -gt 0) { $inicioMB = Tamanho-MB $pastas }
    while (-not $p.WaitForExit(500)) {
        if ($de -ge 0) {
            $alvo = $de
            if ($pastas.Count -gt 0 -and $esperadoMB -gt 0) {
                $cresceu = [Math]::Max(0, (Tamanho-MB $pastas) - $inicioMB)
                $script:BaixadoMB = [Math]::Max($script:BaixadoMB, $baseMB + [Math]::Min($cresceu, $esperadoMB))
                $alvo = $de + ($ate - $de) * [Math]::Min(0.97, $cresceu / $esperadoMB)
            }
            Progresso $alvo $etapa
        }
        else {
            Gravar-Estado 'instalando' $script:Etapa
        }
    }
    $p.WaitForExit()
    $codigo = $p.ExitCode
    $texto = ((@(Get-Content $out -ErrorAction SilentlyContinue) + @(Get-Content $err -ErrorAction SilentlyContinue)) | Out-String).Trim()
    Remove-Item -Force $out, $err -ErrorAction SilentlyContinue
    if ($texto) { Escrever-Log $texto }
    $script:UltimaSaida = $texto
    if ($de -ge 0 -and $codigo -eq 0) {
        if ($esperadoMB -gt 0) { $script:BaixadoMB = [Math]::Max($script:BaixadoMB, $baseMB + $esperadoMB) }
        Progresso $ate $etapa
    }
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
        $script:Pct = 100; $script:Etapa = 'Voz natural pronta'
        Gravar-Estado 'pronto' 'A voz ja estava pronta.'
        exit 0
    }
    Escrever-Log "inicio (dados: $Dados)"
    Progresso 1 'Preparando a voz natural'

    # TLS 1.2 for GitHub on older Windows 10 builds.
    try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }

    # 1. uv, the tool that downloads Python and the packages (0-35%).
    $UvDir = Join-Path $Runtime 'uv'
    $Uv = Get-ChildItem -Path $UvDir -Recurse -Filter 'uv.exe' -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
    if (-not $Uv) {
        $arq = 'x86_64'
        if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { $arq = 'aarch64' }
        $url = "https://github.com/astral-sh/uv/releases/latest/download/uv-$arq-pc-windows-msvc.zip"
        $zip = Join-Path $Runtime 'uv.zip'
        Escrever-Log "baixando uv: $url"
        Baixar $url $zip 1 33 'Baixando o instalador da voz'
        Escrever-Log ('uv baixado: {0:N1} MB' -f ((Get-Item $zip).Length / 1MB))
        if (Test-Path $UvDir) { Remove-Item -Recurse -Force $UvDir }
        Expand-Archive -Path $zip -DestinationPath $UvDir -Force
        Remove-Item -Force $zip
        $Uv = Get-ChildItem -Path $UvDir -Recurse -Filter 'uv.exe' | Select-Object -First 1 -ExpandProperty FullName
        if (-not $Uv) { throw 'uv.exe nao veio no arquivo baixado' }
    }
    $uvMB = $script:BaixadoMB
    if ($uvMB -le 0) { $uvMB = 14.5 }
    $script:TotalMB = [Math]::Max($script:TotalMB, $uvMB + $PythonMB + $PacotesMB)
    $script:BaixadoMB = $uvMB
    Progresso 35 'Instalador pronto'
    Escrever-Log "uv: $Uv"

    # uv keeps its Python and cache inside the runtime folder, away from anything else on the PC.
    $env:UV_PYTHON_INSTALL_DIR = Join-Path $Runtime 'python'
    $env:UV_CACHE_DIR = Join-Path $Runtime 'cache'
    $env:UV_PYTHON_PREFERENCE = 'only-managed'
    $env:UV_NO_CONFIG = '1'
    $env:UV_NO_PROGRESS = '1'

    # 2. The virtual environment with its own Python 3.12 (35-75%).
    $venvOk = $false
    if (Test-Path $Py) {
        $venvOk = ((Rodar $Py @('-c', 'import sys')) -eq 0)
    }
    if (-not $venvOk) {
        Escrever-Log 'criando o ambiente com Python 3.12'
        $codigo = Rodar $Uv @('venv', (Join-Path $Runtime 'venv'), '--python', '3.12', '--clear') 35 75 'Baixando a voz natural' @($env:UV_PYTHON_INSTALL_DIR, $env:UV_CACHE_DIR) $PythonMB $uvMB
        if ($codigo -ne 0) { throw "uv venv falhou ($codigo)" }
    }
    $script:BaixadoMB = [Math]::Max($script:BaixadoMB, $uvMB + $PythonMB)
    Progresso 75 'Baixando a voz natural'

    # 3. The packages: edge-tts for the voice, the rest to hear when the Claude microphone is on (75-95%).
    Escrever-Log ('instalando: ' + ($Pacotes -join ' '))
    $codigo = Rodar $Uv (@('pip', 'install', '--python', $Py) + $Pacotes) 75 95 'Instalando a voz natural' @($env:UV_CACHE_DIR, (Join-Path $Runtime 'venv')) $PacotesMB ($uvMB + $PythonMB)
    if ($codigo -ne 0) { throw "uv pip install falhou ($codigo)" }

    # 4. Proof that it all imports (95-100%).
    $codigo = Rodar $Py @('-c', "import edge_tts, comtypes, pycaw, psutil; print('ok')") 95 99 'Conferindo a voz'
    if ($codigo -ne 0 -or $script:UltimaSaida -notmatch 'ok') { throw "teste de importacao falhou: $($script:UltimaSaida)" }

    if (-not (Test-Path $Pyw)) { $Pyw = $Py }
    Gravar-Json $Pronto @{ python = $Py; pythonw = $Pyw; uv = $Uv; versao = $Versao; quando = (Get-Date -Format 's') }
    $script:Pct = 100; $script:BaixadoMB = $script:TotalMB; $script:Etapa = 'Voz natural pronta'
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
