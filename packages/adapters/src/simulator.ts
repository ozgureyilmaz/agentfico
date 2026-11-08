import { type BehaviorEvent, BehaviorEventSchema } from "@agentfico/core";
import { generateSimulation, type SimulationOptions } from "@agentfico/sim";

export class SimulatorAdapter {
  constructor(private readonly defaults: SimulationOptions = {}) {}

  generate(overrides: SimulationOptions = {}): BehaviorEvent[] {
    const events = generateSimulation({ ...this.defaults, ...overrides });
    return events.map((event) => BehaviorEventSchema.parse(event));
  }
}
