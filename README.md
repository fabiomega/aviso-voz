# Aviso por voz

Um plugin para o **Claude Code** que **avisa você por voz, em português**, em dois casos:

- **Quando o Claude termina uma tarefa**, mesmo sem pergunta, para você poder sair de perto e voltar só quando ela acabar.
- **Quando o Claude precisa de você**: uma pergunta, um pedido de autorização ou uma escolha.

Também avisa quando algo dá errado, porque erro é sempre falado.

- **Voz natural** em português (Francisca, Thalita ou Antonio). Enquanto ela não está pronta, quem fala é a voz do Windows.
- **Instala sozinho**: na primeira vez, baixa a voz natural em segundo plano, com uma **barra de progresso** no painel. Você não precisa instalar Python nem clicar em nada.
- **Repete até você responder** quando o Claude está esperando você, e para sozinho quando você manda a próxima mensagem.
- **Uma fila só**: com várias janelas do Claude abertas, um aviso de cada vez, sem falar por cima.
- **Silêncio quando você quiser**: 30 min, 1 h, 2 h, ou desligado.
- **Painel de ajustes** em português: `/aviso-voz`.

> Este repositório é **privado**: só entra quem recebeu convite. Não compartilhe o acesso.

---

## Antes de começar

- **Windows 10 ou 11.** (Mac e Linux ainda não.)
- **Claude Code com suporte a plugins** (testado na versão 2.1.312), no app do Claude ou no terminal.
- **Internet na primeira vez**, para baixar a voz natural: cerca de 40 MB, de 1 a 3 minutos. Ocupa cerca de 120 MB no disco.
- **Não precisa instalar Python.** O próprio plugin prepara tudo numa pasta só dele.

> **Já tem outra versão do aviso por voz instalada?** Desligue ou remova a antiga antes, senão a voz vai falar em dobro.

## Como instalar (passo a passo para leigos)

Leva uns 10 minutos. Você só faz isso **uma vez**.

