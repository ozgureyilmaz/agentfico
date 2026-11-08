export const PERSONA_IDS = [
  "atlas",
  "blaze",
  "murk",
  "nova-7",
  "phoenix",
] as const;

export type PersonaId = (typeof PERSONA_IDS)[number];

export interface PersonaDefinition {
  id: PersonaId;
  name: string;
  afcId: `afc:sim:${string}`;
  behavior: string;
  expected: string;
  walletAgeDays: number;
  truth: {
    risk: number;
  };
}

export const PERSONAS = [
  {
    id: "atlas",
    name: "Atlas",
    afcId: "afc:sim:atlas",
    behavior: "Disciplined shopper with small purchases across many merchants.",
    expected:
      "760-800; high-quality work, diverse counterparties, and 99% uptime.",
    walletAgeDays: 60,
    truth: { risk: 0.02 },
  },
  {
    id: "blaze",
    name: "Blaze",
    afcId: "afc:sim:blaze",
    behavior:
      "Overspends on weekends, breaches session limits, and sometimes fails payments.",
    expected:
      "600-650; weekend spend spikes, three limit violations, and about 6% failed payments.",
    walletAgeDays: 90,
    truth: { risk: 0.2 },
  },
  {
    id: "murk",
    name: "Murk",
    afcId: "afc:sim:murk",
    behavior:
      "Sells inconsistent work, misses tasks, and has unreliable endpoints.",
    expected:
      "560-620; 40% revise/reject work, 80% uptime, and 25% task failures.",
    walletAgeDays: 90,
    truth: { risk: 0.35 },
  },
  {
    id: "nova-7",
    name: "Nova-7",
    afcId: "afc:sim:nova-7",
    behavior:
      "Fresh wallet linked to a shared-funder cluster with circular transfers.",
    expected:
      "At most 549; low confidence, under review, with F01, F02, and I01 evidence.",
    walletAgeDays: 2,
    truth: { risk: 0.65 },
  },
  {
    id: "phoenix",
    name: "Phoenix",
    afcId: "afc:sim:phoenix",
    behavior:
      "Starts with poor work and payment conduct, then improves after simulated feedback.",
    expected:
      "Rises from about 520 toward 680 as the initial bad period decays and later behavior improves.",
    walletAgeDays: 90,
    truth: { risk: 0.15 },
  },
] as const satisfies readonly PersonaDefinition[];

const PERSONA_BY_ID = new Map<PersonaId, PersonaDefinition>(
  PERSONAS.map((persona) => [persona.id, persona]),
);

export function getPersona(id: PersonaId): PersonaDefinition {
  const persona = PERSONA_BY_ID.get(id);
  if (!persona) {
    throw new Error(`Unknown persona: ${id}`);
  }
  return persona;
}

export function listPersonas(): readonly PersonaDefinition[] {
  return PERSONAS;
}
