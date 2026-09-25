# Backup da lógica — Radar de Conteúdo

> **Contexto:** o trial do n8n Cloud encerrou e a instância foi suspensa (a API passou a responder `Not Found`), impossibilitando a exportação do workflow original. Este arquivo reconstrói **toda a lógica do sistema** a partir do histórico de construção, em formato independente de plataforma.
>
> Serve como fonte única para reconstruir o Radar em Make, n8n self-hosted, Zapier, Pipedream — ou como código próprio.

---

## 1. Configurações gerais

| Item | Valor |
|---|---|
| Agendamento | Cron `0 0 6 * * 1-6` (segunda a sábado, 6h) |
| Timezone | `America/Sao_Paulo` |
| Provedor de IA | Google Gemini — `models/gemini-3-flash-preview` |
| Envio | Gmail API (OAuth) |
| Destinatário | `joaovitorf0405@gmail.com` (trocar pelo da cliente no go-live) |
| Janela de coleta | Últimas 48h |
| Janela antirrepetição | 30 dias |
| Nota de corte da curadoria | 7 (escala 0–10) |
| Candidatos enviados à IA | 25 (até 15 de veículos reconhecidos + complementares) |

---

## 2. Estrutura das tabelas

### `radar_historico` — memória antirrepetição
| Coluna | Tipo |
|---|---|
| data_envio | date |
| pilar | string |
| tema | string |
| fonte | string |
| link | string |
| origem | string (`radar` ou `fallback`) |
| feedback | string (preenchido à mão: usei / adaptei / descartei) |

### `radar_evergreen` — banco de fallback (18 registros)
| Coluna | Tipo |
|---|---|
| pilar | string |
| tema | string |
| angulo | string |
| ultimo_uso | date |

### `radar_base_clinica` — contexto proprietário (32 registros)
| Coluna | Tipo |
|---|---|
| categoria | string |
| item | string |
| descricao | string |
| ativo | boolean |

Categorias: `procedimento` (24), `procedimento_nao_realizado` (1, a preencher), `duvida_frequente` (4), `tom_de_voz` (1), `restricao` (1), `cta_padrao` (1).

> Conteúdo completo em `dados/radar_evergreen.csv` e `dados/radar_base_clinica.csv`, prontos para reimportação.

---

## 3. Lógica por etapa

Cada bloco abaixo era um nó Code do n8n. É JavaScript puro, sem dependências — pode ser reaproveitado em qualquer runtime, inclusive dentro de um Google Apps Script ou Cloudflare Worker, caso a plataforma de destino não execute código.

### 3.1 Definir pilar do dia

```javascript
const agora = $now.setZone('America/Sao_Paulo');
const dia = agora.weekday;
const mapa = {
  1: ['Humanizacao', 'Bastidores, rotina, preparacao, proximidade'],
  2: ['Dor da paciente', 'Situacoes comuns, duvidas, incomodos, identificacao'],
  3: ['Caso clinico', 'Casos autorizados, processo, procedimento, resultado. Sem caso autorizado no banco interno, trabalhar o pilar como processo/jornada, sem inventar caso.'],
  4: ['Educacao', 'Explicacoes, procedimentos, mitos e verdades'],
  5: ['Engajamento', 'Enquetes, quizzes, perguntas, interacao'],
  6: ['Prova social e conversao', 'Resultados autorizados, depoimentos, bastidores, agenda. Sem material autorizado, mostrar processo/jornada.']
};
if (!mapa[dia]) { return []; }
return [{ json: {
  dataHoje: agora.toFormat('dd/MM/yyyy'),
  pilar: mapa[dia][0],
  direcionamento: mapa[dia][1],
  emailDestino: 'joaovitorf0405@gmail.com'
}}];
```

> Os acentos foram removidos apenas neste arquivo de backup para evitar problemas de encoding na transcrição. Ao recriar, use os textos acentuados corretos (Humanização, Educação etc.).

### 3.2 Listar fontes RSS (10 consultas)

