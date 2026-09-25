# Passo a passo — colocar o Radar no ar

Guia de execução detalhado. Cada etapa tem **o que fazer**, **o que você deve ver** e **o que fazer se der errado**.

**Tempo total:** 25 a 35 minutos · **Custo:** R$ 0

Deixe estes dois arquivos abertos, você vai copiar deles:
- `apps-script/Codigo.gs`
- `apps-script/Prompts.gs`

---

## Checklist geral

- [ ] Etapa 0 — Pegar a chave do Gemini
- [ ] Etapa 1 — Criar a planilha
- [ ] Etapa 2 — Criar o projeto no Apps Script
- [ ] Etapa 3 — Configurar o script
- [ ] Etapa 4 — Autorizar e criar as abas
- [ ] Etapa 5 — Importar os dados
- [ ] Etapa 6 — Verificar a instalação
- [ ] Etapa 7 — Testar sem enviar
- [ ] Etapa 8 — Ativar o agendamento
- [ ] Etapa 9 — Confirmar no dia seguinte

---

## Etapa 0 — Pegar a chave do Gemini

⏱️ 3 minutos

**O que fazer:**

1. Acesse **https://aistudio.google.com/apikey**
2. Faça login com a conta Google que vai rodar o Radar
3. Clique em **Create API key** (ou **Criar chave de API**)
4. Se pedir para escolher um projeto, selecione qualquer um ou crie um novo
5. Clique no ícone de **copiar** ao lado da chave gerada
6. Cole em algum lugar temporário (Bloco de Notas) — você vai usar na Etapa 3

**O que você deve ver:** uma chave começando com `AIza`, com cerca de 39 caracteres.

**Se der errado:**

| Problema | Solução |
|---|---|
| Não aparece o botão de criar | Verifique se está logado; alguns perfis corporativos bloqueiam o AI Studio — use uma conta pessoal |
| Pede cartão de crédito | Você entrou no Google Cloud em vez do AI Studio. Confira que a URL é `aistudio.google.com/apikey` |

> 🔒 A chave é como uma senha. Ela nunca vai ficar escrita no código — na Etapa 3 vamos guardá-la num cofre separado.

---

## Etapa 1 — Criar a planilha

⏱️ 3 minutos

**O que fazer:**

1. Acesse **https://sheets.new** (cria uma planilha em branco na hora)
2. Clique no nome no canto superior esquerdo ("Planilha sem título") e renomeie para **Radar de Conteúdo — Base**
3. Olhe a URL na barra de endereço. Ela tem este formato:

```
https://docs.google.com/spreadsheets/d/1a2B3c4D5e6F7g8H9i0J/edit#gid=0
                                      └──────────────────┘
                                        este é o ID
```

4. Copie **só o trecho entre `/d/` e `/edit`** e guarde junto com a chave do Gemini

**O que você deve ver:** um código de aproximadamente 44 caracteres, com letras, números, hífens e underscores.

**Se der errado:**

| Problema | Solução |
|---|---|
| Copiou a URL inteira | Não tem problema — na Etapa 3 recorte só o pedaço do meio |
| A URL tem `/u/0/` no meio | Normal, é a conta ativa. O ID continua sendo o trecho entre `/d/` e `/edit` |

---

## Etapa 2 — Criar o projeto no Apps Script

⏱️ 6 minutos

**O que fazer:**

1. Acesse **https://script.google.com**
2. Clique em **Novo projeto** (botão azul, canto superior esquerdo)
3. Clique no nome do projeto ("Projeto sem título", no topo) e renomeie para **Radar de Conteúdo**
4. No editor, você verá um arquivo `Código.gs` com um `function myFunction() {}`. **Apague tudo** (Ctrl+A, Delete)
5. Abra `apps-script/Codigo.gs`, copie **todo** o conteúdo e cole ali
6. Na barra lateral esquerda, ao lado de **Arquivos**, clique no **+** › **Script**
7. Digite o nome **Prompts** e pressione Enter (não precisa digitar `.gs`)
8. Apague o conteúdo padrão desse arquivo novo
9. Abra `apps-script/Prompts.gs`, copie tudo e cole
10. Salve com **Ctrl+S**

