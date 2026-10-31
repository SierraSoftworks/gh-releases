import * as core from '@actions/core'
import { context, getOctokit } from '@actions/github'
import {
  getEnvironmentReleaseTag,
  getLatestReleaseTag,
  GitHub,
  prepareRelease,
  publishRelease,
  Release,
  renderNotes,
  Repo
} from './release.js'
import { FileSpec, parseFileSpec } from './parser.js'
import { readFile } from 'fs/promises'
import { getSignatures } from './vault.js'
import { bumpVersion, isVersionBump, VersionBump } from './version.js'

export async function run(): Promise<void> {
  try {
    const files = core
      .getMultilineInput('files', { required: true })
      .map(parseFileSpec)

    if (!files.length) {
      core.warning('No files were specified, nothing to do.')
      return
    }

    const token: string = core.getInput('token', { required: true })
    const github = getOctokit(token)
    const repo = context.repo

    const create = getOptionalBooleanInput('create')
    const publish = getOptionalBooleanInput('publish')
    const overwrite = getOptionalBooleanInput('overwrite')
    const target = core.getInput('target') || context.sha

    const bump = getBumpInput()

    const explicitTag = core.getInput('release_tag')
    if (explicitTag && bump) {
      throw new Error(`Only one of 'release_tag' and 'bump' may be specified.`)
    }

    const latestTag =
      bump || create ? await getLatestReleaseTag(github, repo) : undefined

    const releaseTag =
      explicitTag ||
      (bump ? bumpVersion(latestTag, bump) : undefined) ||
      getEnvironmentReleaseTag()

    if (!releaseTag) {
      throw new Error(
        'No release tag found for this action, please specify it in the action input.'
      )
    }
    core.debug(`Resolved release tag to: ${releaseTag}`)

    const templatePath = core.getInput('notes-template')
    let release = await prepareRelease(github, repo, {
      tag: releaseTag,
      target,
      create,
      notes: async () =>
        renderNotes(github, repo, {
          tag: releaseTag,
          target,
          previousTag: latestTag !== releaseTag ? latestTag : undefined,
          template: templatePath
            ? await readFile(templatePath, 'utf8')
            : undefined
        })
    })

    core.debug(`Found release ${release.tag_name} with ID ${release.id}`)

    if (overwrite) {
      await removeExistingAssets(github, repo, release, files)
    }

    await uploadAssets(github, repo, release, files)

    if (publish) {
      release = await publishRelease(github, repo, release)
    }

    core.setOutput('tag', release.tag_name)
    core.setOutput('release_id', release.id)
    core.setOutput('url', release.html_url)
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message)
      if (error.stack) {
        core.error(error.stack)
      }
    }
  }
}

function getBumpInput(): VersionBump | undefined {
  const bump = core.getInput('bump')
  if (!bump) return undefined
  if (!isVersionBump(bump)) {
    throw new Error(
      `Invalid bump '${bump}', expected one of: major, minor, patch`
    )
  }

  return bump
}

function getOptionalBooleanInput(name: string): boolean {
  return core.getInput(name) ? core.getBooleanInput(name) : false
}

async function removeExistingAssets(
  github: GitHub,
  repo: Repo,
  release: Release,
  files: FileSpec[]
): Promise<void> {
  const filesToUpload = files.map((f) => f.target)
  const assetsToOverwrite = release.assets.filter((asset) =>
    filesToUpload.includes(asset.name)
  )

  if (assetsToOverwrite.length) {
    core.debug(`Removing ${assetsToOverwrite.length} existing assets`)
    await Promise.all(
      assetsToOverwrite.map(
        async (asset) =>
          await github.rest.repos.deleteReleaseAsset({
            ...repo,
            asset_id: asset.id
          })
      )
    )
  }
}

async function uploadAssets(
  github: GitHub,
  repo: Repo,
  release: Release,
  files: FileSpec[]
): Promise<void> {
  await Promise.all(
    files.map(async (file) => {
      core.debug(`Reading file ${file.source}`)
      const data = await readFile(file.source)

      core.debug(`Uploading file ${file.target} (${data.length} bytes)`)

      const upload = await github.rest.repos.uploadReleaseAsset({
        ...repo,
        release_id: release.id,
        name: file.target,
        data: data as unknown as string
      })
      core.info(
        `Uploaded file ${file.target}, permalink is: ${upload.data.browser_download_url}`
      )
    })
  )

  const signatures = await getSignatures(files)
  core.debug(`Received ${signatures.length} signatures from Vault`)

  await Promise.all(
    signatures.map(async (signature) => {
      core.debug(`Uploading signature ${signature.file}.sig`)

      const upload = await github.rest.repos.uploadReleaseAsset({
        ...repo,
        release_id: release.id,
        name: `${signature.file}.sig`,
        data: signature.signature
      })
      core.info(
        `Uploaded signature ${signature.file}, permalink is: ${upload.data.browser_download_url}`
      )
    })
  )
}
