# Roteiro da aula (60 min): falha em cascata por esgotamento de pool

Os tempos de execução abaixo foram medidos neste notebook. Os números esperados na tela estão no
README (seção "Roteiro por branch"); aqui está **o que fazer, o que explicar e o que falar,
minuto a minuto**.

**Como ler cada bloco:**
- **▶ Faça**: comandos e o que mostrar.
- **📖 Explique**: o conceito por trás, em frases que você pode ler quase em voz alta.
- **👀 Durante a execução**: o que aparece na tela, quando, e o que falar.
- **🆘 Se der branco**: uma frase só. Se você se perder, diga essa frase e siga para o próximo bloco.

No fim do arquivo há uma **cola de conceitos** (uma linha por conceito) e as **perguntas prováveis
da turma, com respostas**.

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
- [ ] Fórmula escrita no quadro: `conexões = chegadas/s × tempo segurando`.

> **Atalho de tempo usado neste roteiro:** a `main` roda com carga longa (para os erros
> aparecerem); as demais rodam com `LOAD_DURATION=90s`, que já basta para todos os efeitos.
> Cada `make load` leva ~15 s de preparação + 30 s de baseline + a carga.
>
> **Use o tempo de máquina a seu favor:** os ~30 s de preparação + baseline de cada execução são o
> momento de dar o 📖 Explique do bloco. Você raramente fica esperando em silêncio.

---

## Visão geral

| Tempo | Bloco | Branch | Máquina | Ideia central |
|---|---|---|---|---|
| 00:00–05:00 | Abertura e o sistema | — | Grafana parado | pool, fila, o que o painel 3 mede |
| 05:00–16:00 | **A cascata** | `main` | ~4 min de carga (200 s) | recurso compartilhado + fila sem limite |
| 16:00–18:00 | "O que vocês fariam?" | — | — | — |
| 18:00–23:00 | Escalar a API | `fix/scale-out` | ~2,5 min | o recurso finito é o banco |
| 23:00–28:00 | Retry | `fix/retry` | ~2,5 min | amplificação de carga |
| 28:00–30:00 | Virada: por que piorou? | — | — | a fórmula |
| 30:00–43:00 | Falhar rápido + isolar | `fix/timeouts` → `fix/bulkhead` | 3 × ~2,5 min | limitar *quanto tempo* e *quantas* |
| 43:00–49:00 | Tratar a causa | `fix/index` | ~2,5 min | reduzir *o custo* |
| 49:00–56:00 | Síntese | — | tabela-resumo | defesa em camadas |
| 56:00–60:00 | Perguntas e exercício | — | — | — |

---

## 00:00–05:00 · Abertura e o sistema

**▶ Faça: o gancho (1 min).**
"Black Friday, 20h. O checkout cai. O post-mortem descobre que o culpado foi um relatório de vendas
que alguém do financeiro abriu: 2% do tráfego. Hoje vamos reproduzir isso ao vivo."

**▶ Faça: desenhe no quadro (2 min).**
```
k6 (clientes) ──► API (1 réplica, pool de 15) ──► Postgres (2 vCPU, max_connections 50)
```
- 4 rotas: produto 60%, criar pedido 25%, ver pedido 13%, **relatório 2%**.
- O relatório é uma query honesta de ORM: vendas por dia "no fuso de São Paulo",
  com `to_char(created_at …)` no `WHERE`. Isolado leva ~1 s. Ninguém acharia isso grave.

**📖 Explique: o que é um pool de conexões (1 min).**
- Abrir uma conexão com o Postgres é caro: handshake TCP, autenticação e **um processo novo do
  Postgres por conexão**. Por isso a aplicação abre poucas conexões e as **reaproveita**: isso é o pool.
- Fluxo de cada requisição: **pede** uma conexão ao pool → **executa** o SQL → **devolve**.
- Se todas as conexões estão emprestadas, a requisição entra numa **fila** e espera alguém devolver.
- Aqui o pool tem **15 conexões** e o banco aceita até **50**. Guarde os dois números.
- Desenhe a fila na frente do pool:
  ```
  requisições ──► [ fila ] ──► pool (15) ──► Postgres
  ```
  "A aula inteira acontece nessa caixinha chamada fila."

