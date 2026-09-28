import { Test, TestingModule } from '@nestjs/testing';
import { LoggerKey } from '@repo/shared';
import { CommentsService } from './comments.service';
import { CommentRepository } from './infrastructure/repository/comment.repository';

describe('CommentsService', () => {
  let service: CommentsService;

  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommentsService,
        { provide: LoggerKey, useValue: logger },
        { provide: CommentRepository, useValue: {} },
      ],
    }).compile();

    service = module.get<CommentsService>(CommentsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
