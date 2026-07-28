import swaggerJSDoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import type { Application } from 'express';

export function setupSwagger(app: Application): void {
  const options: swaggerJSDoc.Options = {
    definition: {
      openapi: '3.0.0',
      info: {
        title: 'Auth Microservice API',
        version: '1.0.0',
        description: 'Authentication system endpoints (Express.js)',
      },
      servers: [
        {
          url: 'http://localhost:3001',
          description: 'Local development server',
        },
      ],
    },

    apis: ['./src/routes/*.ts'],
  };

  const swaggerSpec = swaggerJSDoc(options);

  app.use('/api', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
}
