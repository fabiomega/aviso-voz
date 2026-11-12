import { describe, expect, mock, test } from 'claude-code/testing'

import { arquivos, fraseReserva, lerRuntime, mesclarCfg, motivoCalar, pastaDados } from '../hooks/logica'

type OnFn = Parameters<Parameters<typeof test>[1]>[1]

const NOW = new Date(2026, 10, 12, 12).getTime()
const PERFIL = 'C:\\Users\\Ana'
const DADOS = 'C:\\Users\\Ana\\.claude\\aviso-voz'
const PY = 'C:\\Users\\Ana\\.claude\\aviso-voz\\runtime\\venv\\Scripts\\python.exe'
const PRONTO = `\uFEFF${JSON.stringify({ python: PY, pythonw: PY, versao: '1.1.0' })}`

type Chamada = { argv: readonly string[]; stdin?: string; env?: Record<string, string> }

type Mundo = {
  chamadas: Chamada[]
  toasts: string[]
  escritas: Record<string, string>
  arquivos: Record<string, string>
  clock: { advance: (ms: number) => Promise<void>; settle: () => Promise<void> }
  falhaProcesso: boolean
  aberturas: number
  leiturasEstado: number
}

type Opcoes = {
  windows?: boolean
  pronto?: boolean
  estado?: Record<string, unknown>
  cfg?: Record<string, unknown>
  resumo?: boolean
  store?: Record<string, unknown>
}