**▶ Faça: mostre o Grafana (1 min), um painel por vez.**
- Painel 1, p95 por rota. Painel 2, erro **visto pelo cliente**.
- **Painel 3 (o mais importante da aula):** a `API` mede separadamente o tempo **esperando uma
  conexão do pool** (tracejado) e o tempo **executando SQL** (sólido).
- Painéis 4 (pool), 5 (Postgres), 6 (taxa enviada vs configurada).

**📖 Explique: por que o painel 3 é raro (30 s).**
- "O jeito normal de usar o driver é `pool.query(sql)`: ele pega a conexão, executa e devolve numa
  chamada só. O tempo que você mede é **fila + SQL somados**, e você não consegue separar."
- "Aqui usamos `pool.connect()` explicitamente e cronometramos as duas partes. Quando o p95
  explodir, esse painel vai dizer **se o banco está lento ou se estamos esperando na fila**."

**📖 Explique: p95 (15 s, se a turma não for de backend).**
"p95 = 95% das requisições foram mais rápidas que esse valor. Média esconde a cauda; o p95 mostra
o que o usuário azarado sente."

**🆘 Se der branco:** "Pool é um estacionamento com 15 vagas. Hoje vamos ver o que acontece quando
um carro grande estaciona e não sai mais."

---

## 05:00–16:00 · Bloco 1: a cascata (`main`)

**▶ Faça: peça uma previsão antes de rodar (1 min).**
"Pool de 15 conexões, queries de 1 ms, 100 req/s. Entra um relatório de 1 s a 2 req/s.
O que acontece com a rota de produto? Mão levantada: nada / fica um pouco mais lenta / cai."

**T1:**
```bash
LOAD_DURATION=200s make load
```

**📖 Explique: o gerador de carga, enquanto a preparação e o baseline rodam (1 min).**
- "O k6 está mandando **taxa fixa**: 60 req/s de produto, 25 de criar pedido, 13 de ver pedido.
  Nos primeiros 30 s, sem o relatório. Depois entra o relatório a 2 req/s."
- "Detalhe importante: é **modelo aberto**. O k6 manda a próxima requisição no horário,
  **mesmo que a anterior ainda não tenha voltado**. É assim que usuário de verdade se comporta:
  ninguém espera o outro cliente terminar para clicar."
- "Se fosse modelo fechado (N usuários virtuais em loop), quando o sistema ficasse lento os
  usuários também mandariam menos, e a cascata se esconderia. Muitos testes de carga mentem por isso."

**👀 Durante a execução** (tempos contados a partir do início do baseline):

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

**📖 Explique: o mecanismo da cascata, passo a passo (3 min, enquanto a carga roda depois de +60 s).**
Conte como uma história, desenhando no quadro:

1. **O banco tem 2 CPUs.** Cada relatório gasta ~1,1 s de CPU. Chegam 2 por segundo:
   2 × 1,1 = **2,2 segundos de CPU pedidos a cada segundo, para 2 CPUs**. Chega mais trabalho do
   que o banco consegue terminar.
2. **Trabalho que não termina se acumula.** Os relatórios começam a rodar ao mesmo tempo, dividindo
   as 2 CPUs. Com 15 relatórios simultâneos, cada um recebe ~2/15 de CPU e leva **10–17 s** em vez
   de 1 s. Quanto mais lentos, mais se acumulam; quanto mais se acumulam, mais lentos ficam.
   Isso é o **ciclo de realimentação** da cascata.
3. **A Lei de Little fecha a conta:** 2 relatórios/s × 17 s cada = **34 conexões necessárias**.
   O pool só tem 15. Então **todas as 15 ficam com relatórios**.
4. **A rota de produto não tem culpa, mas paga a conta.** Ela precisa de uma conexão por 2 ms, mas
   não há conexão livre. Ela entra na **mesma fila** que os relatórios, atrás deles.
   A fila é FIFO e **não tem limite** (`connectionTimeoutMillis: 0` = esperar para sempre).