Padrão da URL: `https://news.google.com/rss/search?q=CONSULTA&hl=pt-BR&gl=BR&ceid=BR:pt-419` (consulta com `encodeURIComponent`).

| # | Segmento | Consulta |
|---|---|---|
| 1 | Harmonização facial | `"harmonização facial" when:2d` |
| 2 | Injetáveis | `(skinbooster OR bioestimulador OR "toxina botulínica") when:2d` |
| 3 | Saúde da pele | `("saúde da pele" OR skincare) when:2d` |
| 4 | Tratamento estético | `("tratamento estético" OR "procedimento estético" OR "estética avançada" OR "biomedicina estética") when:2d` |
| 5 | ANVISA | `ANVISA (estética OR cosmético OR suplemento OR "produto para a pele") when:7d` |
| 6 | Suplementação | `(suplementação OR "suplemento alimentar" OR creatina OR "colágeno hidrolisado") when:2d` |
| 7 | Massa muscular | `("ganho de massa muscular" OR "massa magra" OR hipertrofia OR sarcopenia) when:2d` |
| 8 | Capilar | `("queda de cabelo" OR "tratamento capilar" OR alopecia OR "saúde capilar") when:2d` |
| 9 | Canetas emagrecedoras | `("caneta emagrecedora" OR "canetas emagrecedoras" OR Ozempic OR Mounjaro OR Wegovy) (cabelo OR capilar OR pele OR "massa muscular" OR flacidez OR rosto) when:2d` |
| 10 | Veículos premium | `TEMAS (site:g1.globo.com OR site:uol.com.br OR site:folha.uol.com.br OR site:estadao.com.br OR site:cnnbrasil.com.br OR site:veja.abril.com.br OR site:saude.abril.com.br OR site:metropoles.com OR site:terra.com.br) when:2d` |

Onde `TEMAS` = `("tratamento estético" OR "harmonização facial" OR "saúde da pele" OR suplementação OR "massa muscular" OR "queda de cabelo" OR "canetas emagrecedoras" OR skincare)`.

### 3.3 Consolidar itens — janela de 48h, dedupe e ranking de credibilidade

```javascript
const agora = Date.now();
const limite48h = agora - 48 * 60 * 60 * 1000;
const vistos = new Set();
const norm = function (t) {
  return (t || '').toLowerCase().normalize('NFD').replace(/[^a-z0-9 ]/g, ' ').replace(/ +/g, ' ').trim();
};
const normFonte = function (t) {
  return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
};
const veiculosPremium = ['g1', 'globo', 'o globo', 'globo.com', 'uol', 'folha de s.paulo',
  'folha de spaulo', 'estadao', 'cnn', 'cnn brasil', 'veja', 'bbc', 'bbc news brasil', 'terra',
  'metropoles', 'r7', 'band', 'agencia brasil', 'gov.br', 'anvisa', 'exame', 'gzh',
  'correio braziliense', 'correio do povo', 'einstein', 'fiocruz'];
const separadores = [' ', '.', '-', '/', ','];

// Matching por igualdade OU prefixo seguido de separador.
// Evita o falso positivo de substring (recordeuropa.com nao e "record").
const ehPremium = function (fonte) {
  const f = normFonte(fonte);
  if (!f) return false;
  return veiculosPremium.some(function (d) {
    if (f === d) return true;
    if (f.indexOf(d) === 0) {
      const proximo = f.charAt(d.length);
      return separadores.indexOf(proximo) !== -1;
    }
    return false;
  });
};

const todos = [];
for (const item of $input.all()) {
  const j = item.json || {};
  if (!j.title || !j.link || j.error) continue;
  const dt = j.isoDate ? Date.parse(j.isoDate) : (j.pubDate ? Date.parse(j.pubDate) : agora);
  if (isNaN(dt) || dt < limite48h) continue;
  const chave = norm(j.title).slice(0, 80);
  if (!chave || vistos.has(chave)) continue;
  vistos.add(chave);
  let fonte = '';
  try { fonte = new URL(j.link).hostname.replace('www.', ''); } catch (e) {}
  const partes = String(j.title).split(' - ');
  if (partes.length > 1) fonte = partes[partes.length - 1].trim();
  todos.push({
    titulo: j.title,
    link: j.link,
    resumo: String(j.contentSnippet || j.content || '').replace(/<[^>]*>/g, ' ').slice(0, 300),
    fonte: fonte,
    premium: ehPremium(fonte),
    data: j.isoDate || j.pubDate || '',
    ts: dt
  });
}
const porData = function (a, b) { return b.ts - a.ts; };
const premiums = todos.filter(function (c) { return c.premium; }).sort(porData);
const demais = todos.filter(function (c) { return !c.premium; }).sort(porData);
const selecionados = premiums.slice(0, 15);
const candidatos = selecionados.concat(demais.slice(0, 25 - selecionados.length));
return [{ json: { candidatos: candidatos, totalColetado: $input.all().length } }];
```

