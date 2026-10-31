import * as core from '@actions/core'
import { FileSpec } from './parser.js'
import { createHash, Hash } from 'crypto'
import { readFile } from 'fs/promises'
import { request } from 'https'

type HashAlgorithmType = 'sha2-256' | 'sha2-384' | 'sha2-512'

const hashAlgorithmMapping = {
  'sha2-256': 'sha256',
  'sha2-384': 'sha384',
  'sha2-512': 'sha512'
}

export interface SignatureSpec {
  file: string
  signature: string
}

export async function getSignatures(
  files: FileSpec[]
): Promise<SignatureSpec[]> {
  const vaultServer = core.getInput('vault-server', { required: false })
  if (!vaultServer) {
    return []
  }

  const vaultToken = core.getInput('vault-token', { required: true })
  const vaultPath =
    core.getInput('vault-path', { required: false }) || 'transit'
  const vaultKey = core.getInput('vault-signing-key', { required: true })
  const vaultHashAlgorithm: HashAlgorithmType =
    (core.getInput('vault-hash-algorithm', {
      required: false
    }) as HashAlgorithmType) || 'sha2-512'

  const hashes = await getHashes(vaultHashAlgorithm, files)

  const signatures = await batchSignWithVault(
    hashes.map((h) => h.signature),
    {
      vaultServer,
      vaultToken,
      vaultPath,
      vaultKey,
      vaultHashAlgorithm
    }
  )

  const signingErrors = signatures
    .map((signature, index) => ({
      file: hashes[index].file,
      error: signature.error
    }))
    .filter((s) => s.error)
  if (signingErrors.length > 0) {
    throw new Error(
      `Vault server returned errors for one or more files: ${signingErrors
        .map((s) => `${s.file}: ${s.error}`)
        .join(', ')}`
    )
  }

  return hashes.map((hash, index) => ({
    file: hash.file,
    signature: signatures[index].signature || ''
  }))
}

async function getHashes(
  algorithm: HashAlgorithmType,
  files: FileSpec[]
): Promise<SignatureSpec[]> {
  return await Promise.all(
    files.map(async (file) => {
      const signature = getHash(algorithm)

      await readFile(file.source, { encoding: 'binary' }).then((data) =>
        signature.update(data, 'binary')
      )

      return {
        file: file.target,
        signature: signature.digest('base64')
      }
    })
  )
}

function getHash(algorithm: HashAlgorithmType): Hash {
  if (!hashAlgorithmMapping[algorithm]) {
    throw new Error(
      `The specified "vault-signing-algorithm" is not supported, please use one of the supported algorithms (${Object.keys(
        hashAlgorithmMapping
      ).join(', ')}).`
    )
  }

  return createHash(hashAlgorithmMapping[algorithm])
}

async function batchSignWithVault(
  hashes: string[],
  options: {
    vaultServer: string
    vaultToken: string
    vaultPath: string
    vaultKey: string
    vaultHashAlgorithm: HashAlgorithmType
  }
): Promise<{ signature?: string; error?: string }[]> {
  const vaultServerUrl = new URL(options.vaultServer)

  return new Promise((resolve, reject) => {
    const req = request(
      {
        method: 'POST',
        protocol: vaultServerUrl.protocol,
        hostname: vaultServerUrl.hostname,
        port: vaultServerUrl.port || '443',
        path: `/${vaultServerUrl.pathname}/${options.vaultPath}/sign/${options.vaultKey}`,
        headers: {
          'X-Vault-Token': options.vaultToken
        }
      },
      (res) => {
        let data = ''
        res.on('data', (chunk) => {
          data += chunk
        })
        res.on('end', () => {
          const result = JSON.parse(data)

          if (!result?.data?.batch_results) {
            core.error(data)
            reject(
              new Error('Vault server did not return a batch_results object.')
            )
          }

          resolve(
            result.data.batch_results as {
              signature?: string
              error?: string
            }[]
          )
        })
      }
    )

    req.on('error', (err) => {
      reject(err)
    })

    req.write(
      JSON.stringify({
        hash_algorithm: options.vaultHashAlgorithm,
        batch_input: hashes.map((hash) => ({
          input: hash
        }))
      })
    )

    req.end()
  })
}
