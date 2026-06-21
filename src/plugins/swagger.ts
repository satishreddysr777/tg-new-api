import fp from "fastify-plugin";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";

/** OpenAPI document + interactive docs at /docs (non-production only). */
export default fp(
  async (app) => {
    if (app.config.isProduction) return;

    await app.register(swagger, {
      openapi: {
        info: {
          title: "Technograph API",
          description:
            "Backend for the Technograph employee portal & console.",
          version: "0.1.0",
        },
        components: {
          securitySchemes: {
            bearerAuth: {
              type: "http",
              scheme: "bearer",
              bearerFormat: "JWT",
            },
          },
        },
      },
    });

    await app.register(swaggerUi, {
      routePrefix: "/docs",
      uiConfig: { docExpansion: "list", deepLinking: true },
    });
  },
  { name: "swagger" },
);
