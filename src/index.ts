import { spawn } from 'node:child_process'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { PostToolDecision, PreToolDecision, ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'

type CommandArgs = { command?: unknown }
type TextBlock = { type: 'text'; text: string }

export const name = 'rtk-hooks'
export const inject = ['tools']

export interface Config {
  /** Ask the model to retry with RTK when RTK has a rewrite for the command. */
  denyOnMiss?: boolean
  /** Run `rtk pipe` on text output. Disabled by default because filter selection is heuristic. */
  filterOutput?: boolean
  /** RTK executable name or absolute path. */
  executable?: string
  /** Maximum denials for one exact command before allowing it, preventing retry loops. */
  maxDenialsPerCommand?: number
  /** Timeout for each RTK subprocess. */
  timeoutMs?: number
  /** Explicit RTK filter names keyed by executable command (for example `{ git: 'git' }`). */
  filters?: Record<string, string>
}

export const Config: z<Config> = z.object({
  denyOnMiss: z.boolean().default(true),
  filterOutput: z.boolean().default(false),
  executable: z.string().default('rtk'),
  maxDenialsPerCommand: z.number().default(3),
  timeoutMs: z.number().default(5000),
  filters: z.object({}).default({}) as unknown as z<NonNullable<Config['filters']> >,
})

const COMMAND_TOOLS = new Set(['bash', 'pwsh'])

function commandOf(exec: ToolExecution): string | undefined {
  if (!COMMAND_TOOLS.has(exec.name)) return undefined
  if (typeof exec.arguments !== 'object' || exec.arguments === null) return undefined
  const command = (exec.arguments as CommandArgs).command
  return typeof command === 'string' && command.trim() !== '' ? command.trim() : undefined
}

function rtk(args: readonly string[], config: Config, stdin?: string): Promise<{ stdout: string; code: number }> {
  return new Promise((resolve) => {
    const child = spawn(config.executable ?? 'rtk', [...args], { windowsHide: true, shell: false })
    let stdout = ''
    let settled = false
    const finish = (code: number) => {
      if (settled) return
      settled = true
      resolve({ stdout, code })
    }
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { stdout += chunk })
    child.on('error', () => finish(1))
    child.on('close', (code) => finish(code ?? 1))
    const timer = setTimeout(() => { child.kill(); finish(1) }, config.timeoutMs ?? 5000)
    child.once('close', () => clearTimeout(timer))
    if (stdin !== undefined) {
      child.stdin.end(stdin)
    } else {
      child.stdin.end()
    }
  })
}

function suggestedCommand(output: string, original: string): string | undefined {
  const candidate = output.trim().split(/\r?\n/)[0]?.trim()
  if (!candidate || candidate === original || candidate.startsWith('No rewrite for:')) return undefined
  return candidate
}

function filterFor(command: string, config: Config): string | undefined {
  const executable = command.match(/^[\s]*(?:&\s*)?(?:["']([^"']+)["']|([^\s|;&]+))/)?.[1]
    ?? command.match(/^[\s]*(?:&\s*)?(?:["']([^"']+)["']|([^\s|;&]+))/)?.[2]
  if (!executable) return undefined
  const key = executable.split(/[\\/]/).pop()?.replace(/\.exe$/i, '') ?? executable
  const explicit = config.filters?.[key]
  if (explicit) return explicit
  if (key === 'git') {
    if (/^git\s+diff\b/.test(command)) return 'git-diff'
    if (/^git\s+status\b/.test(command)) return 'git-status'
    if (/^git\s+log\b/.test(command)) return 'git-log'
  }
  return ({ cargo: 'cargo-test', pytest: 'pytest', grep: 'grep', rg: 'grep', find: 'find', phpunit: 'phpunit' } as Record<string, string>)[key]
}

function textBlocks(result: ToolExecutionResult): TextBlock[] | undefined {
  const blocks = result.content.filter((block): block is TextBlock => block.type === 'text')
  return blocks.length === result.content.length && blocks.length > 0 ? blocks : undefined
}

export function apply(ctx: Context, input: Config): void {
  const config = { ...input, maxDenialsPerCommand: Math.max(1, Math.floor(input.maxDenialsPerCommand ?? 3)) }
  const denials = new Map<string, number>()

  ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    const command = commandOf(exec)
    if (!config.denyOnMiss || command === undefined) return next()
    const result = await rtk(['hook', 'check', command], config)
    const suggestion = result.code === 0 ? suggestedCommand(result.stdout, command) : undefined
    if (!suggestion) return next()
    const count = (denials.get(command) ?? 0) + 1
    denials.set(command, count)
    if (count > config.maxDenialsPerCommand) {
      ctx.logger.warn(`${name}: allowing command after ${config.maxDenialsPerCommand} denials: ${command}`)
      return next()
    }
    return {
      kind: 'deny',
      reason: `RTK can reduce this command's output. Retry with: ${suggestion} (attempt ${count}/${config.maxDenialsPerCommand})`,
    }
  })

  ctx.on('tools/post-execute', async (exec, result, next): Promise<PostToolDecision> => {
    if (!config.filterOutput || exec.name !== 'bash' && exec.name !== 'pwsh') return next()
    const command = commandOf(exec)
    const filter = command === undefined ? undefined : filterFor(command, config)
    const blocks = textBlocks(result)
    if (!filter || !blocks || result.isError) return next()
    const source = blocks.map(block => block.text).join('\n')
    const filtered = await rtk(['pipe', '--filter', filter], config, source)
    if (filtered.code !== 0 || filtered.stdout.trim() === '') return next()
    return { kind: 'accept', content: [{ type: 'text', text: filtered.stdout }] }
  })
}
