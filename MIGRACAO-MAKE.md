# Migração do Radar de Conteúdo — n8n → Make

> **Situação:** o trial do n8n Cloud encerrou e a instância foi suspensa. A API já responde `Not Found`, então não houve como exportar o workflow. Toda a lógica foi reconstruída em `backup/LOGICA-COMPLETA.md` e os dados das tabelas em `backup/dados/*.csv`.
>
> Este guia é o passo a passo para reconstruir o sistema no Make.

---

## 1. Antes de começar: três caminhos possíveis

Vale conhecer as três opções antes de investir tempo, porque o esforço varia bastante.

| Caminho | Esforço | Custo | Fidelidade |
|---|---|---|---|
| **A — Make puro** | Alto (reescrever 8 blocos de lógica em fórmulas) | Grátis a US$ 9/mês | ~85% (guardrails ficam mais simples) |
| **B — Make + endpoint de lógica** | Médio (Make orquestra, JS roda em Apps Script) | Grátis | 100% |
| **C — n8n self-hosted** | Baixo (subir container e recriar) | Grátis (ou ~US$ 5/mês em VPS) | 100% |

**Recomendação honesta:** se o objetivo é só manter o Radar rodando sem pagar, o **caminho C** é o mais barato em tempo — o n8n Community Edition é gratuito e roda em Docker, Railway ou Render, e a lógica que você já validou continua idêntica. O caminho A faz sentido se você quer aprender Make ou padronizar seus projetos nele.

Como você pediu Make, o guia cobre **A** em detalhe e traz **B** na seção 8, que é o melhor dos dois mundos.

---

## 2. Mapa de equivalências

| n8n | Make | Observação |
|---|---|---|
| Schedule Trigger (cron) | Agendamento do cenário | Make permite escolher dias da semana e hora direto na interface — dispensa o guarda de domingo |
| Code (JavaScript) | ❌ Não existe equivalente nativo | **Principal fricção.** Resolver com fórmulas ou com o caminho B |
| Data Table | Data store | Equivalente direto |
| RSS Read | RSS › Retrieve RSS feed items | Equivalente |
| AI Agent + Gemini Chat Model | Google Gemini AI › Create a completion | Mais simples: não há conceito de agente, é uma chamada direta |
| IF | Router + filtros | Sem "merge" de volta — exige redesenho |
| Merge | ❌ Não existe | Contornar (ver 3.2) |
| Gmail | Gmail › Send an email | Equivalente |
| Set | Tools › Set variable(s) | Equivalente |
| Split Out | Iterator | Equivalente |
| — | Array aggregator | **Sem correspondente no n8n, mas essencial no Make** (ver 3.3) |

---

## 3. As três diferenças que forçam redesenho

### 3.1 Não existe nó de código

O Radar tem 8 blocos de JavaScript. No Make, cada um precisa virar fórmula, combinação de módulos, ou sair da plataforma (caminho B).

O que dá para fazer com fórmulas nativas: montar o pilar do dia, deduplicar, ordenar, fatiar, montar o prompt, montar o HTML, verificar termos proibidos.
O que fica mais frágil: a normalização de texto (remover acentos e pontuação antes de comparar) não tem função nativa equivalente, então o matching de "tema já usado" e "procedimento permitido" fica mais permissivo.

### 3.2 Router não volta a se juntar

No n8n, o IF bifurcava e um nó Merge reunia os caminhos. No Make, o que entra num Router não se reúne — você teria que duplicar todos os módulos seguintes em cada rota.

**Solução:** eliminar a bifurcação. Buscar o evergreen **sempre** (é uma consulta barata) e decidir por fórmula:

```
{{ if(1.melhor = null; evergreen.tema; candidatos[filtro.melhor].titulo) }}
```

Assim o cenário fica linear do começo ao fim, e o mesmo vale para o caminho da correção de guardrails.

### 3.3 A cobrança é por operação, não por execução

Esta é a diferença que mais afeta o custo. No n8n você paga por execução do workflow. No Make, **cada módulo que roda conta uma operação — e um módulo roda uma vez para cada item que recebe.**

O Radar coleta ~300 notícias por dia. Se elas passarem item a item pelos módulos seguintes, são centenas de operações por execução, e o plano gratuito (~1.000 operações/mês) acaba no segundo dia.

**Solução obrigatória:** colocar um **Array aggregator** logo depois do RSS, para que tudo vire um único item antes de seguir. E limitar itens por feed.

