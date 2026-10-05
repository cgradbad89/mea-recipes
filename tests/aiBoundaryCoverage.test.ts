import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const boundary = 'lib/ai.ts'
const config = 'lib/aiConfig.ts'
const photoScript = 'scripts/generate-photos.js'
const primitives = new Set(['generateText', 'generateObject', 'streamText', 'streamObject', 'generateImage'])
const providerPackages = ['@ai-sdk/openai', '@ai-sdk/anthropic', '@ai-sdk/google', '@google/generative-ai', 'openai', '@anthropic-ai/sdk']
const endpoints = /api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com|\/v1\/(?:chat\/completions|responses|messages)\b/
const credentials = /\b(?:OPENAI_API_KEY|ANTHROPIC_API_KEY|GOOGLE_GENERATIVE_AI_API_KEY|GEMINI_API_KEY|NEXT_PUBLIC_[A-Z0-9_]*(?:AI|OPENAI|ANTHROPIC|GEMINI|GENERATIVE)[A-Z0-9_]*(?:KEY|TOKEN|SECRET|CREDENTIAL)[A-Z0-9_]*)\b/
const modelId = /^(?:openai|anthropic|google|gemini|xai|mistral|deepseek|meta|cohere|amazon|bedrock)\/[\w.-]+$/

function runtimeFiles(directory: string): string[] {
  return readdirSync(join(root, directory), { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap(entry => {
      const path = `${directory}/${entry.name}`
      if (['node_modules', '.next', '.git', 'docs', 'tests', '__tests__'].includes(entry.name)) return []
      if (entry.isDirectory()) return runtimeFiles(path)
      return entry.isFile() && /\.(?:[cm]?[jt]s|[jt]sx)$/.test(path) &&
        !/\.(?:test|spec|d)\.[cm]?[jt]sx?$/.test(path) ? [path] : []
    })
}

function source(path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

function literal(node: ts.Node | undefined): string | undefined {
  return node && ts.isStringLiteralLike(node) ? node.text : undefined
}

function memberName(node: ts.Expression): string | undefined {
  if (ts.isIdentifier(node)) return node.text
  if (ts.isPropertyAccessExpression(node)) return node.name.text
  if (ts.isElementAccessExpression(node)) return literal(node.argumentExpression)
}

function runtimeImport(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause
  if (!clause) return true
  if (clause.isTypeOnly) return false
  if (clause.name || !clause.namedBindings || ts.isNamespaceImport(clause.namedBindings)) return true
  return clause.namedBindings.elements.length === 0 || clause.namedBindings.elements.some(item => !item.isTypeOnly)
}

function findings(path: string, contents: string): string[] {
  const file = ts.createSourceFile(path, contents, ts.ScriptTarget.Latest, true)
  const initializers = new Map<string, ts.Expression[]>()
  const collect = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      initializers.set(node.name.text, [...initializers.get(node.name.text) ?? [], node.initializer])
    }
    ts.forEachChild(node, collect)
  }
  collect(file)
  const violations = new Set<string>()
  const report = (rule: string, node: ts.Node) => {
    const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1
    violations.add(`${path}:${line}: ${rule}`)
  }
  const checkModule = (name: string | undefined, node: ts.Node) => {
    if (!name) return
    if (path !== boundary && (name === 'ai' || name.startsWith('ai/') || name === '@ai-sdk/gateway' || name.startsWith('@ai-sdk/gateway/'))) {
      report('runtime SDK/Gateway import outside lib/ai.ts', node)
    }
    if (providerPackages.some(pkg => name === pkg || name.startsWith(`${pkg}/`)) ||
      (name.startsWith('@ai-sdk/') && !/^@ai-sdk\/(?:gateway|provider|provider-utils)(?:\/|$)/.test(name))) {
      report('direct provider SDK', node)
    }
  }
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && runtimeImport(node)) checkModule(literal(node.moduleSpecifier), node)
    if (ts.isExportDeclaration(node) && !node.isTypeOnly &&
      (!node.exportClause || !ts.isNamedExports(node.exportClause) || node.exportClause.elements.some(item => !item.isTypeOnly))) {
      checkModule(literal(node.moduleSpecifier), node)
    }
    if (ts.isImportEqualsDeclaration(node) && !node.isTypeOnly && ts.isExternalModuleReference(node.moduleReference)) {
      checkModule(literal(node.moduleReference.expression), node)
    }
    if (ts.isCallExpression(node)) {
      const name = memberName(node.expression)
      if (name === 'require' || node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        checkModule(literal(node.arguments[0]), node)
      }
      if (path !== boundary && (primitives.has(name ?? '') || name === 'gateway' ||
        ((ts.isPropertyAccessExpression(node.expression) || ts.isElementAccessExpression(node.expression)) &&
          memberName(node.expression.expression) === 'gateway' && name === 'imageModel'))) {
        report('model primitive outside lib/ai.ts', node)
      }
      // Historical audit/provenance literals are evidence, not invocation settings.
      // Check model IDs in actual AI calls, including calls in the central boundary.
      if (path !== config && (primitives.has(name ?? '') || name === 'gateway' || name === 'imageModel' ||
        /^generateAI(?:Text|Object|Array|Image)$/.test(name ?? ''))) {
        const checked = new Set<ts.Node>()
        const checkModel = (child: ts.Node) => {
          if (checked.has(child)) return
          checked.add(child)
          const value = literal(child)
          if (value && modelId.test(value)) report('model identity outside lib/aiConfig.ts', child)
          if (ts.isIdentifier(child)) initializers.get(child.text)?.forEach(checkModel)
          ts.forEachChild(child, checkModel)
        }
        node.arguments.forEach(checkModel)
      }
    }
    // AST nodes exclude comments and documentation strings containing primitive names.
    // Endpoint/credential literals still count, including computed env-property access.
    const value = literal(node) ?? (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node) ? node.text : undefined)
    if (value && endpoints.test(value)) report('direct provider endpoint', node)
    if ((value && credentials.test(value)) || (ts.isIdentifier(node) && credentials.test(node.text))) {
      report('provider credential', node)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return [...violations]
}

