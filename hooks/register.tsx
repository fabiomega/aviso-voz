import type { Register } from 'claude-code'

import {
  BATIMENTO_MORTO_SEG,
  COMANDO_DO_EVENTO,
  FALAR_SAPI,
  LANCAR_INSTALADOR,
  NOTIFICACOES_FALADAS,
  PADRAO,
  VERSAO,
  argumentosInstalador,
  arquivos,
  barraTexto,
  estadoFalhou,
  estadoInicial,
  fraseReserva,
  instalacaoViva,
  lerJson,
  lerRuntime,
  linhaLog,
  mesclarCfg,
  pastaDados,
  pctDe,
  resumoStatus,
  silenciado,
  textoFase,
  textoProgresso,
  type Cfg,
  type Runtime,
} from './logica'

const PANE = 'aviso-voz'
const TITULO = 'Aviso por voz'

// Colors named by meaning, so the pane follows the person's own theme.
const C = { text: 'text', muted: 'inactive', hair: 'subtle', good: 'success', warn: 'warning', bad: 'error' } as const

// The download bar: a vivid orange on a neutral track, readable on light and dark themes.
const COR_BARRA = '#F97316'
const COR_TRILHO = '#9CA3AF55'

const VOZES = [
  ['Francisca', 'pt-BR-FranciscaNeural', 'Natural, a padrão'],
  ['Thalita', 'pt-BR-ThalitaMultilingualNeural', 'Suave, multilíngue'],
  ['Antonio', 'pt-BR-AntonioNeural', 'Voz masculina'],
] as const

const TAMANHOS = [
  ['Curta', 'curta'],
  ['Média', 'media'],
  ['Detalhada', 'detalhada'],
  ['Completa', 'completa'],
] as const

const SILENCIOS = [
  ['30 min', 30],
  ['1 h', 60],
  ['2 h', 120],
] as const

const REPETICOES = [
  ['Desligada', 0],
  ['5 min', 5],
  ['10 min', 10],
  ['15 min', 15],
] as const

// Whether the pane opens by itself; closing it by hand turns it off, /aviso-voz turns it back on.
const PANE_AUTO_KEY = 'paneAuto'
const AVISO_SO_WINDOWS_KEY = 'avisoSoWindows'

// When each window's current request was sent, so the built-in-voice fallback
// can apply the same minimum time as aviso.py (which reads it from the transcript).
const inicioPedido = new Map<string, number>()

// The first-run download. Every trigger (session start, first prompt, end of a turn, opening
// the panel) calls garantirVoz; this window starts at most one install per minute, and
// estado.json's heartbeat keeps other windows from starting a second one meanwhile.
let autoReinicios = 0
let acompanhamento: { cancel: () => void } | undefined
let ultimoEstado = ''

// Set once, across conversations, when the first automatic download has been announced.
const PRIMEIRA_INSTALACAO_KEY = 'primeiraInstalacaoAvisada'
// When this computer last launched the installer (ms), so triggers in a row start it once.
const INICIADO_EM_KEY = 'instaladorIniciadoEm'

type Ambiente = { isWindows: boolean; isResumo: boolean; dados: string; f: ReturnType<typeof arquivos> }

async function ambiente($: any): Promise<Ambiente> {
  const [os, dir, perfil, resumo] = await Promise.all([
    $.env.get('OS'),
    $.env.get('AVISO_VOZ_DIR'),
    $.env.get('USERPROFILE'),
    $.env.get('AVISO_VOZ_RESUMO'),
  ])
  const dados = pastaDados(dir, perfil)

  return {
    isWindows: os === 'Windows_NT',
    isResumo: resumo !== undefined && resumo !== '',
    dados,
    f: arquivos(dados, $.plugin.root),
  }
}

async function ler($: any, arquivo: string): Promise<string | undefined> {
  try {
    return await $.fs.read(arquivo)
  } catch {
    return undefined
  }
}

async function lerCfg($: any, amb: Ambiente): Promise<Cfg> {
  return mesclarCfg(lerJson(await ler($, amb.f.config)))
}