---

## 4. Arquitetura adaptada ao Make

```
[1]  Agendamento (seg–sáb, 06:00)
[2]  Tools › Set variables ......... pilar do dia, direcionamento, data
[3]  Data store › Search ........... histórico dos últimos 30 dias
[4]  Array aggregator .............. temas usados → 1 item
[5]  Tools › Set variable .......... array com as 10 URLs de RSS
[6]  Iterator ...................... 10 iterações
[7]  RSS › Retrieve feed items ..... máx. 8 itens por feed
[8]  Array aggregator .............. ~80 notícias → 1 item
[9]  Tools › Set variable .......... dedupe + ranking premium + corte de 25
[10] Google Gemini › Completion .... FILTRO de relevância
[11] JSON › Parse JSON
[12] Data store › Search ........... evergreen do pilar (sempre)
[13] Data store › Search ........... base da clínica
[14] Array aggregator .............. contexto → 1 item
[15] Tools › Set variable .......... escolhe radar OU fallback + monta prompt
[16] Google Gemini › Completion .... GERAÇÃO da pauta
[17] JSON › Parse JSON
[18] Tools › Set variable .......... guardrails (violações)
[19] Router ........................ aprovado / reprovado
     └─ reprovado: Gemini › Completion (correção) → Parse JSON
[20] Tools › Set variable .......... HTML do e-mail
[21] Gmail › Send an email
[22] Data store › Add a record ..... registro no histórico
```

Estimativa: **~28 a 35 operações por execução**, ou seja, cerca de **750 a 900 por mês** (26 dias úteis). Cabe no plano gratuito, mas com pouca folga — confirme o contador real depois da primeira semana. O plano Core (~US$ 9/mês, 10.000 operações) resolve com sobra.

---

## 5. Passo a passo

### 5.1 Criar os três data stores

Em **Data stores › Add data store**, criar as três estruturas descritas em `backup/LOGICA-COMPLETA.md`, seção 2.

Para popular `radar_evergreen` e `radar_base_clinica`, use os CSVs em `backup/dados/`. O Make não importa CSV direto em data store — a forma mais rápida é criar um cenário temporário: **Google Sheets › Search rows → Data store › Add a record**, rodar uma vez e apagar o cenário. (Cada linha inserida consome 1 operação: são 50 no total.)

> ⚠️ Confirme o limite de armazenamento de data store do seu plano. As três tabelas são pequenas (poucos KB), mas o histórico cresce ~26 linhas/mês.

### 5.2 Agendamento

No cenário, clique no relógio do primeiro módulo:
- **Run scenario:** Days of the week
- **Days:** Monday a Saturday
- **Time:** 06:00

Confirme o fuso horário da organização em **Profile › Time zone** — deve estar em `America/Sao_Paulo`, senão o horário sai deslocado.

### 5.3 Pilar do dia (módulo 2)

**Tools › Set multiple variables:**

| Variável | Valor |
|---|---|
| `diaSemana` | `{{ formatDate(now; "dddd"; "America/Sao_Paulo") }}` |
| `dataHoje` | `{{ formatDate(now; "DD/MM/YYYY"; "America/Sao_Paulo") }}` |
| `pilar` | `{{ switch(2.diaSemana; "Monday"; "Humanização"; "Tuesday"; "Dor da paciente"; "Wednesday"; "Caso clínico"; "Thursday"; "Educação"; "Friday"; "Engajamento"; "Saturday"; "Prova social e conversão"; "Educação") }}` |
| `direcionamento` | `{{ switch(2.pilar; "Humanização"; "Bastidores, rotina, preparação, proximidade"; "Dor da paciente"; "Situações comuns, dúvidas, incômodos, identificação"; "Caso clínico"; "Casos autorizados, processo, jornada. Sem caso autorizado, trabalhar como processo/jornada, sem inventar caso."; "Educação"; "Explicações, procedimentos, mitos e verdades"; "Engajamento"; "Enquetes, quizzes, perguntas, interação"; "Prova social e conversão"; "Resultados autorizados, depoimentos, bastidores, agenda."; "") }}` |

> Na primeira execução, confira o que `formatDate(now; "dddd")` devolveu. Se vier em português ou abreviado, ajuste os casos do `switch` conforme o retorno real.

### 5.4 Histórico (módulos 3 e 4)

**Data store › Search records** em `radar_historico`, com filtro `data_envio` **greater than** `{{ addDays(now; -30) }}`, limite 100.