const files = ['app', 'lib', 'scripts', 'components', 'hooks', 'types'].flatMap(runtimeFiles)
const violations = files.flatMap(path => findings(path, source(path)))

describe('repository-wide AI provider and model boundary', () => {
  it('keeps runtime SDK imports and model primitives in lib/ai.ts across routes, helpers and scripts', () => {
    expect(files).toContain(photoScript)
    expect(violations.filter(item => /import|primitive|SDK/.test(item))).toEqual([])
  })

  it('bans direct provider dependencies, active endpoints and credential families', () => {
    const pkg = JSON.parse(source('package.json'))
    const dependencies = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies })
    expect(dependencies.filter(name => providerPackages.includes(name))).toEqual([])
    expect(violations.filter(item => /endpoint|credential/.test(item))).toEqual([])
    expect(source('.env.example')).not.toMatch(credentials)
  })

  it('owns invocation models centrally and explicitly protects the photo-script migration', () => {
    expect(violations.filter(item => /model identity/.test(item))).toEqual([])
    const photos = source(photoScript)
    expect(findings(photoScript, photos)).toEqual([])
    expect(photos).not.toContain('openai/gpt-image-2')
    expect(photos).toContain("ssrLoadModule('/lib/ai.ts')")
    expect(photos).toMatch(/\b(?:ai\.)?generateAIImage\s*\(/)
    expect(photos).toContain("feature: 'recipe-photo-generation'")
    expect(photos).toMatch(/finally\s*\{\s*await close\(\)/)
    expect(photos).not.toMatch(/\battempts\s*[:,]/)
  })

  it('detects the original CommonJS bypass and future aliases, dynamic imports and provider calls', () => {
    const original = findings(photoScript, `
      const { generateImage } = require('ai')
      const { gateway } = require('@ai-sdk/gateway')
      generateImage({ model: gateway.imageModel('openai/gpt-image-2'), prompt, size: '1024x1024' })
    `)
    expect(original).toEqual(expect.arrayContaining([
      expect.stringContaining('runtime SDK/Gateway import'),
      expect.stringContaining('model primitive'),
      expect.stringContaining('model identity'),
    ]))
    const bypasses = [
      `import { generateText as run } from 'ai'; run({})`,
      `import * as models from 'ai'; models.generateObject({})`,
      `await import('@ai-sdk/gateway')`,
      `export { gateway } from '@ai-sdk/gateway'`,
      `const sdk = require('@ai-sdk/openai'); sdk.openai('gpt-example')`,
      `import OpenAI from 'openai'; new OpenAI()`,
      `fetch('https://api.openai.com/v1/responses')`,
      `fetch('https://api.anthropic.com/v1/messages')`,
      `fetch('https://generativelanguage.googleapis.com/v1/models')`,
      'fetch(`https://api.openai.com/${path}`)',
      `process.env.OPENAI_API_KEY; process.env['GEMINI_API_KEY']`,
      `process.env.ANTHROPIC_API_KEY; process.env.GOOGLE_GENERATIVE_AI_API_KEY`,
      `process.env.NEXT_PUBLIC_AI_GATEWAY_API_KEY`,
      ...[...primitives].map(name => `${name}({})`),
      `gateway('openai/gpt-example')`,
      `gateway['imageModel']('openai/gpt-example')`,
    ]
    for (const contents of bypasses) expect(findings('scripts/future-helper.ts', contents), contents).not.toEqual([])
    expect(findings(boundary, `generateImage({ model: gateway.imageModel('openai/gpt-example') })`))
      .toEqual([expect.stringContaining('model identity')])
    expect(findings(boundary, `const localModel = 'openai/gpt-example'; generateImage({ model: gateway.imageModel(localModel) })`))
      .toEqual([expect.stringContaining('model identity')])
  })

  it('allows type-only imports, central invocations, comments and unrelated names without false positives', () => {
    expect(findings(config, `import type { GatewayProviderOptions } from '@ai-sdk/gateway'`)).toEqual([])
    expect(findings('app/api/example/route.ts', `
      import type { ModelMessage } from 'ai'
      import { type ModelMessage as Message } from 'ai'
      // generateText({ model: gateway('openai/gpt-example') })
      /* require('ai'); gateway.imageModel('openai/gpt-example') */
      const report = 'generateImage(...) via lib/ai.ts'
      const generateTextareaRef = null
      const settings = { model: 'openai/gpt-example' } // Historical evidence only
      process.env.AI_GATEWAY_API_KEY
    `)).toEqual([])
    expect(findings(boundary, `
      import { generateText, generateImage } from 'ai'
      import { gateway } from '@ai-sdk/gateway'
      generateText({ model: gateway(AI_MODEL) })
      generateImage({ model: gateway.imageModel(AI_IMAGE_MODEL) })
    `)).toEqual([])
  })
})