5. **Por isso o painel 3 mostra SQL em 2 ms e fila em segundos.** O banco continua rápido para a
   query de produto; o tempo todo é espera.
6. **Por que demora para dar erro?** Ninguém do lado do servidor desiste. Quem desiste é o
   **cliente**, quando bate o timeout dele (60 s no k6). Até lá, tudo "funciona", só que lento.

Frase-resumo: **"O relatório transformou a falta de CPU dele em fila para todo mundo."**

**▶ Se der tempo:** abra `api/src/pools.js` da `main`: `max: 15`, `connectionTimeoutMillis: 0`.
"São os defaults do driver. Ninguém escolheu isso conscientemente."

**🆘 Se der branco:** "Uma rota lenta ocupou todas as conexões e as rápidas ficaram na fila atrás
dela. O banco não está lento; a fila está."

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

**📖 Explique (15 s):** "Cada branch é uma decisão real com um `DECISION.md`: o que foi decidido,
por que parecia certo e qual o efeito colateral. Arquitetura é isso: toda decisão tem um custo,
e o custo geralmente aparece em outro lugar."

---

## 18:00–23:00 · Bloco 2: escalar a API (`fix/scale-out`)

**▶ Faça (30 s):** "4 réplicas. Cada uma com seu pool de 15." Mostre `DECISION.md` (só o título e a decisão).

**Previsão:** "Melhora, piora ou fica igual?"

**T1:**
```bash
git checkout fix/scale-out && make up && LOAD_DURATION=90s make load
```

**📖 Explique: por que parece certo e onde está a armadilha (1 min, durante a preparação).**
- "Por que parece certo: a API estava lenta, então damos mais API. No Kubernetes é uma linha
  (`replicas: 4`) e o autoscaler faria isso sozinho quando a latência subisse."
- "A API é **stateless**: escala bem. Mas cada réplica traz **o próprio pool de 15**.
  4 × 15 = **60 conexões** apontando para um banco que aceita **50**."
- "E mesmo que coubessem: o problema era **CPU do banco**. Mais conexões = mais relatórios
  rodando ao mesmo tempo nas mesmas 2 CPUs = cada um mais lento."

**👀 Durante a execução:**

| Quando | Aponte | Fale |
|---|---|---|
| +20–40 s | **Painel 5**: Postgres bate em **47–48**, encostado na linha de 50 | "4 × 15 = 60. O banco aceita 50 (3 reservadas para o superusuário)." |
| +40–60 s | **Painel 2**: **~45–50% de erro, em todas as rotas** | "Na `main`, nesse mesmo momento, era 0%." |
| +60 s | **T2:** `make logs` → `sorry, too many clients already` | "Esse é o Postgres recusando a conexão nova." |
| +60 s | Painel 1: o p95 de produto até "melhorou" (~100–180 ms) | Armadilha: "Melhorou? Não: metade agora falha **na hora** em vez de esperar. A falha mudou de forma." |

**📖 Explique: a lição (1 min).**
- "Escalar a parte stateless **empurrou a pressão para o recurso compartilhado e finito**: o banco."
- Regra prática no quadro: **réplicas × tamanho do pool ≤ max_connections** (menos as reservadas).
- "Com autoscaler é pior: quanto mais lento, mais réplicas sobem, mais conexões, mais lento.
  É o mesmo ciclo de realimentação, agora automatizado."
- "Antes de escalar qualquer coisa, pergunte: **qual é o recurso finito que todo mundo divide?**"

**🆘 Se der branco:** "Mais API não cria mais banco. 4 réplicas × 15 conexões = 60, e o banco só
aceita 50."

---

## 23:00–28:00 · Bloco 3: retry (`fix/retry`)

**▶ Faça (30 s):** "Os clientes agora têm timeout de 3 s e tentam de novo até 3 vezes, na hora."
Mostre a função `send()` em `load/script.js` (o diff é só ela).

**Previsão:** "Quantas requisições por segundo chegam na API quando o sistema fica lento?"

**T1:**
```bash
git checkout fix/retry && make up && LOAD_DURATION=90s make load
```

