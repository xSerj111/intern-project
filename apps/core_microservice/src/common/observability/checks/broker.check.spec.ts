import type { AmqpConnectionManager } from 'amqp-connection-manager';
import { BrokerCheck } from './broker.check';

describe('BrokerCheck', () => {
  const isConnected = jest.fn();
  const check = new BrokerCheck({
    isConnected,
  } as unknown as AmqpConnectionManager);

  beforeEach(() => jest.resetAllMocks());

  it('is a non-critical check named broker', () => {
    expect(check.name).toBe('broker');
    expect(check.critical).toBe(false);
  });

  it('resolves when the connection is up', async () => {
    isConnected.mockReturnValue(true);

    await expect(check.run()).resolves.toBeUndefined();
  });

  it('rejects when the connection is down', async () => {
    isConnected.mockReturnValue(false);

    await expect(check.run()).rejects.toThrow('disconnected');
  });

  it('lets a throwing connection probe surface to the runner', () => {
    isConnected.mockImplementation(() => {
      throw new Error('boom');
    });

    expect(() => check.run()).toThrow('boom');
  });
});
