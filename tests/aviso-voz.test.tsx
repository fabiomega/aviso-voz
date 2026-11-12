import { describe, expect, mock, test } from 'claude-code/testing'

import { arquivos, fraseReserva, lerRuntime, mesclarCfg, pastaDados } from '../hooks/logica'

type OnFn = Parameters<Parameters<typeof test>[1]>[1]

const NOW = new Date(2026, 10, 12, 12).getTime()
const PERFIL = 'C:\\Users\\Ana'
const DADOS = 'C:\\Users\\Ana\\.claude\\aviso-voz'
const PY = 'C:\\Users\\Ana\\.claude\\aviso-voz\\runtime\\venv\\Scripts\\python.exe'
const PRONTO = `\uFEFF${JSON.stringify({ python: PY, pythonw: PY, versao: '1.0.0' })}`

type Chamada = { argv: readonly string[]; stdin?: string; env?: Record<string, string> }

type Mundo = {
  chamadas: Chamada[]
  toasts: string[]
  escritas: Record<string, string>
  arquivos: Record<string, string>
  clock: { advance: (ms: number) => Promise<void>; settle: () => Promise<void> }
  falhaProcesso: boolean
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
  const m: Mundo = { chamadas: [], toasts: [], escritas: {}, arquivos: files, clock, falhaProcesso: false }

  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'aviso-voz' } }))
  on('fs.read', (_, e) => {
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
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('classic.Stop', () => ({}))
  on('classic.UserPromptSubmit', () => ({}))
  on('classic.Notification', () => ({}))
  on('prompt.submit', (_, e) => ({ text: e.text }))

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

  test('reserva: só fala o que precisa da pessoa, com o nome quando há', async () => {
    const semNome = mesclarCfg({})
    const comNome = mesclarCfg({ nome: 'Ana' })
    expect(fraseReserva('notificacao', { notification_type: 'permission_prompt' }, semNome)).toBe('Preciso da sua autorização.')
    expect(fraseReserva('notificacao', { notification_type: 'permission_prompt' }, comNome)).toBe('Ana, preciso da sua autorização.')
    expect(fraseReserva('notificacao', { notification_type: 'idle_prompt' }, semNome)).toBe(undefined)
    expect(fraseReserva('stop', { last_assistant_message: 'Pronto, terminei.' }, semNome)).toBe(undefined)
    expect(fraseReserva('stop', { last_assistant_message: 'Posso enviar?' }, semNome)).toBe('Terminei e tenho uma pergunta para você.')
    expect(fraseReserva('parar', {}, semNome)).toBe(undefined)
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

  test('antes da voz natural ficar pronta, a voz do Windows avisa o que precisa', async ($, on) => {
    const m = mundo(on, { cfg: { nome: 'Ana' } })
    await $.classic.Notification({ ...base, message: 'permission', notification_type: 'permission_prompt' })
    await $.classic.Stop({ ...base, stop_hook_active: false, last_assistant_message: 'Terminei.' })
    await m.clock.advance(1)
    expect(m.chamadas.length).toBe(1)
    expect(m.chamadas[0]?.argv[0]).toBe('powershell.exe')
    expect(String(m.chamadas[0]?.argv.at(-1))).toContain('System.Speech')
    expect(m.chamadas[0]?.env?.AVISO_TXT).toBe('Ana, preciso da sua autorização.')
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
    expect(m.toasts.some(t => t.includes('preparando a voz pela primeira vez'))).toBe(true)
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
      expect((await ui.find({ type: 'Text', text: /Voz pronta/ }))?.text).toBe('Voz pronta')
      expect(await ui.find({ type: 'Text', text: /COMO TE CHAMAR/ })).not.toBe(undefined)
      await ui.unmount()
    }
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
