// POST /api/games — create a new network game.
//
// The creator takes the South seat; the North seat's link is for sharing.
// Raw bearer tokens are returned exactly once, here — afterwards only
// their hashes live in the game record.

import { createNetGame, gameLink, getGameStore } from "@/lib/net/games";

export async function POST() {
  const { record, tokens } = createNetGame();
  const store = getGameStore();
  await store.create(record);

  return Response.json(
    {
      gameId: record.gameId,
      yourSeat: "south",
      yourLink: gameLink(record.gameId, tokens.south),
      inviteLink: gameLink(record.gameId, tokens.north),
      version: record.version,
    },
    { status: 201 },
  );
}
