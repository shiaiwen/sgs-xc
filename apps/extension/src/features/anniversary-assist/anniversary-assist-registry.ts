import type { AnniversaryAssistController } from './anniversary-assist-controller.ts';

let controller: AnniversaryAssistController | null = null;

export function setAnniversaryAssistController(next: AnniversaryAssistController | null): void {
  controller = next;
}

export function getAnniversaryAssistController(): AnniversaryAssistController | null {
  return controller;
}