### Passo 1 · Aceitar o convite do GitHub
1. Tenha uma conta gratuita no [GitHub](https://github.com/signup).
2. Abra o e-mail do convite para **fabiomega/aviso-voz** e clique em **Accept invitation** (ou entre em github.com/fabiomega/aviso-voz e aceite).

### Passo 2 · Deixar o seu computador entrar no GitHub
O Claude precisa do seu login do GitHub para baixar o plugin, porque o repositório é privado.
Se você já fez isso para outro plugin da **fabiomega**, **pule para o passo 3**.

1. Abra o menu Iniciar, digite **PowerShell** e abra.
2. Instale a ferramenta do GitHub (se pedir permissão, aceite):
   ```
   winget install --id GitHub.cli -e
   ```
3. **Feche o PowerShell e abra de novo.**
4. Faça o login. Escolha **GitHub.com**, depois **HTTPS**, depois **Login with a web browser**, copie o código que aparecer e confirme no navegador:
   ```
   gh auth login
   ```
5. Ligue o login ao Git:
   ```
   gh auth setup-git
   ```

### Passo 3 · Instalar no Claude
**No app do Claude (aba Code):**
1. Clique no **+** ao lado da caixa de mensagem e depois em **Plugins**.
2. Clique em **Add marketplace**, digite `fabiomega/aviso-voz` e confirme.
3. Clique em **Add plugin** e escolha **aviso-voz**.

**No terminal (Claude Code):**
```
/plugin install aviso-voz --marketplace fabiomega/aviso-voz
```
Responda `y` à pergunta de adicionar o marketplace e escolha o escopo de usuário (**user**).

### Passo 4 · Reiniciar e deixar ele preparar a voz
1. Feche o Claude por completo (ícone perto do relógio, botão direito, **Sair**) e abra de novo.
2. Numa conversa nova, mande uma mensagem qualquer. Se o app perguntar se pode ligar os mods, aceite.
3. **A voz natural baixa sozinha, sem você clicar em nada.** O painel abre e o card **Voz natural** mostra uma **barra laranja** com o andamento ("Baixando a voz natural… 45% · 18 de 40 MB").
   Quando terminar, o card fica verde: **"Voz natural pronta"**. Isso só acontece uma vez.
4. Teste, digitando **sozinho** na caixa de mensagem (sem outro texto na mesma mensagem):
   ```
   /aviso-voz testar
   ```
   Você deve ouvir um aviso de teste em português.

---

## Como ele decide quando falar

Ele olha **como cada resposta termina** e **quanto tempo a tarefa levou**:

1. **Erro?** Sempre fala (a não ser que o aviso esteja desligado ou em silêncio).
2. **A tarefa durou menos que o tempo mínimo** (padrão 20 s)? Fica em silêncio, terminando com pergunta ou não. Com **Falar todas**, nunca fica em silêncio por tempo.
3. **A resposta terminou com uma pergunta, ou pediu sua autorização?** Fala, se o interruptor **Quando precisa de você** estiver ligado. A pergunta repete no intervalo escolhido até você responder. Um pedido de autorização é falado uma vez.
4. **A tarefa terminou sem pergunta?** Fala um resumo curto, se o interruptor **Quando termina** estiver ligado. É falado **uma vez só**, sem repetir.

Os dois interruptores ficam no card **Quando avisar** do painel. Os dois vêm **ligados** de fábrica.

## Comandos

Digite cada comando **sozinho** na mensagem.

| Comando | O que faz |
| --- | --- |
| `/aviso-voz` | Abre o painel de ajustes |
| `/aviso-voz testar` | Toca um aviso de teste |
| `/aviso-voz status` | Diz se a voz está pronta e mostra as opções atuais |
| `/aviso-voz instalar` | Prepara a voz de novo (use se algo falhou) |

## Ajustes do painel

| Card | O que muda |
| --- | --- |
| **Voz natural** | O andamento da preparação da voz (barra laranja) e o botão **Tentar de novo** se falhar |
| **Voz** | Francisca (padrão), Thalita ou Antonio |
| **Como te chamar** | Seu nome no começo dos avisos ("Ana, preciso da sua autorização"). Vazio = sem nome |
| **Quando avisar** | Os interruptores **Quando termina** e **Quando precisa de você** (ligados por padrão). Abaixo, o tempo mínimo: **Falar todas** ou **Só de 20 s em diante**. O tempo vale para os dois |
| **Repetir até você responder** | Desligada, 5, 10 ou 15 minutos |
| **Tamanho da frase** | Curta, média, detalhada ou completa |
| **Silêncio** | 30 min, 1 h, 2 h, ou desfazer |
| **Ligar / Desligar** | Pausa tudo sem desinstalar |

### Padrões de fábrica

| Ajuste | Padrão |
| --- | --- |
| Voz | Francisca |
| Quando termina | Ligado |
| Quando precisa de você | Ligado |
| Tempo mínimo | 20 segundos |
| Repetir até responder | a cada 5 minutos, até 6 vezes, cada vez um pouco mais espaçada |
| Tamanho da frase | Curta |
| Silêncio | Desligado |

## Problemas comuns

| Problema | O que fazer |
| --- | --- |
| "Repository not found" ao instalar | Aceite o convite (passo 1) e refaça o login (`gh auth login`, depois `gh auth setup-git`) |
| Não sai som nenhum | Confira o volume do Windows e rode `/aviso-voz testar`. Depois veja `/aviso-voz status` |
| A barra não anda, ou some sem terminar | O instalador se recupera sozinho se travar. Se não, toque em **Tentar de novo** ou rode `/aviso-voz instalar`. A primeira vez precisa de internet |
| "Não consegui preparar a voz" | Antivírus ou a rede da empresa podem bloquear o download. Libere `github.com`, `python.org` e `pypi.org`, e rode `/aviso-voz instalar` |
| A voz fala em dobro | Você tem outra versão do aviso por voz instalada. Remova a antiga e deixe só esta |
| A voz fala de mais | No card **Quando avisar**, desligue **Quando termina**, aumente o tempo mínimo, ou use **Silêncio** |
| Só fala com a voz do Windows | A voz natural ainda não está pronta. Veja o card **Voz natural**; se estiver parada, use **Tentar de novo** |
| `/aviso-voz` não faz nada | O comando precisa ser a única coisa escrita na mensagem |

Os detalhes de cada preparação ficam em `%USERPROFILE%\.claude\aviso-voz\instalacao.log`, e os erros em `erros.log`, na mesma pasta.

## Privacidade e funcionamento
- Tudo roda no **seu computador**. O plugin não depende de servidor do autor nem do computador de ninguém.
- Para virar áudio, o texto do aviso vai para o **serviço de voz da Microsoft (Edge TTS)**. Sem internet, a voz do Windows assume.
- Em respostas longas, o aviso pode pedir um **resumo curto** ao seu próprio Claude, o que usa um pouco do **seu** plano. Se o Claude não for encontrado, usa o começo da resposta.
- **Nada é enviado ao autor do plugin.**
- Onde ficam as coisas: o plugin fica onde o Claude guarda os plugins; seus ajustes, a fila e a voz baixada ficam em `%USERPROFILE%\.claude\aviso-voz`.

## Atualizar
Quando houver versão nova, o Claude avisa em **Plugins**. Você também pode rodar `/plugin update aviso-voz`.

## Desinstalar
1. Em **Plugins**, remova o `aviso-voz` e reinicie o Claude.
2. Se quiser apagar também a voz baixada e os ajustes, apague a pasta `%USERPROFILE%\.claude\aviso-voz`.
