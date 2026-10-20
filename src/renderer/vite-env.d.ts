/// <reference types="vite/client" />
import type { CreateUserInput, IpcResult, LoginInput, NewPasswordInput, PasswordChangeInput, ResetInput, SessionView, SetupInput, UpdateUserInput, UserSummary } from '../shared/contracts'

declare global {
  interface Window {
    storeApp: {
      setup: { isRequired(): Promise<IpcResult<boolean>>; createInitialAdmin(input: SetupInput): Promise<IpcResult<SessionView>> }
      auth: {
        login(input: LoginInput): Promise<IpcResult<SessionView>>
        getSession(): Promise<IpcResult<SessionView | null>>
        logout(): Promise<IpcResult<null>>
        unlock(password: string): Promise<IpcResult<SessionView>>
        changeOwnPassword(input: PasswordChangeInput): Promise<IpcResult<null>>
        beginPasswordReset(input: ResetInput): Promise<IpcResult<SessionView>>
        completePasswordReset(input: NewPasswordInput): Promise<IpcResult<null>>
      }
      users: {
        list(): Promise<IpcResult<UserSummary[]>>
        create(input: CreateUserInput): Promise<IpcResult<{ user: UserSummary; code: string; expiresAt: string }>>
        update(input: UpdateUserInput): Promise<IpcResult<null>>
        deactivate(userId: string): Promise<IpcResult<null>>
        issuePasswordReset(userId: string): Promise<IpcResult<{ code: string; expiresAt: string }>>
      }
    }
  }
}
