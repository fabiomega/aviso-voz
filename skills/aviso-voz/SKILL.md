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
  - `historico.jsonl`: cada aviso e o que aconteceu com ele. `erros.log`: falhas.
  - `instalacao.log`: o passo a passo da preparação da voz.
- Motor: `scripts\aviso.py` dentro da pasta do plugin. Instalador: `scripts\instalar.ps1`.

## Comandos para a pessoa (cada um sozinho na mensagem)
- `/aviso-voz` abre o painel (voz, nome, repetição, silêncio, tamanho, microfone, testar).
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
- `PY AVISO parar --todos`

## Diagnóstico
1. `/aviso-voz status`: se a voz não estiver pronta, `/aviso-voz instalar` e leia `instalacao.log`.
2. Sem som com a voz pronta: veja `erros.log` e o volume do Windows; a reserva é a voz do Windows.
3. Avisos que não saem: `historico.jsonl` mostra o motivo (silenciado, ignorado por ser curto, sem pergunta).
