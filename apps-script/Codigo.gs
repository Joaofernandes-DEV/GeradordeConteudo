/**
 * RADAR INTELIGENTE DE CONTEÚDO — Dra. Simone Paes
 * Automação diária de curadoria e geração de pautas para Instagram Stories.
 *
 * Roda inteiramente dentro do Google Apps Script:
 *   - Acionador por tempo  → gatilho diário
 *   - UrlFetchApp          → coleta RSS e chamadas ao Gemini
 *   - Google Sheets        → histórico, evergreen e base da clínica
 *   - GmailApp             → envio do e-mail
 *
 * Custo: R$ 0. Sem limite de operações.
 *
 * INSTALAÇÃO: ver INSTALACAO.md
 */

// ============================================================================
// CONFIGURAÇÃO
// ============================================================================

const CONFIG = {
  // ID da planilha que guarda as três abas (pegue da URL da planilha)
  PLANILHA_ID: '1JeikIG_PRyk3lH4RoAaKPc55rI6pVS8S6eUnRBlfXlA',

  // Para onde o Radar envia a pauta do dia
  EMAIL_DESTINO: 'joaovitorf0405@gmail.com, simonepaes.paes@yahoo.com.br',

  // Recebe alerta se a execução falhar (deixe igual ao seu e-mail)
  EMAIL_ALERTA: 'joaovitorf0405@gmail.com',

  NOME_REMETENTE: 'Radar de Conteúdo',
  FUSO: 'America/Sao_Paulo',


  // Versão da API. Se der 404 em tudo, troque para 'v1beta' e rode
  // listarModelosDisponiveis() para ver o que existe em cada versão.
  API_VERSAO: 'v1',

  // Ordem de tentativa dos modelos. O gemini-3.6-flash vem primeiro porque é o
  // substituto que o próprio Google indicou ao aposentar o 2.5-flash (set/2026).
  // Se todos falharem por modelo indisponível (404), o Radar se autocorrige:
  // procura outro modelo que responda, grava e passa a usá-lo nas próximas
  // execuções. Para conferir manualmente, rode testarModelos().
  MODELOS: ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite'],
  TENTATIVAS: 2,           // novas tentativas por modelo em erro temporário
  ESPERA_MS: 10000,        // espera entre tentativas (cresce a cada uma)

  JANELA_HORAS: 48,        // idade máxima das notícias coletadas
  JANELA_HISTORICO: 30,    // dias sem repetir tema
  MAX_CANDIDATOS: 15,      // itens enviados à IA (menos itens = menos tokens)
  MAX_PREMIUM: 10,         // vagas reservadas a veículos reconhecidos
  MAX_RESUMO: 180,         // caracteres do resumo de cada notícia
  MAX_DESCRICAO_PROC: 130, // caracteres da descrição de cada procedimento
  ITENS_POR_FEED: 8
};

const ABAS = { HISTORICO: 'historico', EVERGREEN: 'evergreen', BASE: 'base_clinica' };

const CALENDARIO = {
  1: ['Humanização', 'Bastidores, rotina, preparação, proximidade'],
  2: ['Dor da paciente', 'Situações comuns, dúvidas, incômodos, identificação'],
  3: ['Caso clínico', 'Casos autorizados, processo, procedimento, resultado. Sem caso autorizado no banco interno, trabalhar o pilar como processo/jornada (como é a avaliação, o que acontece na sessão), sem inventar caso.'],
  4: ['Educação', 'Explicações, procedimentos, mitos e verdades'],
  5: ['Engajamento', 'Enquetes, quizzes, perguntas, interação'],
  6: ['Prova social e conversão', 'Resultados autorizados, depoimentos, bastidores, agenda. Sem material autorizado, mostrar processo/jornada.']
  // 7 (domingo) ausente de propósito: sem envio
};

const TERMOS_PROIBIDOS = [
  'garante', 'garantido', 'garantia de resultado', 'elimina de vez', 'acaba com',
  'resultado imediato', 'resultados imediatos', 'sem riscos', 'sem risco', 'milagre',
  'milagroso', '100% seguro', '100% eficaz', 'melhor que o', 'melhor que a',
  'definitivo', 'para sempre', 'cura '
];

const VEICULOS_PREMIUM = [
  'g1', 'globo', 'o globo', 'globo.com', 'uol', 'folha de s.paulo', 'folha de spaulo',
  'estadao', 'cnn', 'cnn brasil', 'veja', 'bbc', 'bbc news brasil', 'terra', 'metropoles',
  'r7', 'band', 'agencia brasil', 'gov.br', 'anvisa', 'exame', 'gzh',
  'correio braziliense', 'correio do povo', 'einstein', 'fiocruz'
];

// ============================================================================
// FUNÇÃO PRINCIPAL — é esta que o acionador diário chama
// ============================================================================

function radarDoDia() {
  try {
    executarRadar(false);
  } catch (erro) {
    notificarFalha(erro);
    throw erro;
  }
}

/** Teste manual: roda mesmo aos domingos e não grava no histórico. */
function testarAgora() {
  executarRadar(true);
}

