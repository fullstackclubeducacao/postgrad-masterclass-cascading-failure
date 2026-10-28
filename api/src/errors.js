// main: qualquer falha vira 500. Ninguém pensou em falhar rápido — a requisição
// simplesmente espera até o banco responder.
export function toHttpError(err) {
  if (err.validation) return { status: 400, body: { error: err.message } }
  return { status: 500, body: { error: err.message } }
}
