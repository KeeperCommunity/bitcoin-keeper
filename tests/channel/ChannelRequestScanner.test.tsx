import React from 'react';
import renderer, { act } from 'react-test-renderer';
import ChannelRequestScanner from '../../src/services/channel/ChannelRequestScanner';

jest.mock('src/components/QRScanner', () => 'QRScanner');

describe('Desktop request scanner', () => {
  it('waits for asynchronous preparation and sends only one request per scan', async () => {
    let finish: (sent: boolean) => void;
    const onScanCompleted = jest.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        })
    );
    let screen: renderer.ReactTestRenderer;
    act(() => {
      screen = renderer.create(
        <ChannelRequestScanner onScanCompleted={onScanCompleted}>
          {React.createElement('Waiting')}
        </ChannelRequestScanner>
      );
    });
    const scan = screen!.root.findByType('QRScanner' as any).props.onScanCompleted;
    let request: Promise<void>;
    act(() => {
      request = scan('disposable-qr');
    });
    await act(async () => {
      await scan('duplicate-qr');
    });
    expect(onScanCompleted).toHaveBeenCalledTimes(1);
    expect(screen!.root.findAllByType('Waiting' as any)).toHaveLength(0);
    await act(async () => {
      finish!(true);
      await request;
    });
    expect(screen!.root.findAllByType('Waiting' as any)).toHaveLength(1);
    expect(screen!.root.findAllByType('QRScanner' as any)).toHaveLength(0);
    await act(async () => {
      await scan('late-duplicate-qr');
    });
    expect(onScanCompleted).toHaveBeenCalledTimes(1);
  });

  it('keeps the scanner available after failure and accepts the next valid request', async () => {
    const onScanCompleted = jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    let screen: renderer.ReactTestRenderer;
    act(() => {
      screen = renderer.create(
        <ChannelRequestScanner onScanCompleted={onScanCompleted}>
          {React.createElement('Waiting')}
        </ChannelRequestScanner>
      );
    });
    await act(async () => {
      await screen!.root.findByType('QRScanner' as any).props.onScanCompleted('invalid-qr');
    });
    expect(screen!.root.findAllByType('Waiting' as any)).toHaveLength(0);
    await act(async () => {
      await screen!.root.findByType('QRScanner' as any).props.onScanCompleted('valid-qr');
    });
    expect(screen!.root.findAllByType('Waiting' as any)).toHaveLength(1);
  });
});