async function runtime($: any, amb: Ambiente): Promise<Runtime> {
  const [pronto, estado] = await Promise.all([ler($, amb.f.pronto), ler($, amb.f.estado)])

  return lerRuntime(pronto, estado)
}

/** Read, change one key, write back: aviso.py rereads config.json on every use. */
async function mudarCfg($: any, amb: Ambiente, chave: string, valor: unknown) {
  const atual = (lerJson(await ler($, amb.f.config)) ?? {}) as Record<string, unknown>
  delete atual.so_quando_espera // retired in 1.1.0: the two switches decide now
  atual[chave] = valor
  await $.fs.write(amb.f.config, JSON.stringify(atual, null, 2))
}

async function falarReserva($: any, texto: string) {
  await $.process.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', FALAR_SAPI], {
    env: { AVISO_TXT: texto },
    timeoutMs: 30000,
  })
}

/** Runs aviso.py with the runtime's Python, the event's JSON on its standard input. */
async function rodarAviso($: any, amb: Ambiente, python: string, args: string[], entrada?: unknown) {
  return $.process.run([python, amb.f.script, ...args], {
    env: { AVISO_VOZ_DIR: amb.dados, PYTHONIOENCODING: 'utf-8' },
    ...(entrada === undefined ? {} : { stdin: JSON.stringify(entrada) }),
    timeoutMs: 15000,
  })
}

/**
 * Hands one classic event to aviso.py. Before the neural voice is ready, the
 * moments that need the person are said with the built-in Windows voice.
 */
async function encaminhar($: any, comando: string, e: Record<string, unknown>) {
  const amb = await ambiente($)
  if (!amb.isWindows || amb.isResumo) return
  const agoraMs = await $.clock.now()
  const sid = String(e.session_id ?? '')
  if (comando === COMANDO_DO_EVENTO.UserPromptSubmit) inicioPedido.set(sid, agoraMs)
  const r = await runtime($, amb)
  if (r.fase === 'pronto' && r.python !== undefined) {
    await rodarAviso($, amb, r.python, [comando], e)
    return
  }
  const cfg = await lerCfg($, amb)
  if (silenciado(cfg, agoraMs / 1000)) return
  const inicio = inicioPedido.get(sid)
  const frase = fraseReserva(comando, e, cfg, inicio === undefined ? undefined : (agoraMs - inicio) / 1000)
  if (frase !== undefined) await falarReserva($, frase)
}

/** Adds a line to instalacao.log, so nothing about the download is ever silent. */
async function registrar($: any, amb: Ambiente, texto: string) {
  try {
    const antes = (await ler($, amb.f.log)) ?? ''
    await $.fs.write(amb.f.log, `${antes}${antes === '' || antes.endsWith('\n') ? '' : '\n'}${linhaLog(await $.clock.now(), texto)}\n`)
  } catch {
    // The log is a help, not a requirement.
  }
}

/**
 * Starts the installer detached (it outlives this call). The plugin writes estado.json
 * first, so the panel shows the bar at once and other windows wait; a launch Windows
 * refuses is written to the log and to estado.json as a failure.
 */
async function instalar($: any, amb: Ambiente, forcar: boolean, motivo: string) {
  const agoraMs = await $.clock.now()
  await $.store.set(INICIADO_EM_KEY, agoraMs)
  try {
    await $.fs.write(amb.f.estado, estadoInicial(Math.floor(agoraMs / 1000)))
  } catch {
    // The installer writes it too; this only makes the panel react sooner.
  }
  await registrar($, amb, `abrindo o instalador (${motivo})`)
  let falha = ''
  try {
    const res = await $.process.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', LANCAR_INSTALADOR], {
      env: { AVISO_VOZ_ARGS: argumentosInstalador(amb.f.instalador, amb.dados, forcar) },
      timeoutMs: 30000,
    })
    if (res.exitCode !== 0) falha = String(res.stdout || res.stderr || `código ${res.exitCode}`).trim()
  } catch (err) {
    falha = err instanceof Error ? err.message : String(err)
  }
  if (falha !== '') {
    const msg = `não consegui abrir o instalador: ${falha.slice(0, 300)}`
    await registrar($, amb, msg)
    try {
      await $.fs.write(amb.f.estado, estadoFalhou(Math.floor((await $.clock.now()) / 1000), msg))
    } catch {
      // Nothing else to do: the panel still offers "Tentar de novo".
    }
  }
  acompanhar($, amb)
}

