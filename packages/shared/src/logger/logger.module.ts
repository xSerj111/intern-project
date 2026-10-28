import { Module, DynamicModule } from "@nestjs/common";
import { LoggerKey } from "./logger.port";
import { WinstonLogger } from "./winston.logger";

@Module({})
export class LoggerModule {
  /**
   * Creates a dynamic logger module with the given context.
   * @param contextName Class/service name (e.g. 'PostsService')
   */
  
  static forFeature(contextName: string): DynamicModule {
    return {
      module: LoggerModule,
      providers: [
        {
          provide: LoggerKey,

          useFactory: () => new WinstonLogger(contextName),
        },
      ],
      // Export the symbol so services can inject it
      exports: [LoggerKey],
    };
  }
}