### 3.4 Preparar candidatos — corte antirrepetição de 30 dias

Entrada: linhas do histórico.

```javascript
const ctx = $('Definir pilar do dia').first().json;
const consolidado = $('Consolidar itens').first().json;
const corte30d = Date.now() - 30 * 24 * 60 * 60 * 1000;
const norm = function (t) {
  return (t || '').toLowerCase().normalize('NFD').replace(/[^a-z0-9 ]/g, ' ').replace(/ +/g, ' ').trim();
};
const historico = $input.all()
  .map(function (i) { return i.json; })
  .filter(function (h) { return h && h.tema; })
  .filter(function (h) { return !h.data_envio || Date.parse(h.data_envio) >= corte30d; });
const temasUsados = historico.map(function (h) { return norm(h.tema); })
  .filter(function (t) { return t.length > 3; });
const candidatos = (consolidado.candidatos || []).filter(function (c) {
  const t = norm(c.titulo);
  return !temasUsados.some(function (u) { return t.includes(u) || u.includes(t); });
});
return [{ json: Object.assign({}, ctx, {
  candidatos: candidatos,
  historicoTemas: historico.map(function (h) { return h.tema; }),
  totalColetado: consolidado.totalColetado || 0
}) }];
```

### 3.5 Interpretar filtro — parse defensivo da resposta da IA

```javascript
const ctx = $('Preparar candidatos').first().json;
const resp = $input.first().json;
let texto = '';
if (typeof resp.output === 'string') { texto = resp.output; }
else if (resp.output && typeof resp.output === 'object') { texto = JSON.stringify(resp.output); }
else if (resp.content && resp.content.parts) { texto = resp.content.parts.map(function (p) { return p.text || ''; }).join(''); }
else if (typeof resp.text === 'string') { texto = resp.text; }
else { texto = JSON.stringify(resp); }
let dados = null;
try {
  const ini = texto.indexOf('{');
  const fim = texto.lastIndexOf('}');
  dados = JSON.parse(texto.slice(ini, fim + 1));
} catch (e) {
  dados = { melhor: null, avaliacoes: [], motivo: 'Falha ao interpretar a resposta da IA: ' + e.message };
}
const idx = (dados.melhor === null || dados.melhor === undefined) ? null : Number(dados.melhor);
const melhorItem = (idx !== null && !isNaN(idx) && ctx.candidatos[idx]) ? ctx.candidatos[idx] : null;
const aval = Array.isArray(dados.avaliacoes) ? dados.avaliacoes : [];
const descartados = aval
  .filter(function (a) { return Number(a.indice) !== idx; })
  .slice(0, 5)
  .map(function (a) {
    const c = ctx.candidatos[Number(a.indice)] || {};
    return { titulo: c.titulo || '', nota: a.nota, motivo: a.justificativa || '' };
  });
return [{ json: Object.assign({}, ctx, {
  temNovidade: !!melhorItem,
  melhorItem: melhorItem,
  descartados: descartados,
  motivoSelecao: dados.motivo || ''
}) }];
```