function mundo(on: OnFn, o: Opcoes = {}): Mundo {
  mock.store(on, o.store)
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, {
    ...(o.windows === false ? {} : { OS: 'Windows_NT' }),
    USERPROFILE: PERFIL,
    ...(o.resumo === true ? { AVISO_VOZ_RESUMO: '1' } : {}),
  })
  const files: Record<string, string> = {}
  if (o.pronto === true) files[`${DADOS}\\runtime\\pronto.json`] = PRONTO
  if (o.estado !== undefined) files[`${DADOS}\\runtime\\estado.json`] = JSON.stringify(o.estado)
  if (o.cfg !== undefined) files[`${DADOS}\\config.json`] = JSON.stringify(o.cfg)
  const m: Mundo = { chamadas: [], toasts: [], escritas: {}, arquivos: files, clock, falhaProcesso: false, aberturas: 0, leiturasEstado: 0 }

  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'aviso-voz' } }))
  on('fs.read', (_, e) => {
    if (e.path.endsWith('\\runtime\\estado.json')) m.leiturasEstado += 1
    const texto = files[e.path]
    if (texto === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value: texto }
  })
  on('fs.write', (_, e) => {
    files[e.path] = e.text
    m.escritas[e.path] = e.text
    return { value: undefined }
  })
  on('process.run', (_, e) => {
    m.chamadas.push({ argv: e.argv, stdin: e.init?.stdin, env: e.init?.env })
    if (m.falhaProcesso) throw new Error('spawn falhou')
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.toast', (_, e) => {
    m.toasts.push(String((e as unknown as { text?: string }).text ?? ''))
    return { value: undefined }
  })
  on('ui.open', () => {
    m.aberturas += 1
    return { value: { isPlaced: true } }
  })
  on('ui.panes', () => ({ value: [] }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('classic.Stop', () => ({}))
  on('classic.UserPromptSubmit', () => ({}))
  on('classic.Notification', () => ({}))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('turn.complete', () => ({ text: '' }))

  return m
}

const base = { session_id: 'sessao-1', transcript_path: 'C:\\t\\sessao-1.jsonl', cwd: 'C:\\projeto' }

function doMotor(c: Chamada) {
  return c.argv[0] === PY && String(c.argv[1]).endsWith('\\scripts\\aviso.py')
}

describe('regras puras', () => {
  test('pasta de dados: AVISO_VOZ_DIR vence, senão o perfil', async () => {
    expect(pastaDados(undefined, PERFIL)).toBe(DADOS)
    expect(pastaDados('D:\\outro', PERFIL)).toBe('D:\\outro')
    expect(arquivos(DADOS, 'C:/plug/aviso-voz/').script).toBe('C:/plug/aviso-voz\\scripts\\aviso.py')
  })

  test('runtime: pronto.json com BOM é lido; senão o estado do instalador', async () => {
    expect(lerRuntime(PRONTO, undefined)).toEqual({ fase: 'pronto', python: PY })
    expect(lerRuntime(undefined, '{"fase":"falhou","mensagem":"sem internet","quando":1}').fase).toBe('falhou')
    expect(lerRuntime(undefined, undefined).fase).toBe('ausente')
  })

  test('reserva: segue os dois interruptores e o tempo mínimo, com o nome quando há', async () => {
    const semNome = mesclarCfg({})
    const comNome = mesclarCfg({ nome: 'Ana' })
    expect(fraseReserva('notificacao', { notification_type: 'permission_prompt' }, semNome)).toBe('Preciso da sua autorização.')
    expect(fraseReserva('notificacao', { notification_type: 'permission_prompt' }, comNome)).toBe('Ana, preciso da sua autorização.')
    expect(fraseReserva('notificacao', { notification_type: 'idle_prompt' }, semNome)).toBe(undefined)
    expect(fraseReserva('stop', { last_assistant_message: 'Pronto, terminei.' }, semNome)).toBe('Terminei.')
    expect(fraseReserva('stop', { last_assistant_message: 'Pronto, terminei.' }, comNome, 30)).toBe('Ana, terminei.')
    expect(fraseReserva('stop', { last_assistant_message: 'Posso enviar?' }, semNome)).toBe('Terminei e tenho uma pergunta para você.')
    expect(fraseReserva('parar', {}, semNome)).toBe(undefined)
    // mesmo mínimo para os dois tipos
    expect(fraseReserva('stop', { last_assistant_message: 'Pronto.' }, semNome, 5)).toBe(undefined)
    expect(fraseReserva('stop', { last_assistant_message: 'Posso?' }, semNome, 5)).toBe(undefined)
    expect(fraseReserva('notificacao', { notification_type: 'permission_prompt' }, semNome, 5)).toBe(undefined)
    // "Falar todas" desliga o mínimo
    const todas = mesclarCfg({ respostas_curtas: true })
    expect(fraseReserva('stop', { last_assistant_message: 'Pronto.' }, todas, 2)).toBe('Terminei.')
    expect(fraseReserva('notificacao', { notification_type: 'permission_prompt' }, todas, 2)).toBe('Preciso da sua autorização.')
    // interruptores
    const semTerminar = mesclarCfg({ avisar_ao_terminar: false })
    expect(fraseReserva('stop', { last_assistant_message: 'Pronto.' }, semTerminar, 60)).toBe(undefined)
    expect(fraseReserva('stop', { last_assistant_message: 'Posso?' }, semTerminar, 60)).toBe('Terminei e tenho uma pergunta para você.')
    const semPrecisa = mesclarCfg({ avisar_quando_precisa: false })
    expect(fraseReserva('stop', { last_assistant_message: 'Posso?' }, semPrecisa, 60)).toBe(undefined)
    expect(fraseReserva('notificacao', { notification_type: 'elicitation_dialog' }, semPrecisa, 60)).toBe(undefined)
    expect(fraseReserva('stop', { last_assistant_message: 'Pronto.' }, semPrecisa, 60)).toBe('Terminei.')
  })

  test('regras de silêncio: interruptores, mínimo e a chave antiga ignorada', async () => {
    const padrao = mesclarCfg({})
    expect(padrao.avisar_ao_terminar).toBe(true)
    expect(padrao.avisar_quando_precisa).toBe(true)
    expect(motivoCalar(padrao, 'concluido', 25)).toBe('')
    expect(motivoCalar(padrao, 'concluido', 10)).toBe('curto')
    expect(motivoCalar(padrao, 'precisa', 10)).toBe('curto')
    expect(motivoCalar(padrao, 'precisa', undefined)).toBe('')
    const antiga = mesclarCfg({ so_quando_espera: true })
    expect('so_quando_espera' in antiga).toBe(false)
    expect(motivoCalar(antiga, 'concluido', 60)).toBe('')
  })

  test('configuração padrão sem nome pessoal', async () => {
    const cfg = mesclarCfg({ horario_silencio: { ligado: true } })
    expect(cfg.nome).toBe('')
    expect(cfg.horario_silencio).toEqual({ ligado: true, inicio: '22:00', fim: '07:00' })
  })
})

describe('eventos do Claude', () => {
  test('Stop, pedido novo e permissão chegam ao aviso.py com o JSON do evento', async ($, on) => {
    const m = mundo(on, { pronto: true })
    await $.classic.Stop({ ...base, stop_hook_active: false, last_assistant_message: 'Posso seguir?' })
    await $.classic.UserPromptSubmit({ ...base, prompt: 'sim' })
    await $.classic.Notification({ ...base, message: 'Claude needs your permission', notification_type: 'permission_prompt' })
    await m.clock.advance(1)
    const motor = m.chamadas.filter(doMotor)
    expect(motor.map(c => c.argv[2])).toEqual(['stop', 'parar', 'notificacao'])
    expect(JSON.parse(String(motor[0]?.stdin)).transcript_path).toBe(base.transcript_path)
    expect(JSON.parse(String(motor[0]?.stdin)).session_id).toBe('sessao-1')
    expect(motor[0]?.env?.AVISO_VOZ_DIR).toBe(DADOS)
  })

  test('notificação de ociosidade não fala nada', async ($, on) => {
    const m = mundo(on, { pronto: true })
    await $.classic.Notification({ ...base, message: 'Claude is waiting for your input', notification_type: 'idle_prompt' })
    await m.clock.advance(1)
    expect(m.chamadas.length).toBe(0)
  })

  test('uma falha do processo nunca atrapalha a conversa', async ($, on) => {
    const m = mundo(on, { pronto: true })
    m.falhaProcesso = true
    const r = await $.classic.Stop({ ...base, stop_hook_active: false })
    await $.classic.UserPromptSubmit({ ...base, prompt: 'continua' })
    await m.clock.advance(1)
    expect(r.block).toBe(undefined)
    expect(m.chamadas.length).toBe(2)
  })

  test('antes da voz natural ficar pronta, a voz do Windows avisa a pergunta e o fim da tarefa', async ($, on) => {
    const m = mundo(on, { cfg: { nome: 'Ana' } })
    await $.classic.Notification({ ...base, message: 'permission', notification_type: 'permission_prompt' })
    await m.clock.advance(1)
    await $.classic.Stop({ ...base, stop_hook_active: false, last_assistant_message: 'Terminei.' })
    await m.clock.advance(1)
    expect(m.chamadas.length).toBe(2)
    expect(m.chamadas[0]?.argv[0]).toBe('powershell.exe')
    expect(String(m.chamadas[0]?.argv.at(-1))).toContain('System.Speech')
    expect(m.chamadas[0]?.env?.AVISO_TXT).toBe('Ana, preciso da sua autorização.')
    expect(m.chamadas[1]?.env?.AVISO_TXT).toBe('Ana, terminei.')
  })

  test('a voz do Windows respeita o tempo mínimo desde o pedido', async ($, on) => {
    const m = mundo(on, { cfg: {} })
    await $.classic.UserPromptSubmit({ ...base, prompt: 'oi' })
    await m.clock.advance(5000)
    await $.classic.Stop({ ...base, stop_hook_active: false, last_assistant_message: 'Pronto.' })
    await m.clock.advance(1)
    expect(m.chamadas.filter(c => c.env?.AVISO_TXT !== undefined).length).toBe(0)
    await $.classic.UserPromptSubmit({ ...base, prompt: 'faz algo grande' })
    await m.clock.advance(30000)
    await $.classic.Stop({ ...base, stop_hook_active: false, last_assistant_message: 'Pronto.' })
    await m.clock.advance(1)
    const faladas = m.chamadas.filter(c => c.env?.AVISO_TXT !== undefined)
    expect(faladas.length).toBe(1)
    expect(faladas[0]?.env?.AVISO_TXT).toBe('Terminei.')
  })

  test('a voz do Windows respeita os interruptores', async ($, on) => {
    const m = mundo(on, { cfg: { avisar_ao_terminar: false, avisar_quando_precisa: false } })
    await $.classic.Notification({ ...base, message: 'permission', notification_type: 'permission_prompt' })
    await $.classic.Stop({ ...base, stop_hook_active: false, last_assistant_message: 'Pronto.' })
    await $.classic.Stop({ ...base, stop_hook_active: false, last_assistant_message: 'Posso seguir?' })
    await m.clock.advance(1)
    expect(m.chamadas.filter(c => c.env?.AVISO_TXT !== undefined).length).toBe(0)
  })

  test('em silêncio, nem a voz do Windows fala', async ($, on) => {
    const m = mundo(on, { cfg: { silencio_ate: NOW / 1000 + 600 } })
    await $.classic.Notification({ ...base, message: 'permission', notification_type: 'permission_prompt' })
    await m.clock.advance(1)
    expect(m.chamadas.length).toBe(0)
  })

  test('a sessão de resumo do próprio aviso não gera aviso', async ($, on) => {
    const m = mundo(on, { pronto: true, resumo: true })
    await $.classic.Stop({ ...base, stop_hook_active: false })
    await m.clock.advance(1)
    expect(m.chamadas.length).toBe(0)
  })
})

describe('preparação da voz', () => {
  test('sem runtime, o início da sessão abre o instalador uma vez só', async ($, on) => {
    const m = mundo(on)
    await $.session.start({ cwd: 'C:\\projeto', surface: 'desktop', isInteractive: true })
    await m.clock.advance(1)
    await $.session.start({ cwd: 'C:\\projeto', surface: 'desktop', isInteractive: true })
    await m.clock.advance(1)
    const inst = m.chamadas.filter(c => String(c.argv.at(-1)).includes('Start-Process'))
    expect(inst.length).toBe(1)
    expect(String(inst[0]?.env?.AVISO_VOZ_ARGS)).toContain('\\scripts\\instalar.ps1')
    expect(String(inst[0]?.env?.AVISO_VOZ_ARGS)).toContain(`-Dados "${DADOS}"`)
    expect(m.toasts.some(t => t.includes('pela primeira vez'))).toBe(true)
  })

  test('com o runtime pronto, nada é instalado', async ($, on) => {
    const m = mundo(on, { pronto: true })
    await $.session.start({ cwd: 'C:\\projeto', surface: 'desktop', isInteractive: true })
    await m.clock.advance(1)
    expect(m.chamadas.length).toBe(0)
  })

  test('o vigia avisa quando a voz fica pronta', async ($, on) => {
    const m = mundo(on)
    await $.session.start({ cwd: 'C:\\projeto', surface: 'desktop', isInteractive: true })
    await m.clock.advance(1)
    m.arquivos[`${DADOS}\\runtime\\pronto.json`] = PRONTO
    await m.clock.advance(15000)
    expect(m.toasts.some(t => t.includes('Aviso por voz pronto'))).toBe(true)
  })

  test('uma instalação em andamento não é aberta de novo', async ($, on) => {
    const m = mundo(on, { estado: { fase: 'instalando', mensagem: '', quando: NOW / 1000 - 30 } })
    await $.session.start({ cwd: 'C:\\projeto', surface: 'desktop', isInteractive: true })
    await m.clock.advance(1)
    expect(m.chamadas.length).toBe(0)
  })

  test('fora do Windows: um aviso só, e nenhum processo', async ($, on) => {
    const m = mundo(on, { windows: false })
    await $.session.start({ cwd: '/home/ana', surface: 'terminal', isInteractive: true })
    await m.clock.advance(1)
    await $.classic.Stop({ ...base, stop_hook_active: false, last_assistant_message: 'Posso?' })
    await m.clock.advance(1)
    await $.session.start({ cwd: '/home/ana', surface: 'terminal', isInteractive: true })
    await m.clock.advance(1)
    expect(m.chamadas.length).toBe(0)
    expect(m.toasts.filter(t => t.includes('só funciona no Windows')).length).toBe(1)
  })
})

describe('comandos', () => {
  test('/aviso-voz status diz se a voz está pronta', async ($, on) => {
    mundo(on, { pronto: true, cfg: { nome: 'Ana' } })
    const r = await $.command.run({ command: 'aviso-voz', args: 'status' })
    expect(r.text).toContain('Voz pronta')
    expect(r.text).toContain('Nome: Ana')
  })

  test('/aviso-voz instalar força uma nova preparação', async ($, on) => {
    const m = mundo(on, { estado: { fase: 'falhou', mensagem: 'sem internet', quando: 1 } })
    const r = await $.command.run({ command: 'aviso-voz', args: 'instalar' })
    await m.clock.settle()
    expect(r.text).toContain('Preparando a voz de novo')
    expect(String(m.chamadas[0]?.env?.AVISO_VOZ_ARGS)).toContain('-Forcar')
  })

  test('/aviso-voz testar usa o motor quando a voz está pronta', async ($, on) => {
    const m = mundo(on, { pronto: true })
    await $.command.run({ command: 'aviso-voz', args: 'testar' })
    await m.clock.settle()
    expect(m.chamadas.filter(doMotor).map(c => c.argv[2])).toEqual(['testar'])
  })
})

const PANE = {
  plugin: 'aviso-voz',
  component: 'Pane',
  requestId: 'aviso-voz',
  props: {
    title: 'Aviso por voz',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

describe('painel', () => {
  test('mostra a voz, o nome e a situação da voz natural, no desktop e no terminal', async ($, on) => {
    mundo(on, { pronto: true, cfg: { nome: 'Ana' } })
    for (const surface of ['desktop', 'terminal'] as const) {
      const ui = await $.ui.mount({ ...PANE, surface })
      expect((await ui.find({ type: 'Text', text: /^Aviso por voz$/ }))?.text).toBe('Aviso por voz')
      expect((await ui.find({ type: 'Text', text: /^Voz natural pronta$/ }))?.text).toBe('Voz natural pronta')
      expect(await ui.find({ type: 'Text', text: /COMO TE CHAMAR/ })).not.toBe(undefined)
      await ui.unmount()
    }
  })

  test('card QUANDO AVISAR: dois interruptores ligados por padrão, no desktop e no terminal', async ($, on) => {
    mundo(on, { pronto: true })
    for (const surface of ['desktop', 'terminal'] as const) {
      const ui = await $.ui.mount({ ...PANE, surface })
      expect(await ui.find({ type: 'Text', text: /QUANDO AVISAR/ })).not.toBe(undefined)
      expect(await ui.find({ type: 'Text', text: /RESPOSTAS CURTAS/ })).toBe(undefined)
      expect(await ui.find({ type: 'Text', text: /^Quando termina$/ })).not.toBe(undefined)
      expect(await ui.find({ type: 'Text', text: /^Quando precisa de você$/ })).not.toBe(undefined)
      expect((await ui.find({ type: 'Button', key: 'terminar-on' }))?.props.variant).toBe('primary')
      expect((await ui.find({ type: 'Button', key: 'precisa-on' }))?.props.variant).toBe('primary')
      expect((await ui.find({ type: 'Button', key: 'terminar-off' }))?.props.variant).toBe('secondary')
      expect(await ui.find({ type: 'Text', text: /terminadas ou com pergunta/ })).not.toBe(undefined)
      await ui.unmount()
    }
  })

  test('desligar um interruptor grava a chave e apaga a chave antiga', async ($, on) => {
    const m = mundo(on, { pronto: true, cfg: { so_quando_espera: true, nome: 'Ana' } })
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await ui.press({ key: 'terminar-off' })
    expect(JSON.parse(String(m.escritas[`${DADOS}\\config.json`]))).toEqual({ nome: 'Ana', avisar_ao_terminar: false })
    await ui.press({ key: 'precisa-off' })
    expect(JSON.parse(String(m.escritas[`${DADOS}\\config.json`])).avisar_quando_precisa).toBe(false)
    await ui.unmount()
  })

  test('salvar o nome grava só essa opção no config.json', async ($, on) => {
    const m = mundo(on, { pronto: true, cfg: { voz: 'pt-BR-AntonioNeural' } })
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await ui.input({ key: 'nome', text: '  Ana  ' })
    const gravado = JSON.parse(String(m.escritas[`${DADOS}\\config.json`]))
    expect(gravado).toEqual({ voz: 'pt-BR-AntonioNeural', nome: 'Ana' })
    await ui.unmount()
  })

  test('voz com falha mostra o botão Tentar de novo', async ($, on) => {
    const m = mundo(on, { estado: { fase: 'falhou', mensagem: 'sem internet', quando: 1 } })
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    expect((await ui.find({ type: 'Text', text: /Não consegui preparar/ }))?.text).toBe('Não consegui preparar a voz')
    await ui.press({ key: 'instalar' })
    expect(String(m.chamadas[0]?.env?.AVISO_VOZ_ARGS)).toContain('-Forcar')
    await ui.unmount()
  })

  test('fora do Windows, o painel só explica', async ($, on) => {
    mundo(on, { windows: false })
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await ui.find({ type: 'Text', text: /só funciona no Windows/ })).not.toBe(undefined)
    await ui.unmount()
  })
})

const ESTADO = `${DADOS}\\runtime\\estado.json`
const LOG = `${DADOS}\\instalacao.log`
const inicios = (m: Mundo) => m.chamadas.filter(c => String(c.argv.at(-1)).includes('Start-Process'))

describe('download automático da voz (1.1.0)', () => {
  test('o primeiro pedido começa o download, mesmo sem início de sessão', async ($, on) => {
    const m = mundo(on)
    await $.classic.UserPromptSubmit({ ...base, prompt: 'oi' })
    await m.clock.advance(1)
    await m.clock.settle()
    expect(inicios(m).length).toBe(1)
    expect(JSON.parse(String(m.escritas[ESTADO])).fase).toBe('instalando')
    expect(String(m.arquivos[LOG])).toContain('[plugin] abrindo o instalador (pedido enviado)')
  })

  test('o início da sessão começa sozinho e abre o painel na primeira vez', async ($, on) => {
    const m = mundo(on)
    await $.session.start({ cwd: 'C:\\projeto', surface: 'desktop', isInteractive: true })
    await m.clock.advance(1)
    expect(inicios(m).length).toBe(1)
    expect(m.toasts.filter(t => t.includes('pela primeira vez')).length).toBe(1)
    expect(m.aberturas).toBeGreaterThan(0)
  })

  test('vários gatilhos juntos abrem um instalador só', async ($, on) => {
    const m = mundo(on)
    await $.session.start({ cwd: 'C:\\projeto', surface: 'desktop', isInteractive: true })
    await $.prompt.submit({ text: 'oi' })
    await $.command.run({ command: 'aviso-voz', args: '' })
    await m.clock.advance(2500)
    await $.prompt.submit({ text: 'de novo' })
    await m.clock.advance(1)
    expect(inicios(m).length).toBe(1)
  })

  test('o aviso de "primeira vez" sai uma vez só, mesmo se precisar baixar de novo', async ($, on) => {
    const m = mundo(on)
    await $.session.start({ cwd: 'C:\\projeto', surface: 'desktop', isInteractive: true })
    await m.clock.advance(1)
    delete m.arquivos[ESTADO]
    await m.clock.advance(61000)
    await $.prompt.submit({ text: 'oi' })
    await m.clock.advance(1)
    expect(inicios(m).length).toBe(2)
    expect(m.toasts.filter(t => t.includes('pela primeira vez')).length).toBe(1)
  })

  test('instalação viva (batimento recente) não é aberta de novo; parada há mais de 60 s recomeça', async ($, on) => {
    const viva = mundo(on, { estado: { fase: 'instalando', pct: 40, heartbeat: NOW / 1000 - 10, quando: NOW / 1000 - 10 } })
    await $.session.start({ cwd: 'C:\\projeto', surface: 'desktop', isInteractive: true })
    await viva.clock.advance(1)
    expect(inicios(viva).length).toBe(0)
  })

  test('instalação que parou de bater o coração recomeça com -Forcar', async ($, on) => {
    const m = mundo(on, { estado: { fase: 'instalando', pct: 40, heartbeat: NOW / 1000 - 120, quando: NOW / 1000 - 120 } })
    await $.session.start({ cwd: 'C:\\projeto', surface: 'desktop', isInteractive: true })
    await m.clock.advance(1)
    expect(inicios(m).length).toBe(1)
    expect(String(inicios(m)[0]?.env?.AVISO_VOZ_ARGS)).toContain('-Forcar')
  })

  test('falha ao abrir o instalador fica registrada no log e no estado', async ($, on) => {
    const m = mundo(on)
    m.falhaProcesso = true
    await $.classic.UserPromptSubmit({ ...base, prompt: 'oi' })
    await m.clock.advance(1)
    await m.clock.settle()
    expect(JSON.parse(String(m.arquivos[ESTADO])).fase).toBe('falhou')
    expect(String(m.arquivos[LOG])).toContain('não consegui abrir o instalador')
  })

  test('o acompanhamento para quando a voz fica pronta', async ($, on) => {
    const m = mundo(on)
    await $.session.start({ cwd: 'C:\\projeto', surface: 'desktop', isInteractive: true })
    await m.clock.advance(1)
    m.arquivos[`${DADOS}\\runtime\\pronto.json`] = PRONTO
    await m.clock.advance(1000)
    await m.clock.settle()
    await m.clock.advance(1000)
    await m.clock.settle()
    expect(m.toasts.some(t => t.includes('Aviso por voz pronto'))).toBe(true)
    const antes = m.leiturasEstado
    await m.clock.advance(10000)
    await $.prompt.submit({ text: 'oi' })
    await m.clock.advance(1)
    expect(m.leiturasEstado).toBe(antes)
  })

  test('painel: barra grossa com etapa, % e MB enquanto baixa, no desktop e no terminal', async ($, on) => {
    mundo(on, {
      estado: { fase: 'instalando', etapa: 'Baixando a voz natural', pct: 45, baixadoMB: 18, totalMB: 40, heartbeat: NOW / 1000 - 1, quando: NOW / 1000 - 1 },
    })
    const desk = await $.ui.mount({ ...PANE, surface: 'desktop' })
    expect((await desk.find({ type: 'Text', text: /Baixando a voz natural… 45% · 18 de 40 MB/ }))?.text).toBe('Baixando a voz natural… 45% · 18 de 40 MB')
    expect(await desk.find({ type: 'Text', text: /isso só acontece uma vez/ })).not.toBe(undefined)
    expect(await desk.find({ type: 'Box', key: 'barra' })).not.toBe(undefined)
    expect(await desk.find({ type: 'Button', key: 'instalar' })).toBe(undefined)
    await desk.unmount()
    const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const barra = (await term.find({ type: 'Text', text: /█+░+/ }))?.text ?? ''
    expect(barra.length).toBeGreaterThan(20)
    await term.unmount()
  })

  test('painel: falha em vermelho com Tentar de novo', async ($, on) => {
    mundo(on, { estado: { fase: 'falhou', mensagem: 'sem internet', quando: 1 } })
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    expect((await ui.find({ type: 'Text', text: /Não consegui preparar a voz: sem internet/ }))?.props.color).toBe('error')
    expect(await ui.find({ type: 'Button', key: 'instalar' })).not.toBe(undefined)
    await ui.unmount()
  })

  test('painel: pronta em verde, sem barra e sem botão', async ($, on) => {
    mundo(on, { pronto: true })
    const ok = await $.ui.mount({ ...PANE, surface: 'desktop' })
    expect((await ok.find({ type: 'Text', text: /✓ Voz natural pronta/ }))?.props.color).toBe('success')
    expect(await ok.find({ type: 'Box', key: 'barra' })).toBe(undefined)
    expect(await ok.find({ type: 'Button', key: 'instalar' })).toBe(undefined)
    await ok.unmount()
  })
})
