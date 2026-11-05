const crypto = require('crypto');

// Validates an ONVIF WS-Security UsernameToken (PasswordDigest profile):
//   digest = Base64(SHA1(Base64Decode(Nonce) + Created + Password))
function isValidUsernameToken(parsedHeader, cfg) {
  const security = parsedHeader && parsedHeader.Security;
  const token = security && security.UsernameToken;
  if (!token) return false;

  const username = token.Username;
  const password = token.Password && (token.Password['#text'] ?? token.Password);
  const nonceB64 = token.Nonce && (token.Nonce['#text'] ?? token.Nonce);
  const created = token.Created;

  if (!username || !password || !nonceB64 || !created) return false;
  if (username !== cfg.auth.username) return false;

  const nonceBuf = Buffer.from(nonceB64, 'base64');
  const expected = crypto
    .createHash('sha1')
    .update(Buffer.concat([nonceBuf, Buffer.from(created, 'utf8'), Buffer.from(cfg.auth.password, 'utf8')]))
    .digest('base64');

  return expected === password;
}

module.exports = { isValidUsernameToken };
