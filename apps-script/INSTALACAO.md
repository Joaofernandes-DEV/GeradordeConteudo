# Instalação — Radar de Conteúdo em Google Apps Script

Tempo estimado: **20 a 30 minutos**. Custo: **R$ 0**.

> 📋 Este documento é o resumo. Para o guia detalhado — com cada clique, o que esperar em cada tela e o que fazer quando algo falha — use [PASSO-A-PASSO.md](PASSO-A-PASSO.md).

Ao final você terá o Radar rodando sozinho, de segunda a sábado às 6h, sem plataforma de automação, sem assinatura e sem limite de operações.

---

## O que você vai precisar

- Uma conta Google (a mesma que vai enviar os e-mails)
- Uma chave de API do Google Gemini — gratuita em [aistudio.google.com/apikey](https://aistudio.google.com/apikey)

---

## Passo 1 — Criar a planilha

1. Crie uma planilha nova no Google Sheets. Nome sugerido: **Radar de Conteúdo — Base**.
2. Na URL, copie o ID (o trecho entre `/d/` e `/edit`):

```
https://docs.google.com/spreadsheets/d/ESTE_TRECHO_AQUI/edit
```

Guarde esse ID — você vai colar no script no passo 3.

---

## Passo 2 — Criar o projeto no Apps Script

1. Acesse [script.google.com](https://script.google.com) e clique em **Novo projeto**.
2. Renomeie o projeto para **Radar de Conteúdo**.
3. No arquivo `Código.gs` que já vem aberto, apague tudo e cole o conteúdo de **`Codigo.gs`**.
4. Clique no **+** ao lado de "Arquivos" › **Script**, nomeie como **`Prompts`** e cole o conteúdo de **`Prompts.gs`**.
5. Salve (Ctrl+S).

> Os dois arquivos compartilham o mesmo escopo global no Apps Script — por isso as constantes de `Prompts.gs` funcionam dentro de `Codigo.gs` sem nenhum import.

---

## Passo 3 — Configurar

### 3.1 No topo de `Codigo.gs`

```javascript
const CONFIG = {
  PLANILHA_ID: 'cole_aqui_o_id_do_passo_1',
  EMAIL_DESTINO: 'email_de_quem_recebe_a_pauta@gmail.com',
  EMAIL_ALERTA:  'seu_email@gmail.com',
  ...
};
```

### 3.2 Guardar a chave do Gemini com segurança

A chave **não fica no código**. No editor do Apps Script:

1. Ícone de engrenagem (**Configurações do projeto**), na barra lateral esquerda
2. Role até **Propriedades do script** › **Adicionar propriedade de script**
3. Propriedade: `GEMINI_API_KEY` · Valor: sua chave
4. **Salvar propriedades do script**

### 3.3 Ajustar o fuso horário

Ainda em **Configurações do projeto**, confirme que o fuso está em **(GMT-03:00) São Paulo**.

---

## Passo 4 — Preparar as abas da planilha

1. No editor, selecione a função **`prepararPlanilha`** no menu suspenso do topo e clique em **Executar**.
2. Na primeira execução o Google vai pedir autorização: **Revisar permissões** › escolha sua conta › **Avançado** › **Acessar Radar de Conteúdo (não seguro)** › **Permitir**.

> O aviso de "não seguro" aparece porque o script é seu e não passou por verificação do Google. É esperado.

Isso cria as três abas com os cabeçalhos: `historico`, `evergreen` e `base_clinica`.

---

## Passo 5 — Importar os dados

Na planilha, para cada um dos dois arquivos em `backup/dados/`:

1. **Arquivo › Importar › Fazer upload** e selecione `radar_evergreen.csv`
2. Em **Local de importação**, escolha **Substituir planilha atual** com a aba `evergreen` aberta
3. Em **Tipo de separador**, escolha **Personalizado** e digite `;`
4. **Importar dados**

Repita para `radar_base_clinica.csv` na aba `base_clinica`.

Confira ao final:
- `evergreen` → 18 linhas + cabeçalho
- `base_clinica` → 32 linhas + cabeçalho
- `historico` → só o cabeçalho (será preenchido automaticamente)

---

## Passo 6 — Verificar

Selecione a função **`verificarInstalacao`** e execute. Abra o log (**Ver › Registros de execução**).

Resultado esperado:

```
Aba historico: 0 registros.
Aba evergreen: 18 registros.
Aba base_clinica: 32 registros.
Gemini respondeu corretamente.
✅ Tudo certo. Rode testarAgora() para uma prévia completa.
```

Se aparecer alguma pendência, o log diz exatamente qual.

---

## Passo 7 — Teste completo

Execute **`testarAgora`**. Ele roda o fluxo inteiro — coleta, curadoria, geração e guardrails — mas **não envia e-mail nem grava no histórico**. A pauta completa aparece no log.

Leve cerca de 30 a 60 segundos. Confira no log:
- Quantas notícias foram coletadas
- Qual item a IA escolheu e por quê
- A pauta com os 5 Stories

Gostou do resultado? Vá para o passo 8.

---

## Passo 8 — Ativar o agendamento

Execute **`instalarAcionador`** uma única vez. Pronto: o Radar passa a rodar todo dia às 6h, e o próprio script encerra a execução aos domingos.

Para conferir depois, use o ícone de **relógio** (Acionadores) na barra lateral.

---

## Operação no dia a dia

| Quero... | Como fazer |
|---|---|
| Trocar o destinatário | `CONFIG.EMAIL_DESTINO` no topo de `Codigo.gs` |
| Enviar para dois e-mails | Vírgula em `EMAIL_DESTINO`, ou preencher `EMAIL_COPIA` / `EMAIL_COPIA_OCULTA` |
| Mudar o horário | `instalarAcionador()`, alterando `.atHour(6)` |
| Adicionar um segmento de busca | Nova linha em `listarFontesRss()` |
| Mudar o tom das pautas | Editar `PROMPT_GERACAO` em `Prompts.gs` |
| Deixar a curadoria mais exigente | Aumentar a nota de corte no `PROMPT_FILTRO` |
| Incluir/remover procedimentos | Editar a aba `base_clinica` direto na planilha |
| Ver se rodou | Ícone de relógio › **Execuções** |
| Marcar feedback da pauta | Coluna `feedback` da aba `historico` |

### Se algo falhar

O script envia automaticamente um e-mail de alerta para `EMAIL_ALERTA` com a mensagem de erro — foi justamente a ausência disso que fez três execuções falharem em silêncio na versão anterior.

---

## Limites da conta gratuita

| Recurso | Limite | Uso do Radar |
|---|---|---|
| Tempo de execução | 6 min | ~40 segundos |
| E-mails por dia | 100 (conta gratuita) | 1 |
| Chamadas externas | 20.000/dia | ~13 |
| Acionadores por tempo | 20 | 1 |

O Gemini na faixa gratuita também cobre com folga as 2 a 3 chamadas diárias.

---

## Diferenças em relação à versão n8n

O comportamento é o mesmo, com três melhorias que a mudança de plataforma permitiu:

1. **Saída JSON garantida** — a API do Gemini é chamada com `responseMimeType: application/json`, então o modelo não devolve markdown nem cerca de código. O parse defensivo continua no lugar, mas praticamente não é mais acionado.
2. **Coleta em paralelo** — `UrlFetchApp.fetchAll()` busca os 10 feeds ao mesmo tempo, em vez de um a um.
3. **Alerta de falha** — qualquer erro dispara um e-mail imediato, em vez de falhar silenciosamente.
