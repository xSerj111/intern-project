import { Module, DynamicModule } from "@nestjs/common";
import { LoggerKey } from "./logger.port";
import { WinstonLogger } from "./winston.logger";

@Module({})
export class LoggerModule {
  /**
   * Tworzy dynamiczny moduł logera z określonym kontekstem.
   * @param contextName Nazwa klasy/serwisu (np. 'PostsService')
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
      // Eksportujemy symbol, by serwisy mogły go wstrzyknąć
      exports: [LoggerKey],
    };
  }
}