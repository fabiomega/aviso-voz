---
name: aviso-voz
description: Avisos falados em português pelo Edge TTS quando o Claude termina ou precisa da pessoa, com fila única entre janelas, repetição até ela responder, silêncio e voz do Windows como reserva. Use para ajustar voz, nome, tamanho da frase, repetição ou silêncio, ou para diagnosticar o aviso por voz.
---

# Aviso por voz

O plugin `aviso-voz` cuida de tudo sozinho: ouve o fim de cada resposta (Stop), o pedido novo (UserPromptSubmit) e os pedidos de permissão ou de resposta (Notification), e fala em português.

## Onde ficam as coisas
- Dados da pessoa: `%USERPROFILE%\.claude\aviso-voz\` (ou a variável `AVISO_VOZ_DIR`).
  - `config.json`: só o que a pessoa mudou.
  - `runtime\`: o Python e a voz preparados pelo instalador; `runtime\pronto.json` diz qual Python usar.
  - `runtime\estado.json`: o andamento ao vivo da preparação (`fase`, `etapa`, `pct`, `baixadoMB`, `totalMB`, `heartbeat`), que o painel mostra numa barra.
  - `historico.jsonl`: cada aviso e o que aconteceu com ele. `erros.log`: falhas.
  - `instalacao.log`: o passo a passo da preparação da voz.
- Motor: `scripts\aviso.py` dentro da pasta do plugin. Instalador: `scripts\instalar.ps1`.

## Comandos para a pessoa (cada um sozinho na mensagem)
- `/aviso-voz` abre o painel (voz, nome, quando avisar, repetição, silêncio, tamanho, microfone, testar).
- `/aviso-voz status` mostra se a voz está pronta e as opções.
- `/aviso-voz testar` toca um aviso de teste.
- `/aviso-voz instalar` prepara a voz de novo (quando algo falhou).

## Para mudar uma opção pelo terminal
Use o Python do runtime (`PY` = o caminho em `runtime\pronto.json`, `AVISO` = `scripts\aviso.py` do plugin):
- `PY AVISO status`
- `PY AVISO silencio 60` (0 desfaz)
- `PY AVISO config nome '"Ana"'` (vazio = sem nome)
- `PY AVISO config voz '"pt-BR-ThalitaMultilingualNeural"'`
- `PY AVISO config tamanho '"curta"'` (curta, media, detalhada, completa)
- `PY AVISO config repetir_minutos 5` (0 desliga)
- `PY AVISO config avisar_ao_terminar false` (cala as tarefas que terminam sem pergunta; `true` volta)
- `PY AVISO config avisar_quando_precisa false` (cala perguntas e autorizações; `true` volta)
- `PY AVISO config minimo_tarefa_segundos 20` e `PY AVISO config respostas_curtas true` (falar todas, sem mínimo)
- `PY AVISO parar --todos`

## Quando o aviso fala
- Dois interruptores, ligados por padrão: `avisar_ao_terminar` (resposta terminada sem pergunta, falada uma vez, começando com "terminei") e `avisar_quando_precisa` (pergunta na resposta, que repete até a pessoa responder; autorização ou escolha, falada uma vez).
- Um único tempo mínimo (`minimo_tarefa_segundos`, padrão 20) vale para os dois, contado desde o pedido; `respostas_curtas: true` desliga o mínimo.
- Erros sempre falam (salvo desligado ou em silêncio).
- A chave antiga `so_quando_espera` (até a 1.0.0) é ignorada e some do `config.json` na próxima gravação.

## Primeira vez
A voz natural é baixada sozinha (cerca de 40 MB, 1 minuto) logo que o plugin carrega: no início da sessão, no primeiro pedido, no fim de uma resposta ou ao abrir o painel. Só uma preparação roda por vez: o `heartbeat` do `estado.json` é renovado a cada 2 s, e uma preparação sem batimento há 60 s é considerada parada e recomeça sozinha (até duas vezes). Falhas, inclusive ao abrir o instalador, ficam em `instalacao.log` (linhas `[plugin]` são do plugin) e em `estado.json` como `falhou`; aí o painel mostra **Tentar de novo**.

## Diagnóstico
1. `/aviso-voz status`: se a voz não estiver pronta, `/aviso-voz instalar` e leia `instalacao.log`.
2. Sem som com a voz pronta: veja `erros.log` e o volume do Windows; a reserva é a voz do Windows.
3. Avisos que não saem: `historico.jsonl` mostra o motivo (`silenciado:...`, `ignorado:curto(Ns)`, `ignorado:interruptor-terminar`, `ignorado:interruptor-precisa`).
