# Roteiro da aula (60 min): falha em cascata por esgotamento de pool

Os tempos de execução abaixo foram medidos neste notebook. Os números esperados na tela estão no
README (seção "Roteiro por branch"); aqui está **o que fazer e o que falar, minuto a minuto**.

**Fio condutor:** "uma rota de 2% derrubou o sistema inteiro. Vamos tentar consertar como
consertaríamos no mundo real e ver cada conserto criar o próximo problema."

**Fórmula da aula (Lei de Little):** `conexões ocupadas = chegadas/s × tempo segurando a conexão`.
Toda branch é essa conta. Deixe-a escrita num canto do quadro desde o início.

---

## T-60 min: checklist antes de entrar na sala

- [ ] Docker Desktop aberto, ≥ 6 GB de RAM. Carregador na tomada (CPU em modo bateria muda os números).
- [ ] `git checkout main && make up`, depois **um `make load` completo de aquecimento**: aquece o
      cache do Postgres e confirma que tudo funciona. Você deve ver a cascata.
- [ ] Grafana em modo projetor: <http://localhost:3000/d/cascade?kiosk>, zoom do navegador em 125%.
- [ ] Dois terminais com fonte grande:
      **T1** para os comandos; **T2** pronto com `make who` (e depois `make logs`).
- [ ] Notificações do sistema desligadas (Não Perturbe).
- [ ] Vídeos do Plano B abertos numa aba (ver README).
- [ ] Este roteiro impresso ou numa segunda tela.

> **Atalho de tempo usado neste roteiro:** a `main` roda com carga longa (para os erros
> aparecerem); as demais rodam com `LOAD_DURATION=90s`, que já basta para todos os efeitos.
> Cada `make load` leva ~15 s de preparação + 30 s de baseline + a carga.

---

## Visão geral

| Tempo | Bloco | Branch | Máquina |
|---|---|---|---|
| 00:00–05:00 | Abertura e o sistema | — | Grafana parado |
| 05:00–16:00 | **A cascata** | `main` | ~4 min de carga (200 s) |
| 16:00–18:00 | "O que vocês fariam?" | — | — |
| 18:00–23:00 | Escalar a API | `fix/scale-out` | ~2,5 min |
| 23:00–28:00 | Retry | `fix/retry` | ~2,5 min |
| 28:00–30:00 | Virada: por que piorou? | — | — |
| 30:00–43:00 | Falhar rápido + isolar | `fix/timeouts` → `fix/bulkhead` | 3 × ~2,5 min |
| 43:00–49:00 | Tratar a causa | `fix/index` | ~2,5 min |
| 49:00–56:00 | Síntese | — | tabela-resumo |
| 56:00–60:00 | Perguntas e exercício | — | — |

---

## 00:00–05:00 · Abertura e o sistema

**Fale (1 min), o gancho:**
"Black Friday, 20h. O checkout cai. O post-mortem descobre que o culpado foi um relatório de vendas
que alguém do financeiro abriu: 2% do tráfego. Hoje vamos reproduzir isso ao vivo."

**Desenhe no quadro (2 min):**
```
k6 (clientes) ──► API (1 réplica, pool de 15) ──► Postgres (2 vCPU, max_connections 50)
```
- 4 rotas: produto 60%, criar pedido 25%, ver pedido 13%, **relatório 2%**.
- O relatório é uma query honesta de ORM: vendas por dia "no fuso de São Paulo",
  com `to_char(created_at …)` no `WHERE`. Isolado leva ~1 s. Ninguém acharia isso grave.

**Mostre o Grafana (2 min), um painel por vez:**
- Painel 1, p95 por rota. Painel 2, erro **visto pelo cliente**.
- **Painel 3 (o mais importante da aula):** a `API` mede separadamente o tempo **esperando uma
  conexão do pool** (tracejado) e o tempo **executando SQL** (sólido). Normalmente ninguém mede
  isso; `pool.query()` esconde a diferença.
- Painéis 4 (pool), 5 (Postgres), 6 (taxa enviada vs configurada).

---

## 05:00–16:00 · Bloco 1: a cascata (`main`)

