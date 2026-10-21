// Browser and Hermes use the same PKCE verifier without a browser-only btoa global.
export function encodeSocialVerifier(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let encoded = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const first = bytes[i], second = bytes[i + 1], third = bytes[i + 2];
    encoded += alphabet[first >> 2] + alphabet[((first & 3) << 4) | ((second ?? 0) >> 4)];
    if (i + 1 < bytes.length) encoded += alphabet[((second & 15) << 2) | ((third ?? 0) >> 6)];
    if (i + 2 < bytes.length) encoded += alphabet[third & 63];
  }
  return encoded;
}