**O que você deve ver:** dois arquivos na barra lateral — `Código.gs` e `Prompts.gs` — e nenhum sublinhado vermelho de erro no editor.

**Se der errado:**

| Problema | Solução |
|---|---|
| Aparece erro de sintaxe | Provavelmente a cópia veio incompleta. Selecione tudo de novo (Ctrl+A no arquivo de origem) e recole |
| Criou como HTML em vez de Script | Apague o arquivo e refaça o passo 6 escolhendo **Script** |
| Não acha o botão + | Ele fica na linha "Arquivos", aparece ao passar o mouse |

> ℹ️ Os dois arquivos compartilham o mesmo espaço de execução no Apps Script. Por isso as constantes de `Prompts.gs` funcionam dentro de `Código.gs` sem precisar importar nada.

---

## Etapa 3 — Configurar o script

⏱️ 5 minutos

### 3.1 Preencher os dados no topo do código

No arquivo `Código.gs`, localize o bloco `CONFIG` (linhas 20 a 39) e altere **três linhas**:

```javascript
PLANILHA_ID: 'cole_aqui_o_id_da_etapa_1',
EMAIL_DESTINO: 'quem_recebe_a_pauta@gmail.com',
EMAIL_ALERTA: 'seu_email@gmail.com',
```

- `EMAIL_DESTINO` — para onde vai a pauta diária. Enquanto estiver testando, deixe o seu; troque pelo da Dra. Simone quando for para valer
- `EMAIL_ALERTA` — para onde vai o aviso caso a execução falhe. Deixe sempre o seu

Salve com **Ctrl+S**.

### 3.2 Guardar a chave do Gemini no cofre

1. Na barra lateral esquerda, clique no ícone de **engrenagem** (**Configurações do projeto**)
2. Role até o fim, na seção **Propriedades do script**
3. Clique em **Adicionar propriedade de script**
4. Preencha:
   - **Propriedade:** `GEMINI_API_KEY`
   - **Valor:** a chave da Etapa 0
5. Clique em **Salvar propriedades do script**

### 3.3 Conferir o fuso horário

Ainda em **Configurações do projeto**, no topo, confirme que **Fuso horário** está em **(GMT-03:00) Horário Padrão de Brasília — São Paulo**. Se não estiver, ajuste.

**O que você deve ver:** a propriedade `GEMINI_API_KEY` listada (o valor aparece mascarado) e o fuso de São Paulo.

**Se der errado:**

| Problema | Solução |
|---|---|
| Não encontra "Propriedades do script" | Role a página até o final; a seção fica abaixo de tudo |
| Digitou o nome errado | Precisa ser exatamente `GEMINI_API_KEY`, tudo maiúsculo com underscores |
| Fuso errado depois de salvar | Feche e reabra o projeto para confirmar que gravou |

---

## Etapa 4 — Autorizar e criar as abas

⏱️ 4 minutos

**O que fazer:**

1. Volte ao editor (ícone `< >` na barra lateral)
2. Na barra de ferramentas do topo, há um menu suspenso com nomes de função. Selecione **`prepararPlanilha`**
3. Clique em **▶ Executar**
4. Vai abrir uma janela de autorização. Siga:
   - **Revisar permissões**
   - Escolha sua conta Google
   - Aparece a tela **"O Google não verificou este app"** → clique em **Avançado** (link pequeno, embaixo à esquerda)
   - Clique em **Acessar Radar de Conteúdo (não seguro)**
   - Role a lista de permissões e clique em **Permitir**

**O que você deve ver:** no painel inferior (Registro de execução), a mensagem:

```
Abas prontas. Agora importe os CSVs em evergreen e base_clinica.
```