### 3.6 Escolher evergreen — caminho de fallback

Entrada: linhas de `radar_evergreen` filtradas pelo pilar do dia.

```javascript
const ctx = $('Interpretar filtro').first().json;
const norm = function (t) {
  return (t || '').toLowerCase().normalize('NFD').replace(/[^a-z0-9 ]/g, ' ').replace(/ +/g, ' ').trim();
};
const usados = (ctx.historicoTemas || []).map(norm).filter(function (t) { return t.length > 3; });
const opcoes = $input.all().map(function (i) { return i.json; }).filter(function (o) { return o && o.tema; });
let disponiveis = opcoes.filter(function (o) {
  const t = norm(o.tema);
  return !usados.some(function (u) { return t.includes(u) || u.includes(t); });
});
if (disponiveis.length === 0) disponiveis = opcoes;
const sorteado = disponiveis[Math.floor(Math.random() * disponiveis.length)];
return [{ json: Object.assign({}, ctx, {
  origem: 'fallback',
  temaBase: sorteado.tema,
  resumoBase: sorteado.angulo || '',
  fonteBase: 'banco interno (evergreen)',
  linkBase: ''
}) }];
```

### 3.7 Montar prompt e contexto

Entrada: linhas de `radar_base_clinica`.

```javascript
const NL = String.fromCharCode(10);
const pauta = $('Pauta do dia').first().json;
const linhas = $input.all().map(function (i) { return i.json; })
  .filter(function (r) { return r && r.categoria && r.ativo !== false; });
const porCat = function (c) { return linhas.filter(function (r) { return r.categoria === c; }); };
const procedimentos = porCat('procedimento').map(function (r) { return '- ' + r.item + ': ' + String(r.descricao || ''); });
const naoRealizados = porCat('procedimento_nao_realizado').map(function (r) { return '- ' + r.item + ': ' + (r.descricao || ''); });
const duvidas = porCat('duvida_frequente').map(function (r) { return '- ' + r.item; });
const tom = porCat('tom_de_voz').map(function (r) { return r.descricao; }).join(' ');
const cta = porCat('cta_padrao').map(function (r) { return r.descricao; }).join(' ');
const prompt = [
  'DADOS DO DIA',
  'Data: ' + pauta.dataHoje,
  'Pilar do dia: ' + pauta.pilar + ' - ' + pauta.direcionamento,
  'Origem da pauta: ' + (pauta.origem === 'radar' ? 'novidade encontrada nas fontes de hoje' : 'banco interno de temas (fallback: nenhuma novidade relevante hoje)'),
  '',
  'TEMA BASE: ' + pauta.temaBase,
  'RESUMO / ANGULO: ' + pauta.resumoBase,
  'FONTE: ' + pauta.fonteBase + (pauta.linkBase ? ' - ' + pauta.linkBase : ''),
  (pauta.motivoSelecao ? 'POR QUE E RELEVANTE: ' + pauta.motivoSelecao : ''),
  '',
  'CONTEXTO DA CLINICA',
  'Tom de voz: ' + tom,
  'CTA padrao: ' + cta,
  'Procedimentos REALIZADOS pela clinica (os unicos que podem ser citados):',
  procedimentos.join(NL) || '- (nenhum cadastrado)',
  'Procedimentos NAO realizados (nunca sugerir nem mencionar como oferta):',
  naoRealizados.join(NL) || '- (nenhum cadastrado)',
  'Duvidas frequentes das pacientes (bons ganchos):',
  duvidas.join(NL) || '- (nenhuma cadastrada)',
  '',
  'Temas recentes que NAO podem ser repetidos: ' + JSON.stringify(pauta.historicoTemas || [])
].join(NL);
return [{ json: Object.assign({}, pauta, {
  promptGeracao: prompt,
  procedimentosPermitidos: porCat('procedimento').map(function (r) { return r.item; })
}) }];
```

### 3.8 Guardrails editoriais

