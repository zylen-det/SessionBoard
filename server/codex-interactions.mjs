import { randomUUID } from 'node:crypto'

const failure = (message, status = 400) => Object.assign(new Error(message), { status })
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const methods = new Map([
  ['item/commandExecution/requestApproval', 'command'],
  ['item/fileChange/requestApproval', 'fileChange'],
  ['item/permissions/requestApproval', 'permissions'],
  ['item/tool/requestUserInput', 'input'],
  ['tool/requestUserInput', 'input'],
  ['mcpServer/elicitation/request', 'elicitation'],
])
const labels = { command: 'Command approval', fileChange: 'File change approval', permissions: 'Permission request', input: 'Input requested', elicitation: 'Information requested' }

function optionsFor(schema) {
  if (Array.isArray(schema.enum)) return schema.enum.map((value, i) => ({ value, label: typeof schema.enumNames?.[i] === 'string' ? schema.enumNames[i] : value }))
  if (Array.isArray(schema.oneOf)) return schema.oneOf.map(option => ({ value: option?.const, label: typeof option?.title === 'string' ? option.title : option?.const }))
  if (Array.isArray(schema.anyOf)) return schema.anyOf.map(option => ({ value: option?.const, label: typeof option?.title === 'string' ? option.title : option?.const }))
  return null
}

function formFields(schema) {
  if (!object(schema) || schema.type !== 'object' || !object(schema.properties)) return null
  if (schema.required != null && (!Array.isArray(schema.required) || schema.required.some(id => typeof id !== 'string'))) return null
  if (Object.keys(schema).some(key => !['$schema', 'type', 'properties', 'required', 'additionalProperties', 'title', 'description'].includes(key))) return null
  const fields = []
  for (const [id, rule] of Object.entries(schema.properties)) {
    if (!object(rule) || !['string', 'number', 'integer', 'boolean', 'array'].includes(rule.type)) return null
    if (Object.keys(rule).some(key => !['type', 'title', 'description', 'default', 'enum', 'enumNames', 'oneOf', 'items', 'format', 'minLength', 'maxLength', 'minimum', 'maximum', 'minItems', 'maxItems'].includes(key))) return null
    if (rule.format && !['email', 'uri', 'date', 'date-time'].includes(rule.format)) return null
    const options = optionsFor(rule.type === 'array' ? rule.items ?? {} : rule)
    if (rule.type !== 'array' && (Object.hasOwn(rule, 'enum') || Object.hasOwn(rule, 'oneOf')) && !options?.length) return null
    if (rule.type === 'array' && (!object(rule.items) || Object.keys(rule.items).some(key => !['type', 'enum', 'anyOf'].includes(key)))) return null
    if (rule.type === 'array' && !options) return null
    if (options?.some(option => typeof option.value !== 'string')) return null
    fields.push({ id, label: typeof rule.title === 'string' ? rule.title : id, description: typeof rule.description === 'string' ? rule.description : undefined, type: rule.type, required: schema.required?.includes(id) ?? false, options,
      minLength: rule.minLength, maxLength: rule.maxLength, minimum: rule.minimum, maximum: rule.maximum, minItems: rule.minItems, maxItems: rule.maxItems, format: rule.format })
  }
  if (schema.required?.some(id => !fields.some(field => field.id === id))) return null
  return fields
}

