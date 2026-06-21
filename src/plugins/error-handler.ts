import fp from "fastify-plugin";
import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "../lib/errors";

interface ErrorBody {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
  requestId: string;
}

/**
 * Centralised error handling. Translates:
 *  - AppError subclasses        → their declared status/code
 *  - Fastify validation errors  → 400 VALIDATION_ERROR
 *  - rate-limit / known HTTP     → passed through
 *  - everything else            → 500 (message hidden in production)
 */
export default fp(
  async (app) => {
    app.setErrorHandler(
      (error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
        const requestId = request.id;

        if (error instanceof AppError) {
          const body: ErrorBody = {
            statusCode: error.statusCode,
            code: error.code,
            message: error.message,
            details: error.details,
            requestId,
          };
          return reply.status(error.statusCode).send(body);
        }

        if (error.validation) {
          const body: ErrorBody = {
            statusCode: 400,
            code: "VALIDATION_ERROR",
            message: "Request validation failed.",
            details: error.validation,
            requestId,
          };
          return reply.status(400).send(body);
        }

        const statusCode = error.statusCode ?? 500;
        if (statusCode >= 500) {
          request.log.error({ err: error }, "Unhandled error");
        }

        const body: ErrorBody = {
          statusCode,
          code: error.code ?? "INTERNAL_SERVER_ERROR",
          message:
            statusCode >= 500 && app.config.isProduction
              ? "Internal server error."
              : error.message,
          requestId,
        };
        return reply.status(statusCode).send(body);
      },
    );

    app.setNotFoundHandler((request, reply) => {
      reply.status(404).send({
        statusCode: 404,
        code: "NOT_FOUND",
        message: `Route ${request.method} ${request.url} not found.`,
        requestId: request.id,
      });
    });
  },
  { name: "error-handler" },
);
