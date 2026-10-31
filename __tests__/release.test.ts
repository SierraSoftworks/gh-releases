import {
  findRelease,
  GitHub,
  prepareRelease,
  publishRelease,
  Release,
  renderNotes
} from '../src/release'
import { expect, describe, it, jest } from '@jest/globals'

const repo = { owner: 'owner', repo: 'repo' }

function release(overrides: Partial<Release> = {}): Release {
  return {
    id: 1,
    tag_name: 'v1.0.0',
    draft: false,
    immutable: false,
    assets: [],
    ...overrides
  } as Release
}

function notFound(): Error {
  return Object.assign(new Error('Not Found'), { status: 404 })
}

/**
 * Builds a fake GitHub client where `published` releases are resolvable by tag
 * and `releases` are returned when listing (as drafts are).
 */
function fakeGitHub(published: Release[] = [], releases: Release[] = []) {
  const respond = (data: unknown) => Promise.resolve({ data })
  const repos = {
    getReleaseByTag: jest.fn(({ tag }: { tag: string }) => {
      const found = published.find((r) => r.tag_name === tag)
      return found ? respond(found) : Promise.reject(notFound())
    }),
    listReleases: jest.fn(),
    createRelease: jest.fn((params: Record<string, unknown>) =>
      respond(release({ id: 2, ...params }))
    ),
    updateRelease: jest.fn((params: Record<string, unknown>) =>
      respond(release({ id: params.release_id as number, ...params }))
    ),
    generateReleaseNotes: jest.fn(() => respond({ body: '## Changes' }))
  }

  const github = {
    rest: { repos },
    paginate: {
      iterator: async function* () {
        yield { data: releases }
      }
    }
  }

  return { github: github as unknown as GitHub, repos }
}

const prepare = (
  github: GitHub,
  options: Partial<Parameters<typeof prepareRelease>[2]> = {}
) =>
  prepareRelease(github, repo, {
    tag: 'v1.0.0',
    target: 'abc123',
    create: false,
    notes: async () => 'notes',
    ...options
  })

describe('findRelease', () => {
  it('should find published releases by tag', async () => {
    const { github } = fakeGitHub([release()])
    await expect(findRelease(github, repo, 'v1.0.0')).resolves.toMatchObject({
      tag_name: 'v1.0.0'
    })
  })

  it('should find draft releases which have no tag yet', async () => {
    const { github } = fakeGitHub(
      [],
      [release({ id: 5, tag_name: 'v1.0.0', draft: true })]
    )
    await expect(findRelease(github, repo, 'v1.0.0')).resolves.toMatchObject({
      id: 5
    })
  })

  it('should return undefined when there is no release', async () => {
    const { github } = fakeGitHub([], [release({ tag_name: 'v0.9.0' })])
    await expect(findRelease(github, repo, 'v1.0.0')).resolves.toBeUndefined()
  })
})

describe('prepareRelease', () => {
  it('should use an existing release', async () => {
    const { github, repos } = fakeGitHub([release({ id: 3 })])
    await expect(prepare(github)).resolves.toMatchObject({ id: 3 })
    expect(repos.createRelease).not.toHaveBeenCalled()
  })

  it('should fail when the release is missing and create is not set', async () => {
    const { github } = fakeGitHub()
    await expect(prepare(github)).rejects.toThrow('create')
  })

  it('should create a draft release at the target', async () => {
    const { github, repos } = fakeGitHub()
    await expect(prepare(github, { create: true })).resolves.toMatchObject({
      draft: true
    })
    expect(repos.createRelease).toHaveBeenCalledWith(
      expect.objectContaining({
        tag_name: 'v1.0.0',
        target_commitish: 'abc123',
        body: 'notes',
        draft: true
      })
    )
  })

  it('should refresh an existing draft when create is set', async () => {
    const { github, repos } = fakeGitHub([], [release({ id: 4, draft: true })])
    await expect(prepare(github, { create: true })).resolves.toMatchObject({
      id: 4
    })
    expect(repos.createRelease).not.toHaveBeenCalled()
    expect(repos.updateRelease).toHaveBeenCalledWith(
      expect.objectContaining({ release_id: 4, target_commitish: 'abc123' })
    )
  })

  it('should reject published immutable releases', async () => {
    const { github } = fakeGitHub([release({ immutable: true })])
    await expect(prepare(github, { create: true })).rejects.toThrow('immutable')
  })
})

describe('publishRelease', () => {
  it('should publish draft releases', async () => {
    const { github, repos } = fakeGitHub()
    await expect(
      publishRelease(github, repo, release({ id: 6, draft: true }))
    ).resolves.toMatchObject({ draft: false })
    expect(repos.updateRelease).toHaveBeenCalledWith(
      expect.objectContaining({ release_id: 6, draft: false })
    )
  })

  it('should leave published releases unchanged', async () => {
    const { github, repos } = fakeGitHub()
    await publishRelease(github, repo, release())
    expect(repos.updateRelease).not.toHaveBeenCalled()
  })
})

describe('renderNotes', () => {
  it('should render the template with the generated changelog', async () => {
    const { github, repos } = fakeGitHub()
    const notes = await renderNotes(github, repo, {
      tag: 'v1.0.1',
      target: 'abc123',
      previousTag: 'v1.0.0',
      template: '{{ repo }}@{{ tag }} ({{ version }})\n{{ changelog }}'
    })

    expect(notes).toContain('owner/repo@v1.0.1 (1.0.1)')
    expect(notes).toContain('## Changes')
    expect(repos.generateReleaseNotes).toHaveBeenCalledWith(
      expect.objectContaining({
        tag_name: 'v1.0.1',
        previous_tag_name: 'v1.0.0'
      })
    )
  })

  it('should not generate a changelog unless the template uses it', async () => {
    const { github, repos } = fakeGitHub()
    await renderNotes(github, repo, {
      tag: 'v1.0.1',
      target: 'abc123',
      template: '{{ tag }}'
    })
    expect(repos.generateReleaseNotes).not.toHaveBeenCalled()
  })

  it('should default to the generated changelog', async () => {
    const { github } = fakeGitHub()
    await expect(
      renderNotes(github, repo, { tag: 'v1.0.1', target: 'abc123' })
    ).resolves.toBe('## Changes')
  })
})