Em seguida, **Array aggregator** (source: o módulo 3), agregando o campo `tema`. O resultado vira uma lista única de temas usados.

### 5.5 Coleta (módulos 5 a 8)

**Tools › Set variable** `feeds` com o array das 10 URLs. As consultas estão em `backup/LOGICA-COMPLETA.md`, seção 3.2 — lembre-se de aplicar *URL encode* nos termos com espaço e acento.

Formato do valor: `{{ split("url1,url2,url3..."; ",") }}` ou monte via JSON › Create JSON.

**Iterator** com source `{{ 5.feeds }}` → **RSS › Retrieve RSS feed items**:
- **URL:** `{{ 6.value }}`
- **Maximum number of returned items:** `8` ← importante para controlar operações

**Array aggregator** logo depois, agregando `title`, `link`, `description` e `pubDate`. **Não pule este módulo** — é o que impede a explosão de operações.

### 5.6 Curadoria mecânica (módulo 9)

**Tools › Set variable** `candidatos`. Aqui mora a maior perda de fidelidade: sem código, o dedupe e o ranking ficam simplificados.

Versão possível com funções nativas:

```
{{ slice(distinct(8.array; "title"); 0; 25) }}
```

Para o ranking de veículos reconhecidos, o caminho mais simples no Make é **não classificar mecanicamente** e, em vez disso, entregar a fonte para a IA e deixar o critério de credibilidade no prompt (que já existe). Perde-se a garantia de 15 vagas reservadas, mas ganha-se simplicidade — e nos testes o modelo já demonstrava preferir fontes fortes quando instruído.

> Se quiser manter o ranking exato, é o argumento mais forte para o caminho B (seção 8).

### 5.7 Filtro de relevância (módulos 10 e 11)

**Google Gemini AI › Create a completion:**
- **Model:** o Flash mais recente disponível na lista
- **System instruction:** o prompt de `backup/LOGICA-COMPLETA.md`, seção 4.1
- **Temperature:** `0.2`
- **User message:**

```
Pilar do dia: {{ 2.pilar }} ({{ 2.direcionamento }})

Temas já usados nos últimos 30 dias (evitar repetição):
{{ join(4.array; ", ") }}

Itens coletados hoje (avalie cada um pelo índice na lista):
{{ toString(9.candidatos) }}
```

> ⚠️ **Não inclua os links** no texto enviado. As URLs do Google News têm 500+ caracteres e já causaram estouro de limite de tokens no Groq (README, seção 9.1).

Se a app nativa do Gemini não estiver disponível, use **HTTP › Make a request**:
- `POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=SUA_CHAVE`
- Body JSON com `system_instruction`, `contents` e `generationConfig.temperature`.

Depois, **JSON › Parse JSON** sobre a resposta, com data structure gerada a partir do exemplo:

```json
{"avaliacoes":[{"indice":0,"nota":8,"justificativa":"texto"}],"melhor":0,"motivo":"texto"}
```

### 5.8 Contexto e escolha do tema (módulos 12 a 15)

**Data store › Search** em `radar_evergreen` filtrando `pilar` igual a `{{ 2.pilar }}` (limite 10).
**Data store › Search** em `radar_base_clinica` (todos os registros) → **Array aggregator**.

**Tools › Set multiple variables** — é aqui que a bifurcação é resolvida por fórmula:

| Variável | Valor |
|---|---|
| `origem` | `{{ if(11.melhor = null; "fallback"; "radar") }}` |
| `temaBase` | `{{ if(11.melhor = null; 12.tema; get(9.candidatos; 11.melhor + 1).title) }}` |
| `resumoBase` | `{{ if(11.melhor = null; 12.angulo; get(9.candidatos; 11.melhor + 1).description) }}` |
| `fonteBase` | `{{ if(11.melhor = null; "banco interno (evergreen)"; get(9.candidatos; 11.melhor + 1).source) }}` |
| `promptGeracao` | Concatenação conforme seção 3.7 do backup |

> ⚠️ **Atenção ao índice:** arrays no Make começam em **1**, e a IA devolve índice começando em **0**. Por isso o `+ 1` nas fórmulas acima. Esse é o erro mais provável nesta migração — se a pauta sair sobre a notícia errada, é aqui.

### 5.9 Geração e guardrails (módulos 16 a 19)

**Google Gemini › Create a completion** com o prompt da seção 4.2 do backup, temperatura `0.7` → **JSON › Parse JSON**.

