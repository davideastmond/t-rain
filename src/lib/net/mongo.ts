// MongoDB GameStore. One cached client per server instance (important
// on serverless, where module state is reused across invocations but not
// across instances — hence the atomic updateOne filter on version,
// which is what actually prevents lost updates).

import { MongoClient } from "mongodb";

import type { PlayerId } from "@/lib/game/types";

import type { GameRecord, GameStore } from "./store";

let clientPromise: Promise<MongoClient> | null = null;

function getClient(): Promise<MongoClient> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");
  if (!clientPromise) {
    clientPromise = new MongoClient(uri).connect();
  }
  return clientPromise;
}

/** GameRecord as stored: gameId doubles as the string _id. */
type GameDoc = GameRecord & { _id: string };

async function gamesCollection() {
  const client = await getClient();
  const db = client.db(process.env.MONGODB_DB ?? "train");
  return db.collection<GameDoc>("games");
}

export class MongoGameStore implements GameStore {
  async create(record: GameRecord): Promise<void> {
    const col = await gamesCollection();
    try {
      await col.insertOne({ ...record, _id: record.gameId });
    } catch (error) {
      if ((error as { code?: number })?.code === 11000) {
        throw new Error("duplicate gameId");
      }
      throw error;
    }
  }

  async load(gameId: string): Promise<GameRecord | null> {
    const col = await gamesCollection();
    const doc = await col.findOne({ _id: gameId });
    if (!doc) return null;
    // Rebuild without _id: only gameId (the same value) is exposed.
    return {
      gameId: doc.gameId,
      version: doc.version,
      state: doc.state,
      events: doc.events,
      seats: doc.seats,
      setupEndsAt: doc.setupEndsAt,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }

  async save(record: GameRecord, expectedVersion: number): Promise<boolean> {
    const col = await gamesCollection();
    const next = {
      ...record,
      _id: record.gameId,
      version: expectedVersion + 1,
      updatedAt: new Date().toISOString(),
    };
    const result = await col.updateOne(
      { _id: record.gameId, version: expectedVersion },
      { $set: next },
    );
    return result.matchedCount === 1;
  }

  async touchSeat(gameId: string, seat: PlayerId): Promise<void> {
    const col = await gamesCollection();
    const now = new Date().toISOString();
    await col.updateOne(
      { _id: gameId },
      { $set: { [`seats.${seat}.lastSeenAt`]: now, updatedAt: now } },
    );
  }
}
