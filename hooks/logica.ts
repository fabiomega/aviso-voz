// Pure rules of the aviso-voz plugin: paths, settings, runtime state and the
// built-in-voice fallback. No `$` here, so every rule is testable on its own.

export const VERSAO = '1.1.0'

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
  avisar_ao_terminar: true,
  avisar_quando_precisa: true,
  respostas_curtas: false,
  minimo_tarefa_segundos: 20,
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
  /** The installer's live progress: what it is doing, 0–100, and the megabytes behind the bar. */
  etapa?: string
  pct?: number
  baixadoMB?: number
  totalMB?: number
  /** Seconds since the epoch; the installer refreshes it at least every couple of seconds. */
  heartbeat?: number
}

/** An install that has not written for this long is dead, and a new one may start. */
export const BATIMENTO_MORTO_SEG = 60

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
  // Before 1.1.0 "so_quando_espera" silenced finished tasks; the two switches replace it.
  delete (cfg as Record<string, unknown>).so_quando_espera
  return cfg
}

/**
 * Why a notice stays silent ('' = speak), the same rule aviso.py applies:
 * each kind has its switch, and one minimum time covers both unless
 * "Falar todas" is on. An unknown duration counts as a long task.
 */
export function motivoCalar(cfg: Cfg, tipo: 'concluido' | 'precisa', durSeg: number | undefined): string {
  if (tipo === 'concluido' && cfg.avisar_ao_terminar === false) return 'interruptor-terminar'
  if (tipo === 'precisa' && cfg.avisar_quando_precisa === false) return 'interruptor-precisa'
  const minimo = Number(cfg.minimo_tarefa_segundos ?? PADRAO.minimo_tarefa_segundos)
  if (cfg.respostas_curtas !== true && durSeg !== undefined && durSeg < minimo) return 'curto'

  return ''
}

/** The runtime as the installer left it: pronto.json wins, then estado.json. */
export function lerRuntime(prontoTexto: string | undefined, estadoTexto: string | undefined): Runtime {
  const pronto = lerJson(prontoTexto)
  if (pronto !== undefined && typeof pronto.python === 'string' && pronto.python !== '') {
    return { fase: 'pronto', python: pronto.python }
  }
  const estado = lerJson(estadoTexto)
  if (estado !== undefined && (estado.fase === 'instalando' || estado.fase === 'falhou')) {
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
    const quando = Number(estado.quando ?? 0)
    return {
      fase: estado.fase,
      mensagem: String(estado.mensagem ?? ''),
      quando,
      etapa: typeof estado.etapa === 'string' ? estado.etapa : undefined,
      pct: num(estado.pct),
      baixadoMB: num(estado.baixadoMB),
      totalMB: num(estado.totalMB),
      heartbeat: num(estado.heartbeat) ?? quando,
    }
  }

  return { fase: 'ausente' }
}

/** An install still beating: its heartbeat is younger than BATIMENTO_MORTO_SEG. */
export function instalacaoViva(r: Runtime, agoraSeg: number): boolean {
  return r.fase === 'instalando' && agoraSeg - Number(r.heartbeat ?? r.quando ?? 0) < BATIMENTO_MORTO_SEG
}

/** 0–100, clamped; undefined while the installer has not said. */
export function pctDe(r: Runtime): number {
  return Math.max(0, Math.min(100, Math.round(Number(r.pct ?? 0))))
}

/** "Baixando a voz natural… 45% · 18 de 40 MB" */
export function textoProgresso(r: Runtime): string {
  const etapa = (r.etapa ?? 'Preparando a voz natural').replace(/[.…]+$/, '')
  const mb =
    r.baixadoMB !== undefined && r.totalMB !== undefined && r.totalMB > 0
      ? ` · ${Math.round(Math.min(r.baixadoMB, r.totalMB))} de ${Math.round(r.totalMB)} MB`
      : ''

  return `${etapa}… ${pctDe(r)}%${mb}`
}