**Tools › Set variable** `violacoes`, encadeando verificações:

```
{{ trim(
  if(contains(lower(toString(17.pauta)); "garante"); "termo proibido: garante; "; "") +
  if(contains(lower(toString(17.pauta)); "elimina de vez"); "termo proibido: elimina de vez; "; "") +
  if(contains(lower(toString(17.pauta)); "acaba com"); "termo proibido: acaba com; "; "") +
  if(contains(lower(toString(17.pauta)); "resultado imediato"); "termo proibido: resultado imediato; "; "") +
  if(contains(lower(toString(17.pauta)); "sem riscos"); "termo proibido: sem riscos; "; "") +
  if(contains(lower(toString(17.pauta)); "milagre"); "termo proibido: milagre; "; "") +
  if(contains(lower(toString(17.pauta)); "100%"); "termo proibido: 100%; "; "") +
  if(contains(lower(toString(17.pauta)); "definitivo"); "termo proibido: definitivo; "; "") +
  if(contains(lower(toString(17.pauta)); "para sempre"); "termo proibido: para sempre; "; "") +
  if(length(17.pauta.stories) = 5; ""; "estrutura invalida: nao tem 5 stories; ") +
  if(contains(lower(join(map(14.array; "item"); "|")); lower(17.pauta.procedimento_relacionado)); ""; "procedimento fora da lista; ")
) }}
```

A lista completa de 18 termos está na seção 3.8 do backup — inclua todos seguindo o mesmo padrão.

**Router** com duas rotas:
- **Rota 1** (filtro: `violacoes` está vazio) → segue para o e-mail
- **Rota 2** (filtro: `violacoes` não está vazio) → Gemini com o prompt de correção (seção 4.3) → Parse JSON → e-mail

Como o Router não reúne caminhos, os módulos de e-mail e histórico precisam ser duplicados nas duas rotas. Se quiser evitar a duplicação, use uma alternativa: sempre chamar a correção, passando "nenhum problema encontrado" quando não houver violação — custa 1 operação extra por dia, mas mantém o cenário linear.

### 5.10 E-mail e registro (módulos 20 a 22)

**Tools › Set variable** `corpoHtml`. Como a pauta sempre tem exatamente 5 Stories, dá para referenciar por índice e evitar um Iterator (economia de operações):

```
<div style="font-family:Arial;max-width:640px;margin:0 auto;color:#222;line-height:1.5;">
<h2>Radar do dia</h2>
<p style="color:#666;">{{ 2.dataHoje }} — Pilar: <strong>{{ 2.pilar }}</strong></p>
...
<div style="padding:12px;background:#f6f4fb;border-radius:8px;margin-bottom:12px;">
  <strong>Story 1 — {{ get(17.pauta.stories; 1).funcao }}</strong>
  <p><em>Texto de tela:</em> {{ get(17.pauta.stories; 1).texto_tela }}</p>
  <p><em>Fala:</em> {{ get(17.pauta.stories; 1).orientacao_fala }}</p>
</div>
... repetir para 2, 3, 4 e 5 ...
</div>
```

A estrutura completa das seções está na seção 3.9 do backup.

**Gmail › Send an email:**
- **To:** o e-mail de destino
- **Subject:** `Radar do dia - {{ 2.pilar }} - {{ 2.dataHoje }}`
- **Content type:** HTML
- **Content:** `{{ 20.corpoHtml }}`

**Data store › Add/replace a record** em `radar_historico` com `data_envio` = `{{ now }}`, `pilar`, `tema`, `fonte`, `link`, `origem` e `feedback` vazio.

---

## 6. Checklist de validação

Rode o cenário manualmente (**Run once**) e confira, em ordem:

- [ ] O pilar corresponde ao dia da semana correto
- [ ] O RSS trouxe itens dos 10 feeds (verifique o bundle do agregador)
- [ ] O agregador entregou **1 único item** para o módulo seguinte
- [ ] A IA devolveu JSON válido e o Parse JSON não falhou
- [ ] **O tema escolhido corresponde ao índice certo** (erro do `+1`)
- [ ] Quando `melhor = null`, o fallback pegou um tema do pilar correto
- [ ] O e-mail chegou formatado e legível no celular
- [ ] O histórico ganhou uma linha nova
- [ ] O contador de operações do painel ficou dentro do previsto

Depois, ative o cenário e confira na manhã seguinte se a execução agendada rodou.

