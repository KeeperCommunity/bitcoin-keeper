export const getDocumentReadPath = (uri: string, platform: string): string => {
  // RNFS strips file:// but does not decode URI escapes before reading on iOS.
  if (platform === 'ios' && uri.startsWith('file://')) {
    return decodeURIComponent(uri.slice(7));
  }
  return uri;
};
