import type { CreateUserInput, LoginInput, NewPasswordInput, PasswordChangeInput, ResetInput, Role, SetupInput, UpdateUserInput } from '../contracts'

export type ValidationIssue = Readonly<{ path: string; message: string }>
export type ValidationResult<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; issues: readonly ValidationIssue[] }>
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const stringField = (v: Record<string, unknown>, key: string, min: number, max: number): string | undefined => {
  const value = v[key]
  return typeof value === 'string' && [...value].length >= min && [...value].length <= max ? value : undefined
}
function parse<T>(input: unknown, fields: Record<string, (v: Record<string, unknown>) => unknown>, required: readonly string[]): ValidationResult<T> {
  if (!isRecord(input) || Object.keys(input).some((key) => !required.includes(key))) return { ok: false, issues: [{ path: '', message: '入力形式が正しくありません。' }] }
  const output: Record<string, unknown> = {}
  const issues: ValidationIssue[] = []
  for (const key of required) {
    const value = fields[key]?.(input)
    if (value === undefined) issues.push({ path: key, message: '入力内容を確認してください。' })
    else output[key] = value
  }
  return issues.length ? { ok: false, issues } : { ok: true, value: output as T }
}
const role = (v: Record<string, unknown>): Role | undefined => v.role === 'ADMIN' || v.role === 'STAFF' ? v.role : undefined
const login = (v: Record<string, unknown>): string | undefined => stringField(v, 'loginName', 1, 64)?.trim()
const name = (v: Record<string, unknown>, key: string): string | undefined => {
  const value = stringField(v, key, 1, 100)?.trim()
  return value && [...value].length > 0 ? value : undefined
}
const password = (v: Record<string, unknown>, key: string): string | undefined => {
  const value = stringField(v, key, 12, 128)
  return value && [...value].length >= 12 ? value : undefined
}
export const validateSetup = (v: unknown) => parse<SetupInput>(v, {
  storeName: (x) => name(x, 'storeName'), displayName: (x) => name(x, 'displayName'), loginName: login,
  password: (x) => password(x, 'password'), confirmPassword: (x) => password(x, 'confirmPassword')
}, ['storeName', 'displayName', 'loginName', 'password', 'confirmPassword'])
export const validateLogin = (v: unknown) => parse<LoginInput>(v, { loginName: login, password: (x) => stringField(x, 'password', 1, 128) }, ['loginName', 'password'])
export const validatePasswordChange = (v: unknown) => parse<PasswordChangeInput>(v, {
  currentPassword: (x) => stringField(x, 'currentPassword', 1, 128), newPassword: (x) => password(x, 'newPassword'), confirmPassword: (x) => password(x, 'confirmPassword')
}, ['currentPassword', 'newPassword', 'confirmPassword'])
export const validateReset = (v: unknown) => parse<ResetInput>(v, { loginName: login, code: (x) => stringField(x, 'code', 1, 128) }, ['loginName', 'code'])
export const validateNewPassword = (v: unknown) => parse<NewPasswordInput>(v, { password: (x) => password(x, 'password'), confirmPassword: (x) => password(x, 'confirmPassword') }, ['password', 'confirmPassword'])
export const validateCreateUser = (v: unknown) => parse<CreateUserInput>(v, { loginName: login, displayName: (x) => name(x, 'displayName'), role }, ['loginName', 'displayName', 'role'])
export const validateUpdateUser = (v: unknown) => parse<UpdateUserInput>(v, {
  userId: (x) => typeof x.userId === 'string' && /^[0-9a-f-]{36}$/i.test(x.userId) ? x.userId : undefined,
  displayName: (x) => name(x, 'displayName'), role
}, ['userId', 'displayName', 'role'])
