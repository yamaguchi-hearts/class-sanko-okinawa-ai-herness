import { describe, expect, it } from 'vitest'
import { validateLogin, validateNewPassword, validatePasswordChange, validateSetup } from '../../src/shared/validation'

const setupInput = (password: string, confirmPassword = password) => ({ storeName: '検証店舗', displayName: '管理者', loginName: 'admin', password, confirmPassword })
const changeInput = (newPassword: string, confirmPassword = newPassword) => ({ currentPassword: 'x', newPassword, confirmPassword })
const resetInput = (password: string, confirmPassword = password) => ({ password, confirmPassword })
const passes = (result: { ok: boolean }) => result.ok

describe('DEMO new-password policy', () => {
  it.each([
    ['initial setup', validateSetup, setupInput],
    ['own password change', validatePasswordChange, changeInput],
    ['password reset', validateNewPassword, resetInput]
  ])('%s enforces 4-128 Unicode code points', (_name, validate, input) => {
    expect(passes(validate(input('abc')))).toBe(false)
    expect(passes(validate(input('abcd')))).toBe(true)
    expect(passes(validate(input('abcd', 'abce')))).toBe(false)
    expect(passes(validate(input('a'.repeat(128))))).toBe(true)
    expect(passes(validate(input('a'.repeat(129))))).toBe(false)
    expect(passes(validate(input('')))).toBe(false)
    expect(passes(validate(input('    ')))).toBe(true)
    expect(passes(validate(input('😀'.repeat(128))))).toBe(true)
    expect(passes(validate(input('😀'.repeat(129))))).toBe(false)
  })

  it('keeps login and current-password validation independent of the new-password minimum', () => {
    expect(validateLogin({ loginName: 'admin', password: 'x' }).ok).toBe(true)
    expect(validatePasswordChange({ currentPassword: 'x', newPassword: 'abcd', confirmPassword: 'abcd' }).ok).toBe(true)
    expect(validateLogin({ loginName: 'admin', password: 'x'.repeat(129) }).ok).toBe(false)
  })
})