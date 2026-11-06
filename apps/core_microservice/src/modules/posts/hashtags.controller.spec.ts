import { Test, TestingModule } from '@nestjs/testing';
import { HashtagsController } from './hashtags.controller';
import { PostsService } from './posts.service';
import { PostResponseMapper } from './post-response.mapper';
import { OptionalJwtAuthGuard } from '../../common/auth/optional-jwt-auth.guard';
import { fakePost } from './__tests__/fakers/post.faker';

describe('HashtagsController', () => {
  let controller: HashtagsController;
  const postsService = {
    searchHashtags: jest.fn(),
    getHashtagFeed: jest.fn(),
  };
  const mapper = { toResponses: jest.fn() };
  const post = fakePost();

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HashtagsController],
      providers: [
        { provide: PostsService, useValue: postsService },
        { provide: PostResponseMapper, useValue: mapper },
      ],
    })
      .overrideGuard(OptionalJwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(HashtagsController);
  });

  describe('searchHashtags', () => {
    it('delegates the normalized q and limit and returns the suggestions', async () => {
      const tags = [{ tag: 'summer', postCount: 3 }];
      postsService.searchHashtags.mockResolvedValue(tags);

      const result = await controller.searchHashtags({ q: 'sum', limit: 5 });

      expect(postsService.searchHashtags).toHaveBeenCalledWith('sum', 5);
      expect(result).toBe(tags);
    });
  });

  describe('getHashtagFeed', () => {
    beforeEach(() => {
      postsService.getHashtagFeed.mockResolvedValue({
        items: [post],
        nextCursor: 'next',
      });
      mapper.toResponses.mockResolvedValue([{ id: post.id }]);
    });

    it('delegates tag, cursor and limit and maps items with the viewer id', async () => {
      const result = await controller.getHashtagFeed(
        'viewer-1',
        { tag: 'summer' },
        { cursor: 'abc', limit: 2 },
      );

      expect(postsService.getHashtagFeed).toHaveBeenCalledWith(
        'summer',
        'abc',
        2,
      );
      expect(mapper.toResponses).toHaveBeenCalledWith([post], 'viewer-1');
      expect(result).toEqual({ items: [{ id: post.id }], nextCursor: 'next' });
    });

    it('passes an undefined viewer id when not signed in', async () => {
      await controller.getHashtagFeed(
        undefined,
        { tag: 'summer' },
        { limit: 20 },
      );

      expect(postsService.getHashtagFeed).toHaveBeenCalledWith(
        'summer',
        undefined,
        20,
      );
      expect(mapper.toResponses).toHaveBeenCalledWith([post], undefined);
    });
  });
});
