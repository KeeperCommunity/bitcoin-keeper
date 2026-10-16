import { getDocumentReadPath } from 'src/utils/documentReadPath';

describe('getDocumentReadPath', () => {
  test.each(['bsms', 'txt'])('decodes brackets in an iOS .%s file URI', (extension) => {
    const uri = `file:///Documents/%5BMyWallet%5D_backup.${extension}`;

    expect(getDocumentReadPath(uri, 'ios')).toBe(`/Documents/[MyWallet]_backup.${extension}`);
  });

  test.each(['bsms', 'txt'])('preserves an iOS .%s filename without brackets', (extension) => {
    const uri = `file:///Documents/Descriptor.${extension}`;

    expect(getDocumentReadPath(uri, 'ios')).toBe(`/Documents/Descriptor.${extension}`);
  });

  test('decodes spaces, Unicode, and URI-sensitive filename characters', () => {
    expect(getDocumentReadPath('file:///Documents/Caf%C3%A9%20%23100%25.bsms', 'ios')).toBe(
      '/Documents/Café #100%.bsms'
    );
  });

  test('decodes escapes only once for a filename containing literal percent sequences', () => {
    expect(getDocumentReadPath('file:///Documents/%255BMyWallet%255D.bsms', 'ios')).toBe(
      '/Documents/%5BMyWallet%5D.bsms'
    );
  });

  test.each([
    'content://provider/Documents/%5BMyWallet%5D_backup.bsms',
    'file:///Documents/%5BMyWallet%5D_backup.txt',
  ])('leaves Android URIs unchanged: %s', (uri) => {
    expect(getDocumentReadPath(uri, 'android')).toBe(uri);
  });

  test.each(['/Documents/[MyWallet]_backup.bsms', 'content://provider/document/123'])(
    'leaves iOS inputs without the file scheme unchanged: %s',
    (uri) => {
      expect(getDocumentReadPath(uri, 'ios')).toBe(uri);
    }
  );
});
