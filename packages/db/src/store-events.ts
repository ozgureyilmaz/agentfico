import { createHash } from "node:crypto";
import { type BehaviorEvent, BehaviorEventSchema } from "@agentfico/core";
import { and, eq, inArray } from "drizzle-orm";
import type { AgentFicoDb } from "./client";
import { events } from "./schema";

export interface StoreEventsResult {
  inserted: number;
  duplicates: number;
}

const hashEvidence = (event: BehaviorEvent): string | null => {
  const { evidence } = event;
  if (
    !evidence ||
    !Object.values(evidence).some((value) => value !== undefined)
  ) {
    return null;
  }

  return createHash("sha256")
    .update(JSON.stringify(evidence, Object.keys(evidence).sort()))
    .digest("hex");
};

const insertEvents = (
  db: Pick<AgentFicoDb, "insert">,
  validatedEvents: readonly BehaviorEvent[],
): StoreEventsResult => {
  let inserted = 0;

  for (const event of validatedEvents) {
    const result = db
      .insert(events)
      .values({
        eventId: event.event_id,
        subjectAfcId: event.subject.afc_id,
        source: event.source,
        simulated: event.simulated,
        attestation: event.attestation,
        eventType: event.type,
        occurredAt: event.occurred_at,
        evidenceHash: hashEvidence(event),
        eventJson: JSON.stringify(event),
      })
      .onConflictDoNothing()
      .returning({ eventId: events.eventId })
      .get();

    if (result) inserted += 1;
  }

  return { inserted, duplicates: validatedEvents.length - inserted };
};

export const storeEvents = (
  db: AgentFicoDb,
  input: readonly unknown[],
): StoreEventsResult => {
  const validatedEvents = input.map((event) =>
    BehaviorEventSchema.parse(event),
  );
  return db.transaction((transaction) =>
    insertEvents(transaction, validatedEvents),
  );
};

export const replaceSimulatorEvents = (
  db: AgentFicoDb,
  input: readonly unknown[],
): StoreEventsResult => {
  const validatedEvents = input.map((event) =>
    BehaviorEventSchema.parse(event),
  );
  if (
    validatedEvents.some(
      (event) => event.source !== "simulator" || !event.simulated,
    )
  ) {
    throw new Error(
      "Simulator replacement requires simulated simulator events",
    );
  }
  const subjects = [
    ...new Set(validatedEvents.map((event) => event.subject.afc_id)),
  ];
  if (subjects.length === 0) return { inserted: 0, duplicates: 0 };

  return db.transaction((transaction) => {
    transaction
      .delete(events)
      .where(
        and(
          eq(events.source, "simulator"),
          eq(events.simulated, true),
          inArray(events.subjectAfcId, subjects),
        ),
      )
      .run();
    return insertEvents(transaction, validatedEvents);
  });
};