**📖 Explique: por que parece certo e onde está a armadilha (1 min, durante a preparação).**
- "Por que parece certo: falha de rede é passageira; tentar de novo resolve. Toda biblioteca HTTP
  tem retry, e muitas vêm com ele ligado."
- "Agora façam a conta: se o sistema está lento e **toda** requisição estoura o timeout de 3 s,
  cada requisição vira **1 + 3 = 4 tentativas**. A carga quadruplica **justamente quando o
  sistema está mais fraco**."
- "E tem um detalhe cruel: quando o cliente desiste depois de 3 s, **o servidor não fica sabendo**.
  A requisição abandonada continua na fila do pool, esperando uma conexão, para um cliente que já
  foi embora. E a nova tentativa entra **atrás** dela."

**👀 Durante a execução:**

| Quando | Aponte | Fale |
|---|---|---|
| +20 s | **Painel 6**: a linha vermelha (enviadas) descola da tracejada (configurada): **200/s** | "A carga dobrou. Exatamente quando o sistema está mais fraco." |
| +60 s | Painel 6: **~400/s = 4×** | "Cada requisição virou 4." |
| +20–40 s | **Painel 2**: **100% de erro** em todas as rotas | "Na `main` isso levou 2,5 min. Aqui, 20 s." |
| +60 s | **Painel 4**: "em espera" na casa das **dezenas de milhares** (na `main` foram ~3.500) | "O servidor não sabe que o cliente desistiu: as requisições abandonadas continuam na fila, na frente das novas." |

**📖 Explique: a lição (1 min).**
- Esse fenômeno tem nome: **retry storm** (tempestade de retries).
- Retry não é proibido; retry **ingênuo** é. Um retry seguro tem:
  - **backoff exponencial**: esperar 100 ms, 200 ms, 400 ms… em vez de tentar na hora;
  - **jitter**: um valor aleatório no tempo de espera, para os clientes não voltarem todos juntos;
  - **orçamento de retry**: no máximo ~10% de requisições extras; acima disso, para de tentar;
  - **circuit breaker**: se a maioria está falhando, para de chamar por um tempo.
- E só se faz retry de operação **idempotente**. `POST /orders` com retry pode criar pedido duplicado.
- (Bônus: o painel 2 aqui conta erro **por tentativa**, não por usuário.)

**🆘 Se der branco:** "Retry sem freio multiplica a carga por 4 no pior momento possível."

---

## 28:00–30:00 · Virada: por que as duas pioraram?

**📖 Explique, apontando para a fórmula no quadro:** `conexões = chegadas/s × tempo segurando`.
- Scale-out aumentou o **número de conexões** disputando o mesmo banco.
- Retry aumentou as **chegadas/s**.
- Nenhuma das duas mexeu no **tempo segurando a conexão**, que é o termo que explodiu
  (de 1 s para 17 s).
- "Os dois consertos trataram o sintoma (lentidão) com **mais pressão**. As próximas três
  decisões fazem o contrário: **limitam** a pressão."

Escreva no quadro, um embaixo do outro (você vai preencher durante os próximos blocos):
```
timeout   → limita QUANTO TEMPO uma conexão fica presa
bulkhead  → limita QUANTAS conexões uma rota pode prender
índice    → reduz O CUSTO de cada query
```

**🆘 Se der branco:** "Nenhum dos dois diminuiu o tempo que o relatório segura a conexão. E esse é
o número que importa na fórmula."

---

## 30:00–43:00 · Bloco 4: falhar rápido e isolar

### 30:00–35:00 · `fix/timeouts`

**▶ Faça (30 s):** mostre o diff de `api/src/pools.js`: `connectionTimeoutMillis: 1000`,
`statement_timeout: 2000`; e `errors.js`: 503 imediato.

**T1:**
```bash
git checkout fix/timeouts && make up && LOAD_DURATION=90s make load
```

**📖 Explique: os dois timeouts (1,5 min, durante a preparação).**
- **`connectionTimeoutMillis: 1000`**: "se em 1 s não aparecer conexão livre no pool, desiste e
  responde erro". **Limita o tempo na fila.** A fila deixa de ser infinita.
