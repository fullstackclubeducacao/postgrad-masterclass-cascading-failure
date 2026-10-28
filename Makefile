SHELL := /bin/bash
COMPOSE := docker compose

.PHONY: up load reset logs down pull who psql status

## Sobe a stack (Postgres, API, Prometheus, Grafana) e espera ficar saudável.
up:
	$(COMPOSE) up -d --build --wait --remove-orphans
	@echo ""
	@echo "Grafana:    http://localhost:$${GRAFANA_PORT:-$$(grep ^GRAFANA_PORT .env | cut -d= -f2)}"
	@echo "Prometheus: http://localhost:$${PROMETHEUS_PORT:-$$(grep ^PROMETHEUS_PORT .env | cut -d= -f2)}"

## Roda a carga do k6 (baseline -> relatório entra -> carga sustentada).
load:
	@# Aplica os índices da branch atual (caso tenha trocado de branch sem `make up`)...
	$(COMPOSE) run --rm --no-deps migrate
	@# ...e recria a API para cada execução começar do zero (sem fila nem conexões da rodada anterior).
	$(COMPOSE) up -d --build --wait --force-recreate --no-deps api
	$(COMPOSE) --profile load run --rm k6

## Recria o banco do zero (apaga o volume e refaz o seed: ~2 min).
reset:
	$(COMPOSE) --profile load down -v --remove-orphans
	$(MAKE) up

logs:
	$(COMPOSE) logs -f --tail=100 api postgres

down:
	$(COMPOSE) --profile load down --remove-orphans

## Baixa todas as imagens antes da aula (sem depender do Wi-Fi do auditório).
pull:
	$(COMPOSE) --profile load pull --ignore-buildable
	$(COMPOSE) build

## Quem está segurando as conexões do Postgres agora?
who:
	@$(COMPOSE) exec -T postgres psql -U postgres -d shop < scripts/who-holds-connections.sql

psql:
	$(COMPOSE) exec postgres psql -U postgres -d shop

status:
	$(COMPOSE) ps
