import Fastify from 'fastify'
import { httpDuration, registry } from './metrics.js'
import { routeOf, routes } from './routes.js'
import { toHttpError } from './errors.js'

const app = Fastify({ logger: { level: 'warn' } })

// onSend (e não onResponse): dispara mesmo quando o cliente já desistiu e fechou
// o socket — exatamente as requisições que mais interessam numa cascata.
app.addHook('onSend', async (req, reply) => {
  if (!req.routeOptions.url || ['/metrics', '/health'].includes(req.routeOptions.url)) return
  httpDuration.observe({ route: routeOf(req), status: reply.statusCode }, reply.elapsedTime / 1000)
})

app.setErrorHandler((err, req, reply) => {
  const { status, body } = toHttpError(err)
  if (status >= 500) req.log.warn({ route: routeOf(req), err: err.message }, 'request failed')
  reply.code(status).send(body)
})

app.get('/metrics', async (_req, reply) => {
  reply.type(registry.contentType)
  return registry.metrics()
})

app.get('/health', async () => ({ ok: true }))

await app.register(routes)
await app.listen({ host: '0.0.0.0', port: Number(process.env.PORT ?? 3000) })

for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => app.close().then(() => process.exit(0)))
