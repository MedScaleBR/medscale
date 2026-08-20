import crypto from 'crypto'

// Criptografia simétrica do token permanente da Meta antes de persistir em
// profiles.meta_token (conforme observação do spec: nunca guardar em texto puro).
// TOKEN_ENCRYPTION_KEY deve ser uma chave hex de 32 bytes (64 caracteres).
// Gerar com: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

const ALGORITHM = 'aes-256-gcm'

function getKey(): Buffer {
  const key = process.env.TOKEN_ENCRYPTION_KEY
  if (!key || key.length !== 64) {
    throw new Error('TOKEN_ENCRYPTION_KEY ausente ou inválida (esperado hex de 64 caracteres / 32 bytes)')
  }
  return Buffer.from(key, 'hex')
}

export function encryptToken(plainText: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv)
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return Buffer.concat([iv, authTag, encrypted]).toString('base64')
}

export function decryptToken(encoded: string): string {
  const data = Buffer.from(encoded, 'base64')
  const iv = data.subarray(0, 12)
  const authTag = data.subarray(12, 28)
  const encrypted = data.subarray(28)
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
}
