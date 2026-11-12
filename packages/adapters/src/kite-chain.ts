import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { type BehaviorEvent, BehaviorEventSchema } from "@agentfico/core";
import { z } from "zod";

const MAINNET_USDC = "0x7aB6f3ed87C42eF0aDb67Ed95090f8bF5240149e";
const AddressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const TransferSchema = z.object({
  transaction_hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  log_index: z.number().int().nonnegative(),
  timestamp: z.string().nullable(),
  from: z.object({ hash: AddressSchema }),
  to: z.object({ hash: AddressSchema }),
  token: z.object({
    address_hash: AddressSchema,
    decimals: z.string().nullable(),
  }),
  total: z
    .object({
      value: z.string().regex(/^\d+$/),
      decimals: z.string().nullable(),
    })
    .nullable(),
});
const PageSchema = z.object({
  items: z.array(TransferSchema),
  next_page_params: z
    .record(z.string(), z.union([z.string(), z.number(), z.null()]))
    .nullable(),
});
const PAGE_KEYS = new Set([
  "block_number",
  "index",
  "items_count",
  "batch_log_index",
  "batch_block_hash",
  "batch_transaction_hash",
  "index_in_batch",
]);
const BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export class KiteDataError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "KiteDataError";
  }
}

export interface KiteReadOptions {
  env?: Readonly<Record<string, string | undefined>>;
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  fixture?: { simulated: boolean; pages: unknown[] };
}

function eventId(timestamp: string, identity: string): string {
  const time = BigInt(Date.parse(timestamp));
  const digest = createHash("sha256")
    .update(identity)
    .digest("hex")
    .slice(0, 20);
  let value = (time << 80n) | BigInt(`0x${digest}`);
  let id = "";
  for (let i = 0; i < 26; i += 1) {
    id = BASE32[Number(value & 31n)] + id;
    value >>= 5n;
  }
  return id;
}

function decimalAmount(value: string): string {
  const amount = BigInt(value).toString().padStart(7, "0");
  return `${amount.slice(0, -6)}.${amount.slice(-6)}`;
}