/**
 * Polls estado.json every second while the download runs and redraws the panel when it
 * moves; stops on pronto or falhou. A dead installer (no heartbeat) is restarted twice at most.
 */
function acompanhar($: any, amb: Ambiente) {
  acompanhamento?.cancel()
  let voltas = 0
  const timer = $.clock.every(1000, () => {
    void (async () => {
      voltas += 1
      const texto = (await ler($, amb.f.estado)) ?? ''
      const r = await runtime($, amb)
      if (texto !== ultimoEstado || r.fase !== 'instalando') {
        ultimoEstado = texto
        $.ui.invalidate('ui.render')
      }
      if (r.fase === 'pronto') {
        timer.cancel()
        acompanhamento = undefined
        $.ui.toast('Aviso por voz pronto: a partir de agora eu falo com você com a voz natural.')
      } else if (r.fase === 'falhou') {
        timer.cancel()
        acompanhamento = undefined
        $.ui.toast('Aviso por voz: não consegui preparar a voz. Abra /aviso-voz e toque em "Tentar de novo".')
      } else if (r.fase === 'instalando' && !instalacaoViva(r, (await $.clock.now()) / 1000)) {
        timer.cancel()
        acompanhamento = undefined
        await registrar($, amb, 'o instalador parou de responder')
        if (autoReinicios < 2) {
          autoReinicios += 1
          await $.store.set(INICIADO_EM_KEY, 0)
          await garantirVoz($, 'instalador parado')
        }
      } else if (voltas >= 20 * 60) {
        timer.cancel() // twenty minutes: the panel keeps showing what the installer last said
        acompanhamento = undefined
      }
    })().catch(() => undefined)
  })
  acompanhamento = timer
}

/** Opens the pane unless it is on screen already or the person closed it. */
async function abrirPainel($: any) {
  if ((await $.store.get(PANE_AUTO_KEY)) === false) return
  if ((await $.ui.panes()).some((p: any) => p.id === PANE && p.isPlaced)) return
  await $.ui.open({ id: PANE, title: TITULO })
}

/**
 * Makes sure the neural voice exists or is on its way, from any trigger. Starts the
 * download by itself the first time; the first automatic start also opens the panel
 * so the person sees the bar.
 */
async function garantirVoz($: any, motivo: string) {
  const amb = await ambiente($)
  if (amb.isResumo) return
  if (!amb.isWindows) {
    if ((await $.store.get(AVISO_SO_WINDOWS_KEY)) !== true) {
      await $.store.set(AVISO_SO_WINDOWS_KEY, true)
      $.ui.toast('Aviso por voz: só funciona no Windows por enquanto.')
    }
    return
  }
  // pronto.json alone first: once the voice is ready, a trigger costs one small read.
  if (lerRuntime(await ler($, amb.f.pronto), undefined).fase === 'pronto') return
  const r = await runtime($, amb)
  if (r.fase === 'pronto') return
  const agoraMs = await $.clock.now()
  if (instalacaoViva(r, agoraMs / 1000)) {
    if (acompanhamento === undefined) acompanhar($, amb)
    return
  }
  // A failure waits for "Tentar de novo"; only a never-started or dead install starts here.
  if (r.fase === 'falhou') return
  if (agoraMs - Number((await $.store.get(INICIADO_EM_KEY)) ?? 0) < BATIMENTO_MORTO_SEG * 1000) return
  const primeira = (await $.store.get(PRIMEIRA_INSTALACAO_KEY)) !== true
  if (primeira) {
    await $.store.set(PRIMEIRA_INSTALACAO_KEY, true)
    $.ui.toast('Preparando a voz natural pela primeira vez… acompanhe no painel (cerca de 1 minuto).')
    void abrirPainel($).catch(() => undefined)
  }
  await instalar($, amb, r.fase === 'instalando', motivo)
}

