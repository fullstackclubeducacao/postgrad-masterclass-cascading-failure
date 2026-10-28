# `fix/retry` — "os clientes devem tentar de novo"

## Decisão
Os clientes (simulados no k6, `load/script.js`) passam a ter **timeout de 3 s** e, em caso de
timeout ou 5xx, fazem **até 3 retries imediatos**. A API e o banco são os mesmos da `main`.

## Por que parece certa
- "Falhas são transitórias": retry é a primeira coisa que qualquer SDK/HTTP client oferece.
- Timeout de 3 s parece até conservador para uma API de catálogo.
- Cada tentativa individual tem mais chance de pegar a API num momento bom.

## Efeito colateral esperado
Quando a latência passa de 3 s (o que na `main` acontece ~20 s depois que o relatório entra),
**toda** requisição estoura o timeout e vira até 4 requisições. A carga oferecida ao sistema
mais que dobra — exatamente quando ele está mais fraco. E o servidor não sabe que o cliente
desistiu: as requisições abandonadas continuam na fila do pool, ocupando o lugar das novas.
É uma **tempestade de retries**: o sistema colapsa mais cedo e não se recupera enquanto a carga dura.

## Onde olhar no Grafana
- **Painel 6**: "enviadas (inclui retries)" descola da linha "configurada" e passa de **2×**.
- **Painel 4**: "em espera" cresce bem mais rápido que na `main`.
- **Painel 2**: 100% de erro, também nas rotas rápidas, bem antes do que na `main`.

## Lição
Retry sem backoff, sem jitter, sem orçamento (retry budget) e sem circuit breaker é amplificação
de carga. Na pior hora possível.
