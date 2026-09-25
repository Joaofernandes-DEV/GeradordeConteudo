# LOG de Engenharia

Diário de construção do Radar: o que deu certo, o que quebrou, por que quebrou e o que ficou de lição.

Este arquivo existe porque a parte mais instrutiva do projeto não foi o caminho feliz — foram as falhas de produção. Cada entrada registra **sintoma → causa raiz → correção → lição**.

---

## Linha do tempo

| Data | Evento | Resultado |
|---|---|---|
| 09/08/2026 | Briefing convertido em workflow n8n de 28 nós | ✅ |
| 09/08/2026 | Banco de dados em Data Tables em vez de Sheets | ✅ Decisão |
| 10/08/2026 | Catálogo real de 24 procedimentos substitui dados genéricos | ✅ |
| 10/08/2026 | API não permite excluir linhas — workflow utilitário descartável | ⚠️ Contorno |
| 10/08/2026 | Arquitetura de IA trocada para modelo plugável | ✅ Decisão |
| 10–12/08/2026 | Groq estoura limite de tokens e derruba 3 envios | ❌ |
| 12/08/2026 | Tentativa de migrar para OpenAI barrada por credencial | ❌ |
| 12/08/2026 | Volta ao Gemini com teste real de ponta a ponta | ✅ |
| 12/08/2026 | Fuso horário não aplicado na criação do workflow | ❌ |
| 12/08/2026 | Guardrail acusa procedimento válido como inválido | ❌ |
| 12–13/08/2026 | Ampliação para 10 segmentos de busca | ✅ |
| 13/08/2026 | Ranking de fonte marca portal desconhecido como confiável | ❌ |
| 25/08/2026 | Trial do n8n encerra e a instância é suspensa sem exportação | ❌ |
| 25/08/2026 | Sistema reimplementado em Google Apps Script | ✅ Decisão |
| ~09/09/2026 | Todos os modelos de IA retornam 404 | ❌ |
| 10/09/2026 | Google aposenta o modelo em uso para contas novas | ❌ |
| 10/09/2026 | Autocorreção de modelo + suíte de testes em simulador | ✅ |

---

## Acertos

### A1 — Separar a IA em papéis distintos

Em vez de uma chamada única pedindo "leia as notícias e escreva a pauta", o sistema usa duas etapas: um **analista** que dá nota de 0 a 10 a cada item e escolhe o melhor, e uma **redatora** que só recebe o vencedor.

**Ganho:** qualidade maior e custo menor — das ~300 notícias coletadas, apenas uma passa pela chamada cara de redação. A separação também permitiu calibrar temperatura por papel (0.2 para julgar, 0.7 para escrever).

### A2 — Guardrails determinísticos depois da IA

A validação das regras editoriais não é feita por prompt, e sim por código: lista de 18 termos proibidos, cruzamento com o catálogo real de procedimentos e checagem da estrutura de 5 Stories.

**Ganho:** a regra "nunca prometer resultado" deixou de depender da boa vontade do modelo. Quando a checagem reprova, a pauta volta para a IA corrigir uma vez e o e-mail sinaliza a correção.

**Evidência em produção:** o filtro descartou com justificativa itens como notícia policial (nota 1), matéria corporativa sobre congresso (nota 3) e conteúdo genérico de autoestima (nota 5).

### A3 — Arquitetura de IA plugável

Ainda na versão n8n, a IA foi reorganizada para que o modelo fosse um subnó intercambiável, com os parsers tolerando mais de um formato de resposta.

**Ganho:** três trocas de provedor (Gemini → Groq → OpenAI → Gemini) sem reescrever prompt nem lógica. A decisão se pagou de novo na migração para Apps Script.

### A4 — Fallback explícito

Se nenhuma notícia atinge a nota de corte, o sistema puxa um tema de um banco de 18 opções atemporais e **avisa no e-mail** que aquilo é fallback.

**Ganho:** o sistema pode dizer "hoje não houve novidade relevante" sem quebrar a rotina — e sem entregar conteúdo fraco, que destruiria a confiança da cliente na ferramenta.

### A5 — Teste antes de entregar

A migração para Apps Script incluiu `verificarInstalacao()`, `testarAgora()` e `testarModelos()`: funções que diagnosticam a instalação, rodam o fluxo inteiro sem enviar e-mail e testam cada modelo de IA.

**Ganho:** o operador consegue diagnosticar sozinho, sem depender de quem escreveu o código.

---

## Erros

### E1 — Estouro de limite de tokens derrubou três envios

```
413 Request too large for model llama-3.3-70b-versatile
on tokens per minute (TPM): Limit 12000, Requested 12445
```

**Sintoma:** três execuções agendadas consecutivas falharam. O gatilho disparava; o fluxo morria no primeiro nó de IA.

