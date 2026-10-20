/** Renderer/Mainで共有する入力検証スキーマの定義元。Phase 1から契約ごとに追加する。 */
export type ValidationIssue = Readonly<{ path: string; message: string }>