```javascript
const ctx = $('Montar prompt e contexto').first().json;
const resp = $input.first().json;
let texto = '';
if (typeof resp.output === 'string') { texto = resp.output; }
else if (resp.output && typeof resp.output === 'object') { texto = JSON.stringify(resp.output); }
else if (resp.content && resp.content.parts) { texto = resp.content.parts.map(function (p) { return p.text || ''; }).join(''); }
else if (typeof resp.text === 'string') { texto = resp.text; }
else { texto = JSON.stringify(resp); }
let pauta = null;
let erroParse = null;
try {
  const ini = texto.indexOf('{');
  const fim = texto.lastIndexOf('}');
  pauta = JSON.parse(texto.slice(ini, fim + 1));
} catch (e) { erroParse = e.message; }

const violacoes = [];
if (!pauta) {
  violacoes.push('A resposta da IA nao pode ser interpretada como JSON: ' + erroParse);
  pauta = { tema: ctx.temaBase, objetivo: '', formato: '', procedimento_relacionado: 'nenhum',
    stories: [], interacao: '', cta: '', observacoes_gravacao: '', pontos_validacao: [] };
}

// 1. Termos proibidos (promessa de resultado)
const proibidos = ['garante', 'garantido', 'garantia de resultado', 'elimina de vez', 'acaba com',
  'resultado imediato', 'resultados imediatos', 'sem riscos', 'sem risco', 'milagre', 'milagroso',
  '100% seguro', '100% eficaz', 'melhor que o', 'melhor que a', 'definitivo', 'para sempre', 'cura '];
const textoPauta = JSON.stringify(pauta).toLowerCase();
for (const p of proibidos) {
  if (textoPauta.includes(p)) violacoes.push('Termo proibido encontrado: ' + p);
}

// 2. Procedimento fora do escopo (matching normalizado)
const normProc = function (t) { return String(t || '').toLowerCase().replace(/[^a-z0-9à-ü]/g, ''); };
const proc = String(pauta.procedimento_relacionado || 'nenhum').toLowerCase().trim();
const procNorm = normProc(proc);
const permitidos = (ctx.procedimentosPermitidos || []).map(function (x) { return normProc(x); });
if (proc !== 'nenhum' && proc !== '') {
  const ok = permitidos.some(function (x) { return procNorm.includes(x) || x.includes(procNorm); });
  if (!ok) violacoes.push('Procedimento fora da lista da clinica: ' + pauta.procedimento_relacionado);
}

// 3. Estrutura de 5 Stories
const nStories = Array.isArray(pauta.stories) ? pauta.stories.length : 0;
if (nStories !== 5) violacoes.push('A pauta deve ter exatamente 5 Stories (recebido: ' + nStories + ')');

return [{ json: Object.assign({}, ctx, { pauta: pauta, aprovado: violacoes.length === 0, violacoes: violacoes }) }];
```

### 3.9 Montar e-mail (HTML)

Estrutura do corpo, na ordem:

1. Cabeçalho: `Radar do dia` + data + pilar
2. **📡 Radar do dia** — título da notícia, fonte com link, resumo, "por que é relevante". No modo fallback: aviso "Sem novidade relevante hoje" + tema escolhido do banco interno
3. **💡 Oportunidade de conteúdo** — tema, pilar, objetivo, formato, procedimento relacionado
4. **🎬 Sequência de Stories** — 5 blocos com fundo `#f6f4fb`, cada um com "Texto de tela" e "Fala"; depois interação sugerida, CTA e observações de gravação
5. **⚠️ Observações** — lista com pontos de validação, aviso de fallback, aviso de correção automática (quando houve) e violações de guardrail
6. Lista de temas descartados no dia, com nota e justificativa
7. Rodapé: "gerado automaticamente. Você é sempre a aprovadora final."

Assunto: `Radar do dia - {pilar} - {dd/MM/yyyy}`

