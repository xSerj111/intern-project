import 'reflect-metadata';
import { HttpStatus, RequestMethod } from '@nestjs/common';
import {
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { Test, TestingModule } from '@nestjs/testing';
import type { ILikeState } from '@repo/contracts';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { LikesController } from './likes.controller';
import { LikesService } from './likes.service';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const TARGET_ID = '22222222-2222-2222-2222-222222222222';

describe('LikesController', () => {
  let controller: LikesController;
  const service = {
    likePost: jest.fn(),
    unlikePost: jest.fn(),
    likeComment: jest.fn(),
    unlikeComment: jest.fn(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [LikesController],
      providers: [{ provide: LikesService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(LikesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it.each([
    ['likePost', 'likePost'],
    ['unlikePost', 'unlikePost'],
    ['likeComment', 'likeComment'],
    ['unlikeComment', 'unlikeComment'],
  ] as const)(
    '%s passes the target id and the caller id (sub) to the service',
    async (method, serviceMethod) => {
      const state: ILikeState = { likeCount: 4, likedByMe: true };
      service[serviceMethod].mockResolvedValue(state);

      const result = await controller[method](USER_ID, TARGET_ID);

      expect(service[serviceMethod]).toHaveBeenCalledWith(TARGET_ID, USER_ID);
      expect(result).toBe(state);
    },
  );

  it('propagates service errors', async () => {
    service.likePost.mockRejectedValue(new Error('nope'));

    await expect(controller.likePost(USER_ID, TARGET_ID)).rejects.toThrow(
      'nope',
    );
  });

  describe('routes', () => {
    const route = (name: keyof LikesController) => {
      const proto = LikesController.prototype as unknown as Record<
        string,
        object
      >;
      const handler = proto[name];
      return {
        path: Reflect.getMetadata(PATH_METADATA, handler) as string,
        method: Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod,
        code: Reflect.getMetadata(HTTP_CODE_METADATA, handler) as
          number | undefined,
      };
    };

    it('exposes idempotent PUT/DELETE on posts and comments', () => {
      expect(route('likePost')).toEqual({
        path: 'posts/:postId/like',
        method: RequestMethod.PUT,
        code: HttpStatus.OK,
      });
      expect(route('unlikePost')).toMatchObject({
        path: 'posts/:postId/like',
        method: RequestMethod.DELETE,
      });
      expect(route('likeComment')).toEqual({
        path: 'comments/:commentId/like',
        method: RequestMethod.PUT,
        code: HttpStatus.OK,
      });
      expect(route('unlikeComment')).toMatchObject({
        path: 'comments/:commentId/like',
        method: RequestMethod.DELETE,
      });
    });

    it('is protected by JwtAuthGuard', () => {
      const guards = Reflect.getMetadata('__guards__', LikesController) as
        unknown[] | undefined;
      expect(guards).toContain(JwtAuthGuard);
    });
  });
});