function validateValues(fields, values) {
  if (!fields) throw failure('This form needs the original Codex client because its schema is not supported here.')
  if (!object(values) || Object.keys(values).some(id => !fields.some(field => field.id === id))) throw failure('The response contains unknown fields.')
  for (const field of fields) {
    const value = Object.hasOwn(values, field.id) ? values[field.id] : undefined
    if (value === undefined || value === '') { if (field.required) throw failure(`Answer ${field.label}.`); else continue }
    const bad = () => { throw failure(`Invalid value for ${field.label}.`) }
    if (field.type === 'string') {
      if (typeof value !== 'string' || value.length > (field.maxLength ?? 8000) || value.length < (field.minLength ?? 0)) bad()
      if (field.options && !field.allowOther && !field.options.some(option => option.value === value)) bad()
      if (field.format === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) bad()
      if (field.format === 'uri') { try { new URL(value) } catch { bad() } }
      if (field.format === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) bad()
      if (field.format === 'date-time' && (!/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value)))) bad()
    } else if (field.type === 'number' || field.type === 'integer') {
      if (!Number.isFinite(value) || (field.type === 'integer' && !Number.isInteger(value)) || (field.minimum != null && value < field.minimum) || (field.maximum != null && value > field.maximum)) bad()
    } else if (field.type === 'boolean') { if (typeof value !== 'boolean') bad() }
    else if (field.type === 'array') {
      if (!Array.isArray(value) || value.length < (field.minItems ?? 0) || value.length > (field.maxItems ?? 100) || new Set(value).size !== value.length || value.some(item => !field.options.some(option => option.value === item))) bad()
    }
  }
  return Object.fromEntries(fields.filter(field => Object.hasOwn(values, field.id) && values[field.id] !== '').map(field => [field.id, values[field.id]]))
}

/** Only live requests received on this connection are answerable. Never infer approvals from logs. */
export class CodexInteractions {
  constructor({ send, onChange, confirmationMs = 8000 }) {
    this.send = send; this.onChange = onChange; this.confirmationMs = confirmationMs; this.requests = new Map()
  }

  receive(message, changes) {
    const kind = methods.get(message.method), p = message.params
    if (!kind || !p?.threadId || !['string', 'number'].includes(typeof message.id)) return false
    if ([...this.requests.values()].some(request => request.wireId === message.id && request.threadId === p.threadId)) return true
    const requestId = randomUUID()
    const variant = kind === 'input' ? 'question' : kind === 'elicitation' ? 'elicitation' : 'permission'
    let fields = [], url = null
    if (kind === 'input') fields = Array.isArray(p.questions) && p.questions.length && p.questions.every(q => object(q) && typeof q.id === 'string' && typeof q.question === 'string' && (q.options == null || (Array.isArray(q.options) && q.options.every(option => object(option) && typeof option.label === 'string')))) && new Set(p.questions.map(q => q.id)).size === p.questions.length
      ? p.questions.map(q => ({ id: q.id, label: q.question, description: typeof q.header === 'string' ? q.header : undefined, type: 'string', required: true, secret: q.isSecret === true, allowOther: q.isOther === true || !q.options?.length, options: q.options?.map(option => ({ value: option.label, label: option.label, description: typeof option.description === 'string' ? option.description : undefined })) ?? null })) : null
    if (kind === 'elicitation') {
      if (p.mode === 'url') { try { const candidate = new URL(p.url); if (['http:', 'https:'].includes(candidate.protocol)) url = candidate.href } catch {} }
      else fields = ['form', 'openai/form', 'openaiForm'].includes(p.mode) ? formFields(p.requestedSchema) : null
    }
    const approval = ['command', 'fileChange', 'permissions'].includes(kind)
    const actions = approval
      ? [{ value: 'accept', label: 'Allow once' }, { value: 'acceptForSession', label: 'Allow for session' }, { value: 'decline', label: 'Deny' }, ...(kind === 'permissions' ? [] : [{ value: 'cancel', label: 'Cancel' }])]
      : [{ value: 'accept', label: kind === 'input' ? 'Send answer' : p.mode === 'url' ? 'I completed this step' : 'Submit' }, { value: 'decline', label: 'Decline' }, { value: 'cancel', label: 'Cancel' }].filter(action => kind !== 'input' || action.value === 'accept')
    const allowedActions = Array.isArray(p.availableDecisions) ? actions.filter(action => p.availableDecisions.includes(action.value)) : actions
    const detail = kind === 'command' ? { command: p.command, cwd: p.cwd, kind: p.kind, networkApprovalContext: p.networkApprovalContext, additionalPermissions: p.additionalPermissions }
      : kind === 'fileChange' ? { grantRoot: p.grantRoot, changes: changes ?? null }
        : kind === 'permissions' ? { cwd: p.cwd, permissions: p.permissions } : null
    const preview = [p.reason, p.message, kind === 'input' ? p.questions?.[0]?.question : null, labels[kind]].find(value => typeof value === 'string' && value.trim())
    const title = kind === 'command' && p.networkApprovalContext ? 'Network access approval' : kind === 'command' && p.kind === 'stdin' ? 'Command input approval' : labels[kind]
    const view = { requestId, variant, kind, title, preview, detail, fields, url, mode: p.mode, serverName: p.serverName, actions: allowedActions, canRespond: true,
      unsupported: !fields || (kind === 'permissions' && !object(p.permissions)) || (kind === 'elicitation' && p.mode === 'url' && !url) }
    this.requests.set(requestId, { requestId, wireId: message.id, threadId: p.threadId, turnId: p.turnId, itemId: p.itemId, params: p, kind, view, sent: false, waiter: null })
    this.onChange()
    return true
  }

