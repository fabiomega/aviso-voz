import type { Register } from 'claude-code'

import {
  COMANDO_DO_EVENTO,
  FALAR_SAPI,
  LANCAR_INSTALADOR,
  NOTIFICACOES_FALADAS,
  PADRAO,
  VERSAO,
  argumentosInstalador,
  arquivos,
  fraseReserva,
  instalacaoViva,
  lerJson,
  lerRuntime,
  mesclarCfg,
  pastaDados,
  resumoStatus,
  silenciado,
  textoFase,
  type Cfg,
  type Runtime,
} from './logica'

const PANE = 'aviso-voz'
const TITULO = 'Aviso por voz'

// Colors named by meaning, so the pane follows the person's own theme.
const C = { text: 'text', muted: 'inactive', hair: 'subtle', good: 'success', warn: 'warning', bad: 'error' } as const

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

// Once per load of the module: the installer is started at most once, one watcher at a time.
let instaladorIniciado = false
let vigia: { cancel: () => void } | undefined

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
  const r = await runtime($, amb)
  if (r.fase === 'pronto' && r.python !== undefined) {
    await rodarAviso($, amb, r.python, [comando], e)
    return
  }
  const cfg = await lerCfg($, amb)
  if (silenciado(cfg, (await $.clock.now()) / 1000)) return
  const frase = fraseReserva(comando, e, cfg)
  if (frase !== undefined) await falarReserva($, frase)
}

/** Starts the installer detached (it outlives this call) and watches until it settles. */
async function instalar($: any, amb: Ambiente, forcar: boolean) {
  instaladorIniciado = true
  await $.process.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', LANCAR_INSTALADOR], {
    env: { AVISO_VOZ_ARGS: argumentosInstalador(amb.f.instalador, amb.dados, forcar) },
    timeoutMs: 20000,
  })
  vigiar($, amb)
}

function vigiar($: any, amb: Ambiente) {
  vigia?.cancel()
  let voltas = 0
  const timer = $.clock.every(15000, () => {
    void (async () => {
      voltas += 1
      const r = await runtime($, amb)
      if (r.fase === 'pronto') {
        timer.cancel()
        $.ui.toast('Aviso por voz pronto: a partir de agora eu falo com você quando precisar.')
        $.ui.invalidate('ui.render')
      } else if (r.fase === 'falhou') {
        timer.cancel()
        $.ui.toast('Aviso por voz: não consegui preparar a voz. Abra /aviso-voz e toque em "Tentar de novo".')
        $.ui.invalidate('ui.render')
      } else if (voltas >= 60) {
        timer.cancel() // fifteen minutes: the panel still shows what the installer said
      }
    })().catch(() => undefined)
  })
  vigia = timer
}

/** At the start of a session: on Windows, make sure the voice runtime exists or is on its way. */
async function preparar($: any) {
  const amb = await ambiente($)
  if (amb.isResumo) return
  if (!amb.isWindows) {
    if ((await $.store.get(AVISO_SO_WINDOWS_KEY)) !== true) {
      await $.store.set(AVISO_SO_WINDOWS_KEY, true)
      $.ui.toast('Aviso por voz: só funciona no Windows por enquanto.')
    }
    return
  }
  const r = await runtime($, amb)
  if (r.fase === 'pronto') return
  if (instalacaoViva(r, (await $.clock.now()) / 1000)) {
    vigiar($, amb)
    return
  }
  if (instaladorIniciado) return
  $.ui.toast('Aviso por voz: preparando a voz pela primeira vez (1–3 min)…')
  await instalar($, amb, r.fase === 'falhou')
}

/** Opens the pane unless it is on screen already or the person closed it. */
async function abrirPainel($: any) {
  if ((await $.store.get(PANE_AUTO_KEY)) === false) return
  if ((await $.ui.panes()).some((p: any) => p.id === PANE && p.isPlaced)) return
  await $.ui.open({ id: PANE, title: TITULO })
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
    $.clock.after(0, () => {
      void preparar($).catch(() => undefined)
      void abrirPainel($).catch(() => undefined)
    })

    return started
  })

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
        void instalar($, amb, true).catch(() => undefined)
        return { text: 'Preparando a voz de novo (1–3 min). O painel mostra quando ficar pronta.' }
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
    const situacao = card(
      'situacao',
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap={1}>
          {title('VOZ NATURAL')}
          <Text size="caption" weight="semibold" color={corFase}>
            {textoFase(r)}
          </Text>
        </Box>
        {r.fase === 'pronto'
          ? hint('Tudo certo: os avisos usam a voz natural escolhida abaixo.')
          : r.fase === 'instalando'
            ? hint('Baixando a voz pela primeira vez (1–3 min). Enquanto isso, uso a voz do Windows.')
            : hint(
                r.fase === 'falhou'
                  ? `Falhou: ${r.mensagem || 'sem detalhes'}. Confira a internet e tente de novo.`
                  : 'A voz natural ainda não foi preparada neste computador.',
              )}
        {r.fase !== 'pronto' && r.fase !== 'instalando' && (
          <Button
            key="instalar"
            label="Tentar de novo"
            variant="primary"
            onPress={async () => {
              await instalar($, amb, true)
              $.ui.toast('Preparando a voz (1–3 min)…')
              redraw()
            }}
          />
        )}
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

    const curtasCard = card(
      'curtas',
      <Box flexDirection="column" gap={1}>
        {title('RESPOSTAS CURTAS')}
        {row([
          choice('curtas-on', 'Falar todas', curtas, () => set('respostas_curtas', true, 'Falo qualquer resposta')),
          choice('curtas-off', `Só de ${minimo}s em diante`, !curtas, () =>
            set('respostas_curtas', false, `Só respostas de ${minimo}s em diante`),
          ),
        ])}
        {hint(
          curtas
            ? 'Qualquer resposta é falada, de qualquer duração.'
            : `Respostas mais rápidas que ${minimo}s ficam em silêncio. Perguntas e erros sempre são falados.`,
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