function executarRadar(modoTeste) {
  const contexto = definirPilarDoDia(modoTeste);
  if (!contexto) {
    Logger.log('Domingo — sem envio.');
    return;
  }
  Logger.log('Pilar do dia: ' + contexto.pilar);

  // 1. Coleta
  const brutos = coletarFeeds();
  Logger.log('Itens coletados: ' + brutos.length);

  // 2. Normalização, dedupe e ranking de credibilidade
  const consolidados = consolidarItens(brutos);

  // 3. Corte antirrepetição contra o histórico
  const historico = lerHistorico();
  const temasUsados = historico.map(function (h) { return h.tema; });
  const candidatos = removerJaUsados(consolidados, temasUsados);
  Logger.log('Candidatos após dedupe: ' + candidatos.length);

  // 4. IA — filtro de relevância
  const filtro = filtrarComIa(contexto, candidatos, temasUsados);

  // 5. Seleção ou fallback
  const pautaBase = filtro.melhorItem
    ? {
        origem: 'radar',
        temaBase: filtro.melhorItem.titulo,
        resumoBase: filtro.melhorItem.resumo,
        fonteBase: filtro.melhorItem.fonte,
        linkBase: filtro.melhorItem.link,
        motivoSelecao: filtro.motivo
      }
    : escolherEvergreen(contexto.pilar, temasUsados, contexto.direcionamento);
  Logger.log('Origem da pauta: ' + pautaBase.origem + ' — ' + pautaBase.temaBase);

  // 6. Enriquecimento com o contexto da clínica
  const base = lerBaseClinica();
  const prompt = montarPromptGeracao(contexto, pautaBase, temasUsados, base);

  // 7. IA — geração da pauta
  let pauta = gerarPauta(prompt);

  // 8. Guardrails
  let checagem = aplicarGuardrails(pauta, base.procedimentos);
  let corrigido = false;
  if (!checagem.aprovado) {
    Logger.log('Guardrails reprovaram: ' + checagem.violacoes.join('; '));
    pauta = corrigirPauta(pauta, checagem.violacoes, base.procedimentos);
    corrigido = true;
    checagem = aplicarGuardrails(pauta, base.procedimentos);
  }

  // 9. E-mail
  const html = montarEmailHtml(contexto, pautaBase, pauta, filtro.descartados, checagem, corrigido);
  const assunto = 'Radar do dia - ' + contexto.pilar + ' - ' + contexto.dataHoje;

  if (modoTeste) {
    Logger.log('MODO TESTE — e-mail não enviado. Prévia do assunto: ' + assunto);
    Logger.log(JSON.stringify(pauta, null, 2));
    return;
  }

  const opcoes = { htmlBody: html, name: CONFIG.NOME_REMETENTE };
  if (CONFIG.EMAIL_COPIA) opcoes.cc = CONFIG.EMAIL_COPIA;
  if (CONFIG.EMAIL_COPIA_OCULTA) opcoes.bcc = CONFIG.EMAIL_COPIA_OCULTA;

  GmailApp.sendEmail(CONFIG.EMAIL_DESTINO, assunto, 'Abra em HTML para visualizar a pauta.', opcoes);
  Logger.log('E-mail enviado para: ' + CONFIG.EMAIL_DESTINO +
    (CONFIG.EMAIL_COPIA ? ' | cc: ' + CONFIG.EMAIL_COPIA : '') +
    (CONFIG.EMAIL_COPIA_OCULTA ? ' | cco: ' + CONFIG.EMAIL_COPIA_OCULTA : ''));

  // 10. Registro no histórico
  registrarHistorico(contexto, pautaBase, pauta);
  Logger.log('Concluído.');
}

// ============================================================================
// 1. PILAR DO DIA
// ============================================================================

function definirPilarDoDia(modoTeste) {
  const agora = new Date();
  // 'u' devolve 1 (segunda) a 7 (domingo)
  let dia = Number(Utilities.formatDate(agora, CONFIG.FUSO, 'u'));
  if (modoTeste && !CALENDARIO[dia]) dia = 4; // domingo em teste vira quinta (Educação)
  if (!CALENDARIO[dia]) return null;

  return {
    dataHoje: Utilities.formatDate(agora, CONFIG.FUSO, 'dd/MM/yyyy'),
    pilar: CALENDARIO[dia][0],
    direcionamento: CALENDARIO[dia][1]
  };
}

// ============================================================================
// 2. COLETA RSS
// ============================================================================

function listarFontesRss() {
  const gn = function (q) {
    return 'https://news.google.com/rss/search?q=' + encodeURIComponent(q) +
           '&hl=pt-BR&gl=BR&ceid=BR:pt-419';
  };
  const premium = 'site:g1.globo.com OR site:uol.com.br OR site:folha.uol.com.br OR ' +
    'site:estadao.com.br OR site:cnnbrasil.com.br OR site:veja.abril.com.br OR ' +
    'site:saude.abril.com.br OR site:metropoles.com OR site:terra.com.br';
  const temasPremium = '("tratamento estético" OR "harmonização facial" OR "saúde da pele" OR ' +
    'suplementação OR "massa muscular" OR "queda de cabelo" OR "canetas emagrecedoras" OR skincare)';

  return [
    gn('"harmonização facial" when:2d'),
    gn('(skinbooster OR bioestimulador OR "toxina botulínica") when:2d'),
    gn('("saúde da pele" OR skincare) when:2d'),
    gn('("tratamento estético" OR "procedimento estético" OR "estética avançada" OR "biomedicina estética") when:2d'),
    gn('ANVISA (estética OR cosmético OR suplemento OR "produto para a pele") when:7d'),
    gn('(suplementação OR "suplemento alimentar" OR creatina OR "colágeno hidrolisado") when:2d'),
    gn('("ganho de massa muscular" OR "massa magra" OR hipertrofia OR sarcopenia) when:2d'),
    gn('("queda de cabelo" OR "tratamento capilar" OR alopecia OR "saúde capilar") when:2d'),
    gn('("caneta emagrecedora" OR "canetas emagrecedoras" OR Ozempic OR Mounjaro OR Wegovy) (cabelo OR capilar OR pele OR "massa muscular" OR flacidez OR rosto) when:2d'),
    gn(temasPremium + ' (' + premium + ') when:2d')
  ];
}

/** Busca os 10 feeds em paralelo. Uma fonte que falhar não derruba as demais. */
function coletarFeeds() {
  const requisicoes = listarFontesRss().map(function (url) {
    return { url: url, muteHttpExceptions: true };
  });

  let respostas;
  try {
    respostas = UrlFetchApp.fetchAll(requisicoes);
  } catch (e) {
    Logger.log('Falha geral na coleta: ' + e.message);
    return [];
  }

  const itens = [];
  respostas.forEach(function (resp, i) {
    if (resp.getResponseCode() !== 200) {
      Logger.log('Feed ' + (i + 1) + ' retornou ' + resp.getResponseCode());
      return;
    }
    try {
      parsearRss(resp.getContentText()).forEach(function (item) { itens.push(item); });
    } catch (e) {
      Logger.log('Feed ' + (i + 1) + ' com XML inválido: ' + e.message);
    }
  });
  return itens;
}

function parsearRss(xml) {
  const canal = XmlService.parse(xml).getRootElement().getChild('channel');
  if (!canal) return [];
  return canal.getChildren('item').slice(0, CONFIG.ITENS_POR_FEED).map(function (item) {
    return {
      titulo: item.getChildText('title') || '',
      link: item.getChildText('link') || '',
      descricao: item.getChildText('description') || '',
      pubDate: item.getChildText('pubDate') || ''
    };
  });
}

// ============================================================================
// 3. CONSOLIDAÇÃO — janela de tempo, dedupe e ranking de credibilidade
// ============================================================================

function normalizar(texto) {
  return String(texto || '').toLowerCase().normalize('NFD')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/ +/g, ' ').trim();
}

function normalizarFonte(texto) {
  return String(texto || '').toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '').trim();
}

/**
 * Igualdade OU prefixo seguido de separador.
 * Evita o falso positivo de substring: "recordeuropa.com" não é "record".
 */