E, ao abrir a planilha da Etapa 1, três novas abas na parte de baixo: `historico`, `evergreen` e `base_clinica`.

**Se der errado:**

| Problema | Solução |
|---|---|
| "O Google não verificou este app" assusta | É esperado. O aviso aparece porque o script é seu e não passou pela revisão pública do Google. Você está autorizando o seu próprio código |
| `Exception: Unexpected error while getting the method or property openById` | O `PLANILHA_ID` está errado. Volte à Etapa 1 e confira se copiou só o trecho do meio |
| Não aparece o menu de funções | Salve o arquivo primeiro (Ctrl+S); o menu só lista funções de arquivos salvos |
| Nada acontece ao clicar em Executar | Verifique se a aba do navegador não bloqueou o pop-up de autorização |

> 💡 Pode apagar a aba padrão "Página1" da planilha, ela não é usada.

---

## Etapa 5 — Importar os dados

⏱️ 6 minutos

Você vai importar dois arquivos da pasta `backup/dados/`. **A ordem dos cliques importa** — o erro mais comum é o Google criar uma aba nova em vez de preencher a existente.

### 5.1 Importar o banco de temas evergreen

1. Abra a planilha
2. **Clique na aba `evergreen`** na parte de baixo (ela precisa estar selecionada)
3. Menu **Arquivo › Importar**
4. Aba **Fazer upload** › selecione `backup/dados/radar_evergreen.csv`
5. Na janela de opções, configure:
   - **Local de importação:** `Substituir planilha atual` ← importante
   - **Tipo de separador:** `Personalizado` e digite `;` no campo que aparece
   - **Converter texto em números e datas:** deixe desmarcado
6. Clique em **Importar dados**

### 5.2 Importar a base da clínica

Repita exatamente o mesmo processo, mas:
- Clicando antes na aba **`base_clinica`**
- Selecionando o arquivo `radar_base_clinica.csv`

**O que você deve ver:**

| Aba | Conteúdo esperado |
|---|---|
| `evergreen` | Cabeçalho + **18 linhas**, colunas `pilar`, `tema`, `angulo` |
| `base_clinica` | Cabeçalho + **32 linhas**, colunas `categoria`, `item`, `descricao`, `ativo` |
| `historico` | Só o cabeçalho (será preenchido automaticamente) |

Confira também se os acentos aparecem corretos ("Humanização", não "HumanizaÃ§Ã£o").

**Se der errado:**

| Problema | Solução |
|---|---|
| Criou uma aba nova chamada "radar_evergreen" | Você deixou em "Inserir nova planilha". Apague a aba criada e refaça escolhendo **Substituir planilha atual** |
| Tudo caiu numa coluna só | O separador ficou como vírgula. Refaça escolhendo **Personalizado** e `;` |
| Acentos quebrados | Refaça a importação; se persistir, abra o CSV num editor e salve como UTF-8 |
| Importou na aba errada | Apague o conteúdo da aba (Ctrl+A, Delete) e refaça clicando na aba certa antes |

---

## Etapa 6 — Verificar a instalação

⏱️ 2 minutos

**O que fazer:**

1. Volte ao editor do Apps Script
2. Selecione a função **`verificarInstalacao`** no menu suspenso
3. Clique em **▶ Executar**
4. Abra o painel **Registro de execução** (aparece automaticamente embaixo)

**O que você deve ver:**

```
Aba historico: 0 registros.
Aba evergreen: 18 registros.
Aba base_clinica: 32 registros.
Gemini respondeu corretamente.
✅ Tudo certo. Rode testarAgora() para uma prévia completa.
```

**Se der errado:** a própria função diz o que falta. Os casos possíveis:

