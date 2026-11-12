# Aviso por voz

Um plugin para o **Claude Code** que **fala com você em português** quando o Claude precisa da sua atenção:
quando termina uma tarefa com uma pergunta, quando precisa da sua autorização ou quando algo deu errado.
Assim você pode fazer outra coisa longe da tela e só voltar quando ele chamar.

- **Voz natural** em português (Francisca, Thalita ou Antonio), com a voz do Windows como reserva.
- **Repete até você responder** (5, 10 ou 15 minutos), e para sozinho quando você manda a próxima mensagem.
- **Uma fila só**: com várias janelas do Claude abertas, um aviso de cada vez, sem falar por cima.
- **Silêncio quando você quiser**: por 30 min, 1 h, 2 h, ou desligado.
- **Painel de ajustes** em português: `/aviso-voz`.

> Este repositório é **privado**: só entra quem recebeu convite. Não compartilhe o acesso.

---

## Antes de começar

- **Windows 10 ou 11.** (Mac e Linux ainda não.)
- **Claude Code com suporte a mods** (testado na versão 2.1.312), no app do Claude ou no terminal.
- **Internet na primeira vez**, para baixar a voz (uns 120 MB, de 1 a 3 minutos).
- **Não precisa instalar Python nem nada:** o próprio plugin prepara tudo, numa pasta só dele.

## Como instalar (passo a passo para leigos)

Leva uns 10 minutos. Você só faz isso **uma vez**.

### Passo 1 · Aceitar o convite do GitHub
1. Tenha uma conta gratuita no [GitHub](https://github.com/signup).
2. Abra o e-mail do convite do **FabaoMega** e clique em **Accept invitation** (ou entre em github.com/FabaoMega/aviso-voz e aceite).

### Passo 2 · Deixar o seu computador entrar no GitHub
O Claude precisa do seu login do GitHub para baixar o plugin, porque o repositório é privado.
Se você já fez isso para outro plugin do FabaoMega, **pule para o passo 3**.

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
2. Clique em **Add marketplace**, digite `FabaoMega/aviso-voz` e confirme.
3. Clique em **Add plugin** e escolha **aviso-voz**.

**No terminal (Claude Code):**
```
/plugin install aviso-voz --marketplace FabaoMega/aviso-voz
```
Responda `y` à pergunta de adicionar o marketplace e escolha o escopo de usuário (**user**).

### Passo 4 · Reiniciar e deixar ele preparar a voz
1. Feche o Claude por completo (ícone perto do relógio, botão direito, **Sair**) e abra de novo.
2. Numa conversa nova, mande uma mensagem qualquer. Se o app perguntar se pode ligar os mods, aceite.
3. Aparece o aviso **"preparando a voz pela primeira vez (1–3 min)"**. Espere o **"Aviso por voz pronto"**.
   Enquanto isso, se o Claude precisar de você, quem avisa é a voz do Windows.
4. Teste, digitando **sozinho** na caixa de mensagem (sem nenhum outro texto na mesma mensagem):
   ```
   /aviso-voz testar
   ```
   Você deve ouvir: "Este é um teste do aviso por voz."

---

## Comandos

Digite cada comando **sozinho** na mensagem.

| Comando | O que faz |
| --- | --- |
| `/aviso-voz` | Abre o painel de ajustes |
| `/aviso-voz testar` | Toca um aviso de teste |
| `/aviso-voz status` | Diz se a voz está pronta e mostra as opções |
| `/aviso-voz instalar` | Prepara a voz de novo (use se algo falhou) |

## Ajustes do painel

| Ajuste | O que muda |
| --- | --- |
| **Voz** | Francisca (padrão), Thalita ou Antonio |
| **Como te chamar** | Seu nome no começo dos avisos ("Ana, preciso da sua autorização"). Vazio = sem nome |
| **Respostas curtas** | Falar toda resposta, ou só as que demoraram (padrão: 20 s ou mais) |
| **Repetir até você responder** | Desligada, 5, 10 ou 15 minutos |
| **Tamanho da frase** | Curta, média, detalhada ou completa |
| **Silêncio** | 30 min, 1 h, 2 h, ou desfazer |
| **Microfone** | Calar na hora em que você dita no microfone do Claude |
| **Ligar / Desligar** | Pausa tudo sem desinstalar |

Por padrão, o aviso só fala quando **o Claude precisa de você** (uma pergunta, uma autorização ou um erro).
Tarefas que terminam sem pergunta ficam em silêncio.

## Problemas comuns

| Problema | O que fazer |
| --- | --- |
| "Repository not found" ao instalar | Aceite o convite (passo 1) e refaça o login (`gh auth login`, `gh auth setup-git`) |
| Não sai som nenhum | Confira o volume do Windows e rode `/aviso-voz testar`. Depois veja `/aviso-voz status` |
| Fica em "Preparando a voz…" | Rode `/aviso-voz instalar`. A primeira vez precisa de internet |
| "Não consegui preparar a voz" | Antivírus ou rede da empresa podem bloquear o download. Libere `github.com`, `python.org` e `pypi.org`, e rode `/aviso-voz instalar` |
| Rede da empresa com proxy | Peça ao TI para liberar os sites acima; a voz em si usa o serviço de voz da Microsoft |
| `/aviso-voz` não faz nada | O comando tem que ser a única coisa da mensagem |
| Fala de mais | Use **Silêncio**, ou deixe **Respostas curtas** em "Só de 20s em diante" |

O passo a passo da preparação fica em `%USERPROFILE%\.claude\aviso-voz\instalacao.log`, e os erros em `erros.log`, na mesma pasta.

## Como funciona e privacidade
- Tudo roda no **seu computador**. O plugin não depende do computador de ninguém nem de servidor próprio.
- Para virar áudio, o texto do aviso vai para o **serviço de voz da Microsoft (Edge TTS)**, o mesmo da leitura em voz alta do navegador Edge. Sem internet, a voz do Windows assume.
- Em respostas longas, um **resumo curto** pode ser feito pelo seu próprio Claude (usa um pouquinho do **seu** plano). Se o Claude não for encontrado, o aviso usa o começo da resposta.
- Nada é enviado ao autor do plugin.
- Arquivos: o plugin fica onde o Claude guarda os plugins; seus ajustes, a fila e a voz ficam em `%USERPROFILE%\.claude\aviso-voz`.

## Atualizar
Quando houver versão nova, o Claude avisa em **Plugins**. Você também pode rodar `/plugin update aviso-voz`.

## Desinstalar
1. Em **Plugins**, remova o `aviso-voz`, e reinicie o Claude.
2. Se quiser apagar também a voz baixada e os ajustes, apague a pasta `%USERPROFILE%\.claude\aviso-voz`.