---

## 7. Armadilhas conhecidas

| Armadilha | Como evitar |
|---|---|
| Explosão de operações | Array aggregator logo após o RSS; limite de 8 itens por feed |
| Índice trocado (0 vs 1) | Arrays no Make começam em 1; some `+1` ao índice devolvido pela IA |
| Fuso horário deslocado | Configure `America/Sao_Paulo` no perfil da organização |
| Router sem merge | Evite bifurcar: escolha por `if()` numa única linha de módulos |
| IA devolvendo markdown | Mantenha a instrução "sem cercas de código" no prompt; se persistir, limpe com `replace()` antes do Parse JSON |
| Cenário parado por erro | Ative **Scenario settings › Allow storing incomplete executions** e configure o tratamento de erro |
| Links inflando o prompt | Nunca envie as URLs do Google News para a IA |

---

## 8. Caminho B — Make orquestrando, lógica em Apps Script

Se a perda de fidelidade dos itens 5.6 e 5.9 incomodar, existe um meio-termo que preserva 100% do comportamento original: manter o JavaScript já testado rodando num **Google Apps Script Web App** (gratuito, sem servidor) e deixar o Make apenas orquestrando.

O cenário no Make encolhe para cerca de 10 módulos:

```
[1] Agendamento
[2] HTTP › POST /preparar ......... devolve pilar, candidatos e prompt prontos
[3] Gemini › Completion (filtro)
[4] HTTP › POST /selecionar ....... interpreta o filtro, aplica fallback, monta o prompt
[5] Gemini › Completion (geração)
[6] HTTP › POST /finalizar ........ guardrails + HTML do e-mail
[7] Gmail › Send an email
[8] Data store › Add a record
```

Esqueleto do Apps Script:

```javascript
function doPost(e) {
  const req = JSON.parse(e.postData.contents);
  let resposta;
  switch (req.acao) {
    case 'preparar':   resposta = preparar(req);   break;   // etapas 3.1 a 3.4
    case 'selecionar': resposta = selecionar(req); break;   // etapas 3.5 a 3.7
    case 'finalizar':  resposta = finalizar(req);  break;   // etapas 3.8 e 3.9
    default:           resposta = { erro: 'acao desconhecida' };
  }
  return ContentService
    .createTextOutput(JSON.stringify(resposta))
    .setMimeType(ContentService.MimeType.JSON);
}
```

Dentro de cada função entra o código correspondente de `backup/LOGICA-COMPLETA.md`, com duas adaptações: trocar `$input.all()` pelos dados recebidos em `req`, e retornar objeto simples em vez de `[{ json: ... }]`.

Publique em **Implantar › Nova implantação › App da Web**, com acesso "qualquer pessoa" e a URL protegida por um token no corpo da requisição.

**Vantagens:** fidelidade total, menos operações no Make (mais barato), e a lógica fica portátil — se um dia trocar o Make por outra ferramenta, o "cérebro" continua o mesmo.

---

## 9. Caminho C — n8n self-hosted (para referência)

Se em algum momento quiser voltar ao n8n sem custo de assinatura:

```bash
docker run -d --name n8n -p 5678:5678 \
  -e GENERIC_TIMEZONE="America/Sao_Paulo" \
  -e TZ="America/Sao_Paulo" \
  -v n8n_data:/home/node/.n8n \
  docker.n8n.io/n8nio/n8n
```

Alternativas sem servidor próprio: Railway, Render ou Fly.io têm templates de n8n com poucos cliques (custo aproximado de US$ 5/mês, ou grátis dentro da cota inicial).

O workflow precisaria ser recriado a partir do `backup/LOGICA-COMPLETA.md`, mas sem nenhuma adaptação de lógica — é copiar e colar em nós Code. As Data Tables existem também na versão self-hosted.

---

## 10. O que não muda

Independente do caminho escolhido, estes elementos permanecem exatamente iguais e são o real valor do sistema:

- Os **três prompts** (filtro, geração e correção), já calibrados e testados
- As **10 consultas RSS** segmentadas
- A **base da clínica** com os 24 procedimentos reais e o tom de voz
- Os **18 temas evergreen** para fallback
- A **lista de termos proibidos** dos guardrails
- O **calendário editorial** por pilar
- A **estrutura de 5 Stories** e o formato do e-mail

Ferramenta é substituível. Curadoria, contexto e regras de segurança editorial são o produto.
