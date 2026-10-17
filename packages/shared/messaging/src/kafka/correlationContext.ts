import { AsyncLocalStorage } from 'async_hooks'

/**
 * Per-message correlation context for Kafka consumers.
 *
 * The consumers in this repo log with prefixed console lines, not a Fastify
 * request logger, so there is no child logger to bind. The lightest equivalent
 * is an AsyncLocalStorage store entered for the duration of one message: any
 * code the handler awaits (stores, publishers, helpers) can ask for the current
 * correlationId without it being threaded through every signature.
 */
export interface MessageContext {
  correlationId: string
  eventId: string
}

const storage = new AsyncLocalStorage<MessageContext>()

/** Runs `fn` with `ctx` as the current message context. */
export function runWithMessageContext<T>(ctx: MessageContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(ctx, fn)
}

export function currentMessageContext(): MessageContext | undefined {
  return storage.getStore()
}

/** `correlationId=<id>` while handling a message, else an empty string. */
export function correlationTag(): string {
  const ctx = storage.getStore()
  return ctx ? `correlationId=${ctx.correlationId}` : ''
}

/**
 * Appends the correlation tag to a log line: `msg [correlationId=...]`.
 * A no-op outside a message, so it is safe to use in code shared with HTTP paths.
 */
export function withCorrelationTag(message: string): string {
  const tag = correlationTag()
  return tag ? `${message} [${tag}]` : message
}
