import { describe, it, expect, beforeEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { TaskGraph } from '../../../src/core/coordination/taskGraph'
import { saveGraph, loadGraph } from '../../../src/core/coordination/persist'
import type { SubTask } from '../../../src/core/coordination/types'

const mk = (id: string, dependsOn: string[] = []): SubTask => ({
  id,
  title: id,
  profile: 'feature',
  testStrategy: 'tdd',
  agentId: null,
  status: 'pending',
  dependsOn,
  contextFor: [],
  result: null,
})

describe('TaskGraph', () => {
  let tmp: string
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nuka-tg-'))
  })

  it('add + ready 返回所有无依赖任务', () => {
    const g = new TaskGraph({ rootMessage: 'x', difficulty: 'hard' })
    g.add(mk('a'))
    g.add(mk('b', ['a']))
    g.add(mk('c'))
    expect(g.ready().map((t) => t.id).sort()).toEqual(['a', 'c'])
  })

  it('markRunning + markDone 解锁下游', () => {
    const g = new TaskGraph({ rootMessage: 'x', difficulty: 'hard' })
    g.add(mk('a'))
    g.add(mk('b', ['a']))
    expect(g.ready().map((t) => t.id)).toEqual(['a'])
    g.markRunning('a', 'agent1')
    g.markDone('a', { summary: 's', artifacts: [] })
    const ready = g.ready()
    expect(ready.map((t) => t.id)).toEqual(['b'])
  })

  it('markListening 不算 done，下游仍解锁', () => {
    const g = new TaskGraph({ rootMessage: 'x', difficulty: 'hell' })
    g.add(mk('a'))
    g.add(mk('b', ['a']))
    g.markRunning('a', 'agent1')
    g.markListening('a')
    const ready = g.ready()
    expect(ready.map((t) => t.id)).toEqual(['b'])
  })

  it('toposort 处理跨层级依赖（Kahn）', () => {
    const g = new TaskGraph({ rootMessage: 'x', difficulty: 'hard' })
    // a → b, a → c, b → d, c → d
    g.add(mk('a'))
    g.add(mk('b', ['a']))
    g.add(mk('c', ['a']))
    g.add(mk('d', ['b', 'c']))
    const order = g.toposort()
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'))
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('c'))
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('d'))
    expect(order.indexOf('c')).toBeLessThan(order.indexOf('d'))
  })

  it('toposort 检测环并抛错', () => {
    const g = new TaskGraph({ rootMessage: 'x', difficulty: 'hard' })
    g.add(mk('a', ['b']))
    g.add(mk('b', ['a']))
    expect(() => g.toposort()).toThrow(/cycle/i)
  })

  it('toJSON / fromJSON 圆周', () => {
    const g = new TaskGraph({ rootMessage: 'x', difficulty: 'hell' })
    g.add(mk('a'))
    g.link('a', 'b', 'a precedes b')
    g.add(mk('b', ['a']))
    g.markRunning('a', 'agent1')
    const round = TaskGraph.fromJSON(g.toJSON())
    expect(round.ready().map((t) => t.id)).toHaveLength(0) // a is running
    expect(round.snapshot().correlations).toHaveLength(1)
  })

  it('saveGraph / loadGraph 文件持久化', () => {
    const g = new TaskGraph({ rootMessage: 'persist me', difficulty: 'medium' })
    g.add(mk('a'))
    const file = path.join(tmp, 'graph.json')
    saveGraph(file, g)
    const loaded = loadGraph(file)
    expect(loaded?.snapshot().rootMessage).toBe('persist me')
    expect(loaded?.ready().map((t) => t.id)).toEqual(['a'])
  })

  it('loadGraph 不存在时返回 null', () => {
    expect(loadGraph(path.join(tmp, 'nope.json'))).toBeNull()
  })

  it('loadGraph 损坏文件时返回 null（不抛错）', () => {
    const file = path.join(tmp, 'broken.json')
    fs.writeFileSync(file, '{not valid', 'utf8')
    expect(loadGraph(file)).toBeNull()
  })

  it('link 添加 correlation 不重复', () => {
    const g = new TaskGraph({ rootMessage: 'x', difficulty: 'hard' })
    g.add(mk('a'))
    g.add(mk('b'))
    g.link('a', 'b', 'reason1')
    g.link('a', 'b', 'reason2') // 同一对，不应重复
    expect(g.snapshot().correlations).toHaveLength(1)
  })
})
