import { bumpVersion, isVersionBump } from '../src/version'
import { expect, describe, it } from '@jest/globals'

describe('bumpVersion', () => {
  it.each([
    ['v1.2.3', 'patch', 'v1.2.4'],
    ['v1.2.3', 'minor', 'v1.3.0'],
    ['v1.2.3', 'major', 'v2.0.0'],
    ['1.2.3', 'patch', '1.2.4'],
    ['v3.3.9', 'patch', 'v3.3.10'],
    [undefined, 'patch', 'v0.0.1'],
    [undefined, 'major', 'v1.0.0']
  ] as const)('%s + %s => %s', (latest, bump, expected) => {
    expect(bumpVersion(latest, bump)).toBe(expected)
  })

  it.each(['latest', 'v1.2', 'v1.2.3-rc.1'])(
    'should reject non-semver version %s',
    (latest) => {
      expect(() => bumpVersion(latest, 'patch')).toThrow(latest)
    }
  )
})

describe('isVersionBump', () => {
  it.each([
    ['major', true],
    ['minor', true],
    ['patch', true],
    ['Patch', false],
    ['', false]
  ])('%s => %s', (value, expected) => {
    expect(isVersionBump(value)).toBe(expected)
  })
})
