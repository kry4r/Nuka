// test/core/outputStyles/loader.test.ts
//
// Coverage for the markdown + YAML-frontmatter output-style loader.
// Uses real temp directories — the loader is a thin wrapper around
// `node:fs`, `yaml`, and Zod, so mocking those would only re-prove
// they work. The five test groups mirror the loader's public contract:
//
//   1. Missing directory returns an empty list (no throw).
//   2. Valid `.md` files parse end-to-end with every supported field.
//   3. Malformed files (broken YAML, missing fences, bad schema) are
//      silently dropped without taking the batch down with them.
//   4. Project entries override globals when their `name` matches.
//   5. Frontmatter-missing `description` falls back to a body-derived
//      string.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import os from 'node:os'
import { loadOutputStyles, parseOutputStyle } from '../../../src/core/outputStyles/loader'

let home: string
let cwd: string

beforeEach(async () => {
  home = await mkdtemp(join(os.tmpdir(), 'nuka-output-styles-home-'))
  cwd = await mkdtemp(join(os.tmpdir(), 'nuka-output-styles-cwd-'))
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
  await rm(cwd, { recursive: true, force: true })
})

async function seedStyle(
  root: string,
  fileName: string,
  contents: string,
): Promise<string> {
  const dir = join(root, '.nuka', 'output-styles')
  await mkdir(dir, { recursive: true })
  const filePath = join(dir, fileName)
  await writeFile(filePath, contents, 'utf8')
  return filePath
}

describe('loadOutputStyles — empty / missing directories', () => {
  it('returns an empty list when neither home nor cwd has the directory', async () => {
    const styles = await loadOutputStyles({ home, cwd })
    expect(styles).toEqual([])
  })

  it('returns an empty list when the directory exists but is empty', async () => {
    await mkdir(join(cwd, '.nuka', 'output-styles'), { recursive: true })
    const styles = await loadOutputStyles({ home, cwd })
    expect(styles).toEqual([])
  })

  it('ignores non-markdown files in the directory', async () => {
    await seedStyle(cwd, 'notes.txt', 'not a style')
    await seedStyle(cwd, 'config.yaml', 'name: ignored\n')
    const styles = await loadOutputStyles({ home, cwd })
    expect(styles).toEqual([])
  })
})

describe('loadOutputStyles — valid files', () => {
  it('loads a single valid project-scoped style with every field', async () => {
    const filePath = await seedStyle(
      cwd,
      'explanatory.md',
      [
        '---',
        'name: explanatory',
        'description: walks through the why',
        'keepCodingInstructions: true',
        '---',
        '',
        'You are an explanatory assistant.',
        'Always narrate your reasoning before acting.',
        '',
      ].join('\n'),
    )

    const styles = await loadOutputStyles({ home, cwd })
    expect(styles).toHaveLength(1)
    const style = styles[0]!
    expect(style.name).toBe('explanatory')
    expect(style.description).toBe('walks through the why')
    expect(style.keepCodingInstructions).toBe(true)
    expect(style.source).toBe('project')
    expect(style.path).toBe(filePath)
    expect(style.prompt).toBe(
      'You are an explanatory assistant.\nAlways narrate your reasoning before acting.',
    )
  })

  it('loads a global-scoped style when only the home dir has one', async () => {
    await seedStyle(
      home,
      'concise.md',
      [
        '---',
        'name: concise',
        'description: terse responses only',
        '---',
        'Be brief.',
      ].join('\n'),
    )
    const styles = await loadOutputStyles({ home, cwd })
    expect(styles).toHaveLength(1)
    expect(styles[0]!.source).toBe('global')
    expect(styles[0]!.name).toBe('concise')
  })

  it('omits keepCodingInstructions when the frontmatter does not set it', async () => {
    await seedStyle(
      cwd,
      'plain.md',
      ['---', 'name: plain', 'description: nothing fancy', '---', 'body'].join(
        '\n',
      ),
    )
    const styles = await loadOutputStyles({ home, cwd })
    expect(styles).toHaveLength(1)
    expect('keepCodingInstructions' in styles[0]!).toBe(false)
  })
})

