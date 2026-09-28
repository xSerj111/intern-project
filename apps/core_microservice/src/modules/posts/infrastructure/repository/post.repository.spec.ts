import type { Repository } from 'typeorm';

import { Post } from '../../domain/entities/post.entity';
import { PostRepository } from './post.repository';

describe('PostRepository', () => {
  it('resolves dotted default relations into nested objects', async () => {
    const repository = {
      findOne: jest.fn().mockResolvedValue({ id: 'post-1' }),
    };
    const postRepository = new PostRepository(
      repository as unknown as Repository<Post>,
    );

    await postRepository.findOneByIdOrThrow('post-1');

    // Regression: `assets.asset` must nest under `assets` even though `assets`
    // is also declared as a top-level relation, rather than throwing
    // "Cannot create property 'asset' on boolean 'true'".
    expect(repository.findOne).toHaveBeenCalledWith({
      relations: { author: true, assets: { asset: true } },
      where: { id: 'post-1' },
    });
  });
});