function ehPremium(fonte) {
  const f = normalizarFonte(fonte);
  if (!f) return false;
  const separadores = [' ', '.', '-', '/', ','];
  return VEICULOS_PREMIUM.some(function (d) {
    if (f === d) return true;
    if (f.indexOf(d) === 0) return separadores.indexOf(f.charAt(d.length)) !== -1;
    return false;
  });
}

function consolidarItens(brutos) {
  const agora = Date.now();
  const limite = agora - CONFIG.JANELA_HORAS * 60 * 60 * 1000;
  const vistos = {};
  const todos = [];

  brutos.forEach(function (item) {
    if (!item.titulo || !item.link) return;

    const ts = item.pubDate ? Date.parse(item.pubDate) : agora;
    if (isNaN(ts) || ts < limite) return;

    const chave = normalizar(item.titulo).slice(0, 80);
    if (!chave || vistos[chave]) return;
    vistos[chave] = true;

    // O Google News formata o título como "Manchete - Veículo"
    let fonte = '';
    const partes = item.titulo.split(' - ');
    if (partes.length > 1) fonte = partes[partes.length - 1].trim();

    todos.push({
      titulo: item.titulo,
      link: item.link,
      resumo: item.descricao.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, CONFIG.MAX_RESUMO),
      fonte: fonte,
      premium: ehPremium(fonte),
      data: item.pubDate,
      ts: ts
    });
  });

  const maisNovoPrimeiro = function (a, b) { return b.ts - a.ts; };
  const premiums = todos.filter(function (c) { return c.premium; }).sort(maisNovoPrimeiro);
  const demais = todos.filter(function (c) { return !c.premium; }).sort(maisNovoPrimeiro);
  const escolhidos = premiums.slice(0, CONFIG.MAX_PREMIUM);

  return escolhidos.concat(demais.slice(0, CONFIG.MAX_CANDIDATOS - escolhidos.length));
}

function removerJaUsados(candidatos, temasUsados) {
  const usados = temasUsados.map(normalizar).filter(function (t) { return t.length > 3; });
  return candidatos.filter(function (c) {
    const t = normalizar(c.titulo);
    return !usados.some(function (u) { return t.indexOf(u) !== -1 || u.indexOf(t) !== -1; });
  });
}

// ============================================================================
// 4. PLANILHA (banco de dados)
// ============================================================================

function abrirAba(nome) {
  const planilha = SpreadsheetApp.openById(CONFIG.PLANILHA_ID);
  const aba = planilha.getSheetByName(nome);
  if (!aba) throw new Error('Aba "' + nome + '" não encontrada na planilha.');
  return aba;
}

/** Lê uma aba como lista de objetos, usando a primeira linha como cabeçalho. */
function lerAba(nome) {
  const valores = abrirAba(nome).getDataRange().getValues();
  if (valores.length < 2) return [];
  const cabecalho = valores[0].map(function (c) { return String(c).trim(); });
  return valores.slice(1).map(function (linha) {
    const obj = {};
    cabecalho.forEach(function (col, i) { obj[col] = linha[i]; });
    return obj;
  }).filter(function (obj) {
    return Object.keys(obj).some(function (k) { return String(obj[k]).trim() !== ''; });
  });
}

function lerHistorico() {
  const corte = Date.now() - CONFIG.JANELA_HISTORICO * 24 * 60 * 60 * 1000;
  return lerAba(ABAS.HISTORICO).filter(function (h) {
    if (!h.tema) return false;
    if (!h.data_envio) return true;
    const ts = (h.data_envio instanceof Date) ? h.data_envio.getTime() : Date.parse(h.data_envio);
    return isNaN(ts) ? true : ts >= corte;
  });
}

function lerBaseClinica() {
  const linhas = lerAba(ABAS.BASE).filter(function (r) {
    return r.categoria && String(r.ativo).toLowerCase() !== 'false';
  });
  const porCategoria = function (cat) {
    return linhas.filter(function (r) { return String(r.categoria).trim() === cat; });
  };
  return {
    procedimentos: porCategoria('procedimento'),
    naoRealizados: porCategoria('procedimento_nao_realizado'),
    duvidas: porCategoria('duvida_frequente'),
    tomDeVoz: porCategoria('tom_de_voz').map(function (r) { return r.descricao; }).join(' '),
    cta: porCategoria('cta_padrao').map(function (r) { return r.descricao; }).join(' ')
  };
}

function escolherEvergreen(pilar, temasUsados, direcionamento) {
  const opcoes = lerAba(ABAS.EVERGREEN).filter(function (o) {
    return o.tema && String(o.pilar).trim() === pilar;
  });

  if (opcoes.length === 0) {
    return {
      origem: 'fallback',
      temaBase: 'Tema livre do pilar ' + pilar,
      resumoBase: 'Nenhum tema evergreen cadastrado para este pilar. Criar a pauta a partir do direcionamento: ' + direcionamento,
      fonteBase: 'banco interno',
      linkBase: '',
      motivoSelecao: ''
    };
  }

  const usados = temasUsados.map(normalizar).filter(function (t) { return t.length > 3; });
  let disponiveis = opcoes.filter(function (o) {
    const t = normalizar(o.tema);
    return !usados.some(function (u) { return t.indexOf(u) !== -1 || u.indexOf(t) !== -1; });
  });
  if (disponiveis.length === 0) disponiveis = opcoes;

  const sorteado = disponiveis[Math.floor(Math.random() * disponiveis.length)];
  return {
    origem: 'fallback',
    temaBase: sorteado.tema,
    resumoBase: sorteado.angulo || '',
    fonteBase: 'banco interno (evergreen)',
    linkBase: '',
    motivoSelecao: ''
  };
}

function registrarHistorico(contexto, pautaBase, pauta) {
  abrirAba(ABAS.HISTORICO).appendRow([
    new Date(),
    contexto.pilar,
    pauta.tema || pautaBase.temaBase,
    pautaBase.fonteBase,
    pautaBase.linkBase,
    pautaBase.origem,
    ''
  ]);
}

// ============================================================================
// 5. GEMINI
// ============================================================================