**Antes de rodar, peça uma previsão (1 min):**
"Pool de 15 conexões, queries de 1 ms, 100 req/s. Entra um relatório de 1 s a 2 req/s.
O que acontece com a rota de produto? Mão levantada: nada / fica um pouco mais lenta / cai."

**T1:**
```bash
LOAD_DURATION=200s make load
```

**Durante a execução** (tempos contados a partir do início do baseline):

| Quando | Aponte | Fale |
|---|---|---|
| 0–30 s (baseline) | Painel 1: tudo em 1–2 ms | "Saudável. Guardem esse número." |
| ~30 s | O relatório entra | "Lembrem: só 2%." |
| +10–20 s | **Painel 1**: products sobe de 1 ms para **~8–9 s** | "Mil vezes mais lento. E a rota de produto nem toca na tabela de pedidos." |
| +20 s | **Painel 3**: products com o tracejado (fila) em segundos e o sólido (SQL) em **~2 ms** | **Momento-chave.** "O banco responde produto em 2 ms. O problema não é o banco ser lento para essa query: ela está numa **fila**." |
| +30 s | **Painel 4**: ativas = 15 (o máximo), "em espera" subindo sem parar | "As 15 conexões estão com relatórios. Todo o resto espera numa fila FIFO sem limite." |
| +30 s | **T2:** `make who` | 15 conexões `active`, todas rodando o `to_char`, a mais antiga com 10+ s. "Quem segura as conexões." |
| +40 s | **Painel 5**: Postgres com **17 de 50** | "O banco **não** está cheio. O gargalo é o pool, não o banco." |
| +60 s | **Painel 2**: **0% de erro** | Pergunte: "O sistema está bem?" Deixe responderem. "Sem erro ≠ saudável. Espera infinita não falha, só pendura." |
| +140 s | Painel 2: o relatório começa a falhar | "O primeiro erro, 2 minutos e 20 segundos depois do estrago." |
| +180–200 s | Painel 2: produto vai a **~90–100%** de erro | "Agora o cliente desistiu: timeout padrão de 60 s. Tudo o que estava na fila há mais de 1 minuto falha de uma vez." |

**Explique a causa com a fórmula (2 min, enquanto a carga termina):**
- Isolado: 2 relatórios/s × 1,1 s de CPU = **2,2 CPU·s por segundo, num banco de 2 vCPU**.
  Chega mais trabalho do que o banco consegue terminar → os relatórios se acumulam.
- Sob disputa, cada relatório passa a levar ~17 s: 2/s × 17 s = **34 conexões necessárias > 15**.
- Ao ocupar todo o pool, o relatório transforma a falta de CPU **dele** em fila para **todos**.

**Se der tempo:** abra `api/src/pools.js` da `main`: `max: 15`, `connectionTimeoutMillis: 0`.
"São os defaults do driver."

---

## 16:00–18:00 · "O que vocês fariam?"

Colete 4–6 respostas rápidas no quadro. Elas costumam cair em 4 grupos; mapeie cada uma:

| A turma diz | Vai para |
|---|---|
| "Escala a API / sobe mais pods / aumenta o pool" | `fix/scale-out` |
| "Retry / o cliente tenta de novo" | `fix/retry` |
| "Timeout / falhar rápido" | `fix/timeouts` |
| "Separar o relatório / réplica de leitura / fila" | `fix/bulkhead` |
| "Cria um índice!" | `fix/index`: "Vamos chegar lá. Mas e a **próxima** query lenta que ninguém conhece ainda?" |

"Vamos testar na ordem em que as empresas normalmente tentam."

---

## 18:00–23:00 · Bloco 2: escalar a API (`fix/scale-out`)

**Fale (30 s):** "4 réplicas. Cada uma com seu pool de 15." Mostre `DECISION.md` (só o título e a decisão).

**Previsão:** "Melhora, piora ou fica igual?"

**T1:**
```bash
git checkout fix/scale-out && make up && LOAD_DURATION=90s make load
```

| Quando | Aponte | Fale |
|---|---|---|
| +20–40 s | **Painel 5**: Postgres bate em **47–48**, encostado na linha de 50 | "4 × 15 = 60. O banco aceita 50 (3 reservadas para o superusuário)." |
| +40–60 s | **Painel 2**: **~45–50% de erro, em todas as rotas** | "Na `main`, nesse mesmo momento, era 0%." |
| +60 s | **T2:** `make logs` → `sorry, too many clients already` | |
| +60 s | Painel 1: o p95 de produto até "melhorou" (~100–180 ms) | Armadilha: "Melhorou? Não: metade agora falha **na hora** em vez de esperar. A falha mudou de forma." |

