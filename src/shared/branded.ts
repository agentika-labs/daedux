/**
 * Effect branded types for function parameters.
 * Use these to prevent mixing structurally identical but semantically different values.
 *
 * Example:
 *   const getSession = (id: SessionId) => ...
 *   getSession(projectPath)  // ❌ Type error
 *   getSession(sessionId)    // ✅ Works
 */

import { Brand } from "effect";

// ─── Identity Types ─────────────────────────────────────────────────────────

export type SessionId = string & Brand.Brand<"SessionId">;
export const SessionId = Brand.nominal<SessionId>();

export type QueryId = string & Brand.Brand<"QueryId">;
export const QueryId = Brand.nominal<QueryId>();

export type ProjectPath = string & Brand.Brand<"ProjectPath">;
export const ProjectPath = Brand.nominal<ProjectPath>();

export type FilePath = string & Brand.Brand<"FilePath">;
export const FilePath = Brand.nominal<FilePath>();

// ─── Numeric Types ──────────────────────────────────────────────────────────

export type UnixTimestampMs = number & Brand.Brand<"UnixTimestampMs">;
export const UnixTimestampMs = Brand.nominal<UnixTimestampMs>();

export type CostUsd = number & Brand.Brand<"CostUsd">;
export const CostUsd = Brand.nominal<CostUsd>();

// ─── Time Utilities ────────────────────────────────────────────────────────

export const nowMs = (): UnixTimestampMs => UnixTimestampMs(Date.now());

export const addMs = (base: UnixTimestampMs, delta: number): UnixTimestampMs =>
  UnixTimestampMs(base + delta);