describe('loadOutputStyles — malformed files are tolerated', () => {
  it('drops a file with no frontmatter fence', async () => {
    await seedStyle(cwd, 'no-frontmatter.md', 'Just a body, no fences.\n')
    const styles = await loadOutputStyles({ home, cwd })
    expect(styles).toEqual([])
  })

  it('drops a file with an unterminated frontmatter block', async () => {
    await seedStyle(
      cwd,
      'unterminated.md',
      ['---', 'name: oops', 'description: never closed'].join('\n'),
    )
    const styles = await loadOutputStyles({ home, cwd })
    expect(styles).toEqual([])
  })

  it('drops a file whose frontmatter YAML is invalid', async () => {
    await seedStyle(
      cwd,
      'broken-yaml.md',
      ['---', '  name: : :', 'description: broken', '---', 'body'].join('\n'),
    )
    const styles = await loadOutputStyles({ home, cwd })
    expect(styles).toEqual([])
  })

  it('drops a file whose frontmatter is missing required fields', async () => {
    await seedStyle(
      cwd,
      'no-name.md',
      ['---', 'description: missing name field', '---', 'body'].join('\n'),
    )
    const styles = await loadOutputStyles({ home, cwd })
    expect(styles).toEqual([])
  })

  it('keeps valid siblings even when one file is malformed', async () => {
    await seedStyle(cwd, 'bad.md', 'no fences here at all')
    await seedStyle(
      cwd,
      'good.md',
      [
        '---',
        'name: good',
        'description: well-formed',
        '---',
        'still here',
      ].join('\n'),
    )
    const styles = await loadOutputStyles({ home, cwd })
    expect(styles.map((s) => s.name)).toEqual(['good'])
  })
})

describe('loadOutputStyles — override semantics', () => {
  it('project entries override globals when the name matches', async () => {
    await seedStyle(
      home,
      'verbose.md',
      [
        '---',
        'name: verbose',
        'description: global verbose',
        '---',
        'global body',
      ].join('\n'),
    )
    await seedStyle(
      cwd,
      'verbose.md',
      [
        '---',
        'name: verbose',
        'description: project verbose',
        '---',
        'project body',
      ].join('\n'),
    )
    const styles = await loadOutputStyles({ home, cwd })
    expect(styles).toHaveLength(1)
    expect(styles[0]!.source).toBe('project')
    expect(styles[0]!.description).toBe('project verbose')
    expect(styles[0]!.prompt).toBe('project body')
  })

  it('keeps both styles when names differ', async () => {
    await seedStyle(
      home,
      'a.md',
      ['---', 'name: a', 'description: A', '---', 'aa'].join('\n'),
    )
    await seedStyle(
      cwd,
      'b.md',
      ['---', 'name: b', 'description: B', '---', 'bb'].join('\n'),
    )
    const styles = await loadOutputStyles({ home, cwd })
    const names = styles.map((s) => s.name).sort()
    expect(names).toEqual(['a', 'b'])
  })
})

describe('parseOutputStyle — description fallback', () => {
  it('derives description from the first non-blank body line when missing', () => {
    const style = parseOutputStyle(
      ['---', 'name: pithy', '---', '', '# Heading text', '', 'rest...'].join(
        '\n',
      ),
      { path: '/tmp/pithy.md', source: 'project' },
    )
    expect(style).not.toBeNull()
    expect(style!.description).toBe('Heading text')
  })

  it('uses a default phrase when the body is empty', () => {
    const style = parseOutputStyle(
      ['---', 'name: hollow', '---', '', '   ', ''].join('\n'),
      { path: '/tmp/hollow.md', source: 'global' },
    )
    expect(style).not.toBeNull()
    expect(style!.description).toBe('Custom hollow output style')
  })

  it('truncates very long body-derived descriptions', () => {
    const longLine = 'x'.repeat(200)
    const style = parseOutputStyle(
      ['---', 'name: long', '---', '', longLine].join('\n'),
      { path: '/tmp/long.md', source: 'global' },
    )
    expect(style).not.toBeNull()
    expect(style!.description.length).toBe(100)
    expect(style!.description.endsWith('...')).toBe(true)
  })
})
