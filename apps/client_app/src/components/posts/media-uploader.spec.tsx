import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { uploadAsset } from '../../lib/api/assets';
import { MediaUploader } from './media-uploader';

jest.mock('../../lib/auth/auth-context', () => ({
  useAuth: () => ({ accessToken: 'test-token' }),
}));
jest.mock('../../lib/api/assets', () => ({
  uploadAsset: jest.fn(),
  validateUploadFile: jest.fn((f: File) =>
    f.size > 10 * 1024 * 1024 ? `${f.name} is larger than 10 MB.` : null,
  ),
}));

const upload = uploadAsset as jest.Mock;

function png(name: string, size = 10): File {
  const f = new File(['x'], name, { type: 'image/png' });
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

function asset(id: string) {
  return { id, url: `https://example.test/${id}.png`, mimeType: 'image/png' };
}

function drop(files: File[]) {
  fireEvent.drop(screen.getByTestId('media-dropzone'), {
    dataTransfer: { files },
  });
}

describe('MediaUploader', () => {
  beforeEach(() => jest.clearAllMocks());

  it('uploads dropped files and reports them in order', async () => {
    upload.mockImplementation((f: File) =>
      Promise.resolve(asset(f.name.replace('.png', ''))),
    );
    const onChange = jest.fn();
    render(<MediaUploader onChange={onChange} />);

    drop([png('a.png'), png('b.png')]);

    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(
        [
          expect.objectContaining({ assetId: 'a' }),
          expect.objectContaining({ assetId: 'b' }),
        ],
        false,
      ),
    );
    expect(upload).toHaveBeenCalledTimes(2);
  });

  it('rejects an oversized file inline without blocking valid ones', async () => {
    upload.mockResolvedValue(asset('ok'));
    const onChange = jest.fn();
    render(<MediaUploader onChange={onChange} />);

    drop([png('huge.png', 12 * 1024 * 1024), png('ok.png')]);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'huge.png is larger than 10 MB.',
    );
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(
        [expect.objectContaining({ assetId: 'ok' })],
        false,
      ),
    );
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('reordering changes the reported order', async () => {
    upload.mockImplementation((f: File) =>
      Promise.resolve(asset(f.name.replace('.png', ''))),
    );
    const onChange = jest.fn();
    render(<MediaUploader onChange={onChange} />);
    drop([png('a.png'), png('b.png')]);
    await screen.findByLabelText('Move a.png right');
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(expect.any(Array), false));

    fireEvent.click(screen.getByLabelText('Move a.png right'));

    await waitFor(() => {
      const [items] = onChange.mock.calls.at(-1) as [{ assetId: string }[]];
      expect(items.map((i) => i.assetId)).toEqual(['b', 'a']);
    });
  });

  it('cancelling an upload aborts it and removes the row', async () => {
    let signal: AbortSignal | undefined;
    upload.mockImplementation(
      (_f: File, _t: string, _p: unknown, s: AbortSignal) => {
        signal = s;
        return new Promise(() => undefined);
      },
    );
    render(<MediaUploader onChange={jest.fn()} />);
    drop([png('slow.png')]);

    await act(async () => {
      fireEvent.click(await screen.findByLabelText('Cancel slow.png'));
    });

    expect(signal?.aborted).toBe(true);
    expect(screen.queryByText('slow.png')).not.toBeInTheDocument();
  });

  it('shows an error row and retries a failed upload', async () => {
    upload.mockRejectedValueOnce(new Error('network down'));
    upload.mockResolvedValueOnce(asset('a'));
    const onChange = jest.fn();
    render(<MediaUploader onChange={onChange} />);
    drop([png('a.png')]);

    expect(await screen.findByText('network down')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Retry a.png'));

    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(
        [expect.objectContaining({ assetId: 'a' })],
        false,
      ),
    );
  });
});
