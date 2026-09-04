import { setLlmProvider } from '../src/core/llm/provider';
import { createOfflineProvider, type OfflineOptions } from '../src/core/llm/offline';

/** Installs the offline provider from src/core/llm/offline for the duration of a test. */
export function installMockLlm(options: OfflineOptions = {}): { calls: string[] } {
  const calls: string[] = [];
  setLlmProvider(createOfflineProvider(options, calls));
  return { calls };
}

export function uninstallMockLlm(): void {
  setLlmProvider(null);
}