**Lição (1 min):** "O gargalo era o banco. Escalar a parte stateless empurrou mais pressão para o
recurso compartilhado e finito. **Réplicas × pool ≤ max_connections.**"

---

## 23:00–28:00 · Bloco 3: retry (`fix/retry`)

**Fale (30 s):** "Os clientes agora têm timeout de 3 s e tentam de novo até 3 vezes, na hora."
Mostre a função `send()` em `load/script.js` (o diff é só ela).

**Previsão:** "Quantas requisições por segundo chegam na API quando o sistema fica lento?"

**T1:**
```bash
git checkout fix/retry && make up && LOAD_DURATION=90s make load
```

| Quando | Aponte | Fale |
|---|---|---|
| +20 s | **Painel 6**: a linha vermelha (enviadas) descola da tracejada (configurada): **200/s** | "A carga dobrou. Exatamente quando o sistema está mais fraco." |
| +60 s | Painel 6: **~400/s = 4×** | "Cada requisição virou 4." |
| +20–40 s | **Painel 2**: **100% de erro** em todas as rotas | "Na `main` isso levou 2,5 min. Aqui, 20 s." |
| +60 s | **Painel 4**: "em espera" na casa das **dezenas de milhares** (na `main` foram ~3.500) | "O servidor não sabe que o cliente desistiu: as requisições abandonadas continuam na fila, na frente das novas." |

**Lição (1 min):** retry sem **backoff + jitter**, sem **orçamento de retry** e sem **circuit
breaker** é amplificação de carga. (Bônus: o painel 2 aqui conta erro **por tentativa**.)

---

## 28:00–30:00 · Virada: por que as duas pioraram?

Volte para a fórmula no quadro: `conexões = chegadas/s × tempo segurando`.
- Scale-out aumentou o **número de conexões** disputando o mesmo banco.
- Retry aumentou as **chegadas/s**.
- Nenhuma das duas mexeu no **tempo segurando a conexão**, que é o termo que explodiu.

"As próximas três decisões atacam a fórmula de verdade."

---

## 30:00–43:00 · Bloco 4: falhar rápido e isolar

### 30:00–35:00 · `fix/timeouts`

**Fale (30 s):** mostre o diff de `api/src/pools.js`: `connectionTimeoutMillis: 1000`,
`statement_timeout: 2000`; e `errors.js`: 503 imediato.

**T1:**
```bash
git checkout fix/timeouts && make up && LOAD_DURATION=90s make load
```

- **Painel 1:** produto **parado em 1 ms** a carga toda. "Resolvido?"
- **Painel 2:** só o relatório falha, **90–100%** (503).
- **Painel 3:** o SQL do relatório fica "achatado" em **2 s**, o teto do `statement_timeout`.
- Fórmula: 2/s × **2 s** = **4 conexões ≤ 15**. "Coube na conta."

### 35:00–38:00 · "Mas e se o relatório crescer?"

**Pergunte:** "Fim do mês, o financeiro inteiro abre o relatório: 8 por segundo. Fazendo a conta?"
(8 × 2 s = **16 > 15**.)

**T1** (mesma branch):
```bash
RATE_REPORT=8 LOAD_DURATION=90s make load
```

- **Painel 2:** a rota de **produto volta a falhar: 22–30%** (503, sem conexão no pool).
- **Painel 1:** p95 de produto em **~1,7 s**.
- "O timeout limita **quanto tempo** uma conexão fica presa. Não limita **quantas** uma carga pode prender."

### 38:00–43:00 · `fix/bulkhead`

**Fale (30 s):** "Dois pools: 3 conexões só para relatório, 12 para o resto. **O mesmo total de 15**:
não pedimos nada a mais ao banco." Explique a metáfora: compartimentos estanques de um navio.

**T1** (já com a carga pesada):
```bash
git checkout fix/bulkhead && make up && RATE_REPORT=8 LOAD_DURATION=90s make load
```

