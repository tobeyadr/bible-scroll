// Everything about the sync secret: the 12-word phrase, and the keys derived from it.
//
// The secret never leaves the device. From it we derive three independent values:
//   id    – names her record on the server
//   token – proves to the server that a request comes from someone who holds the secret
//   key   – AES-GCM key; the server only ever stores ciphertext
const encoder = new TextEncoder()
const SALT = encoder.encode('bible-scroll-sync-v1')
const FORMAT = 1

export const b64u = {
  encode(bytes) {
    let s = ''
    for (const b of bytes) s += String.fromCharCode(b)
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  },
  decode(text) {
    const s = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
    return Uint8Array.from(s, ch => ch.charCodeAt(0))
  },
}

const toBase64 = bytes => {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}
const fromBase64 = text => Uint8Array.from(atob(text), ch => ch.charCodeAt(0))

export const generateSecret = () => crypto.getRandomValues(new Uint8Array(16))

async function checksumBits(secret) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', secret))
  return (hash[0] >> 4).toString(2).padStart(4, '0')
}

const toBits = bytes => [...bytes].map(b => b.toString(2).padStart(8, '0')).join('')

export async function phraseFromSecret(secret) {
  const { WORDS } = await import('./wordlist.js')
  const bits = toBits(secret) + (await checksumBits(secret))
  const words = []
  for (let i = 0; i < 12; i++) words.push(WORDS[parseInt(bits.slice(i * 11, i * 11 + 11), 2)])
  return words.join(' ')
}

export async function secretFromPhrase(phrase) {
  const { WORDS } = await import('./wordlist.js')
  const words = phrase.toLowerCase().split(/[\s,.-]+/).filter(Boolean)
  if (words.length !== 12) throw new Error('A sync phrase has 12 words.')
  let bits = ''
  for (const word of words) {
    const index = WORDS.indexOf(word)
    if (index < 0) throw new Error(`"${word}" is not in the word list. Check the spelling.`)
    bits += index.toString(2).padStart(11, '0')
  }
  const secret = Uint8Array.from({ length: 16 }, (_, i) => parseInt(bits.slice(i * 8, i * 8 + 8), 2))
  if ((await checksumBits(secret)) !== bits.slice(128)) throw new Error('Those words do not match. Check each one and their order.')
  return secret
}

export async function deriveKeys(secret) {
  const base = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits'])
  const bits = async label =>
    new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: SALT, info: encoder.encode(label) }, base, 256))

  const id = [...(await bits('id'))].map(b => b.toString(16).padStart(2, '0')).join('')
  const token = b64u.encode(await bits('write'))
  const key = await crypto.subtle.importKey('raw', await bits('enc'), 'AES-GCM', false, ['encrypt', 'decrypt'])
  return { id, token, key }
}

// doc -> base64 text (format byte + 12-byte IV + ciphertext)
export async function encryptDoc(key, doc) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify(doc))))
  const out = new Uint8Array(1 + iv.length + ciphertext.length)
  out[0] = FORMAT
  out.set(iv, 1)
  out.set(ciphertext, 1 + iv.length)
  return toBase64(out)
}

export async function decryptDoc(key, blob) {
  const bytes = fromBase64(blob)
  if (bytes[0] !== FORMAT) throw new Error('This synced data was made by a newer version of the app.')
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(1, 13) }, key, bytes.slice(13))
  return JSON.parse(new TextDecoder().decode(plain))
}
