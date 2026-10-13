import { Test, TestingModule } from '@nestjs/testing';
import { LoggerKey } from '@repo/shared';
import { CommentsService } from './comments.service';
import { CommentRepository } from './infrastructure/repository/comment.repository';

describe('CommentsService', () => {
  let service: CommentsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommentsService,
        { provide: LoggerKey, useValue: {} },
        { provide: CommentRepository, useValue: {} },
      ],
    }).compile();

    service = module.get<CommentsService>(CommentsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