  first(threadId) { return [...this.requests.values()].find(request => request.threadId === threadId) }
  view(threadId) { const request = this.first(threadId); return request ? { ...request.view, canRespond: !request.sent } : null }
  meta(threadId) { const request = this.first(threadId); return request ? { variant: request.view.variant, requestId: request.requestId, preview: request.view.preview } : null }

  resolved(threadId, wireId) {
    for (const request of this.requests.values()) if (request.threadId === threadId && request.wireId === wireId) {
      this.requests.delete(request.requestId)
      request.waiter?.resolve({ ok: true })
      this.onChange()
    }
  }

  clear(threadId, message = 'The Codex request was cleared. Check the original client.', status = 409) {
    for (const request of this.requests.values()) if (!threadId || request.threadId === threadId) {
      this.requests.delete(request.requestId)
      request.waiter?.reject(failure(message, status))
    }
  }

  clearItem(threadId, itemId) {
    if (!itemId) return
    for (const request of this.requests.values()) if (request.threadId === threadId && request.itemId === itemId) {
      this.requests.delete(request.requestId)
      request.waiter?.reject(failure('The Codex item has already completed. Refresh to see the latest request.', 409))
    }
  }

  async respond(threadId, payload) {
    const request = this.requests.get(payload?.requestId)
    if (!request || request.threadId !== threadId) throw failure('This request is no longer pending. Refresh to see the latest request.', 409)
    if (request.sent) throw failure('A response has already been sent. Waiting for Codex confirmation.', 409)
    const { action } = payload
    if (!request.view.actions.some(candidate => candidate.value === action)) throw failure('Unsupported decision for this request.')
    const { kind, params: p, view } = request
    if (view.unsupported && ['accept', 'acceptForSession'].includes(action)) throw failure('Complete this request in the original Codex client.')
    let result
    if (kind === 'command' || kind === 'fileChange') result = { decision: action }
    if (kind === 'permissions') result = { permissions: action === 'decline' ? {} : Object.fromEntries(Object.entries(p.permissions ?? {}).filter(([, value]) => value != null)), scope: action === 'acceptForSession' ? 'session' : 'turn' }
    if (kind === 'input') {
      const values = validateValues(view.fields, payload.values)
      result = { answers: Object.fromEntries(view.fields.map(field => [field.id, { answers: [values[field.id]] }])) }
    }
    if (kind === 'elicitation') result = { action, content: action !== 'accept' || p.mode === 'url' ? null : validateValues(view.fields, payload.values), _meta: null }
    request.sent = true
    this.onChange()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        request.waiter = null
        reject(failure('The response was sent, but Codex has not confirmed it. Check the original client before retrying.', 504))
        this.onChange()
      }, this.confirmationMs)
      timer.unref()
      request.waiter = { resolve: value => { clearTimeout(timer); resolve(value) }, reject: error => { clearTimeout(timer); reject(error) } }
      this.send(request.wireId, result).catch(error => {
        if (!request.waiter) return
        request.sent = false
        request.waiter.reject(failure(`Could not send the response: ${error.message}`, 502))
        request.waiter = null
        this.onChange()
      })
    })
  }
}