/** Uma única chamada, a um modelo específico. Anexa o código HTTP ao erro. */
function chamadaGemini(modelo, chave, instrucaoSistema, mensagem, temperatura) {
  const url = 'https://generativelanguage.googleapis.com/' + CONFIG.API_VERSAO +
              '/models/' + modelo + ':generateContent?key=' + chave;

  const payload = {
    system_instruction: { parts: [{ text: instrucaoSistema }] },
    contents: [{ role: 'user', parts: [{ text: mensagem }] }],
    generationConfig: {
      temperature: temperatura,
      // Força saída em JSON puro — dispensa limpar cercas de código
      responseMimeType: 'application/json'
    }
  };

  const resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const codigo = resp.getResponseCode();
  if (codigo !== 200) {
    const erro = new Error('Modelo ' + modelo + ' retornou ' + codigo + ': ' +
                           resp.getContentText().slice(0, 400));
    erro.codigo = codigo;
    throw erro;
  }

  const dados = JSON.parse(resp.getContentText());
  const partes = dados.candidates && dados.candidates[0] &&
                 dados.candidates[0].content && dados.candidates[0].content.parts;
  if (!partes) {
    const erro = new Error('Modelo ' + modelo + ' respondeu sem conteúdo: ' +
                           resp.getContentText().slice(0, 400));
    erro.codigo = 200;
    throw erro;
  }

  return partes.map(function (p) { return p.text || ''; }).join('');
}

// Onde a autocorreção grava o modelo que descobriu funcionando
const CHAVE_MODELO_DESCOBERTO = 'MODELO_DESCOBERTO';

/**
 * Lê, na mensagem de erro do Google, qual modelo ele indica usar no lugar.
 * Ex.: "...Please update your code to use models/gemini-3.6-flash for..." → "gemini-3.6-flash"
 */
function extrairModeloRecomendado(texto) {
  const m = String(texto || '').match(/use models\/([a-zA-Z0-9._-]+)/);
  return m ? m[1].replace(/\.+$/, '') : null;
}