- **`statement_timeout: 2000`**: configuração do **Postgres**: "se uma query passar de 2 s, o
  próprio banco a cancela". **Limita o tempo segurando a conexão.** É o termo que tinha explodido.
- **Por que 503 e não 500:** 500 diz "eu quebrei". 503 diz "estou sobrecarregado, tente mais
  tarde". Load balancers, gateways e clientes bem-feitos tratam os dois de forma diferente.
- O nome do padrão é **fail fast** (falhar rápido): "um não em 1 ms é melhor que um sim em 60 s.
  Erro rápido libera recursos; espera longa prende recursos."
- Pela fórmula: 2 relatórios/s × **no máximo 2 s** = **no máximo 4 conexões**. Cabe nas 15.

**👀 Durante a execução:**
- **Painel 1:** produto **parado em 1 ms** a carga toda. "Resolvido?"
- **Painel 2:** só o relatório falha, **90–100%** (503).
- **Painel 3:** o SQL do relatório fica "achatado" em **2 s**, o teto do `statement_timeout`.
- Fórmula: 2/s × **2 s** = **4 conexões ≤ 15**. "Coube na conta."

**📖 Explique (30 s):** "Repare no que fizemos: **decidimos quem falha**. Antes falhava todo mundo;
agora falha só o relatório. Isso é uma decisão de negócio: o checkout vale mais que o relatório."

### 35:00–38:00 · "Mas e se o relatório crescer?"

**Pergunte:** "Fim do mês, o financeiro inteiro abre o relatório: 8 por segundo. Fazendo a conta?"
(8 × 2 s = **16 > 15**.)

**T1** (mesma branch):
```bash
RATE_REPORT=8 LOAD_DURATION=90s make load
```

**👀 Durante a execução:**
- **Painel 2:** a rota de **produto volta a falhar: 22–30%** (503, sem conexão no pool).
- **Painel 1:** p95 de produto em **~1,7 s**.

**📖 Explique (1 min):**
- "O timeout limita **quanto tempo** uma conexão fica presa. Não limita **quantas** uma rota pode
  prender."
- "A 8/s, os relatórios voltam a ocupar o pool inteiro, mesmo morrendo a cada 2 s: um morre, outro
  entra no lugar. O produto espera 1 s, não acha conexão e recebe 503."
- "Timeout é necessário, mas sozinho não basta. Falta um limite de **quantidade**."

**🆘 Se der branco:** "Timeout limita quanto tempo. Não limita quantas."

### 38:00–43:00 · `fix/bulkhead`

**▶ Faça (30 s):** "Dois pools: 3 conexões só para relatório, 12 para o resto. **O mesmo total de 15**:
não pedimos nada a mais ao banco."

**T1** (já com a carga pesada):
```bash
git checkout fix/bulkhead && make up && RATE_REPORT=8 LOAD_DURATION=90s make load
```

**📖 Explique: o padrão bulkhead (1,5 min, durante a preparação).**
- **A metáfora:** bulkhead é a antepara de um navio, a parede que divide o casco em compartimentos
  estanques. Se um compartimento inunda, o navio não afunda. (O Titanic tinha anteparas, mas elas
  não iam até o teto: a água passou por cima.)
- **No software:** cada tipo de carga ganha **o seu próprio recurso limitado**. O relatório pode
  esgotar as 3 conexões dele; ele **não consegue** tocar nas 12 das rotas transacionais.
- **Por que 3 e 12:** a rota de produto e as de pedido precisam de ~100 req/s × ~3 ms ≈ **0,3
  conexão** em média. 12 é folga de sobra. O relatório recebe pouco **de propósito**: é o
  compartimento que aceitamos perder.
- **Outros bulkheads que vocês já viram:** pool de threads separado por dependência, réplica de
  leitura só para relatórios, fila separada por cliente, limite de CPU por container.

**👀 Durante a execução:**
- **Painel 2:** produto, pedidos: **0,0% de erro**, com o relatório a 8/s.
- **Painel 4:** pool `reports` cheio (3/3) e com fila; pool `transactional` folgado.
- **Painel 1:** produto em 1–20 ms.
- "A falha ficou **confinada**. Mas repare: o relatório continua sem funcionar. Contivemos o sintoma."

