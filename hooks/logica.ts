// Pure rules of the aviso-voz plugin: paths, settings, runtime state and the
// built-in-voice fallback. No `$` here, so every rule is testable on its own.

export const VERSAO = '1.0.0'

/** The settings aviso.py starts from; config.json holds only what the person changed. */
export const PADRAO = {
  ligado: true,
  voz: 'pt-BR-FranciscaNeural',
  velocidade: '+0%',
  volume: 100,
  nome: '',
  tamanho: 'curta',
  limite_segundos: 90,
  calar_com_microfone: true,
  respostas_curtas: false,
  minimo_tarefa_segundos: 20,
  so_quando_espera: true,
  repetir_minutos: 5,
  repeticao_crescente: true,
  max_repeticoes: 6,
  silencio_ate: 0,
  horario_silencio: { ligado: false, inicio: '22:00', fim: '07:00' },
  prefixo_projeto: 'auto',
}

export type Cfg = typeof PADRAO

/** The classic events the plugin forwards, and the aviso.py command each one runs. */
export const COMANDO_DO_EVENTO = {
  Stop: 'stop',
  UserPromptSubmit: 'parar',
  Notification: 'notificacao',
} as const

/** Only these notifications mean "Claude is waiting for you"; the rest stay silent. */
export const NOTIFICACOES_FALADAS = ['permission_prompt', 'elicitation_dialog']

export type Fase = 'pronto' | 'instalando' | 'falhou' | 'ausente'

export type Runtime = {
  fase: Fase
  python?: string
  mensagem?: string
  /** Seconds since the epoch of the last estado.json write. */
  quando?: number
}

/** Joins Windows path parts, whatever separators each part already has. */
export function caminho(...partes: string[]): string {
  return partes
    .filter(p => p !== '')
    .map((p, i) => (i === 0 ? p.replace(/[\\/]+$/, '') : p.replace(/^[\\/]+|[\\/]+$/g, '')))
    .join('\\')
}

/** Where the settings, queue, cache and voice runtime live: AVISO_VOZ_DIR, else %USERPROFILE%\.claude\aviso-voz. */
export function pastaDados(avisoVozDir: string | undefined, userProfile: string | undefined): string {
  if (avisoVozDir !== undefined && avisoVozDir.trim() !== '') return avisoVozDir.trim()
  return caminho(userProfile ?? 'C:\\Users\\Public', '.claude', 'aviso-voz')
}

export function arquivos(dados: string, raizPlugin: string) {
  return {
    config: caminho(dados, 'config.json'),
    pronto: caminho(dados, 'runtime', 'pronto.json'),
    estado: caminho(dados, 'runtime', 'estado.json'),
    log: caminho(dados, 'instalacao.log'),
    script: caminho(raizPlugin, 'scripts', 'aviso.py'),
    instalador: caminho(raizPlugin, 'scripts', 'instalar.ps1'),
  }
}

/** JSON as PowerShell 5.1 or Python may write it: a leading BOM is dropped. */
export function lerJson(texto: string | undefined): any {
  if (texto === undefined) return undefined
  try {
    return JSON.parse(texto.replace(/^\uFEFF/, ''))
  } catch {
    return undefined
  }
}

export function mesclarCfg(bruto: unknown): Cfg {
  const cfg = JSON.parse(JSON.stringify(PADRAO)) as Cfg
  if (bruto === null || typeof bruto !== 'object') return cfg
  for (const [k, v] of Object.entries(bruto as Record<string, unknown>)) {
    const atual = (cfg as Record<string, unknown>)[k]
    if (v !== null && typeof v === 'object' && atual !== null && typeof atual === 'object') {
      Object.assign(atual as object, v)
    } else {
      ;(cfg as Record<string, unknown>)[k] = v
    }
  }
  return cfg
}

/** The runtime as the installer left it: pronto.json wins, then estado.json. */
export function lerRuntime(prontoTexto: string | undefined, estadoTexto: string | undefined): Runtime {
  const pronto = lerJson(prontoTexto)
  if (pronto !== undefined && typeof pronto.python === 'string' && pronto.python !== '') {
    return { fase: 'pronto', python: pronto.python }
  }
  const estado = lerJson(estadoTexto)
  if (estado !== undefined && (estado.fase === 'instalando' || estado.fase === 'falhou')) {
    return { fase: estado.fase, mensagem: String(estado.mensagem ?? ''), quando: Number(estado.quando ?? 0) }
  }

  return { fase: 'ausente' }
}

