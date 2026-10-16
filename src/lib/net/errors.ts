// Maps engine error codes to HTTP status for the action routes.
//
// 403: the request was well-formed but the game state forbids it
//      (wrong phase/turn, or the seat already acted).
// 400: the request itself was invalid (bad body, illegal placement/move).

const FORBIDDEN = new Set(["wrong-phase", "not-your-turn", "already-setup"]);

export function errorStatus(error: string): 400 | 403 {
  return FORBIDDEN.has(error) ? 403 : 400;
}
