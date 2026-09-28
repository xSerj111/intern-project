import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { fakeMedia, fakePost } from '../../test/fixtures';
import { createPost, updatePost } from '../../lib/api/posts';
import { PostForm } from './post-form';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('../../lib/auth/auth-context', () => ({
  useAuth: () => ({ accessToken: 'test-token' }),
}));

jest.mock('../../lib/api/assets', () => ({
  uploadAsset: jest.fn(),
  validateUploadFile: jest.fn(() => null),
}));

jest.mock('../../lib/api/posts', () => ({
  createPost: jest.fn(),
  updatePost: jest.fn(),
}));

describe('PostForm', () => {
  it('disables Publish until there is text or media', () => {
    render(<PostForm />);

    const publish = screen.getByRole('button', { name: 'Publish' });
    expect(publish).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('Share something…'), {
      target: { value: 'First post' },
    });

    expect(publish).toBeEnabled();
  });

  it('saves a draft with publish=false', async () => {
    const onSuccess = jest.fn();
    jest.mocked(createPost).mockResolvedValue(fakePost());

    render(<PostForm onSuccess={onSuccess} />);

    fireEvent.change(screen.getByPlaceholderText('Share something…'), {
      target: { value: 'Draft text' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => {
      expect(createPost).toHaveBeenCalledWith('test-token', {
        content: 'Draft text',
        assetIds: [],
        publish: false,
      });
    });
    expect(onSuccess).toHaveBeenCalled();
  });

  it('prefills and updates an existing post in edit mode', async () => {
    const initialPost = fakePost({
      id: 'post-9',
      content: 'Original text',
      assets: [fakeMedia({ assetId: 'asset-1' })],
    });
    jest.mocked(updatePost).mockResolvedValue(initialPost);

    render(<PostForm initialPost={initialPost} />);

    expect(screen.getByDisplayValue('Original text')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(updatePost).toHaveBeenCalledWith('test-token', 'post-9', {
        content: 'Original text',
        assetIds: ['asset-1'],
      });
    });
  });
});
