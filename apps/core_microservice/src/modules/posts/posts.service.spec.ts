import { Test, TestingModule } from '@nestjs/testing';
import { LoggerKey } from '@repo/shared';
import { PostsService } from './posts.service';
import { PostRepository } from './infrastructure/repository/post.repository';
import { FollowRepositoryKey } from '../follows/domain/interfaces/follow-repository.port';

describe('PostsService', () => {
  let service: PostsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PostsService,
        { provide: LoggerKey, useValue: {} },
        { provide: PostRepository, useValue: {} },
        { provide: FollowRepositoryKey, useValue: {} },
      ],
    }).compile();

    service = module.get<PostsService>(PostsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