/** A full-row bar of blocks for the terminal, `largura` cells wide. */
export function barraTexto(pct: number, largura: number): string {
  const total = Math.max(4, Math.floor(largura))
  const cheios = Math.round((Math.max(0, Math.min(100, pct)) / 100) * total)

  return '█'.repeat(cheios) + '░'.repeat(total - cheios)
}

/** The estado.json the plugin writes before launching, so other windows see an install is on its way. */
export function estadoInicial(agoraSeg: number): string {
  return JSON.stringify({
    fase: 'instalando',
    mensagem: 'Preparando a voz pela primeira vez.',
    etapa: 'Preparando a voz natural',
    pct: 0,
    heartbeat: agoraSeg,
    quando: agoraSeg,
    versao: VERSAO,
  })
}

export function estadoFalhou(agoraSeg: number, mensagem: string): string {
  return JSON.stringify({ fase: 'falhou', mensagem, heartbeat: agoraSeg, quando: agoraSeg, versao: VERSAO })
}

/** One line for instalacao.log, in the installer's own format. */
export function linhaLog(agoraMs: number, texto: string): string {
  const d = new Date(agoraMs)
  const p = (n: number) => String(n).padStart(2, '0')
  const quando = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`

  return `${quando} [plugin] ${texto}`
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
 * prepared, under the same switches and minimum time as aviso.py.
 * `durSeg` is how long the task has run; undefined when unknown.
 */
export function fraseReserva(
  comando: string,
  e: Record<string, unknown>,
  cfg: Cfg,
  durSeg?: number,
): string | undefined {
  if (comando === 'notificacao') {
    const tipo = String(e.notification_type ?? '')
    if (!NOTIFICACOES_FALADAS.includes(tipo)) return undefined
    if (motivoCalar(cfg, 'precisa', durSeg) !== '') return undefined
    return tipo === 'permission_prompt' ? chamar(cfg, 'preciso da sua autorização.') : chamar(cfg, 'tenho uma pergunta para você.')
  }
  if (comando === 'stop') {
    if (e.stop_hook_active === true) return undefined
    const resposta = String(e.last_assistant_message ?? '').trim()
    if (resposta === '') return undefined
    const tipo = resposta.endsWith('?') ? 'precisa' : 'concluido'
    if (motivoCalar(cfg, tipo, durSeg) !== '') return undefined
    return tipo === 'precisa' ? chamar(cfg, 'terminei e tenho uma pergunta para você.') : chamar(cfg, 'terminei.')
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

// Starts the installer detached; if Windows refuses, the reason goes to stdout so the plugin can log it.
export const LANCAR_INSTALADOR =
  "try { $p = Start-Process -WindowStyle Hidden -FilePath powershell.exe -ArgumentList $env:AVISO_VOZ_ARGS -PassThru -ErrorAction Stop; 'iniciado ' + $p.Id } catch { 'erro ' + $_.Exception.Message; exit 1 }"

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
    `Quando termina: ${cfg.avisar_ao_terminar === false ? 'silêncio' : 'falo'} · quando precisa de você: ${cfg.avisar_quando_precisa === false ? 'silêncio' : 'falo'} · mínimo: ${cfg.respostas_curtas === true ? 'nenhum (falar todas)' : `${Number(cfg.minimo_tarefa_segundos ?? PADRAO.minimo_tarefa_segundos)}s`}`,
    `Voz escolhida: ${cfg.voz} · tamanho: ${cfg.tamanho} · repetir: ${Number(cfg.repetir_minutos) > 0 ? `a cada ${cfg.repetir_minutos} min` : 'não'}`,
    `Nome: ${String(cfg.nome ?? '').trim() || '(nenhum)'}${silencio > 0 ? ` · em silêncio por mais ${silencio} min` : ''}`,
  ]
  if (r.fase !== 'pronto') linhas.push('Para preparar a voz de novo: /aviso-voz instalar')

  return linhas.join('\n')
}