/** Fire-and-forget from any hook: never delays or breaks the event that called it. */
function garantirDepois($: any, motivo: string) {
  $.clock.after(0, () => void garantirVoz($, motivo).catch(() => undefined))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'aviso-voz',
      description: 'Aviso por voz: abre o painel (instalar · status · testar)',
      argumentHint: '[instalar | status | testar]',
    })
    // After the start settles, so nothing here delays the session or a surface not ready yet.
    // session.start also fires when the plugin is enabled or reloaded mid-session.
    $.clock.after(0, () => void abrirPainel($).catch(() => undefined))
    garantirDepois($, 'início da sessão')
    // A second look a little later, for a surface or a session that was not ready at the start.
    $.clock.after(2000, () => void garantirVoz($, 'início da sessão (2 s)').catch(() => undefined))

    return started
  })

  // The first moments of use are triggers too, in case the start was missed.
  on('turn.complete', ($, e, next) => {
    if (e.agentId === undefined) garantirDepois($, 'fim de uma resposta')
    return next(e)
  }).catch(($, e, next) => next(e))

  // The three moments, heard exactly as a settings hook would hear them; the
  // work runs after the hook returns, so the conversation never waits on it.
  on('classic.Stop', ($, e, next) => {
    const evento = { ...e }
    $.clock.after(0, () => void encaminhar($, COMANDO_DO_EVENTO.Stop, evento).catch(() => undefined))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.UserPromptSubmit', ($, e, next) => {
    const evento = { ...e }
    $.clock.after(0, () => void encaminhar($, COMANDO_DO_EVENTO.UserPromptSubmit, evento).catch(() => undefined))
    garantirDepois($, 'pedido enviado')
    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.Notification', ($, e, next) => {
    if (NOTIFICACOES_FALADAS.includes(String(e.notification_type))) {
      const evento = { ...e }
      $.clock.after(0, () => void encaminhar($, COMANDO_DO_EVENTO.Notification, evento).catch(() => undefined))
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // A pane that did not fit at the start opens on the first request.
  on('prompt.submit', async ($, e, next) => {
    void abrirPainel($).catch(() => undefined)
    garantirDepois($, 'primeiro pedido')
    return next(e)
  }).catch(($, e, next) => next(e))

  // Closing the pane by hand keeps it closed in the next conversations too.
  on('ui.close', async ($, e, next) => {
    const result = await next(e)
    if (e.id === PANE && e.origin.kind === 'person') await $.store.set(PANE_AUTO_KEY, false)
    return result
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'aviso-voz' }, async ($, e) => {
    try {
      const amb = await ambiente($)
      const arg = e.args.trim().toLowerCase()
      if (arg === 'status') {
        const [r, cfg, agora] = await Promise.all([runtime($, amb), lerCfg($, amb), $.clock.now()])
        return { text: resumoStatus(r, cfg, agora / 1000, amb.isWindows) }
      }
      if (!amb.isWindows) return { text: 'Aviso por voz: só funciona no Windows por enquanto.' }
      if (arg === 'instalar') {
        void instalar($, amb, true, 'comando /aviso-voz instalar').catch(() => undefined)
        void abrirPainel($).catch(() => undefined)
        return { text: 'Preparando a voz de novo (cerca de 1 minuto). A barra no painel mostra o andamento.' }
      }
      if (arg === 'testar') {
        const r = await runtime($, amb)
        const cfg = await lerCfg($, amb)
        if (r.fase === 'pronto' && r.python !== undefined) {
          void rodarAviso($, amb, r.python, ['testar']).catch(() => undefined)
          return { text: 'Tocando um aviso de teste com a voz escolhida.' }
        }
        void falarReserva($, 'Este é um teste do aviso por voz.').catch(() => undefined)
        return { text: `Tocando um teste com a voz do Windows. ${textoFase(r)}: a voz natural entra quando estiver pronta.` }
      }
      await $.store.set(PANE_AUTO_KEY, true)
      void $.ui.open({ id: PANE, title: TITULO })
      garantirDepois($, 'painel aberto')
      return { text: 'Painel do aviso por voz aberto. Também: /aviso-voz status · /aviso-voz testar · /aviso-voz instalar' }
    } catch {
      return { text: 'Aviso por voz: algo falhou agora. Tente /aviso-voz status.' }
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Input } = $.ui.resolve(e) as any
    const amb = await ambiente($)
    const [cfg, r, agoraMs] = await Promise.all([lerCfg($, amb), runtime($, amb), $.clock.now()])
    const ligado = cfg.ligado !== false
    const curtas = cfg.respostas_curtas === true
    const aoTerminar = cfg.avisar_ao_terminar !== false
    const quandoPrecisa = cfg.avisar_quando_precisa !== false
    const calar = cfg.calar_com_microfone !== false
    const minimo = Number(cfg.minimo_tarefa_segundos ?? PADRAO.minimo_tarefa_segundos)
    const vozAtual = VOZES.find(v => v[1] === cfg.voz) ?? VOZES[0]
    const silencioMin = Math.max(0, Math.ceil((Number(cfg.silencio_ate ?? 0) - agoraMs / 1000) / 60))
    const nome = String(cfg.nome ?? '').trim()

    const redraw = () => $.ui.invalidate('ui.render')
    const set = async (chave: string, valor: unknown, texto: string) => {
      await mudarCfg($, amb, chave, valor)
      $.ui.toast(texto)
      redraw()
    }

    const title = (label: string) => (
      <Text size="footnote" weight="semibold" color={C.muted}>
        {label}
      </Text>
    )
    const hint = (label: string) => (
      <Text size="caption" color={C.muted}>
        {label}
      </Text>
    )
    const card = (key: string, children: unknown) => (
      <Box key={key} flexDirection="column" borderStyle="round" borderColor={C.hair} paddingX={2} paddingY={1} gap={1}>
        {children}
      </Box>
    )
    // One choice among several: the chosen one is filled, the rest are quiet.
    const choice = (key: string, label: string, isOn: boolean, onPress: () => unknown) => (
      <Button key={key} label={label} variant={isOn ? 'primary' : 'secondary'} onPress={onPress} />
    )
    const row = (children: unknown) => (
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        {children}
      </Box>
    )

    if (!amb.isWindows) {
      return (
        <Box flexDirection="column" gap={1} paddingY={1}>
          <Text size="heading" weight="bold" color={C.text}>
            {TITULO}
          </Text>
          {hint('O aviso por voz só funciona no Windows por enquanto.')}
        </Box>
      )
    }

    const header = (
      <Box key="header" flexDirection="row" justifyContent="space-between" alignItems="center" gap={1}>
        <Box flexDirection="column">
          <Text size="heading" weight="bold" color={C.text}>
            {TITULO}
          </Text>
          <Text color={C.muted}>{`${vozAtual[0]} · ${ligado ? 'ligado' : 'desligado'} · versão ${VERSAO}`}</Text>
        </Box>
        <Box flexDirection="row" gap={2} alignItems="center">
          <Text color={ligado ? C.good : C.muted} weight="semibold">
            {ligado ? '● ativo' : '○ pausado'}
          </Text>
          {ligado ? (
            <Button key="toggle" label="Desligar" onPress={() => set('ligado', false, 'Aviso por voz desligado')} />
          ) : (
            <Button key="toggle" label="Ligar" variant="primary" onPress={() => set('ligado', true, 'Aviso por voz ligado')} />
          )}
        </Box>
      </Box>
    )

    const corFase = r.fase === 'pronto' ? C.good : r.fase === 'falhou' ? C.bad : C.warn
    const viva = r.fase === 'instalando' && instalacaoViva(r, agoraMs / 1000)
    const pct = pctDe(r)
    // The download bar: thick and vivid, so it reads as "something is happening, wait".
    const isTerminal = e.surface === 'terminal'
    const largura = Math.max(10, Number(e.props?.bodyColumns ?? 40) - 6)
    const barra = isTerminal ? (
      <Text key="barra" color={COR_BARRA}>
        {barraTexto(pct, largura)}
      </Text>
    ) : (
      <Box key="barra" width="100%" height={1} minHeight={1} backgroundColor={COR_TRILHO} flexDirection="row">
        <Box width={`${Math.max(2, pct)}%`} height={1} minHeight={1} backgroundColor={COR_BARRA} />
      </Box>
    )
    const tentar = (
      <Button
        key="instalar"
        label="Tentar de novo"
        variant="primary"
        onPress={async () => {
          await instalar($, amb, true, 'botão Tentar de novo')
          redraw()
        }}
      />
    )
    const situacao = card(
      'situacao',
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap={1}>
          {title('VOZ NATURAL')}
          <Text size="caption" weight="semibold" color={viva ? COR_BARRA : corFase}>
            {r.fase === 'pronto' ? 'Voz natural pronta' : viva ? `${pct}%` : textoFase(r)}
          </Text>
        </Box>
        {r.fase === 'pronto' && (
          <Text color={C.good} weight="semibold">
            ✓ Voz natural pronta: os avisos usam a voz escolhida abaixo.
          </Text>
        )}
        {viva && (
          <Text color={C.text} weight="semibold">
            {textoProgresso(r)}
          </Text>
        )}
        {viva && barra}
        {viva && hint('Aguarde, isso só acontece uma vez (cerca de 1 minuto). Enquanto isso, uso a voz do Windows.')}
        {r.fase === 'falhou' && (
          <Text color={C.bad} weight="semibold">
            {`Não consegui preparar a voz: ${r.mensagem || 'sem detalhes'}`}
          </Text>
        )}
        {r.fase === 'falhou' && hint('Confira a internet (ou o antivírus) e toque em "Tentar de novo".')}
        {r.fase === 'ausente' && hint('Vou preparar a voz natural sozinho em instantes. Se não começar, toque abaixo.')}
        {r.fase === 'instalando' && !viva && hint('A preparação parou de responder.')}
        {(r.fase === 'falhou' || r.fase === 'ausente' || (r.fase === 'instalando' && !viva)) && tentar}
      </Box>,
    )

    const voz = card(
      'voz',
      <Box flexDirection="column" gap={1}>
        {title('VOZ')}
        {row(VOZES.map(([rotulo, id]) => choice(id, rotulo, id === vozAtual[1], () => set('voz', id, `Voz: ${rotulo}`))))}
        {hint(vozAtual[2])}
      </Box>,
    )

    const nomeCard = card(
      'nome',
      <Box flexDirection="column" gap={1}>
        {title('COMO TE CHAMAR')}
        <Input
          key="nome"
          label="Seu nome: "
          placeholder="ex.: Ana (deixe vazio para sem nome)"
          value={nome}
          submitLabel="salvar"
          onSubmit={async (v: string) => {
            const limpo = v.trim().slice(0, 40)
            await set('nome', limpo, limpo === '' ? 'Sem nome nos avisos' : `Vou te chamar de ${limpo}`)
          }}
        />
        {hint(nome === '' ? 'Os avisos começam direto, sem nome.' : `Ex.: "${nome}, preciso da sua autorização."`)}
      </Box>,
    )

    // An on/off switch drawn with the same chips as every other choice: the active side is filled.
    const interruptor = (key: string, rotulo: string, isOn: boolean, chave: string, ligadoMsg: string, desligadoMsg: string) => (
      <Box key={key} flexDirection="row" gap={1} flexWrap="wrap" alignItems="center">
        <Text color={C.text}>{rotulo}</Text>
        {choice(`${key}-on`, 'Ligado', isOn, () => set(chave, true, ligadoMsg))}
        {choice(`${key}-off`, 'Desligado', !isOn, () => set(chave, false, desligadoMsg))}
      </Box>
    )

    const curtasCard = card(
      'curtas',
      <Box flexDirection="column" gap={1}>
        {title('QUANDO AVISAR')}
        {interruptor(
          'terminar',
          'Quando termina',
          aoTerminar,
          'avisar_ao_terminar',
          'Aviso quando a tarefa termina',
          'Tarefas terminadas ficam em silêncio',
        )}
        {interruptor(
          'precisa',
          'Quando precisa de você',
          quandoPrecisa,
          'avisar_quando_precisa',
          'Aviso quando preciso de você',
          'Perguntas e autorizações ficam em silêncio',
        )}
        {row([
          choice('curtas-on', 'Falar todas', curtas, () => set('respostas_curtas', true, 'Falo qualquer resposta')),
          choice('curtas-off', `Só de ${minimo}s em diante`, !curtas, () =>
            set('respostas_curtas', false, `Só respostas de ${minimo}s em diante`),
          ),
        ])}
        {hint(
          curtas
            ? 'Qualquer resposta é falada, de qualquer duração. Erros sempre são falados.'
            : `Respostas mais rápidas que ${minimo}s ficam em silêncio, terminadas ou com pergunta. Erros sempre são falados.`,
        )}
        <Input
          key="minimo"
          label="Segundos mínimos: "
          placeholder="20"
          value={String(minimo)}
          submitLabel="salvar"
          onSubmit={async (v: string) => {
            const n = Number(v.trim().replace(',', '.'))
            if (!Number.isFinite(n) || n < 0) {
              $.ui.toast('Digite um número de segundos, 0 ou maior')
              return
            }
            await set('minimo_tarefa_segundos', n, `Mínimo: ${n}s`)
          }}
        />
      </Box>,
    )

    const repetir = card(
      'repetir',
      <Box flexDirection="column" gap={1}>
        {title('REPETIR ATÉ VOCÊ RESPONDER')}
        {row(
          REPETICOES.map(([rotulo, min]) =>
            choice(`rep-${min}`, rotulo, Number(cfg.repetir_minutos ?? 5) === min, () =>
              set('repetir_minutos', min, `Repetição: ${rotulo}`),
            ),
          ),
        )}
      </Box>,
    )

    const tamanho = card(
      'tamanho',
      <Box flexDirection="column" gap={1}>
        {title('TAMANHO DA FRASE')}
        {row(
          TAMANHOS.map(([rotulo, modo]) =>
            choice(`tam-${modo}`, rotulo, (cfg.tamanho ?? PADRAO.tamanho) === modo, () => set('tamanho', modo, `Tamanho: ${rotulo}`)),
          ),
        )}
      </Box>,
    )

    const silencio = card(
      'silencio',
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" justifyContent="space-between">
          {title('SILÊNCIO')}
          <Text size="caption" color={silencioMin > 0 ? C.warn : C.muted}>
            {silencioMin > 0 ? `silenciado por mais ${silencioMin} min` : 'sem silêncio'}
          </Text>
        </Box>
        {row([
          ...SILENCIOS.map(([rotulo, min]) =>
            choice(`sil-${min}`, rotulo, false, async () => {
              const agora = (await $.clock.now()) / 1000
              await set('silencio_ate', agora + min * 60, `Silêncio por ${rotulo}`)
            }),
          ),
          choice('sil-0', 'Desfazer', false, () => set('silencio_ate', 0, 'Silêncio desfeito')),
        ])}
      </Box>,
    )

    const microfone = card(
      'microfone',
      <Box flexDirection="column" gap={1}>
        {title('MICROFONE')}
        {row([
          choice('mic-on', 'Calar ao falar', calar, () => set('calar_com_microfone', true, 'Calo quando você dita')),
          choice('mic-off', 'Ignorar', !calar, () => set('calar_com_microfone', false, 'Não calo ao ditar')),
        ])}
        {hint('Quando você ditar no microfone do Claude, a voz para na hora.')}
      </Box>,
    )

    const testar = card(
      'testar',
      <Box flexDirection="row" justifyContent="space-between" alignItems="center">
        <Box flexDirection="column">
          {title('TESTAR AGORA')}
          {hint('Toca um aviso curto com a voz escolhida.')}
        </Box>
        <Button
          key="testar"
          label="Testar voz"
          variant="primary"
          onPress={async () => {
            const atual = await runtime($, amb)
            if (atual.fase === 'pronto' && atual.python !== undefined) {
              await rodarAviso($, amb, atual.python, ['testar'])
            } else {
              await falarReserva($, 'Este é um teste do aviso por voz.')
            }
          }}
        />
      </Box>,
    )

    return (
      <Box flexDirection="column" gap={1} paddingY={1}>
        {header}
        {situacao}
        {voz}
        {nomeCard}
        {curtasCard}
        {repetir}
        {tamanho}
        {silencio}
        {microfone}
        {testar}
      </Box>
    )
  })
}