**Causa raiz:** o prompt do filtro enviava o objeto completo de cada candidato, incluindo os links do Google News — URLs codificadas com mais de 500 caracteres cada. Com 20 candidatos, os links representavam a maior parte do payload. E a IA nem os usava para decidir.

**Correção:** o prompt passou a enviar apenas índice, título, resumo, fonte e data. Redução de aproximadamente 60% no tamanho.

**Lição:** monte o payload da IA com o mínimo necessário para a decisão, não com o objeto inteiro que você já tem em mãos. Além de evitar limites, reduz custo e melhora o foco do modelo.

### E2 — Falha silenciosa por três dias

**Sintoma:** os e-mails simplesmente não chegavam, sem erro visível no dia a dia.

**Causa raiz:** as execuções agendadas estavam com status de erro havia três dias. Só apareceu ao consultar o histórico de execuções manualmente.

**Correção:** na versão Apps Script, qualquer exceção dispara um e-mail de alerta que identifica a causa provável e orienta a correção.

**Lição:** workflow ativo não é workflow saudável. Sistema que falha calado é sistema que não existe — observabilidade mínima é requisito, não enfeite.

### E3 — Credencial inválida bloqueou a migração para OpenAI

```
401 Incorrect API key provided: sk-proj-...hgMA
```

**Sintoma:** ao testar o gpt-5.4-mini, a requisição era montada e enviada corretamente, mas recusada.

**Diagnóstico:** falha de credencial, não de configuração — chave expirada, revogada ou conta sem billing ativo.

**Correção:** a versão OpenAI ficou como rascunho não publicado e o provedor anterior seguiu em produção.

**Lição:** ao trocar de provedor, mantenha a versão anterior publicada até o teste real passar. Rascunho não afeta produção.

### E4 — Guardrail acusando procedimento válido

**Sintoma:** a IA respondia `"Skinbooster"` e o guardrail acusava procedimento fora da lista, porque o catálogo registra `"Skin Booster / Hidratação Injetável"`.

**Causa raiz:** comparação literal entre string gerada e catálogo, sem normalização.

**Correção:** normalização antes de comparar — remoção de espaços, pontuação e caixa.

**Lição:** validação por lista fechada precisa de normalização, senão vira ruído e treina o usuário a ignorar alertas.

### E5 — Falso positivo no ranking de credibilidade

**Sintoma:** o domínio `recordeuropa.com`, um portal desconhecido, era classificado como veículo reconhecido. O mesmo com `brasilemfolhas.com.br`.

**Causa raiz:** a verificação usava `includes()`. Como a lista continha `record` e `folha`, qualquer fonte que contivesse esses trechos em qualquer posição passava.

**Correção:** comparação por igualdade ou prefixo seguido de separador. `band.com.br` e `UOL Economia` continuam válidos; `recordeuropa.com` e `Folha de Alagoas` não.

**Lição:** matching por substring em allowlist é gerador clássico de falso positivo. Verificação de confiança exige fronteira explícita.

### E6 — Fuso horário não aplicado

**Sintoma:** o gatilho das 6h disparava às 9h UTC — correto em UTC, mas dependente do padrão da instância.

**Causa raiz:** a chamada que configurava o fuso falhou com erro de rede durante a criação e não foi repetida na hora.

**Correção:** fuso `America/Sao_Paulo` aplicado explicitamente.

**Lição:** falha de rede em passo de configuração passa despercebida no meio de um build. Vale reconferir o estado final, não só o retorno de cada passo.

### E7 — Plataforma suspensa sem janela de exportação

**Sintoma:** o trial do n8n Cloud encerrou e a instância foi suspensa. A API passou a responder `Not Found` para o workflow e para a listagem.

**Impacto:** impossível exportar o workflow que estava em produção.

**Correção:** toda a lógica foi reconstruída em `backup/LOGICA-COMPLETA.md`, em formato independente de plataforma, e os dados das tabelas em CSV.

**Lição:** não existe "depois eu exporto". Trial encerrado pode significar acesso revogado no mesmo dia. A lógica precisa viver em formato portátil desde o começo — e essa reconstrução virou o insumo que permitiu migrar em uma tarde.

### E8 — Versão errada da API: 404 em todos os modelos

**Sintoma:** depois da migração para Apps Script, todas as chamadas de IA retornavam 404, inclusive para modelos que existiam.

**Causa raiz:** o código chamava a versão `v1beta` da API, mas os modelos estavam publicados na `v1`.

**Correção:** `API_VERSAO` virou configuração, e foi criada a função `listarModelosDisponiveis()`, que consulta as duas versões e mostra o que existe em cada uma.

**Lição:** quando a documentação e a realidade divergem, pergunte à API. Diagnóstico baseado em consulta vence diagnóstico baseado em suposição.

