import { createTransport } from 'nodemailer';
import type { AppConfigService } from '../../../../config/app-config.service';
import { NodemailerAdapter } from './nodemailer.adapter';

jest.mock('nodemailer');

describe('NodemailerAdapter', () => {
  const sendMail = jest.fn();
  const close = jest.fn();
  const message = { to: 'b@x.io', subject: 's', text: 't', html: '<p>h</p>' };

  const build = (smtp: Record<string, unknown>) => {
    (createTransport as jest.Mock).mockReturnValue({ sendMail, close });
    return new NodemailerAdapter({ smtp } as unknown as AppConfigService);
  };

  beforeEach(() => jest.clearAllMocks());

  it('connects without auth when no credentials are configured', async () => {
    const adapter = build({
      host: 'localhost',
      port: 1025,
      secure: false,
      from: 'Innogram <no-reply@innogram.local>',
    });
    sendMail.mockResolvedValue({});

    await adapter.send(message);

    expect(createTransport).toHaveBeenCalledWith({
      host: 'localhost',
      port: 1025,
      secure: false,
      auth: undefined,
    });
    expect(sendMail).toHaveBeenCalledWith({
      from: 'Innogram <no-reply@innogram.local>',
      ...message,
    });
  });

  it('passes credentials when both are set', () => {
    build({
      host: 'smtp.x.io',
      port: 465,
      secure: true,
      from: 'a@x.io',
      user: 'u',
      pass: 'p',
    });

    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ auth: { user: 'u', pass: 'p' } }),
    );
  });

  it('rejects when sending fails', async () => {
    const adapter = build({
      host: 'h',
      port: 25,
      secure: false,
      from: 'a@x.io',
    });
    sendMail.mockRejectedValue(new Error('smtp down'));

    await expect(adapter.send(message)).rejects.toThrow('smtp down');
  });

  it('closes the transport on shutdown', () => {
    build({
      host: 'h',
      port: 25,
      secure: false,
      from: 'a@x.io',
    }).onApplicationShutdown();

    expect(close).toHaveBeenCalled();
  });
});
