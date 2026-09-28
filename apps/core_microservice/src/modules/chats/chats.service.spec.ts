import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { LoggerKey } from '@repo/shared';
import { ChatsService } from './chats.service';
import { Message } from './domain/entities/message.entity';

describe('ChatsService', () => {
  let service: ChatsService;

  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatsService,
        { provide: LoggerKey, useValue: logger },
        { provide: getRepositoryToken(Message), useValue: {} },
      ],
    }).compile();

    service = module.get<ChatsService>(ChatsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
