// Produce complete JSON fixtures from the upstream generated API contracts.
import ts from '../apps/web/node_modules/typescript/lib/typescript.js'
import fs from 'node:fs'
import path from 'node:path'
const dirs = ['apps/web/src/types/generated', 'packages/shared/src/types/generated']
const types = new Map()
for (const dir of dirs) for (const file of fs.readdirSync(dir)) {
  if (!file.endsWith('.ts')) continue
  const ast = ts.createSourceFile(file, fs.readFileSync(path.join(dir, file), 'utf8'), ts.ScriptTarget.Latest, true)
  for (const stmt of ast.statements) if (ts.isTypeAliasDeclaration(stmt)) types.set(stmt.name.text, stmt.type)
}
function value(node, seen = new Set()) {
  if (!node) return null
  if (ts.isUnionTypeNode(node)) {
    if (node.types.some(t => t.kind === ts.SyntaxKind.NullKeyword || (ts.isLiteralTypeNode(t) && t.literal.kind === ts.SyntaxKind.NullKeyword))) return null
    return value(node.types[0], seen)
  }
  if (ts.isTypeLiteralNode(node)) return Object.fromEntries(node.members.filter(m => ts.isPropertySignature(m) && !m.questionToken).map(m => [m.name.text, value(m.type, seen)]))
  if (ts.isArrayTypeNode(node)) return []
  if (ts.isLiteralTypeNode(node)) return node.literal.kind === ts.SyntaxKind.TrueKeyword ? true : node.literal.kind === ts.SyntaxKind.FalseKeyword ? false : node.literal.text ?? null
  if (ts.isTypeReferenceNode(node)) {
    const name = node.typeName.getText()
    if (name === 'Array') return []
    if (name === 'Record') return {}
    if (seen.has(name)) return null
    return value(types.get(name), new Set([...seen, name]))
  }
  if (node.kind === ts.SyntaxKind.StringKeyword) return ''
  if (node.kind === ts.SyntaxKind.NumberKeyword || node.kind === ts.SyntaxKind.BigIntKeyword) return 0
  if (node.kind === ts.SyntaxKind.BooleanKeyword) return false
  return null
}
const names = ['LiveSession', 'SessionInfo', 'SessionDetail', 'ExtendedDashboardStats', 'AIGenerationStatsResponse', 'SystemResponse', 'StorageStats', 'RichSessionData', 'ContributionsResponse', 'InsightsResponse', 'SearchResponse', 'ClaudeCodeSettingsResponse', 'MemoryResponse', 'PluginsResponse', 'ScoreResponse']
fs.writeFileSync('apps/web/src/demo/defaults.json', JSON.stringify(Object.fromEntries(names.map(name => [name, value(types.get(name))])), null, 2) + '\n')