- **Painel 2:** produto, pedidos: **0,0% de erro**, com o relatório a 8/s.
- **Painel 4:** pool `reports` cheio (3/3) e com fila; pool `transactional` folgado.
- **Painel 1:** produto em 1–20 ms.
- "A falha ficou **confinada**. Mas repare: o relatório continua sem funcionar. Contivemos o sintoma."

---

## 43:00–49:00 · Bloco 5: tratar a causa (`fix/index`)

**Fale (1 min):** "Por que o relatório é lento? Seq scan em 3 milhões de pedidos, com `to_char()` em
cada linha." Mostre o diff de `api/src/routes.js`: **só criar o índice não adianta**; com função
na coluna o Postgres não usa o índice. O filtro vira um intervalo sobre `created_at`, e a função
passa a ser aplicada aos limites, não às linhas.

**T1** (a 1ª subida cria os índices, ~20 s: aproveite para explicar o índice covering):
```bash
git checkout fix/index && make up && LOAD_DURATION=90s make load
```

- **Painel 1:** relatório em **~150 ms** (o SQL em ~120 ms); produto em 1–2 ms.
- **Painel 2:** **0% de erro** em todas as rotas.
- Fórmula: 2/s × 0,12 s = **0,24 conexão**.

**Pergunta para a turma:** "Agora que o índice resolveu, podemos tirar os timeouts e o bulkhead?"
Resposta esperada: **não**. Eles protegem contra a **próxima** query lenta, que ainda não conhecemos.
O índice resolve **este** problema; os outros dois limitam o estrago do próximo.

---

## 49:00–56:00 · Síntese

Mostre a tabela "Resumo" do README e feche com 5 ideias:

1. **Recurso compartilhado + fila sem limite = cascata.** A rota mais lenta dita a latência de
   todas, porque todas esperam na mesma fila.
2. **Meça a fila separada do trabalho** (painel 3). Sem isso o diagnóstico vira "o banco está lento",
   e o banco respondia produto em 2 ms.
3. **Os consertos intuitivos aumentam a pressão:** scale-out multiplica conexões; retry multiplica
   chegadas. Antes de escalar, encontre o recurso finito.
4. **Proteções, em camadas:** timeout limita *quanto tempo*, bulkhead limita *quantas*,
   e a correção da causa reduz *o custo*. As três juntas.
5. **Teste de carga em modelo aberto.** Com VUs fixos o gerador desacelera junto com o sistema
   e a cascata nunca aparece no teste, só em produção.

---

## 56:00–60:00 · Perguntas e exercício

**Exercício para casa (escolha um):**
- Implemente retry **com backoff exponencial + jitter + orçamento** na `fix/retry` e mostre no
  painel 6 que a amplificação fica abaixo de 1,2×.
- Implemente um **circuit breaker** para o relatório na `fix/timeouts` e compare com o bulkhead.
- Calcule, com a Lei de Little, o tamanho mínimo do pool de relatório para que ele **funcione**
  na `fix/bulkhead` a 2 req/s (sem índice). Teste a sua resposta mudando `max` em `pools.js`.

---

## Se atrasar: o que cortar

| Atraso | Corte |
|---|---|
| 3–5 min | Na `main`, use `LOAD_DURATION=120s` e `Ctrl+C` depois do painel 5; só **cite** que os erros aparecem ~2,5 min depois |
| 5–8 min | `fix/retry`: não rode; mostre o vídeo/print do painel 6 e os números do README |
| 8+ min | `fix/timeouts`: pule a 1ª execução (carga normal) e vá direto para `RATE_REPORT=8` |
| Último recurso | `fix/index`: não rode; mostre o diff e a tabela-resumo |

**Para interromper uma execução** que já mostrou o efeito: `Ctrl+C` no T1. O próximo
`make load` recria a API e começa do zero.

## Se algo quebrar ao vivo

- Gráfico vazio / dados velhos: ajuste o intervalo para "últimos 5 min" e espere ~15 s.
- `make up` lento ou erro de porta: ver "Troubleshooting" no README.
- Qualquer coisa estranha por mais de 1 minuto: **mude para o vídeo** (Plano B) e siga o roteiro.
  O conteúdo da aula está nos gráficos, não em rodar ao vivo.
