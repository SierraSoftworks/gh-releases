import { renderTemplate, templatePlaceholders } from '../src/template'
import { expect, describe, it } from '@jest/globals'

describe('renderTemplate', () => {
  const variables = { tag: 'v1.2.3', repo: 'owner/repo', changelog: '' }

  it.each([
    ['{{tag}}', 'v1.2.3'],
    ['{{ tag }}', 'v1.2.3'],
    ['/{{ repo }}/refs/tags/{{ tag }}/', '/owner/repo/refs/tags/v1.2.3/'],
    ['no placeholders', 'no placeholders'],
    ['before{{ changelog }}after', 'beforeafter']
  ])('should render %j', (template, expected) => {
    expect(renderTemplate(template, variables)).toBe(expected)
  })

  it('should reject unknown placeholders', () => {
    expect(() => renderTemplate('{{ tga }}', variables)).toThrow('{{ tga }}')
  })
})

describe('templatePlaceholders', () => {
  it('should list the placeholders used', () => {
    expect(templatePlaceholders('{{ tag }} {{changelog}}')).toEqual([
      'tag',
      'changelog'
    ])
  })
})
