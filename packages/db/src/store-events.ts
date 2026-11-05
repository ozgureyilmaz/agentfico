import { createHash } from "node:crypto";
import { type BehaviorEvent, BehaviorEventSchema } from "@agentfico/core";
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

export const storeEvents = (
  db: AgentFicoDb,
  input: readonly unknown[],
): StoreEventsResult => {
  const validatedEvents = input.map((event) =>
    BehaviorEventSchema.parse(event),
  );

  return db.transaction((transaction) => {
    let inserted = 0;

    for (const event of validatedEvents) {
      const result = transaction
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
  });
};