**📖 Explique (30 s):** "Timeout e bulkhead são **contenção**: não deixam o problema se espalhar.
Mas o financeiro continua sem relatório. Falta tratar a causa."

**🆘 Se der branco:** "Cada rota com o seu compartimento. O relatório pode afundar o dele, não o
dos outros."

---

## 43:00–49:00 · Bloco 5: tratar a causa (`fix/index`)

**▶ Faça (30 s):** mostre o diff de `api/src/routes.js` (a query) e de `db/branch.sql` (os índices).

**T1** (a 1ª subida cria os índices, ~20 s: é o tempo de dar o 📖 Explique abaixo):
```bash
git checkout fix/index && make up && LOAD_DURATION=90s make load
```

**📖 Explique: por que o relatório era lento e por que "só criar o índice" não basta (2 min).**
- **Seq scan:** sem índice em `created_at`, para achar 7 dias de pedidos o Postgres lê **os 3
  milhões de linhas** e testa uma por uma.
- **O detalhe que pega muita gente:** a query original era
  `WHERE to_char(created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') BETWEEN $1 AND $2`.
  Um índice em `created_at` guarda os valores **de `created_at`**, não os de `to_char(...)`.
  Com uma função aplicada na coluna, o banco **não consegue usar o índice**: precisa calcular a
  função em todas as linhas. O nome técnico é condição **não-sargable**.
- **A correção:** levar a função para o **outro lado** da comparação. Converte-se o *período*
  para timestamp uma vez, e a coluna fica "pura":
  `WHERE created_at >= (início em SP) AND created_at < (fim em SP)`.
  Mesmo resultado; agora o índice serve. A função roda 2 vezes (nos limites), não 3 milhões.
- **O índice covering** em `order_items(order_id) INCLUDE (quantity, price_cents)`: o índice já
  carrega as colunas que a soma precisa, então o banco responde **só lendo o índice**, sem ir à
  tabela (index-only scan). Por isso o `VACUUM`: ele atualiza o mapa que diz ao Postgres quais
  páginas podem ser lidas só pelo índice.
- "Moral: índice é metade da história. **A query precisa ser escrita de um jeito que o índice
  possa ser usado.** Sempre confira com `EXPLAIN`."

**👀 Durante a execução:**
- **Painel 1:** relatório em **~150 ms** (o SQL em ~120 ms); produto em 1–2 ms.
- **Painel 2:** **0% de erro** em todas as rotas.
- Fórmula: 2/s × 0,12 s = **0,24 conexão**. "De 34 conexões necessárias para 0,24."

**Pergunta para a turma:** "Agora que o índice resolveu, podemos tirar os timeouts e o bulkhead?"
Resposta esperada: **não**. Eles protegem contra a **próxima** query lenta, que ainda não conhecemos.
O índice resolve **este** problema; os outros dois limitam o estrago do próximo.

**📖 Explique (30 s):** "O índice também tem custo: cada `INSERT` em pedidos agora atualiza mais
um índice, e ele ocupa disco. Em tabelas com muita escrita, isso pesa. De novo: decisão → custo."

**🆘 Se der branco:** "Função na coluna impede o índice. Mudamos a query para comparar a coluna
pura, e o relatório caiu de 17 s para 0,12 s."

---

## 49:00–56:00 · Síntese

Mostre a tabela "Resumo" do README e feche com 5 ideias:

1. **Recurso compartilhado + fila sem limite = cascata.** A rota mais lenta dita a latência de
   todas, porque todas esperam na mesma fila.
   *Explique:* "Procurem no sistema de vocês: o que todas as rotas dividem? Pool de conexões, pool
   de threads, CPU do banco, um serviço comum. Cada um é um ponto de cascata."
2. **Meça a fila separada do trabalho** (painel 3). Sem isso o diagnóstico vira "o banco está lento",
   e o banco respondia produto em 2 ms.
   *Explique:* "Sem esse painel, o time teria aumentado a máquina do banco, e não teria resolvido."
