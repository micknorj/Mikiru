import type { ErrorCode } from '../src/shared/contracts.ts';
export class Failure extends Error {
  constructor(readonly code: ErrorCode, readonly status: number) { super(code); }
}