| Mensagem | O que fazer |
|---|---|
| `PLANILHA_ID não configurado` | Volte à Etapa 3.1 |
| `GEMINI_API_KEY não definida` | Volte à Etapa 3.2 — confira se o nome está exato |
| `Aba evergreen está vazia` | A importação da Etapa 5 não funcionou; refaça |
| `Gemini: ... retornou 400` | Chave inválida ou incompleta. Gere outra na Etapa 0 |
| `Gemini: ... retornou 403` | A API do Gemini não está habilitada para essa chave; recrie pelo AI Studio |
| `Gemini: ... retornou 429` | Cota momentânea excedida. Espere alguns minutos e rode de novo |
| `Aba "historico" não encontrada` | Rode `prepararPlanilha` de novo (Etapa 4) |

**Não avance enquanto não aparecer o ✅.**

---

## Etapa 7 — Testar sem enviar

⏱️ 3 minutos

Esta etapa executa o fluxo completo — coleta, curadoria, geração e guardrails — **sem mandar e-mail e sem gravar no histórico**.

**O que fazer:**

1. Selecione a função **`testarAgora`**
2. Clique em **▶ Executar**
3. Aguarde de 30 a 60 segundos
4. Leia o Registro de execução

**O que você deve ver:**

```
Pilar do dia: Educação
Itens coletados: 180
Candidatos após dedupe: 25
Origem da pauta: radar — [título de alguma notícia real]
MODO TESTE — e-mail não enviado. Prévia do assunto: Radar do dia - Educação - 25/08/2026
{
  "tema": "...",
  "objetivo": "educar",
  "stories": [ ... 5 itens ... ],
  ...
}
```

**Confira, com calma:**

- [ ] O pilar bate com o dia da semana de hoje?
- [ ] Coletou uma quantidade razoável de notícias (dezenas, não zero)?
- [ ] O tema escolhido faz sentido para uma paciente de estética?
- [ ] A pauta tem exatamente 5 Stories?
- [ ] O procedimento citado existe mesmo na lista da clínica?
- [ ] Nenhuma promessa de resultado no texto?

**Se der errado:**

| Problema | Solução |
|---|---|
| `Itens coletados: 0` | O Google News pode ter recusado a requisição. Rode de novo em alguns minutos; se persistir, teste uma das URLs de `listarFontesRss()` direto no navegador |
| `Origem da pauta: fallback` | Não é erro — significa que nada atingiu a nota 7 hoje. O sistema funcionou como projetado. Rode de novo amanhã |
| `Guardrails reprovaram` no log | Também não é erro: a trava funcionou e a pauta foi corrigida automaticamente. Confira o resultado final |
| Excedeu o tempo de execução | Raro. Reduza `ITENS_POR_FEED` de 10 para 6 no CONFIG |

> Se a pauta não agradou no conteúdo (e não no funcionamento), o ajuste é no `PROMPT_GERACAO` dentro de `Prompts.gs`.

---

## Etapa 8 — Ativar o agendamento

⏱️ 2 minutos

**O que fazer:**

1. Selecione a função **`instalarAcionador`**
2. Clique em **▶ Executar**
3. Confirme no log: `Acionador criado: todo dia às 6h (domingo é ignorado pelo próprio script).`
4. Clique no ícone de **relógio** (Acionadores) na barra lateral esquerda para confirmar

**O que você deve ver:** um acionador listado, com:
- Função: `radarDoDia`
- Tipo: Baseado no tempo · Contador de dias
- Horário: entre 6h e 7h

**Se der errado:**

| Problema | Solução |
|---|---|
| Criou vários acionadores | A função apaga os antigos antes de criar. Se sobraram, apague manualmente pelo ícone de três pontos |
| O horário mostra outra faixa | O Google agenda dentro de uma janela de 1 hora. "6h–7h" é o esperado |

> ⚠️ Não rode `instalarAcionador` várias vezes por precaução — uma vez basta.

---

## Etapa 9 — Confirmar no dia seguinte

⏱️ 2 minutos, na manhã seguinte

**O que fazer:**

1. Depois das 7h, confira a caixa de entrada de `EMAIL_DESTINO`
2. No Apps Script, ícone de **relógio** › aba **Execuções** (ou menu lateral **Execuções**)
3. Abra a planilha e veja a aba `historico`

