// Carga em MODELO ABERTO (constant-arrival-rate): as requisições chegam na taxa
// configurada não importa se o sistema está lento. Com VUs fixos (modelo fechado)
// o gerador desaceleraria junto com o sistema e esconderia a cascata.
import http from 'k6/http'
import { check } from 'k6'
import { Counter, Gauge } from 'k6/metrics'

const BASE = __ENV.BASE_URL || 'http://api:3000'
const BASELINE = __ENV.BASELINE_DURATION || '30s'
const LOAD = __ENV.LOAD_DURATION || '150s'
const MAX_VUS = Number(__ENV.MAX_VUS || 4000)
const TOTAL = `${seconds(BASELINE) + seconds(LOAD)}s`

const RATES = {
  products: Number(__ENV.RATE_PRODUCTS || 60),
  createOrder: Number(__ENV.RATE_CREATE_ORDER || 25),
  getOrder: Number(__ENV.RATE_GET_ORDER || 13),
  report: Number(__ENV.RATE_REPORT || 2),
}

// Taxa configurada, publicada como métrica para o painel 6 comparar com o que foi enviado.
const targetRps = new Gauge('target_rps')
// Conta cada requisição no momento do ENVIO (http_reqs só conta quando a resposta chega,
// o que esconde as requisições penduradas). Também conta cada retry.
const requestsSent = new Counter('requests_sent')

function scenario(exec, rate, route, extra = {}) {
  return {
    executor: 'constant-arrival-rate',
    exec,
    rate,
    timeUnit: '1s',
    duration: TOTAL,
    preAllocatedVUs: Math.max(5, rate * 2),
    maxVUs: MAX_VUS,
    tags: { route },
    ...extra,
  }
}

export const options = {
  discardResponseBodies: true,
  // Sem a tag `url` (ids aleatórios explodiriam a cardinalidade no Prometheus).
  systemTags: ['status', 'method', 'name', 'scenario', 'expected_response', 'error_code'],
  dns: { ttl: '5s', select: 'roundRobin' },
  scenarios: {
    products: scenario('getProduct', RATES.products, 'GET /products/:id'),
    create_order: scenario('createOrder', RATES.createOrder, 'POST /orders'),
    get_order: scenario('getOrder', RATES.getOrder, 'GET /orders/:id'),
    // O relatório só entra depois do baseline saudável.
    report: scenario('salesReport', RATES.report, 'GET /reports/sales', {
      startTime: BASELINE,
      duration: LOAD,
      preAllocatedVUs: 20,
    }),
  },
}

// ─── A DECISÃO DESTA BRANCH (fix/retry) ────────────────────────────────────
// Os clientes desistem depois de 3 s e tentam de novo, imediatamente, até 3 vezes.
// "Falhas transitórias se resolvem com retry."
const CLIENT_TIMEOUT = '3s'
const MAX_RETRIES = 3

function send(request) {
  let res
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    requestsSent.add(1)
    res = request({ timeout: CLIENT_TIMEOUT })
    if (res.status !== 0 && res.status < 500) return res // sucesso (ou erro do cliente): não repete
  }
  return res
}
// ──────────────────────────────────────────────────────────────────────────

const json = { headers: { 'Content-Type': 'application/json' } }
const rand = (min, max) => min + Math.floor(Math.random() * (max - min + 1))

export function getProduct() {
  targetRps.add(RATES.products)
  const id = rand(1, 10000)
  const res = send((p) => http.get(`${BASE}/products/${id}`, { ...p, tags: { name: 'GET /products/:id' } }))
  check(res, { ok: (r) => r.status === 200 })
}

export function createOrder() {
  targetRps.add(RATES.createOrder)
  const items = [1, 2, 3].map(() => ({ productId: rand(1, 10000), quantity: rand(1, 5) }))
  const body = JSON.stringify({ customerId: rand(1, 200000), items })
  const res = send((p) => http.post(`${BASE}/orders`, body, { ...json, ...p, tags: { name: 'POST /orders' } }))
  check(res, { created: (r) => r.status === 201 })
}

export function getOrder() {
  targetRps.add(RATES.getOrder)
  const id = rand(1, 3000000)
  const res = send((p) => http.get(`${BASE}/orders/${id}`, { ...p, tags: { name: 'GET /orders/:id' } }))
  check(res, { ok: (r) => r.status === 200 })
}

export function salesReport() {
  targetRps.add(RATES.report)
  // Uma semana aleatória de 2025.
  const start = new Date(Date.UTC(2025, 0, 1) + rand(0, 350) * 86400000)
  const end = new Date(start.getTime() + 6 * 86400000)
  const day = (d) => d.toISOString().slice(0, 10)
  const url = `${BASE}/reports/sales?from=${day(start)}&to=${day(end)}`
  const res = send((p) => http.get(url, { ...p, tags: { name: 'GET /reports/sales' } }))
  check(res, { ok: (r) => r.status === 200 })
}

function seconds(duration) {
  const m = /^(\d+)(s|m)$/.exec(duration)
  if (!m) throw new Error(`duração inválida: ${duration} (use ex.: 30s, 2m)`)
  return Number(m[1]) * (m[2] === 'm' ? 60 : 1)
}
