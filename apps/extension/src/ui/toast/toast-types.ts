export type ToastKind = 'success' | 'warning' | 'error';

export interface ToastNotice {
  id: number;
  message: string;
  kind: ToastKind;
}