/** Modelos "flash" de texto que a API lista, do mais novo ao mais antigo. */
function listarCandidatosFlash(chave) {
  let resp;
  try {
    resp = UrlFetchApp.fetch(
      'https://generativelanguage.googleapis.com/' + CONFIG.API_VERSAO + '/models?key=' + chave,
      { muteHttpExceptions: true }
    );
  } catch (e) {
    return [];
  }
  if (resp.getResponseCode() !== 200) return [];

  const indesejados = ['image', 'audio', 'tts', 'embedding', 'vision', 'live', 'native'];
  const versaoDe = function (nome) {
    const m = nome.match(/gemini-(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : 0;
  };

  return (JSON.parse(resp.getContentText()).models || [])
    .filter(function (m) {
      return (m.supportedGenerationMethods || []).indexOf('generateContent') !== -1;
    })
    .map(function (m) { return String(m.name).replace('models/', ''); })
    .filter(function (nome) {
      const n = nome.toLowerCase();
      return n.indexOf('flash') !== -1 &&
             !indesejados.some(function (x) { return n.indexOf(x) !== -1; });
    })
    .sort(function (a, b) {
      const diff = versaoDe(b) - versaoDe(a);
      if (diff !== 0) return diff;
      return (a.indexOf('lite') !== -1 ? 1 : 0) - (b.indexOf('lite') !== -1 ? 1 : 0);
    });
}

/**
 * Autocorreção: testa candidatos — primeiro os que o Google recomendou nas
 * mensagens de erro, depois os "flash" listados pela API — e devolve o
 * primeiro que responder de verdade. Listado não significa disponível.
 */
function descobrirModeloFuncional(chave, recomendados, jaTentados) {
  const vistos = {};
  const fila = recomendados.concat(listarCandidatosFlash(chave))
    .filter(function (m) {
      if (!m || vistos[m] || jaTentados.indexOf(m) !== -1) return false;
      vistos[m] = true;
      return true;
    })
    .slice(0, 8);

  for (let i = 0; i < fila.length; i++) {
    try {
      chamadaGemini(fila[i], chave, 'Responda apenas com JSON.', 'Devolva {"ok":true}', 0);
      Logger.log('Autocorreção: ' + fila[i] + ' respondeu e passa a ser usado.');
      return fila[i];
    } catch (e) {
      Logger.log('Autocorreção: ' + fila[i] + ' indisponível (' + (e.codigo || '?') + ').');
    }
  }
  return null;
}

/**
 * Chama o Gemini com resiliência:
 *   - usa primeiro o modelo que a autocorreção tiver descoberto antes (se houver)
 *   - erro temporário (429, 500, 503) → espera e tenta de novo, no mesmo modelo
 *   - erro definitivo → parte para o próximo modelo da lista
 *   - se houver 404 (modelo aposentado) e todos falharem → autocorreção:
 *     descobre outro modelo que funcione, grava e usa
 * Se ainda assim falhar, o erro lista o motivo de CADA modelo tentado.
 */
function chamarGemini(instrucaoSistema, mensagem, temperatura) {
  const props = PropertiesService.getScriptProperties();
  const chave = props.getProperty('GEMINI_API_KEY');
  if (!chave) throw new Error('Defina GEMINI_API_KEY nas propriedades do script.');

  const descoberto = props.getProperty(CHAVE_MODELO_DESCOBERTO);
  const modelos = (descoberto ? [descoberto] : []).concat(CONFIG.MODELOS)
    .filter(function (m, i, lista) { return lista.indexOf(m) === i; });

  const temporarios = [429, 500, 502, 503, 504];
  const falhas = [];
  const recomendados = [];

  // Tenta um modelo, com novas tentativas em erro temporário. Devolve o texto ou null.
  const tentar = function (modelo) {
    for (let tentativa = 1; tentativa <= CONFIG.TENTATIVAS; tentativa++) {
      try {
        const texto = chamadaGemini(modelo, chave, instrucaoSistema, mensagem, temperatura);
        if (tentativa > 1 || modelo !== modelos[0]) {
          Logger.log('Sucesso com ' + modelo + ' (tentativa ' + tentativa + ').');
        }
        return texto;
      } catch (e) {
        Logger.log('Falha em ' + modelo + ' (tentativa ' + tentativa + '): ' + e.message);
        const sugerido = extrairModeloRecomendado(e.message);
        if (sugerido && recomendados.indexOf(sugerido) === -1) recomendados.push(sugerido);

        const definitivo = temporarios.indexOf(e.codigo) === -1;
        if (definitivo || tentativa === CONFIG.TENTATIVAS) {
          falhas.push({ modelo: modelo, codigo: e.codigo, mensagem: e.message });
          // Modelo gravado pela autocorreção que foi aposentado depois: esquece na hora.
          if (modelo === descoberto && e.codigo === 404) props.deleteProperty(CHAVE_MODELO_DESCOBERTO);
          return null;
        }
        Utilities.sleep(CONFIG.ESPERA_MS * tentativa);
      }
    }
    return null;
  };

  for (let m = 0; m < modelos.length; m++) {
    const texto = tentar(modelos[m]);
    if (texto !== null) return texto;
  }

  // Todos falharam. Se algum foi aposentado/inexistente (404), tenta se autocorrigir.
  if (falhas.some(function (f) { return f.codigo === 404; })) {
    if (descoberto) props.deleteProperty(CHAVE_MODELO_DESCOBERTO);
    const novo = descobrirModeloFuncional(chave, recomendados, modelos);
    if (novo) {
      props.setProperty(CHAVE_MODELO_DESCOBERTO, novo);
      const texto = tentar(novo);
      if (texto !== null) return texto;
    }
  }

  const detalhe = falhas.map(function (f) {
    return '  • ' + f.modelo + ' → ' + (f.codigo || '?') + ': ' + String(f.mensagem).slice(0, 250);
  }).join('\n');
  const erro = new Error('Nenhum modelo do Gemini respondeu.\n' + detalhe);
  erro.codigo = falhas.length > 0 ? falhas[falhas.length - 1].codigo : null;
  throw erro;
}

/** Extrai JSON mesmo se vier com texto em volta. */
function parseJsonSeguro(texto) {
  try {
    return JSON.parse(texto);
  } catch (e) {
    const ini = texto.indexOf('{');
    const fim = texto.lastIndexOf('}');
    if (ini === -1 || fim === -1) return null;
    try { return JSON.parse(texto.slice(ini, fim + 1)); } catch (e2) { return null; }
  }
}

// ============================================================================
// 6. IA — FILTRO DE RELEVÂNCIA
// ============================================================================

function filtrarComIa(contexto, candidatos, temasUsados) {
  if (candidatos.length === 0) {
    return { melhorItem: null, descartados: [], motivo: 'Nenhum item coletado hoje.' };
  }

  // Envia só o necessário para decidir. Os links do Google News têm 500+ caracteres
  // e já causaram estouro de limite de tokens — nunca incluí-los aqui.
  const enxutos = candidatos.map(function (c, i) {
    return { indice: i, titulo: c.titulo, resumo: c.resumo, fonte: c.fonte, premium: c.premium, data: c.data };
  });

  const mensagem = [
    'Pilar do dia: ' + contexto.pilar + ' (' + contexto.direcionamento + ')',
    '',
    'Temas já usados nos últimos 30 dias (evitar repetição):',
    JSON.stringify(temasUsados),
    '',
    'Itens coletados hoje (avalie cada um pelo índice na lista; "premium": true indica veículo reconhecido):',
    JSON.stringify(enxutos)
  ].join('\n');

  const bruto = chamarGemini(PROMPT_FILTRO, mensagem, 0.2);
  const dados = parseJsonSeguro(bruto) || { melhor: null, avaliacoes: [], motivo: 'Falha ao interpretar a resposta da IA.' };

  const idx = (dados.melhor === null || dados.melhor === undefined) ? null : Number(dados.melhor);
  const melhorItem = (idx !== null && !isNaN(idx) && candidatos[idx]) ? candidatos[idx] : null;

  const avaliacoes = Array.isArray(dados.avaliacoes) ? dados.avaliacoes : [];
  const descartados = avaliacoes
    .filter(function (a) { return Number(a.indice) !== idx; })
    .slice(0, 5)
    .map(function (a) {
      const c = candidatos[Number(a.indice)] || {};
      return { titulo: c.titulo || '', nota: a.nota, motivo: a.justificativa || '' };
    });

  return { melhorItem: melhorItem, descartados: descartados, motivo: dados.motivo || '' };
}

// ============================================================================
// 7. IA — GERAÇÃO DA PAUTA
// ============================================================================

function montarPromptGeracao(contexto, pautaBase, temasUsados, base) {
  const listaProc = base.procedimentos.map(function (r) {
    const desc = String(r.descricao || '')
      .replace('[A VALIDAR com a Dra. Simone] ', '')
      .slice(0, CONFIG.MAX_DESCRICAO_PROC);
    return '- ' + r.item + ': ' + desc;
  });
  const listaNao = base.naoRealizados.map(function (r) { return '- ' + r.item + ': ' + (r.descricao || ''); });
  const listaDuvidas = base.duvidas.map(function (r) { return '- ' + r.item; });

  return [
    'DADOS DO DIA',
    'Data: ' + contexto.dataHoje,
    'Pilar do dia: ' + contexto.pilar + ' - ' + contexto.direcionamento,
    'Origem da pauta: ' + (pautaBase.origem === 'radar'
      ? 'novidade encontrada nas fontes de hoje'
      : 'banco interno de temas (fallback: nenhuma novidade relevante hoje)'),
    '',
    'TEMA BASE: ' + pautaBase.temaBase,
    'RESUMO / ÂNGULO: ' + pautaBase.resumoBase,
    'FONTE: ' + pautaBase.fonteBase + (pautaBase.linkBase ? ' - ' + pautaBase.linkBase : ''),
    pautaBase.motivoSelecao ? 'POR QUE É RELEVANTE: ' + pautaBase.motivoSelecao : '',
    '',
    'CONTEXTO DA CLÍNICA',
    'Tom de voz: ' + base.tomDeVoz,
    'CTA padrão: ' + base.cta,
    'Procedimentos REALIZADOS pela clínica (os únicos que podem ser citados):',
    listaProc.join('\n') || '- (nenhum cadastrado)',
    'Procedimentos NÃO realizados (nunca sugerir nem mencionar como oferta):',
    listaNao.join('\n') || '- (nenhum cadastrado)',
    'Dúvidas frequentes das pacientes (bons ganchos):',
    listaDuvidas.join('\n') || '- (nenhuma cadastrada)',
    '',
    'Temas recentes que NÃO podem ser repetidos: ' + JSON.stringify(temasUsados)
  ].join('\n');
}

function gerarPauta(prompt) {
  const bruto = chamarGemini(PROMPT_GERACAO, prompt, 0.7);
  return parseJsonSeguro(bruto) || {
    tema: '', objetivo: '', formato: '', procedimento_relacionado: 'nenhum',
    stories: [], interacao: '', cta: '', observacoes_gravacao: '', pontos_validacao: []
  };
}

function corrigirPauta(pauta, violacoes, procedimentos) {
  const permitidos = procedimentos.map(function (p) { return p.item; });
  const mensagem = [
    'A pauta de Stories abaixo violou regras editoriais. Corrija APENAS os problemas listados,',
    'mantendo todo o resto igual. Responda somente com o JSON completo corrigido, no mesmo formato recebido.',
    '',
    'Problemas encontrados:',
    violacoes.join('; '),
    '',
    'Regras: nunca prometer resultado, nunca inventar dados, nunca diagnosticar, apenas procedimentos',
    'desta lista podem ser citados: ' + JSON.stringify(permitidos) + '. A pauta deve ter exatamente 5 stories.',
    '',
    'Pauta:',
    JSON.stringify(pauta)
  ].join('\n');

  try {
    const bruto = chamarGemini(PROMPT_CORRECAO, mensagem, 0.3);
    const corrigida = parseJsonSeguro(bruto);
    return (corrigida && Array.isArray(corrigida.stories)) ? corrigida : pauta;
  } catch (e) {
    Logger.log('Correção falhou: ' + e.message);
    return pauta;
  }
}

// ============================================================================
// 8. GUARDRAILS EDITORIAIS (determinísticos)
// ============================================================================

function aplicarGuardrails(pauta, procedimentos) {
  const violacoes = [];

  if (!pauta || typeof pauta !== 'object') {
    return { aprovado: false, violacoes: ['A resposta da IA não pôde ser interpretada como JSON.'] };
  }

  // 1. Promessa de resultado
  const texto = JSON.stringify(pauta).toLowerCase();
  TERMOS_PROIBIDOS.forEach(function (termo) {
    if (texto.indexOf(termo) !== -1) violacoes.push('Termo proibido encontrado: ' + termo);
  });

  // 2. Procedimento fora do escopo (comparação normalizada)
  const normProc = function (t) { return String(t || '').toLowerCase().replace(/[^a-z0-9à-ü]/g, ''); };
  const proc = String(pauta.procedimento_relacionado || 'nenhum').toLowerCase().trim();
  if (proc !== 'nenhum' && proc !== '') {
    const alvo = normProc(proc);
    const permitidos = procedimentos.map(function (p) { return normProc(p.item); });
    const ok = permitidos.some(function (x) {
      return x && (alvo.indexOf(x) !== -1 || x.indexOf(alvo) !== -1);
    });
    if (!ok) violacoes.push('Procedimento fora da lista da clínica: ' + pauta.procedimento_relacionado);
  }

  // 3. Estrutura de 5 Stories
  const n = Array.isArray(pauta.stories) ? pauta.stories.length : 0;
  if (n !== 5) violacoes.push('A pauta deve ter exatamente 5 Stories (recebido: ' + n + ')');

  return { aprovado: violacoes.length === 0, violacoes: violacoes };
}

// ============================================================================
// 9. E-MAIL
// ============================================================================

function escapar(t) {
  return String(t === null || t === undefined ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function montarEmailHtml(contexto, pautaBase, pauta, descartados, checagem, corrigido) {
  const stories = Array.isArray(pauta.stories) ? pauta.stories : [];

  const blocosStories = stories.map(function (s) {
    return '<div style="margin:0 0 12px 0;padding:12px;background:#f6f4fb;border-radius:8px;">' +
      '<strong>Story ' + escapar(s.numero) + ' - ' + escapar(s.funcao) + '</strong>' +
      '<p style="margin:6px 0 4px 0;"><em>Texto de tela:</em> ' + escapar(s.texto_tela) + '</p>' +
      '<p style="margin:0;"><em>Fala:</em> ' + escapar(s.orientacao_fala) + '</p></div>';
  }).join('');

  const radar = pautaBase.origem === 'radar'
    ? '<p><strong>' + escapar(pautaBase.temaBase) + '</strong></p>' +
      '<p style="margin:4px 0;">Fonte: ' + escapar(pautaBase.fonteBase) +
      (pautaBase.linkBase ? ' - <a href="' + escapar(pautaBase.linkBase) + '">ver notícia</a>' : '') + '</p>' +
      '<p style="margin:4px 0;">' + escapar(pautaBase.resumoBase) + '</p>' +
      (pautaBase.motivoSelecao
        ? '<p style="margin:4px 0;"><em>Por que é relevante:</em> ' + escapar(pautaBase.motivoSelecao) + '</p>'
        : '')
    : '<p><strong>Sem novidade relevante hoje</strong> - sugestão criada a partir do banco interno de temas do pilar.</p>' +
      '<p style="margin:4px 0;">Tema escolhido: ' + escapar(pautaBase.temaBase) + '</p>';

  let obs = '';
  (Array.isArray(pauta.pontos_validacao) ? pauta.pontos_validacao : []).forEach(function (v) {
    obs += '<li>Validar antes de publicar: ' + escapar(v) + '</li>';
  });
  if (pautaBase.origem === 'fallback') {
    obs += '<li>Aviso: pauta de fallback (nenhuma novidade atingiu o corte de relevância hoje).</li>';
  }
  if (corrigido) {
    obs += '<li>Esta pauta passou por correção automática de guardrails. Revise com atenção redobrada.</li>';
  }
  if (checagem.violacoes.length > 0) {
    obs += '<li>Alertas de guardrails ainda pendentes: ' + escapar(checagem.violacoes.join('; ')) + '</li>';
  }

  const listaDescartados = (descartados || []).map(function (x) {
    return '<li>' + escapar(x.titulo) +
      (x.nota !== undefined ? ' (nota ' + escapar(x.nota) + ')' : '') +
      (x.motivo ? ' - ' + escapar(x.motivo) : '') + '</li>';
  }).join('');

  const roxo = 'border-bottom:2px solid #7c5cbf;padding-bottom:4px;';

  return '<div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;color:#222;line-height:1.5;">' +
    '<h2 style="margin:0 0 4px 0;">Radar do dia</h2>' +
    '<p style="margin:0 0 16px 0;color:#666;">' + escapar(contexto.dataHoje) +
      ' - Pilar: <strong>' + escapar(contexto.pilar) + '</strong></p>' +
    '<h3 style="' + roxo + '">&#128225; Radar do dia</h3>' + radar +
    '<h3 style="' + roxo + '">&#128161; Oportunidade de conteúdo</h3>' +
    '<p style="margin:4px 0;"><strong>Tema:</strong> ' + escapar(pauta.tema) + '</p>' +
    '<p style="margin:4px 0;"><strong>Pilar:</strong> ' + escapar(contexto.pilar) + '</p>' +
    '<p style="margin:4px 0;"><strong>Objetivo:</strong> ' + escapar(pauta.objetivo) + '</p>' +
    '<p style="margin:4px 0;"><strong>Formato:</strong> ' + escapar(pauta.formato) + '</p>' +
    '<p style="margin:4px 0;"><strong>Procedimento relacionado:</strong> ' +
      escapar(pauta.procedimento_relacionado || 'nenhum') + '</p>' +
    '<h3 style="' + roxo + '">&#127916; Sequência de Stories</h3>' + blocosStories +
    '<p style="margin:4px 0;"><strong>Interação sugerida:</strong> ' + escapar(pauta.interacao) + '</p>' +
    '<p style="margin:4px 0;"><strong>CTA:</strong> ' + escapar(pauta.cta) + '</p>' +
    (pauta.observacoes_gravacao
      ? '<p style="margin:4px 0;"><strong>Gravação:</strong> ' + escapar(pauta.observacoes_gravacao) + '</p>'
      : '') +
    '<h3 style="border-bottom:2px solid #e0a800;padding-bottom:4px;">&#9888;&#65039; Observações</h3>' +
    (obs ? '<ul>' + obs + '</ul>' : '<p>Nenhum ponto de atenção hoje.</p>') +
    (listaDescartados
      ? '<p style="margin:12px 0 4px 0;"><strong>Temas avaliados e descartados hoje:</strong></p><ul>' +
        listaDescartados + '</ul>'
      : '') +
    '<p style="color:#999;font-size:12px;margin-top:20px;">Radar Inteligente de Conteúdo - gerado ' +
      'automaticamente. Você é sempre a aprovadora final.</p></div>';
}

function notificarFalha(erro) {
  let orientacao = '';
  const msg = String(erro.message || '');

  if (msg.indexOf('404') !== -1) {
    orientacao = 'CAUSA PROVÁVEL: os modelos de IA configurados foram aposentados ou não estão ' +
      'disponíveis para a sua chave (o Google continua listando modelos que já recusa para contas novas).\n' +
      'O Radar já tentou se autocorrigir procurando outro modelo e não encontrou nenhum que respondesse.\n' +
      'O QUE FAZER: rode testarModelos() no editor. Ele testa de verdade cada modelo disponível e ' +
      'sugere a lista que funciona para colar em CONFIG.MODELOS. A lista abaixo mostra o motivo de cada modelo.';
  } else if (msg.indexOf('429') !== -1) {
    orientacao = 'CAUSA PROVÁVEL: cota da IA esgotada.\n' +
      'O QUE FAZER: rode a função testarModelos() no editor para ver qual modelo ainda responde ' +
      'e ajuste CONFIG.MODELOS. Se nenhum responder, gere uma nova chave em ' +
      'aistudio.google.com/apikey ou ative o faturamento (custo estimado abaixo de R$ 1/mês neste volume).';
  } else if (msg.indexOf('403') !== -1 || msg.indexOf('400') !== -1) {
    orientacao = 'CAUSA PROVÁVEL: chave de API inválida, revogada ou sem permissão.\n' +
      'O QUE FAZER: gere uma nova chave em aistudio.google.com/apikey e atualize a propriedade ' +
      'GEMINI_API_KEY nas Configurações do projeto.';
  } else if (msg.indexOf('openById') !== -1 || msg.indexOf('não encontrada') !== -1) {
    orientacao = 'CAUSA PROVÁVEL: problema de acesso à planilha.\n' +
      'O QUE FAZER: confira CONFIG.PLANILHA_ID e se as três abas existem.';
  } else {
    orientacao = 'O QUE FAZER: rode verificarInstalacao() no editor para um diagnóstico completo.';
  }

  try {
    GmailApp.sendEmail(
      CONFIG.EMAIL_ALERTA,
      '[Radar] Falha na execução de hoje',
      'O Radar não conseguiu gerar a pauta.\n\n' +
      'ERRO: ' + msg + '\n\n' + orientacao + '\n\n---\n' + (erro.stack || '')
    );
  } catch (e) {
    Logger.log('Não foi possível enviar o alerta de falha: ' + e.message);
  }
}

// ============================================================================
// 10. INSTALAÇÃO
// ============================================================================

/** Rode uma vez para criar o acionador diário das 6h. */
function instalarAcionador() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'radarDoDia') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('radarDoDia').timeBased().atHour(6).everyDays(1).create();
  Logger.log('Acionador criado: todo dia às 6h (domingo é ignorado pelo próprio script).');
}

/** Rode uma vez para criar as três abas com os cabeçalhos corretos. */
function prepararPlanilha() {
  const planilha = SpreadsheetApp.openById(CONFIG.PLANILHA_ID);
  const estrutura = {};
  estrutura[ABAS.HISTORICO] = ['data_envio', 'pilar', 'tema', 'fonte', 'link', 'origem', 'feedback'];
  estrutura[ABAS.EVERGREEN] = ['pilar', 'tema', 'angulo', 'ultimo_uso'];
  estrutura[ABAS.BASE] = ['categoria', 'item', 'descricao', 'ativo'];

  Object.keys(estrutura).forEach(function (nome) {
    let aba = planilha.getSheetByName(nome);
    if (!aba) aba = planilha.insertSheet(nome);
    if (aba.getLastRow() === 0) {
      aba.appendRow(estrutura[nome]);
      aba.getRange(1, 1, 1, estrutura[nome].length).setFontWeight('bold');
      aba.setFrozenRows(1);
    }
  });
  Logger.log('Abas prontas. Agora importe os CSVs em evergreen e base_clinica.');
}

/** Diagnóstico rápido: confere configuração, planilha e acesso ao Gemini. */
function verificarInstalacao() {
  const problemas = [];

  if (CONFIG.PLANILHA_ID.indexOf('COLE_AQUI') === 0) problemas.push('PLANILHA_ID não configurado.');
  if (!PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY')) {
    problemas.push('GEMINI_API_KEY não definida nas propriedades do script.');
  }

  try {
    [ABAS.HISTORICO, ABAS.EVERGREEN, ABAS.BASE].forEach(function (nome) {
      const linhas = lerAba(nome);
      Logger.log('Aba ' + nome + ': ' + linhas.length + ' registros.');
      if (nome !== ABAS.HISTORICO && linhas.length === 0) problemas.push('Aba ' + nome + ' está vazia.');
    });
  } catch (e) {
    problemas.push('Planilha: ' + e.message);
  }

  try {
    chamarGemini('Responda apenas com JSON.', 'Devolva {"ok":true}', 0);
    Logger.log('Gemini respondeu corretamente.');
  } catch (e) {
    problemas.push('Gemini: ' + e.message);
  }

  Logger.log(problemas.length === 0
    ? '✅ Tudo certo. Rode testarAgora() para uma prévia completa.'
    : '⚠️ Pendências:\n- ' + problemas.join('\n- '));
}

/**
 * ⭐ RODE ESTA PRIMEIRO quando der 404.
 * Pergunta ao Google quais modelos existem de verdade para a sua chave,
 * em cada versão da API, e sugere a lista pronta para colar em CONFIG.MODELOS.
 */
function listarModelosDisponiveis() {
  const chave = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!chave) {
    Logger.log('❌ GEMINI_API_KEY não está definida nas propriedades do script.');
    return;
  }

  ['v1beta', 'v1'].forEach(function (versao) {
    Logger.log('');
    Logger.log('========== API ' + versao + ' ==========');

    const resp = UrlFetchApp.fetch(
      'https://generativelanguage.googleapis.com/' + versao + '/models?key=' + chave,
      { muteHttpExceptions: true }
    );

    if (resp.getResponseCode() !== 200) {
      Logger.log('HTTP ' + resp.getResponseCode() + ' — ' + resp.getContentText().slice(0, 300));
      return;
    }

    const modelos = (JSON.parse(resp.getContentText()).models || [])
      .filter(function (m) {
        return (m.supportedGenerationMethods || []).indexOf('generateContent') !== -1;
      })
      .map(function (m) { return String(m.name).replace('models/', ''); });

    if (modelos.length === 0) {
      Logger.log('Nenhum modelo com generateContent nesta versão.');
      return;
    }

    Logger.log('Modelos que geram texto (' + modelos.length + '):');
    modelos.forEach(function (nome) { Logger.log('   ' + nome); });

    // Sugestão: prioriza os "flash" (rápidos e baratos), descartando variantes
    // de imagem, áudio, TTS, embedding e versões numeradas de preview antigas.
    const indesejados = ['image', 'audio', 'tts', 'embedding', 'vision', 'live', 'native'];
    const flash = modelos.filter(function (nome) {
      const n = nome.toLowerCase();
      if (n.indexOf('flash') === -1) return false;
      return !indesejados.some(function (x) { return n.indexOf(x) !== -1; });
    });

    // Ordena do mais novo para o mais antigo (gemini-3.8 antes de gemini-2.5)
    // e, dentro da mesma versão, prefere o 'flash' cheio ao 'flash-lite'.
    const versaoDe = function (nome) {
      const m = nome.match(/gemini-(\d+(?:\.\d+)?)/);
      return m ? parseFloat(m[1]) : 0;
    };
    flash.sort(function (a, b) {
      const diff = versaoDe(b) - versaoDe(a);
      if (diff !== 0) return diff;
      const liteA = a.indexOf('lite') !== -1 ? 1 : 0;
      const liteB = b.indexOf('lite') !== -1 ? 1 : 0;
      return liteA - liteB;
    });

    const sugestao = (flash.length > 0 ? flash : modelos).slice(0, 3);
    Logger.log('');
    Logger.log('➡️ Para esta versão, use:');
    Logger.log('   API_VERSAO: \'' + versao + '\',');
    Logger.log('   MODELOS: ' + JSON.stringify(sugestao) + ',');
  });

  Logger.log('');
  Logger.log('⚠️ "Listado" não significa "disponível": o Google continua listando modelos que já ' +
             'recusa para contas novas. Antes de colar no CONFIG, confirme com testarModelos().');
}

/**
 * ⭐ Diagnóstico principal de modelos de IA.
 * Testa DE VERDADE cada modelo — os do CONFIG e os "flash" que a API lista — e
 * sugere só os que responderam. A API lista modelos que já recusa para contas
 * novas, então "listado" não significa "disponível".
 */
function testarModelos() {
  const props = PropertiesService.getScriptProperties();
  const chave = props.getProperty('GEMINI_API_KEY');
  if (!chave) {
    Logger.log('❌ GEMINI_API_KEY não está definida nas propriedades do script.');
    return;
  }

  const descoberto = props.getProperty(CHAVE_MODELO_DESCOBERTO);
  if (descoberto) Logger.log('ℹ️ Modelo gravado pela autocorreção (usado primeiro): ' + descoberto);

  const vistos = {};
  const candidatos = CONFIG.MODELOS.concat(listarCandidatosFlash(chave)).filter(function (m) {
    if (!m || vistos[m]) return false;
    vistos[m] = true;
    return true;
  });

  const funcionando = [];
  const recomendados = [];

  candidatos.forEach(function (modelo) {
    try {
      chamadaGemini(modelo, chave, 'Responda apenas com JSON.', 'Devolva {"ok":true}', 0);
      Logger.log('✅ ' + modelo + ' — funcionando');
      funcionando.push(modelo);
    } catch (e) {
      const sugerido = extrairModeloRecomendado(e.message);
      if (sugerido && recomendados.indexOf(sugerido) === -1) recomendados.push(sugerido);

      let motivo = 'erro ' + (e.codigo || '?') + ': ' + String(e.message).slice(0, 120);
      if (e.codigo === 429) motivo = 'COTA ESGOTADA (429)';
      else if (e.codigo === 403) motivo = 'SEM PERMISSÃO / API não habilitada (403)';
      else if (e.codigo === 400) motivo = 'CHAVE INVÁLIDA ou pedido recusado (400)';
      else if (e.codigo === 404) {
        motivo = String(e.message).indexOf('no longer available') !== -1
          ? 'APOSENTADO para contas novas (404)'
          : 'não existe com este nome nesta versão da API (404)';
      }
      Logger.log('❌ ' + modelo + ' — ' + motivo);
    }
  });

  Logger.log('');
  if (recomendados.length > 0) {
    Logger.log('💡 O próprio Google recomendou: ' + recomendados.join(', '));
  }
  if (funcionando.length > 0) {
    Logger.log('➡️ Cole em CONFIG.MODELOS: MODELOS: ' + JSON.stringify(funcionando.slice(0, 3)) + ',');
  } else {
    Logger.log('➡️ Nenhum modelo respondeu. Interprete pelo código:');
    Logger.log('   404 em todos → modelos aposentados ou versão errada. Troque API_VERSAO entre \'v1\' e \'v1beta\'.');
    Logger.log('   429 em todos → cota da chave esgotada. Gere outra chave (em novo projeto) ou ative faturamento.');
    Logger.log('   400/403 em todos → a chave está inválida ou sem permissão. Gere outra em aistudio.google.com/apikey.');
  }
}

/** Apaga o modelo gravado pela autocorreção; o Radar volta a usar só CONFIG.MODELOS. */
function esquecerModeloDescoberto() {
  PropertiesService.getScriptProperties().deleteProperty(CHAVE_MODELO_DESCOBERTO);
  Logger.log('Modelo descoberto apagado. O Radar volta a usar apenas CONFIG.MODELOS.');
}
