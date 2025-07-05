/**
 * Type definitions for fastify-sse-v2
 */

declare module 'fastify-sse-v2' {
  import { FastifyPluginCallback } from 'fastify';

  interface SSEMessage {
    id?: string;
    event?: string;
    data: string;
    retry?: number;
  }

  interface FastifySSEOptions {
    retryDelay?: number;
  }

  interface SSESource {
    push(message: SSEMessage): void;
  }

  declare module 'fastify' {
    interface FastifyReply {
      sse(generator: (source: SSESource) => Promise<void> | void): void;
    }
  }

  const fastifySSE: FastifyPluginCallback<FastifySSEOptions>;
  export default fastifySSE;
}
