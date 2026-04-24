import { describe, it, expect } from 'vitest'
import { pluginSearch } from '../../src/slash/plugin/search'
import { pluginInstall } from '../../src/slash/plugin/install'
import { pluginUninstall } from '../../src/slash/plugin/uninstall'
import { pluginList } from '../../src/slash/plugin/list'
import { pluginEnable } from '../../src/slash/plugin/enable'
import { pluginDisable } from '../../src/slash/plugin/disable'
import { pluginUpdate } from '../../src/slash/plugin/update'
import { createPluginCommand } from '../../src/slash/plugin/index'
import type { PluginSubcmdDeps, PluginInfo } from '../../src/slash/plugin/types'

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const PLUGINS: PluginInfo[] = [
  { name: 'foo', version: '1.0.0', description: 'Foo plugin', enabled: true },
  { name: 'bar', version: '2.0.0', description: 'Bar plugin', enabled: false },
]

function makeDeps(overrides: Partial<PluginSubcmdDeps> = {}): PluginSubcmdDeps {
  return {
    search: async (q) => PLUGINS.filter(p => p.name.includes(q)),
    install: async (name) => ({ name, version: '1.0.0' }),
    uninstall: async (_name) => {},
    enable: async (_name, _enabled) => {},
    update: async (_name) => ({ changed: false }),
    list: async () => PLUGINS,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// /plugin search
// ---------------------------------------------------------------------------

describe('/plugin search', () => {
  it('returns error for empty query', async () => {
    const r = await pluginSearch('', makeDeps())
    expect('isError' in r && r.isError).toBe(true)
    expect(r.text).toMatch(/usage/i)
  })

  it('returns matching plugins', async () => {
    const r = await pluginSearch('foo', makeDeps())
    expect(r.text).toMatch(/foo/)
    expect('isError' in r).toBe(false)
  })

  it('returns no-results message when nothing matches', async () => {
    const r = await pluginSearch('nonexistent', makeDeps())
    expect(r.text).toMatch(/no plugins found/i)
  })

  it('returns error when search throws', async () => {
    const deps = makeDeps({ search: async () => { throw new Error('network error') } })
    const r = await pluginSearch('foo', deps)
    expect('isError' in r && r.isError).toBe(true)
    expect(r.text).toMatch(/network error/)
  })

  it('includes version and description in output', async () => {
    const deps = makeDeps({
      search: async () => [{ name: 'myplugin', version: '3.0.0', description: 'My plugin' }],
    })
    const r = await pluginSearch('my', deps)
    expect(r.text).toMatch(/3\.0\.0/)
    expect(r.text).toMatch(/My plugin/)
  })
})

// ---------------------------------------------------------------------------
// /plugin install
// ---------------------------------------------------------------------------

describe('/plugin install', () => {
  it('returns error for empty name', async () => {
    const r = await pluginInstall('', makeDeps())
    expect('isError' in r && r.isError).toBe(true)
  })

  it('returns success message after install', async () => {
    const r = await pluginInstall('foo', makeDeps())
    expect(r.text).toMatch(/installed/i)
    expect(r.text).toMatch(/foo/)
  })

  it('returns error when install throws', async () => {
    const deps = makeDeps({ install: async () => { throw new Error('already installed') } })
    const r = await pluginInstall('foo', deps)
    expect('isError' in r && r.isError).toBe(true)
    expect(r.text).toMatch(/already installed/)
  })

  it('includes version in success message', async () => {
    const deps = makeDeps({ install: async (name) => ({ name, version: '2.1.0' }) })
    const r = await pluginInstall('bar', deps)
    expect(r.text).toMatch(/2\.1\.0/)
  })
})

// ---------------------------------------------------------------------------
// /plugin uninstall
// ---------------------------------------------------------------------------

describe('/plugin uninstall', () => {
  it('returns error for empty name', async () => {
    const r = await pluginUninstall('', makeDeps())
    expect('isError' in r && r.isError).toBe(true)
  })

  it('returns success message after uninstall', async () => {
    const r = await pluginUninstall('foo', makeDeps())
    expect(r.text).toMatch(/uninstalled/i)
    expect(r.text).toMatch(/foo/)
  })

  it('returns error when uninstall throws', async () => {
    const deps = makeDeps({ uninstall: async () => { throw new Error('not found') } })
    const r = await pluginUninstall('foo', deps)
    expect('isError' in r && r.isError).toBe(true)
    expect(r.text).toMatch(/not found/)
  })
})

// ---------------------------------------------------------------------------
// /plugin list
// ---------------------------------------------------------------------------

describe('/plugin list', () => {
  it('returns "no plugins" when list is empty', async () => {
    const deps = makeDeps({ list: async () => [] })
    const r = await pluginList('', deps)
    expect(r.text).toMatch(/no plugins/i)
  })

  it('lists installed plugins with version', async () => {
    const r = await pluginList('', makeDeps())
    expect(r.text).toMatch(/foo/)
    expect(r.text).toMatch(/1\.0\.0/)
  })

  it('shows disabled status for disabled plugins', async () => {
    const r = await pluginList('', makeDeps())
    expect(r.text).toMatch(/\[disabled\]/)
  })

  it('returns error when list throws', async () => {
    const deps = makeDeps({ list: async () => { throw new Error('fs error') } })
    const r = await pluginList('', deps)
    expect('isError' in r && r.isError).toBe(true)
  })

  it('shows plugin count in header', async () => {
    const r = await pluginList('', makeDeps())
    expect(r.text).toMatch(/2/)
  })
})

// ---------------------------------------------------------------------------
// /plugin enable
// ---------------------------------------------------------------------------

describe('/plugin enable', () => {
  it('returns error for empty name', async () => {
    const r = await pluginEnable('', makeDeps())
    expect('isError' in r && r.isError).toBe(true)
  })

  it('returns success message', async () => {
    const r = await pluginEnable('foo', makeDeps())
    expect(r.text).toMatch(/enabled/i)
    expect(r.text).toMatch(/foo/)
  })

  it('calls enable dep with true', async () => {
    const calls: [string, boolean][] = []
    const deps = makeDeps({ enable: async (name, enabled) => { calls.push([name, enabled]) } })
    await pluginEnable('foo', deps)
    expect(calls).toEqual([['foo', true]])
  })

  it('returns error when enable throws', async () => {
    const deps = makeDeps({ enable: async () => { throw new Error('not found') } })
    const r = await pluginEnable('foo', deps)
    expect('isError' in r && r.isError).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// /plugin disable
// ---------------------------------------------------------------------------

describe('/plugin disable', () => {
  it('returns error for empty name', async () => {
    const r = await pluginDisable('', makeDeps())
    expect('isError' in r && r.isError).toBe(true)
  })

  it('returns success message', async () => {
    const r = await pluginDisable('bar', makeDeps())
    expect(r.text).toMatch(/disabled/i)
    expect(r.text).toMatch(/bar/)
  })

  it('calls enable dep with false', async () => {
    const calls: [string, boolean][] = []
    const deps = makeDeps({ enable: async (name, enabled) => { calls.push([name, enabled]) } })
    await pluginDisable('foo', deps)
    expect(calls).toEqual([['foo', false]])
  })

  it('returns error when disable throws', async () => {
    const deps = makeDeps({ enable: async () => { throw new Error('no such plugin') } })
    const r = await pluginDisable('foo', deps)
    expect('isError' in r && r.isError).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// /plugin update
// ---------------------------------------------------------------------------

describe('/plugin update', () => {
  it('returns error for empty name', async () => {
    const r = await pluginUpdate('', makeDeps())
    expect('isError' in r && r.isError).toBe(true)
  })

  it('returns "already up to date" when unchanged', async () => {
    const r = await pluginUpdate('foo', makeDeps())
    expect(r.text).toMatch(/up to date/i)
  })

  it('returns "updated" when changed', async () => {
    const deps = makeDeps({ update: async () => ({ changed: true }) })
    const r = await pluginUpdate('foo', deps)
    expect(r.text).toMatch(/updated/i)
  })

  it('returns error when update throws', async () => {
    const deps = makeDeps({ update: async () => { throw new Error('git error') } })
    const r = await pluginUpdate('foo', deps)
    expect('isError' in r && r.isError).toBe(true)
    expect(r.text).toMatch(/git error/)
  })
})

// ---------------------------------------------------------------------------
// createPluginCommand (dispatcher)
// ---------------------------------------------------------------------------

describe('createPluginCommand', () => {
  it('returns a SlashCommand with name "plugin"', () => {
    const cmd = createPluginCommand(makeDeps())
    expect(cmd.name).toBe('plugin')
  })

  it('dispatches to list', async () => {
    const cmd = createPluginCommand(makeDeps({ list: async () => [] }))
    const result = await cmd.run('list', {} as any)
    expect(result.type).toBe('text')
    expect((result as any).text).toMatch(/no plugins/i)
  })

  it('dispatches to search', async () => {
    const cmd = createPluginCommand(makeDeps())
    const result = await cmd.run('search foo', {} as any)
    expect(result.type).toBe('text')
    expect((result as any).text).toMatch(/foo/)
  })

  it('dispatches to install', async () => {
    const cmd = createPluginCommand(makeDeps())
    const result = await cmd.run('install myplugin', {} as any)
    expect((result as any).text).toMatch(/installed/i)
  })

  it('dispatches to uninstall', async () => {
    const cmd = createPluginCommand(makeDeps())
    const result = await cmd.run('uninstall myplugin', {} as any)
    expect((result as any).text).toMatch(/uninstalled/i)
  })

  it('dispatches to enable', async () => {
    const cmd = createPluginCommand(makeDeps())
    const result = await cmd.run('enable foo', {} as any)
    expect((result as any).text).toMatch(/enabled/i)
  })

  it('dispatches to disable', async () => {
    const cmd = createPluginCommand(makeDeps())
    const result = await cmd.run('disable bar', {} as any)
    expect((result as any).text).toMatch(/disabled/i)
  })

  it('dispatches to update', async () => {
    const deps = makeDeps({ update: async () => ({ changed: true }) })
    const cmd = createPluginCommand(deps)
    const result = await cmd.run('update foo', {} as any)
    expect((result as any).text).toMatch(/updated/i)
  })

  it('returns help text for unknown subcommand', async () => {
    const cmd = createPluginCommand(makeDeps())
    const result = await cmd.run('frobnicate', {} as any)
    expect((result as any).text).toMatch(/plugin.*list|list.*plugin/i)
  })

  it('returns help text for empty args', async () => {
    const cmd = createPluginCommand(makeDeps())
    const result = await cmd.run('', {} as any)
    expect((result as any).text).toMatch(/plugin/i)
  })
})
