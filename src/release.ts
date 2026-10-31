import * as core from '@actions/core'
import { context, getOctokit } from '@actions/github'
import { renderTemplate, templatePlaceholders } from './template.js'

export type GitHub = ReturnType<typeof getOctokit>
export type Release = Awaited<
  ReturnType<GitHub['rest']['repos']['getReleaseByTag']>
>['data']

export interface Repo {
  owner: string
  repo: string
}

/**
 * Discovers the release tag from the build environment (release events and tag pushes).
 */
export function getEnvironmentReleaseTag(): string | undefined {
  if (context.eventName === 'release') {
    return context.payload.release.tag_name
  }

  if (context.ref.startsWith('refs/tags/')) {
    return context.ref.substring('refs/tags/'.length)
  }

  return undefined
}

/**
 * Gets the tag of the latest published (non-draft, non-prerelease) release.
 */
export async function getLatestReleaseTag(
  github: GitHub,
  repo: Repo
): Promise<string | undefined> {
  try {
    const latest = await github.rest.repos.getLatestRelease({ ...repo })
    return latest.data.tag_name
  } catch (error) {
    if (isNotFound(error)) return undefined
    throw error
  }
}

/**
 * Finds the release for a tag, including drafts (which `getReleaseByTag` does
 * not return because their tag does not exist until they are published).
 */
export async function findRelease(
  github: GitHub,
  repo: Repo,
  tag: string
): Promise<Release | undefined> {
  try {
    const release = await github.rest.repos.getReleaseByTag({ ...repo, tag })
    return release.data
  } catch (error) {
    if (!isNotFound(error)) throw error
  }

  for await (const page of github.paginate.iterator(
    github.rest.repos.listReleases,
    { ...repo, per_page: 100 }
  )) {
    const draft = page.data.find((r) => r.draft && r.tag_name === tag)
    if (draft) return draft
  }

  return undefined
}

export interface NotesOptions {
  tag: string
  target: string
  previousTag?: string
  template?: string
}

/**
 * Renders the release notes template, generating the `{{ changelog }}` using
 * GitHub's release notes generator (configured by `.github/release.yml`).
 */
export async function renderNotes(
  github: GitHub,
  repo: Repo,
  options: NotesOptions
): Promise<string> {
  const template = options.template ?? '{{ changelog }}'

  let changelog = ''
  if (templatePlaceholders(template).includes('changelog')) {
    const notes = await github.rest.repos.generateReleaseNotes({
      ...repo,
      tag_name: options.tag,
      target_commitish: options.target,
      previous_tag_name: options.previousTag
    })
    changelog = notes.data.body
  }

  return renderTemplate(template, {
    tag: options.tag,
    version: options.tag.replace(/^v/, ''),
    previous_tag: options.previousTag ?? '',
    repo: `${repo.owner}/${repo.repo}`,
    sha: options.target,
    changelog
  })
}

export interface PrepareOptions {
  tag: string
  target: string
  create: boolean
  notes: () => Promise<string>
}

/**
 * Gets the release which assets should be uploaded to, creating (or refreshing)
 * a draft release when `create` is set.
 */
export async function prepareRelease(
  github: GitHub,
  repo: Repo,
  options: PrepareOptions
): Promise<Release> {
  const existing = await findRelease(github, repo, options.tag)

  if (!existing) {
    if (!options.create) {
      throw new Error(
        `No release found for tag ${options.tag}, set 'create: true' to create one.`
      )
    }

    core.info(`Creating draft release ${options.tag} at ${options.target}`)
    const created = await github.rest.repos.createRelease({
      ...repo,
      tag_name: options.tag,
      name: options.tag,
      target_commitish: options.target,
      body: await options.notes(),
      draft: true
    })
    return created.data
  }

  if (existing.draft && options.create) {
    // A previous run failed before publishing, so refresh the draft to match this run.
    core.info(`Updating existing draft release ${options.tag}`)
    const updated = await github.rest.repos.updateRelease({
      ...repo,
      release_id: existing.id,
      target_commitish: options.target,
      body: await options.notes()
    })
    return updated.data
  }

  if (!existing.draft && existing.immutable) {
    throw new Error(
      `Release ${options.tag} has already been published and is immutable, so its assets cannot be changed.`
    )
  }

  return existing
}

/**
 * Publishes a draft release, which creates its tag (and locks the release if
 * immutable releases are enabled).
 */
export async function publishRelease(
  github: GitHub,
  repo: Repo,
  release: Release
): Promise<Release> {
  if (!release.draft) return release

  core.info(`Publishing release ${release.tag_name}`)
  const published = await github.rest.repos.updateRelease({
    ...repo,
    release_id: release.id,
    draft: false
  })
  return published.data
}

function isNotFound(error: unknown): boolean {
  return (error as { status?: number } | undefined)?.status === 404
}
