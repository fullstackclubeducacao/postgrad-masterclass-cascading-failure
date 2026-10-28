import { withConnection } from './db.js'
import { pools } from './pools.js'

const DATE = /^\d{4}-\d{2}-\d{2}$/

export async function routes(app) {
  app.get('/products/:id', async (req, reply) => {
    const { rows } = await withConnection(pools.products, routeOf(req), (db) =>
      db.query('SELECT id, name, price_cents, description FROM products WHERE id = $1', [Number(req.params.id)]),
    )
    return rows[0] ?? reply.code(404).send({ error: 'not found' })
  })

  app.get('/orders/:id', async (req, reply) => {
    const { rows } = await withConnection(pools.orders, routeOf(req), (db) =>
      db.query(
        `SELECT o.id, o.customer_id, o.status, o.created_at,
                json_agg(json_build_object('product_id', oi.product_id, 'quantity', oi.quantity,
                                           'price_cents', oi.price_cents)) AS items
           FROM orders o
           JOIN order_items oi ON oi.order_id = o.id
          WHERE o.id = $1
          GROUP BY o.id`,
        [Number(req.params.id)],
      ),
    )
    return rows[0] ?? reply.code(404).send({ error: 'not found' })
  })

  app.post('/orders', async (req, reply) => {
    const { customerId, items } = req.body ?? {}
    if (!Number.isInteger(customerId) || !Array.isArray(items) || items.length === 0) {
      return reply.code(400).send({ error: 'customerId e items são obrigatórios' })
    }
    const order = await withConnection(pools.orders, routeOf(req), async (db) => {
      await db.query('BEGIN')
      try {
        const { rows } = await db.query(
          `INSERT INTO orders (customer_id, status, created_at, shipping_address)
           VALUES ($1, 'paid', now(), 'Rua da Demo, 42') RETURNING id, created_at`,
          [customerId],
        )
        await db.query(
          `INSERT INTO order_items (order_id, product_id, quantity, price_cents)
           SELECT $1, p.id, x.quantity, p.price_cents
             FROM unnest($2::int[], $3::int[]) AS x(product_id, quantity)
             JOIN products p ON p.id = x.product_id`,
          [rows[0].id, items.map((i) => i.productId), items.map((i) => i.quantity)],
        )
        await db.query('COMMIT')
        return rows[0]
      } catch (err) {
        await db.query('ROLLBACK').catch(() => {})
        throw err
      }
    })
    return reply.code(201).send(order)
  })

  // Relatório de vendas por dia (no fuso de São Paulo). O filtro aplica função
  // sobre created_at — além de não haver índice, o predicado não é "sargable":
  // o Postgres precisa calcular to_char() para cada uma das ~3 milhões de linhas.
  app.get('/reports/sales', async (req, reply) => {
    const { from, to } = req.query
    if (!DATE.test(from ?? '') || !DATE.test(to ?? '')) {
      return reply.code(400).send({ error: 'use ?from=YYYY-MM-DD&to=YYYY-MM-DD' })
    }
    const { rows } = await withConnection(pools.reports, routeOf(req), (db) =>
      db.query(
        `SELECT to_char(o.created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS day,
                count(DISTINCT o.id) AS orders,
                sum(oi.quantity * oi.price_cents) AS revenue_cents
           FROM orders o
           JOIN order_items oi ON oi.order_id = o.id
          WHERE to_char(o.created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') BETWEEN $1 AND $2
          GROUP BY 1
          ORDER BY 1`,
        [from, to],
      ),
    )
    return rows
  })
}

export function routeOf(req) {
  return `${req.method} ${req.routeOptions.url}`
}
