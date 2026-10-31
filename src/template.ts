const placeholderPattern = /\{\{\s*([a-z_]+)\s*\}\}/g

/**
 * Lists the placeholders (e.g. `{{ tag }}`) used within a template.
 */
export function templatePlaceholders(template: string): string[] {
  return [...template.matchAll(placeholderPattern)].map((m) => m[1])
}

/**
 * Replaces `{{ name }}` placeholders with the matching variable, failing on
 * unknown placeholders so that typos don't end up in published release notes.
 */
export function renderTemplate(
  template: string,
  variables: Record<string, string>
): string {
  return template.replace(placeholderPattern, (placeholder, name: string) => {
    if (!(name in variables)) {
      throw new Error(
        `Unknown placeholder ${placeholder} in release notes template, supported placeholders are: ${Object.keys(
          variables
        )
          .map((v) => `{{ ${v} }}`)
          .join(', ')}`
      )
    }

    return variables[name]
  })
}
