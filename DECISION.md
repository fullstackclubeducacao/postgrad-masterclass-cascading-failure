# `fix/scale-out` — "falta capacidade, vamos escalar a API"

## Decisão
Subir a API de 1 para **4 réplicas** (`deploy.replicas: 4` no `docker-compose.yml`).
Cada réplica mantém o seu pool de 15 conexões. Nada mais mudou.

## Por que parece certa
- A latência explodiu e a API "não dá conta": escalar horizontalmente é o reflexo padrão.
- Stateless, atrás de um balanceador — é para isso que serve.
- 4× mais réplicas = 4× mais conexões = 4× mais relatórios em paralelo. Deve resolver.

## Efeito colateral esperado
4 × 15 = **60 conexões possíveis** contra um Postgres com `max_connections = 50`
(e 3 delas reservadas para superusuário). Sob carga os pools tentam crescer, o Postgres recusa:
`FATAL: sorry, too many clients already`. Rotas que antes só esperavam agora **falham**, em
todas as réplicas. E as conexões que existem estão ocupadas por **mais** relatórios simultâneos
disputando as mesmas 2 vCPUs — cada relatório fica ainda mais lento.
O gargalo nunca foi a API: era o banco. Escalar a API apenas o empurrou para o banco.

## Onde olhar no Grafana
- **Painel 5**: conexões do Postgres batem na linha de `max_connections`.
- **Painel 2**: taxa de erro sobe já no primeiro minuto (na `main` o primeiro erro levava ~2 min).
- **Painel 4**: a soma dos pools (4 réplicas) passa de 15 para o limite do banco.
- `make logs` → `sorry, too many clients already`.

## Lição
Escalar um componente stateless na frente de um recurso compartilhado e finito multiplica a
pressão sobre esse recurso. Pool size × réplicas precisa caber no banco.