Estilo: `font-family: Arial; max-width: 640px; color: #222; line-height: 1.5`. Títulos de seção com `border-bottom: 2px solid #7c5cbf` (roxo) e `#e0a800` (âmbar) para observações.

### 3.10 Registro no histórico

Após o envio, grava uma linha em `radar_historico`:

```javascript
{
  data_envio: new Date().toISOString(),
  pilar: d.pilar,
  tema: pauta.tema || d.temaBase,
  fonte: d.fonteBase,
  link: d.linkBase,
  origem: d.origem,   // 'radar' ou 'fallback'
  feedback: ''
}
```

---

## 4. Prompts

### 4.1 Filtro de relevância (system) — temperatura 0.2

```
Você é a analista de relevância de conteúdo da Dra. Simone Paes, biomédica esteta (estética facial
e corporal, saúde integrativa e análises clínicas). Sua função é avaliar notícias coletadas e decidir
se alguma rende conteúdo de Instagram Stories para a audiência dela: mulheres interessadas em estética
facial e corporal, cuidados com a pele, suplementação, ganho de massa muscular, saúde capilar e
emagrecimento saudável, em linguagem de paciente.

Critérios de avaliação (nota 0 a 10):
- Interessa a uma paciente real? Notícias corporativas, de mercado financeiro, fofocas de celebridades
  ou excessivamente técnicas recebem nota baixa.
- A fonte é confiável e reconhecida? Itens com "premium": true vêm de veículos premiados/reconhecidos
  (G1, UOL, Folha, Estadão, CNN Brasil, Veja Saúde, BBC, Agência Brasil, ANVISA/gov.br) e merecem
  preferência. Portais desconhecidos só devem ser aprovados se o tema for muito forte.
- Tem base confiável ou é modismo sem evidência?
- Dá para transformar em conteúdo dentro da atuação de uma biomédica esteta (estética, suplementação,
  capilar, corporal)?
- Conversa com o pilar do dia informado?
- Já foi abordado recentemente (lista de temas usados)? Se sim, nota baixa.

Regras obrigatórias:
- Nota de corte: 7. O campo "melhor" deve ser o índice (na lista recebida) do melhor item com nota
  maior ou igual a 7.
- Em empate de relevância, escolha o item de fonte premium.
- Se nenhum item atingir a nota 7, ou se a lista estiver vazia, retorne "melhor": null.
- Prefira não aprovar nada a aprovar algo fraco.
- Trabalhe apenas com o que está nos itens; nunca invente informações.

Responda APENAS com JSON válido, sem nenhum texto antes ou depois, sem markdown e sem cercas de
código, neste formato exato:
{"avaliacoes":[{"indice":0,"nota":8,"justificativa":"texto curto"}],"melhor":0,"motivo":"por que este item é relevante para a audiência"}
```

**Mensagem do usuário:**

```
Pilar do dia: {pilar} ({direcionamento})

Temas já usados nos últimos 30 dias (evitar repetição):
{JSON dos temas do histórico}

Itens coletados hoje (avalie cada um pelo índice na lista; "premium": true indica veículo reconhecido):
{JSON com indice, titulo, resumo, fonte, premium, data}
```

> ⚠️ **Importante:** não enviar os links do Google News no prompt. São URLs de 500+ caracteres que a IA não usa para decidir e que já causaram estouro de limite de tokens (ver README, seção 9.1).

### 4.2 Geração da pauta (system) — temperatura 0.7