**O que você deve ver:**

- Um e-mail com assunto **"Radar do dia - [pilar] - [data]"**, formatado, legível no celular
- Uma execução com status **Concluído**
- Uma linha nova em `historico` com o tema do dia

**Se não chegou o e-mail:**

| Situação | Diagnóstico |
|---|---|
| Chegou um e-mail de alerta `[Radar] Falha na execução` | Leia a mensagem de erro nele — ela diz exatamente o que quebrou |
| Execução com status "Falha" | Clique nela para ver o erro completo |
| Nenhuma execução listada | O acionador não foi criado. Refaça a Etapa 8 |
| Execução OK mas sem e-mail | Confira spam e o valor de `EMAIL_DESTINO` |
| Hoje é domingo | Comportamento correto: não há envio aos domingos |

---

## Quando o Google aposenta o modelo de IA

Sintoma: e-mail `[Radar] Falha na execução` com a frase **"This model ... is no longer available to new users"** (erro 404).

**O que significa:** o Google aposentou aquele modelo para contas novas — **mesmo que ele continue aparecendo na lista de modelos da API**. A própria mensagem costuma indicar o substituto: *"Please update your code to use models/..."*.

**O que o Radar já faz sozinho:** se todos os modelos de `CONFIG.MODELOS` derem 404, ele se autocorrige — lê o modelo que o Google recomendou na mensagem de erro, testa os modelos "flash" disponíveis do mais novo ao mais antigo, grava o primeiro que responder e passa a usá-lo nas execuções seguintes. **Na maioria das vezes você não precisa fazer nada.** O alerta só chega se nem a autocorreção encontrou um modelo funcionando.

⏱️ 5 minutos

### Passo 1 — Ver o diagnóstico real

1. Abra o projeto no Apps Script
2. No menu suspenso de funções, selecione **`testarModelos`**
3. Clique em **▶ Executar**
4. Leia o Registro de execução (painel inferior)

**O que você deve ver:** cada modelo testado de verdade, com o motivo de cada falha:

```
✅ gemini-3.6-flash — funcionando
❌ gemini-2.5-flash — APOSENTADO para contas novas (404)
...
💡 O próprio Google recomendou: gemini-3.6-flash
➡️ Cole em CONFIG.MODELOS: MODELOS: ["gemini-3.6-flash", ...],
```

### Passo 2 — Colar a lista sugerida

1. No `Código.gs`, localize a linha `MODELOS:` dentro do bloco `CONFIG`
2. Substitua a linha inteira pela que aparece depois de ➡️ no log
3. Salve com **Ctrl+S**

### Passo 3 — Confirmar

1. Selecione **`testarAgora`** → **▶ Executar**
2. Aguarde de 30 a 60 segundos

**O que você deve ver:** a pauta completa com os 5 Stories no log, sem nenhuma linha `Falha em`.

**Se der errado:**

