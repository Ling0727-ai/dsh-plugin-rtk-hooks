import test from 'node:test'
import assert from 'node:assert/strict'
import { name, apply } from '../lib/index.js'

test('exports a DSH plugin', () => {
  assert.equal(name, 'rtk-hooks')
  assert.equal(typeof apply, 'function')
})