3. **Os consertos intuitivos aumentam a pressão:** scale-out multiplica conexões; retry multiplica
   chegadas. Antes de escalar, encontre o recurso finito.
4. **Proteções, em camadas:** timeout limita *quanto tempo*, bulkhead limita *quantas*,
   e a correção da causa reduz *o custo*. As três juntas.
   *Explique:* "É defesa em profundidade, como em segurança. A causa você corrige uma por vez;
   as proteções valem para as causas que você ainda não conhece."
5. **Teste de carga em modelo aberto.** Com VUs fixos o gerador desacelera junto com o sistema
   e a cascata nunca aparece no teste, só em produção.

**Frase de encerramento:** "Toda decisão de arquitetura tem um efeito colateral. O trabalho de
vocês não é evitar efeitos colaterais; é **escolher quais aceitar** e **medir para vê-los**."

---

## 56:00–60:00 · Perguntas e exercício

**Exercício para casa (escolha um):**
- Implemente retry **com backoff exponencial + jitter + orçamento** na `fix/retry` e mostre no
  painel 6 que a amplificação fica abaixo de 1,2×.
- Implemente um **circuit breaker** para o relatório na `fix/timeouts` e compare com o bulkhead.
- Calcule, com a Lei de Little, o tamanho mínimo do pool de relatório para que ele **funcione**
  na `fix/bulkhead` a 2 req/s (sem índice). Teste a sua resposta mudando `max` em `pools.js`.
  *Pista para você (não conte à turma):* a conta de CPU do bloco 1 (2/s × 1,1 s = 2,2 CPU·s/s
  para 2 CPUs) indica que **nenhum** tamanho de pool resolve sem índice: o limite é a CPU do
  banco, não o pool. Um pool maior só deixa cada relatório mais lento. É uma boa discussão para a
  próxima aula. (Esta conclusão vem da conta, não foi medida aqui; confira antes de usar como
  gabarito.)

---

## Cola de conceitos (uma linha cada)

| Conceito | Em uma frase |
|---|---|
| Pool de conexões | Conexões abertas e reaproveitadas, porque abrir uma é caro; quem não acha conexão livre espera numa fila |
| Lei de Little | Itens no sistema = taxa de chegada × tempo de permanência. 2/s × 17 s = 34 conexões |
| Falha em cascata | Uma parte lenta consome um recurso compartilhado e as outras partes falham por falta dele |
| Fila sem limite | Não falha, só pendura: a latência cresce até o cliente desistir |
| Modelo aberto vs fechado | Aberto: chegadas não dependem das respostas (usuários reais). Fechado: N usuários em loop, desaceleram junto com o sistema |
| p95 | 95% das requisições foram mais rápidas que esse valor |
| `max_connections` | Limite de conexões do Postgres; cada conexão é um processo no servidor |
| Retry storm | Retries multiplicam a carga justamente quando o sistema está lento |
| Backoff + jitter | Esperar cada vez mais entre tentativas, com um componente aleatório |
| Circuit breaker | Depois de muitas falhas, para de chamar por um tempo e falha na hora |
| Fail fast | Erro rápido libera recursos; espera longa prende recursos |
| `connectionTimeoutMillis` | Tempo máximo esperando uma conexão do pool (na `main`, 0 = infinito) |
| `statement_timeout` | O Postgres cancela a query que passar desse tempo |
| 503 vs 500 | 503: sobrecarregado, tente depois. 500: erro interno |
| Bulkhead | Recursos separados por tipo de carga, para uma não afundar a outra |
| Seq scan | Ler a tabela inteira, linha por linha |
| Sargable | Condição que permite usar índice: a coluna aparece "pura", sem função em volta |
| Índice covering | Índice que já contém as colunas que a query precisa: nem vai na tabela |

---

## Perguntas prováveis da turma (com respostas)