### E9 — Modelo aposentado: "listado" não é "disponível"

```
404: This model models/gemini-2.5-flash is no longer available to new users.
Please update your code to use models/gemini-3.6-flash
```

**Sintoma:** o sistema rodava havia semanas e parou de um dia para o outro.

**Causa raiz:** o Google aposentou o modelo para contas novas — **mas ele continuava aparecendo na listagem de modelos da própria API**. A função de diagnóstico, que confiava na listagem, chegou a sugeri-lo de volta.

**Agravante:** o alerta de falha mostrava só o erro do último modelo da cadeia de fallback, escondendo por que os anteriores falharam.

**Correção:**
- Modelo principal trocado para o substituto indicado pelo próprio Google na mensagem de erro.
- **Autocorreção**: quando os modelos configurados falham com 404, o script extrai da mensagem o modelo recomendado, testa os candidatos disponíveis do mais novo ao mais antigo, grava o primeiro que responder e passa a usá-lo.
- O alerta passou a listar o motivo de **cada** modelo tentado.
- `testarModelos()` passou a testar de verdade, em vez de confiar na listagem.
- Validação com simulador do Apps Script em Node: **22 verificações em 8 cenários**, incluindo a mensagem de erro real, cota esgotada, erro temporário e o caso em que nada responde.

**Lição:** listas fixas de nomes de modelo envelhecem, e a listagem oficial também engana. A única prova de disponibilidade é uma chamada real. Quem depende de LLM de terceiros precisa tratar troca de modelo como evento normal de operação, não como exceção.

---

## Decisões estruturais

### D1 — Sair da plataforma de automação

**Contexto:** com o trial do n8n encerrado, as opções eram migrar para o Make, contratar o n8n ou hospedar por conta própria.

**Análise:** o Make cobra por operação — e o Radar processa ~300 notícias por dia. Sem agregação imediata, o plano gratuito acabaria em dois dias. Além disso, a plataforma não tem nó de código, o que exigiria reescrever oito blocos de lógica em fórmulas.

**Decisão:** migrar para Google Apps Script. O Radar é um script agendado linear, com três integrações e um usuário. A plataforma visual entregava um canvas bonito e cobrava por isso em assinatura, limite de operações e custo de migração.

**Resultado:** custo zero, sem limite de operações, e a lógica em JavaScript foi aproveitada quase integralmente. O estudo do Make ficou documentado em [MIGRACAO-MAKE.md](MIGRACAO-MAKE.md).

### D2 — Planilha como banco de dados

Google Sheets em vez de banco relacional. O motivo não é técnico, é de produto: a própria cliente precisa conseguir editar o catálogo de procedimentos, o tom de voz e os temas de reserva sem depender de ninguém.

### D3 — Comparativo de provedores de IA

Três provedores testados no mesmo pipeline, com prompts idênticos:

| Provedor | Resultado |
|---|---|
| **Google Gemini** | ✅ Em produção. Processou 107 candidatos sem esbarrar em limite; execução completa em 26s |
| **Groq** | ⚠️ Rápido e gratuito, porém inviável no free tier: teto de 12k tokens/minuto para um prompt de curadoria |
| **OpenAI** | ❌ Não avaliado — credencial inválida |

**Conclusão:** para cargas com prompt grande — típicas de curadoria, em que dezenas de itens vão de uma vez — o limite de tokens por minuto pesa mais que a velocidade de inferência.

---

## Evidência de qualidade editorial

Execução real de 12/08/2026, pilar "Caso clínico", com 107 notícias coletadas:

- **Selecionada (nota 8):** "Canetas emagrecedoras podem afetar rosto e saúde bucal"
- **Tema gerado:** *"O impacto do emagrecimento rápido na firmeza do rosto"*, em formato processo/jornada, conectado a um procedimento real do catálogo
- **Descartadas com justificativa:** notícia policial (nota 1), congresso da área (nota 3), estética masculina fora do público (nota 4), conteúdo genérico de autoestima (nota 5)
- **Pontos de validação sinalizados:** 2

O modelo demonstrou entender o encaixe no pilar do dia, não apenas o tema: escolheu um ângulo que permite trabalhar "processo/jornada" quando não há caso clínico autorizado disponível.

---

## Pendências conhecidas

- [ ] Trocar o e-mail de destino pelo da profissional no go-live definitivo
- [ ] Preencher a lista de procedimentos que a clínica **não** realiza
- [ ] Converter as regras de publicidade do Conselho Federal de Biomedicina em restrições explícitas do prompt
- [ ] Validar com a profissional as descrições dos 24 procedimentos
- [ ] Concluir a fase de calibração: marcar cada pauta como usei / adaptei / descartei no histórico
