# Innogram - Social Media Application

A modern social media application built with microservices architecture.

## Project Structure

```
innogram/
├── apps/
│   ├── core_microservice/          # NestJS API Gateway & Business Logic
│   ├── auth_microservice/          # Express.js Authentication Service
│   ├── notifications_consumer_microservice/  # NestJS Notifications Service
│   └── client_app/                 # Next.js Frontend Application
├── packages/
│   ├── shared/                     # Shared utilities and constants
│   └── types/                      # Shared TypeScript types
├── scripts/                       # Build and deployment scripts
├── docker/                        # Docker configurations
└── .github/workflows/             # CI/CD pipelines
```

## Prerequisites

- Node.js (v18 or higher)
- PostgreSQL (v13 or higher)
- Redis (v6 or higher)
- Docker (optional)

## Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start infrastructure services:**
   ```bash
   npm run docker:up
   ```

3. **Set up environment variables:**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. **Run database migrations:**
   ```bash
   npm run db:migrate
   ```

5. **Start development servers:**
   ```bash
   npm run dev
   ```

## Available Scripts

- `npm run dev` - Start all services in development mode
- `npm run build` - Build all services
- `npm run test` - Run tests for all services
- `npm run lint` - Lint all services
- `npm run type-check` - Type check all services
- `npm run docker:up` - Start infrastructure services
- `npm run docker:down` - Stop infrastructure services

## Services

### Core Microservice (Port 3001)
- NestJS API Gateway
- Main business logic
- Database operations
- Real-time features

### Authentication Microservice (Port 3002)
- Express.js service
- JWT token management
- OAuth 2.0 integration
- Session management

### Notifications Consumer (Port 3003)
- NestJS service
- Message processing
- Email notifications
- Real-time notifications

### Client Application (Port 3000)
- Next.js frontend
- React components
- User interface
- Real-time updates

## Development Workflow

1. Each feature should be focused and testable
2. Follow microservices architecture patterns
3. Implement features incrementally
4. Write tests for each component

## Contributing

1. Create a feature branch: `git checkout -b feature/INO-XXX`
2. Make your changes
3. Run tests: `npm run test`
4. Run linting: `npm run lint`
5. Create a Pull Request

## License

MIT