**"Por que não aumentar o pool para 50?"**
Porque o gargalo é a CPU do banco. Com 50 conexões, rodariam mais relatórios ao mesmo tempo nas
mesmas 2 CPUs, cada um ainda mais lento, e o pool encheria do mesmo jeito (a fórmula pede 34 e
cresce). Aumentar o pool só desloca a fila da aplicação para dentro do banco. O scale-out mostrou
isso: mais conexões, resultado pior.

**"PgBouncer resolveria?"**
Resolveria o `too many clients` do scale-out: ele multiplexa muitas conexões de aplicação em poucas
conexões reais no banco. Não resolveria a cascata: a fila só muda de lugar (vai para o PgBouncer),
e a CPU do banco continua sendo dividida com os relatórios.

**"E uma réplica de leitura para o relatório?"**
É um bulkhead no nível de infraestrutura, e é uma ótima resposta. Custo: mais uma máquina, e o
relatório passa a ler dados com algum atraso (replication lag). Para relatório, geralmente aceitável.

**"E cache?"**
Ajuda se o mesmo relatório for pedido muitas vezes. Aqui cada pedido usa um período diferente, então
o cache quase não acertaria. E cache vazio (depois de um deploy, por exemplo) traz a cascata de volta.

**"Por que o timeout do cliente era 60 s?"**
É o padrão do k6, e muitos clientes HTTP têm padrões parecidos ou nenhum timeout. Na `main`,
os erros só aparecem quando a espera na fila passa de 60 s; por isso demoram ~2,5 min.

**"Circuit breaker não é a mesma coisa que bulkhead?"**
Não. Bulkhead limita **quantos** recursos uma carga usa, o tempo todo. Circuit breaker **para de
chamar** uma dependência que está falhando, por um tempo. São complementares: o bulkhead impede o
relatório de afundar o produto; o circuit breaker evitaria até tentar o relatório enquanto ele está
quebrado.

**"Por que o servidor não cancela a requisição quando o cliente desiste?"**
A maioria dos frameworks (Fastify incluído, por padrão) não cancela o trabalho quando o cliente
fecha a conexão. Dá para fazer, propagando um sinal de cancelamento até a query, mas é raro.
Por isso, no `fix/retry`, a fila do servidor fica cheia de requisições que ninguém mais espera.

**"Isso acontece com MongoDB / MySQL / outro banco?"**
Sim. O mecanismo é o pool de conexões e a fila na frente dele, não o Postgres. O mesmo vale para
pool de threads, conexões HTTP para outro serviço, ou qualquer recurso limitado compartilhado.

**"Por que limitar o Postgres a 2 vCPUs?"**
Para a demo ser reproduzível num notebook: um banco de produção pequeno tem 2–4 vCPUs. Com mais CPU,
basta mais tráfego de relatório para a mesma cascata aparecer.

**Pergunta que você não sabe responder:** "Ótima pergunta. Não sei de cabeça. Anoto e respondo no
grupo da turma." Anote e siga.

---

## Se atrasar: o que cortar

| Atraso | Corte |
|---|---|
| 3–5 min | Na `main`, use `LOAD_DURATION=120s` e `Ctrl+C` depois do painel 5; só **cite** que os erros aparecem ~2,5 min depois |
| 5–8 min | `fix/retry`: não rode; mostre o vídeo/print do painel 6 e os números do README |
| 8+ min | `fix/timeouts`: pule a 1ª execução (carga normal) e vá direto para `RATE_REPORT=8` |
| Último recurso | `fix/index`: não rode; mostre o diff e a tabela-resumo |

Os 📖 Explique dos blocos cortados **não devem ser cortados**: fale por cima do vídeo ou do print.
O conteúdo está na explicação; a execução é a prova.

**Para interromper uma execução** que já mostrou o efeito: `Ctrl+C` no T1. O próximo
`make load` recria a API e começa do zero.

## Se algo quebrar ao vivo

- Gráfico vazio / dados velhos: ajuste o intervalo para "últimos 5 min" e espere ~15 s.
- `make up` lento ou erro de porta: ver "Troubleshooting" no README.
- Qualquer coisa estranha por mais de 1 minuto: **mude para o vídeo** (Plano B) e siga o roteiro.
  O conteúdo da aula está nos gráficos, não em rodar ao vivo.
