import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';

import { fakeMedia, fakePost } from '../../test/fixtures';
import { createPost, publishPost, updatePost } from '../../lib/api/posts';
import { PostStatus } from '@repo/contracts';

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
  publishPost: jest.fn(),
}));

function renderForm(ui: ReactElement, client = new QueryClient()) {
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

describe('PostForm', () => {
  it('disables Publish until there is text or media', () => {
    renderForm(<PostForm />);

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

    renderForm(<PostForm onSuccess={onSuccess} />);

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

  it('invalidates the feed after creating a post', async () => {
    const client = new QueryClient();
    const invalidate = jest.spyOn(client, 'invalidateQueries');
    jest.mocked(createPost).mockResolvedValue(fakePost());

    renderForm(<PostForm onSuccess={jest.fn()} />, client);

    fireEvent.change(screen.getByPlaceholderText('Share something…'), {
      target: { value: 'Hello' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['feed'] });
    });
  });

  it('prefills and updates an existing post in edit mode', async () => {
    const initialPost = fakePost({
      id: 'post-9',
      content: 'Original text',
      assets: [fakeMedia({ assetId: 'asset-1' })],
    });
    jest.mocked(updatePost).mockResolvedValue(initialPost);

    renderForm(<PostForm initialPost={initialPost} />);

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

  it('offers Publish for a draft and publishes after saving edits', async () => {
    const draft = fakePost({ id: 'post-3', status: PostStatus.Draft });
    jest.mocked(updatePost).mockResolvedValue(draft);
    jest
      .mocked(publishPost)
      .mockResolvedValue({ ...draft, status: PostStatus.Published });

    renderForm(<PostForm initialPost={draft} onSuccess={jest.fn()} />);

    expect(screen.getByRole('button', { name: 'Save draft' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

    await waitFor(() => {
      expect(publishPost).toHaveBeenCalledWith('test-token', 'post-3');
    });
    expect(updatePost).toHaveBeenCalled();
  });

  it('hides Save draft when editing a published post', () => {
    renderForm(<PostForm initialPost={fakePost()} />);

    expect(
      screen.queryByRole('button', { name: 'Save draft' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Publish' }),
    ).not.toBeInTheDocument();
  });
});