/** An install still running, or one that died without saying so (older than 20 minutes is dead). */
export function instalacaoViva(r: Runtime, agoraSeg: number): boolean {
  return r.fase === 'instalando' && agoraSeg - Number(r.quando ?? 0) < 20 * 60
}

export function silenciado(cfg: Cfg, agoraSeg: number): boolean {
  return cfg.ligado === false || Number(cfg.silencio_ate ?? 0) > agoraSeg
}

/** Puts the person's name in front when they set one. */
export function chamar(cfg: Cfg, frase: string): string {
  const nome = String(cfg.nome ?? '').trim()
  if (nome === '') return frase.charAt(0).toUpperCase() + frase.slice(1)

  return `${nome}, ${frase.charAt(0).toLowerCase()}${frase.slice(1)}`
}

/**
 * What the built-in Windows voice says while the neural voice is still being
 * prepared: only the moments that need the person, never a plain "done".
 */
export function fraseReserva(comando: string, e: Record<string, unknown>, cfg: Cfg): string | undefined {
  if (comando === 'notificacao') {
    const tipo = String(e.notification_type ?? '')
    if (!NOTIFICACOES_FALADAS.includes(tipo)) return undefined
    return tipo === 'permission_prompt' ? chamar(cfg, 'preciso da sua autorização.') : chamar(cfg, 'tenho uma pergunta para você.')
  }
  if (comando === 'stop') {
    const resposta = String(e.last_assistant_message ?? '').trim()
    if (e.stop_hook_active === true || !resposta.endsWith('?')) return undefined
    return chamar(cfg, 'terminei e tenho uma pergunta para você.')
  }

  return undefined
}

/**
 * The PowerShell that launches the installer detached, so it outlives the
 * call; the paths travel in an environment variable, never inside the code.
 */
export function argumentosInstalador(instalador: string, dados: string, forcar: boolean): string {
  return `-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${instalador}" -Dados "${dados}"${forcar ? ' -Forcar' : ''}`
}

export const LANCAR_INSTALADOR =
  'Start-Process -WindowStyle Hidden -FilePath powershell.exe -ArgumentList $env:AVISO_VOZ_ARGS'

/** The built-in Windows voice (SAPI), with a Brazilian voice when one is installed. */
export const FALAR_SAPI =
  "Add-Type -AssemblyName System.Speech;$s=New-Object System.Speech.Synthesis.SpeechSynthesizer;" +
  "$v=$s.GetInstalledVoices()|Where-Object{$_.VoiceInfo.Culture.Name -eq 'pt-BR'}|Select-Object -First 1;" +
  'if($v){$s.SelectVoice($v.VoiceInfo.Name)};$s.Speak($env:AVISO_TXT)'

export function textoFase(r: Runtime): string {
  if (r.fase === 'pronto') return 'Voz pronta'
  if (r.fase === 'instalando') return 'Preparando a voz…'
  if (r.fase === 'falhou') return 'Não consegui preparar a voz'

  return 'Voz ainda não preparada'
}

export function resumoStatus(r: Runtime, cfg: Cfg, agoraSeg: number, isWindows: boolean): string {
  if (!isWindows) return 'Aviso por voz: só funciona no Windows por enquanto.'
  const silencio = Math.max(0, Math.ceil((Number(cfg.silencio_ate ?? 0) - agoraSeg) / 60))
  const linhas = [
    `Aviso por voz ${VERSAO}: ${cfg.ligado === false ? 'desligado' : 'ligado'}`,
    `Voz: ${textoFase(r)}${r.fase === 'falhou' && r.mensagem ? ` (${r.mensagem})` : ''}`,
    `Voz escolhida: ${cfg.voz} · tamanho: ${cfg.tamanho} · repetir: ${Number(cfg.repetir_minutos) > 0 ? `a cada ${cfg.repetir_minutos} min` : 'não'}`,
    `Nome: ${String(cfg.nome ?? '').trim() || '(nenhum)'}${silencio > 0 ? ` · em silêncio por mais ${silencio} min` : ''}`,
  ]
  if (r.fase !== 'pronto') linhas.push('Para preparar a voz de novo: /aviso-voz instalar')

  return linhas.join('\n')
}