| Problema | Solução |
|---|---|
| Todos com ❌ 404 | Troque `API_VERSAO` entre `'v1'` e `'v1beta'` no CONFIG, salve e rode `testarModelos` de novo |
| Todos com ❌ 429 | Cota esgotada — veja a seção "Quando a IA falha por cota" |
| Todos com ❌ 400 ou 403 | Problema na chave — gere outra em [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| O log mostra `Modelo gravado pela autocorreção` com um modelo que você não quer | Rode **`esquecerModeloDescoberto`** — o Radar volta a usar só a sua lista |

> ⚠️ `listarModelosDisponiveis` mostra o que a API **lista**, não o que ela **aceita**. Foi confiando nela que o `gemini-2.5-flash` voltou para a configuração e quebrou. Para decidir, use sempre `testarModelos`.

---

## Quando todos os modelos dão 404

Sintoma: `testarModelos` devolve **404 em todos**, ou o e-mail de falha menciona 404.

**O que significa:** não é cota nem chave inválida — os **nomes dos modelos mudaram**. O Google renomeia e aposenta modelos periodicamente, então uma lista fixa no código envelhece.

⏱️ 4 minutos

### Passo 1 — Perguntar ao Google quais modelos existem

1. No editor, selecione a função **`listarModelosDisponiveis`**
2. Clique em **▶ Executar**
3. Leia o Registro de execução

**O que você deve ver:** a lista real de modelos da sua chave, com um bloco pronto no fim:

```
========== API v1beta ==========
Modelos que geram texto (14):
   gemini-flash-latest
   gemini-3-flash-preview
   ...

➡️ Para esta versão, use:
   API_VERSAO: 'v1beta',
   MODELOS: ["gemini-flash-latest","gemini-3-flash-preview","..."],
```

A função testa **as duas versões da API** (`v1beta` e `v1`) e sugere separadamente para cada uma.

### Passo 2 — Colar no CONFIG

1. No `Código.gs`, localize `API_VERSAO` e `MODELOS` no bloco `CONFIG`
2. Substitua as duas linhas pelo bloco sugerido no log
3. **Ctrl+S**

> Não presuma qual versão é a certa: use a que **de fato listou modelos**. Em agosto/2026, por exemplo, os modelos apareceram na `v1` e não na `v1beta` — o oposto do que a documentação antiga sugeria.
>
> A sugestão sai ordenada do modelo **mais novo para o mais antigo**. Vale ainda misturar gerações na lista (ex.: um 3.8, um 3.5 e um 2.5) em vez de três variantes irmãs: se uma geração inteira tiver problema, você ainda tem uma alternativa de outra família.

### Passo 3 — Confirmar

1. Rode **`testarModelos`** → os nomes novos devem aparecer com ✅
2. Rode **`testarAgora`** → a pauta completa deve voltar a aparecer no log

**Se der errado:**

| Problema | Solução |
|---|---|
| `listarModelosDisponiveis` também deu erro | Aí o problema é a chave, não o modelo. Veja a seção abaixo, casos 400 e 403 |
| Nenhuma das versões listou modelos | Gere uma chave nova em [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| A lista veio, mas os modelos sugeridos dão 429 | Os nomes estão certos e o problema agora é cota. Veja a seção seguinte |

---

## Quando a IA falha por cota

Sintoma: o Radar parou de enviar e chegou um e-mail `[Radar] Falha na execução` mencionando **429**.

⏱️ 5 minutos

### Passo 1 — Descobrir qual modelo ainda responde

1. Abra o projeto no Apps Script
2. Selecione a função **`testarModelos`**
3. Clique em **▶ Executar**
4. Leia o Registro de execução

**O que você deve ver:** uma linha por modelo, por exemplo:

```
❌ gemini-2.5-flash — COTA ESGOTADA (429)
✅ gemini-2.5-flash-lite — funcionando
✅ gemini-2.0-flash — funcionando

➡️ Coloque estes em CONFIG.MODELOS, nesta ordem: ["gemini-2.5-flash-lite","gemini-2.0-flash"]
```

### Passo 2 — Agir conforme o diagnóstico

| O que apareceu | O que significa | O que fazer |
|---|---|---|
| Algum modelo com ✅ | Só aquele modelo específico estourou a cota | Copie a lista sugerida para `CONFIG.MODELOS` e salve. Resolvido |
| Todos com **429** | A cota da chave inteira acabou | Vá ao Passo 3 |
| Todos com **400** | A chave está inválida ou foi revogada | Gere outra em [aistudio.google.com/apikey](https://aistudio.google.com/apikey) e atualize `GEMINI_API_KEY` nas Configurações do projeto |
| Todos com **403** | A API não está habilitada para essa chave | Recrie a chave pelo AI Studio (não pelo Console do Google Cloud) |

### Passo 3 — Se a cota da chave acabou

Três saídas, da mais simples à mais definitiva:

**a) Esperar o reset.** As cotas gratuitas do Gemini se renovam periodicamente. Se foi um pico pontual, o Radar volta sozinho no dia seguinte — e agora, com a lista de modelos alternativos, ele tenta os três antes de desistir.

**b) Gerar uma chave nova em outro projeto.** No AI Studio, ao criar a chave, escolha **criar um novo projeto** em vez de reaproveitar o existente. A cota gratuita é contada por projeto.

**c) Ativar o faturamento** (recomendado se for para produção). Neste volume — cerca de 3 chamadas por dia — o custo estimado fica **abaixo de R$ 1 por mês**. Some-se a isso que os limites sobem muito, e o problema deixa de existir. Ative em [aistudio.google.com](https://aistudio.google.com) › configurações de faturamento do projeto.

### Passo 4 — Confirmar

Rode **`testarAgora`** e confirme que o log mostra a pauta completa de novo.

---

## Depois de tudo funcionando

### Fase de calibração — duas primeiras semanas

Para cada pauta recebida, marque na coluna `feedback` da aba `historico`: **usei**, **adaptei** ou **descartei**. Esse retorno é o que orienta os ajustes de prompt, nota de corte e fontes.

Meta do MVP: pelo menos 4 de 6 pautas semanais aproveitáveis.

### Antes de entregar para a Dra. Simone

- [ ] Trocar `EMAIL_DESTINO` pelo e-mail dela
- [ ] Preencher a linha `[PREENCHER] Procedimentos que a clínica NÃO realiza` na aba `base_clinica`
- [ ] Validar com ela as descrições dos 24 procedimentos
- [ ] Levantar as regras de publicidade do Conselho Federal de Biomedicina e convertê-las em restrições no `PROMPT_GERACAO`
- [ ] Confirmar se há casos autorizados para os pilares de quarta e sábado

### Ajustes rápidos

| Quero... | Onde mexer |
|---|---|
| Enviar para dois e-mails | `EMAIL_DESTINO`, separando por vírgula — ou usar `EMAIL_COPIA` / `EMAIL_COPIA_OCULTA` (ver abaixo) |
| Mudar o horário de envio | `instalarAcionador()`, trocar `.atHour(6)` e rodar de novo |
| Adicionar um tema de busca | Nova linha em `listarFontesRss()` |
| Deixar a curadoria mais exigente | Aumentar a nota de corte no `PROMPT_FILTRO` |
| Mudar o tom das pautas | `PROMPT_GERACAO` em `Prompts.gs` |
| Incluir um procedimento novo | Nova linha na aba `base_clinica`, categoria `procedimento` |
| Adicionar um tema de reserva | Nova linha na aba `evergreen` |
| Bloquear mais expressões | Array `TERMOS_PROIBIDOS` no `Código.gs` |

### Enviar para mais de um e-mail

Há três formas, e a escolha muda o que cada pessoa enxerga:

| Forma | Como configurar | Quem vê quem |
|---|---|---|
| **Ambos como destinatários** | `EMAIL_DESTINO: 'simone@clinica.com, joao@gmail.com'` | Os dois aparecem no campo "Para" e veem um ao outro |
| **Um em cópia** | `EMAIL_DESTINO: 'simone@clinica.com'` e `EMAIL_COPIA: 'joao@gmail.com'` | O e-mail parece endereçado à Dra. Simone, com você visivelmente em cópia |
| **Cópia oculta** | `EMAIL_DESTINO: 'simone@clinica.com'` e `EMAIL_COPIA_OCULTA: 'joao@gmail.com'` | Ela não sabe que você recebe uma cópia |

Todos os três campos aceitam vários endereços separados por vírgula. Depois de alterar, salve com **Ctrl+S** — não precisa recriar o acionador.

**Para a fase de calibração**, a segunda opção costuma ser a melhor: o e-mail chega com cara de ter sido feito para ela, e você acompanha cada pauta sem precisar pedir print.
