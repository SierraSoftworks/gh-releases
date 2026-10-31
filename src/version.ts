export type VersionBump = 'major' | 'minor' | 'patch'

const versionPattern = /^(v?)(\d+)\.(\d+)\.(\d+)$/

export function isVersionBump(value: string): value is VersionBump {
  return value === 'major' || value === 'minor' || value === 'patch'
}

/**
 * Computes the next version tag after `latest` (e.g. `v1.2.3` + `minor` => `v1.3.0`).
 * When there is no previous release, the bump is applied to `v0.0.0`.
 */
export function bumpVersion(
  latest: string | undefined,
  bump: VersionBump
): string {
  const match = versionPattern.exec(latest ?? 'v0.0.0')
  if (!match) {
    throw new Error(
      `Cannot bump the version of '${latest}', it is not in the form v1.2.3`
    )
  }

  const [, prefix] = match
  let [major, minor, patch] = match.slice(2).map(Number)

  switch (bump) {
    case 'major':
      major++
      minor = 0
      patch = 0
      break
    case 'minor':
      minor++
      patch = 0
      break
    case 'patch':
      patch++
      break
  }

  return `${prefix}${major}.${minor}.${patch}`
}
