# Publish GitHub Release Artifacts

This GitHub Action will publish artifacts from a build pipeline to a GitHub
Release. It is a lightweight wrapper around the `oktokit` library and strives to
be as simple as possible such that it may be easily audited by teams who may
otherwise be cautious about how they publish artifacts.

## Usage

```yaml
uses: SierraSoftworks/gh-releases@v1.0.7
with:
  token: ${{ secrets.GITHUB_TOKEN }}
  overwrite: 'true'
  files: |
    foo.txt
    bar.txt
    fizz.txt | buzz.txt
```

### Signing Artifacts using Hashicorp Vault

```yaml
uses: SierraSoftworks/gh-releases@v1.0.7
with:
  token: ${{ secrets.GITHUB_TOKEN }}
  overwrite: 'true'
  files: |
    foo.txt
    bar.txt
    fizz.txt | buzz.txt
  vault-server: https://vault.example.com
  vault-token: ${{ secrets.VAULT_TOKEN }}
  vault-path: transit
  vault-signing-key: github-signing-key
  vault-hash-algorithm: sha2-256
```

### Creating and Publishing Releases

The action can manage the full release lifecycle in one step, uploading
artifacts to a draft before publishing it. This is required for repositories
with
[immutable releases](https://docs.github.com/en/code-security/supply-chain-security/understanding-your-software-supply-chain/immutable-releases),
where published releases cannot have their artifacts changed.

```yaml
on:
  workflow_dispatch:
    inputs:
      bump:
        type: choice
        options: [patch, minor, major]

permissions:
  contents: write

jobs:
  release:
    runs-on: ubuntu-latest
    concurrency: release
    steps:
      - uses: actions/checkout@v7
      - run: make dist
      - uses: SierraSoftworks/gh-releases@v1
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
          bump: ${{ inputs.bump }}
          create: 'true'
          publish: 'true'
          notes-template: .github/release-template.md
          files: |
            dist/app.tgz
```

- **Versioning**: `bump` increments the latest published release, so re-running
  a failed workflow reuses its draft rather than creating a new version.
- **Notes**: `notes-template` renders `{{ tag }}`, `{{ version }}`,
  `{{ previous_tag }}`, `{{ repo }}`, `{{ sha }}` and `{{ changelog }}`
  (GitHub's generated release notes).
- **Publishing**: `publish` runs after all artifacts and signatures are
  uploaded, creating the tag at `target` (defaults to the current commit).