```
Você é estrategista de conteúdo e redatora de Stories da Dra. Simone Paes, biomédica esteta. A partir
do tema base e do contexto da clínica, produza UMA pauta completa de Instagram Stories, pronta para gravar.

ESTRATÉGIA (definir antes de escrever):
- Tema: o ângulo editorial, não o título da notícia.
- Objetivo: educar, gerar identificação, aproximar, engajar ou converter.
- Formato: explicação, mito x verdade, bastidor, enquete, comparativo ou processo/jornada.
- Procedimento relacionado: APENAS um da lista de procedimentos realizados; se nenhum se encaixar
  naturalmente, use "nenhum".

SEQUÊNCIA FIXA DE 5 STORIES:
1 Gancho: parar o dedo; pergunta, dado ou situação de identificação; sem tecnicismo.
2 Contexto: explicar a novidade ou a dor em linguagem de paciente.
3 Desenvolvimento: entregar valor real (explicação, mito x verdade, bastidor, processo).
4 Aplicação prática: como isso afeta a rotina, a pele ou a decisão da paciente; vínculo com o
  procedimento quando houver.
5 Fechamento: recado final + CTA único e claro.

REGRAS OBRIGATÓRIAS (inegociáveis):
- Nunca inventar dados, estudos, números, casos ou resultados.
- Nunca prometer ou insinuar resultado (proibido: garante, elimina, acaba com, resultado imediato,
  100%, milagre, definitivo, sem riscos).
- Nunca fazer diagnóstico, prescrição ou indicação individualizada.
- Nunca sugerir procedimentos fora da lista da clínica.
- Nunca usar linguagem sensacionalista, alarmista ou comparar com outros profissionais.
- Citar a fonte quando a pauta vier de notícia.
- Tudo que exigir conferência técnica deve entrar em pontos_validacao.
- Escrever em português do Brasil, no tom de voz informado.

Responda APENAS com JSON válido, sem nenhum texto antes ou depois, sem markdown e sem cercas de
código, neste formato exato:
{"tema":"...","objetivo":"...","formato":"...","procedimento_relacionado":"nome exato da lista ou nenhum","stories":[{"numero":1,"funcao":"Gancho","texto_tela":"texto curto que aparece na tela","orientacao_fala":"o que a Dra. Simone fala ou faz"},{"numero":2,"funcao":"Contexto","texto_tela":"...","orientacao_fala":"..."},{"numero":3,"funcao":"Desenvolvimento","texto_tela":"...","orientacao_fala":"..."},{"numero":4,"funcao":"Aplicação prática","texto_tela":"...","orientacao_fala":"..."},{"numero":5,"funcao":"Fechamento","texto_tela":"...","orientacao_fala":"..."}],"interacao":"enquete, caixinha, quiz ou controle deslizante, com a pergunta pronta","cta":"ação única e clara","observacoes_gravacao":"cenário ou apoio visual sugerido","pontos_validacao":["ponto exato que exige conferência técnica antes de publicar"]}
```

**Mensagem do usuário:** o prompt montado na etapa 3.7.

### 4.3 Correção (acionada só quando os guardrails reprovam) — temperatura 0.3

**System:**

```
Você é revisora editorial de conteúdo de saúde/estética. Corrija pautas que violaram regras, mantendo
o formato JSON idêntico ao recebido. Responda apenas com JSON válido.
```

**Mensagem do usuário:**

```
A pauta de Stories abaixo violou regras editoriais. Corrija APENAS os problemas listados, mantendo
todo o resto igual. Responda somente com o JSON completo corrigido, no mesmo formato recebido, sem
nenhum texto antes ou depois e sem cercas de código.

Problemas encontrados:
{lista de violações separadas por ponto e vírgula}

Regras: nunca prometer resultado, nunca inventar dados, nunca diagnosticar, apenas procedimentos desta
lista podem ser citados: {JSON dos procedimentos permitidos}. A pauta deve ter exatamente 5 stories.

Pauta:
{JSON da pauta reprovada}
```

---

## 5. Calendário editorial

| Dia | Pilar | Direcionamento |
|---|---|---|
| Segunda | Humanização | Bastidores, rotina, preparação, proximidade |
| Terça | Dor da paciente | Situações comuns, dúvidas, identificação |
| Quarta | Caso clínico | Processo, procedimento, jornada |
| Quinta | Educação | Explicações, mitos e verdades |
| Sexta | Engajamento | Enquetes, quizzes, perguntas |
| Sábado | Prova social + conversão | Resultados autorizados, agenda |
| Domingo | — | Sem envio |