/** Read-only Blockscout v2 transfers, using the linked primary response schema. */
export async function readKiteEvents(
  address: string,
  options: KiteReadOptions = {},
) {
  const parsedAddress = AddressSchema.safeParse(address);
  if (!parsedAddress.success)
    throw new KiteDataError(
      "invalid_address",
      "Expected a 20-byte Kite address",
    );
  const subjectAddress = parsedAddress.data.toLowerCase();
  const env = options.env ?? process.env;
  const base = new URL(env.KITESCAN_API_BASE ?? "https://kitescan.ai/api/v2");
  const network =
    base.hostname === "kitescan.ai"
      ? "mainnet"
      : base.hostname === "testnet.kitescan.ai"
        ? "testnet"
        : "unknown";
  const token = AddressSchema.safeParse(
    env.KITE_USDC_ADDRESS ?? (network === "mainnet" ? MAINNET_USDC : undefined),
  );
  if (!token.success)
    throw new KiteDataError(
      "kite_configuration",
      "KITE_USDC_ADDRESS must identify the configured USDC.e contract",
    );
  if (
    !["https:", "http:"].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  ) {
    throw new KiteDataError(
      "kite_configuration",
      "KiteScan base URL failed validation",
    );
  }
  let fixture = options.fixture;
  if (env.AFC_OFFLINE === "1" && !fixture) {
    const file = Bun.file(
      resolve(
        import.meta.dir,
        "../../../fixtures/kite/real",
        `kitescan-${network}-${subjectAddress}.json`,
      ),
    );
    if (!(await file.exists())) {
      throw new KiteDataError(
        "kite_fixture_unavailable",
        "No recorded Kite history for this address in offline mode",
      );
    }
    fixture = z
      .strictObject({
        simulated: z.literal(false),
        pages: z.array(z.unknown()).min(1).max(20),
      })
      .parse(await file.json());
  }
  const afc_id = `afc:kite:${subjectAddress}`;
  const simulated = fixture?.simulated ?? false;
  const events: BehaviorEvent[] = [];
  const seen = new Set<string>();
  const pagination = new Set<string>();
  let cursor: Record<string, string | number | null> | null = null;
  let complete = false;
  let skipped = false;
  let pages = 0;
  for (let pageIndex = 0; pageIndex < 20; pageIndex += 1) {
    const url = new URL(
      `${base.toString().replace(/\/$/, "")}/addresses/${subjectAddress}/token-transfers`,
    );
    url.searchParams.set("type", "ERC-20");
    url.searchParams.set("token", token.data);
    for (const [key, value] of Object.entries(cursor ?? {})) {
      if (PAGE_KEYS.has(key) && value !== null)
        url.searchParams.set(key, String(value));
    }
    let raw: unknown;
    if (fixture) {
      if (pageIndex >= fixture.pages.length) break;
      raw = fixture.pages[pageIndex];
    } else {
      let response: Response;
      try {
        response = await (options.fetch ?? globalThis.fetch)(url, {
          signal: AbortSignal.timeout(15_000),
        });
      } catch {
        throw new KiteDataError(
          "kite_provider_unavailable",
          "KiteScan could not be reached",
        );
      }
      if (!response.ok)
        throw new KiteDataError(
          "kite_provider_unavailable",
          `KiteScan returned HTTP ${response.status}`,
        );
      try {
        raw = await response.json();
      } catch {
        throw new KiteDataError(
          "kite_invalid_response",
          "KiteScan did not return JSON",
        );
      }
    }
    const parsed = PageSchema.safeParse(raw);
    if (!parsed.success)
      throw new KiteDataError(
        "kite_invalid_response",
        "KiteScan transfer data failed schema validation",
      );
    pages += 1;
    for (const transfer of parsed.data.items) {
      if (
        transfer.token.address_hash.toLowerCase() !== token.data.toLowerCase()
      )
        continue;
      if (
        !transfer.timestamp ||
        !Number.isFinite(Date.parse(transfer.timestamp)) ||
        !transfer.total ||
        transfer.token.decimals !== "6" ||
        transfer.total.decimals !== "6"
      ) {
        skipped = true;
        continue;
      }
      const from = transfer.from.hash.toLowerCase();
      const to = transfer.to.hash.toLowerCase();
      if (from !== subjectAddress && to !== subjectAddress) {
        skipped = true;
        continue;
      }
      const occurred_at = new Date(transfer.timestamp).toISOString();
      const identity = `${transfer.transaction_hash}:${transfer.log_index}:${subjectAddress}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      events.push(
        BehaviorEventSchema.parse({
          event_id: eventId(occurred_at, identity),
          subject: { afc_id, links: { kite_address: subjectAddress } },
          source: simulated ? "simulator" : "kite_chain",
          simulated,
          attestation: simulated ? "self_reported" : "onchain",
          type: from === subjectAddress ? "payment.sent" : "payment.received",
          occurred_at,
          amount: {
            value: decimalAmount(transfer.total.value),
            currency: "USDC",
            decimals: 6,
          },
          counterparty: {
            id: from === subjectAddress ? to : from,
            kind: "unknown",
          },
          outcome: "success",
          evidence: {
            tx_hash: transfer.transaction_hash,
            url: `${url.origin}${url.pathname}#${transfer.transaction_hash}-${transfer.log_index}`,
          },
          attrs: {
            log_index: transfer.log_index,
            ...(simulated ? {} : { kite_network: network }),
          },
        }),
      );
    }
    cursor = parsed.data.next_page_params;
    if (!cursor || Object.keys(cursor).length === 0) {
      complete = true;
      break;
    }
    if (Object.keys(cursor).some((key) => !PAGE_KEYS.has(key)))
      throw new KiteDataError(
        "kite_invalid_response",
        "KiteScan pagination fields are unsupported",
      );
    const paginationKey = JSON.stringify(
      Object.entries(cursor).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    );
    if (pagination.has(paginationKey)) break;
    pagination.add(paginationKey);
  }
  events.sort((a, b) =>
    a.occurred_at < b.occurred_at
      ? -1
      : a.occurred_at > b.occurred_at
        ? 1
        : a.event_id < b.event_id
          ? -1
          : 1,
  );
  const earliest = events[0];
  if (earliest)
    events.unshift(
      BehaviorEventSchema.parse({
        event_id: eventId(earliest.occurred_at, `${afc_id}:observed-history`),
        subject: earliest.subject,
        source: earliest.source,
        simulated,
        attestation: earliest.attestation,
        type: "identity.registered",
        occurred_at: earliest.occurred_at,
        attrs: {
          age_basis: "earliest_observed_usdc_transfer",
          ...(simulated ? {} : { kite_network: network }),
          incomplete_history: !complete || skipped,
        },
      }),
    );
  return {
    afc_id,
    events,
    complete: complete && !skipped,
    pages,
    simulated_share: simulated ? 1 : 0,
    offline: Boolean(fixture),
  };
}
