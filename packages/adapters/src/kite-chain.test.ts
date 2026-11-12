import { expect, test } from "bun:test";
import { readKiteEvents } from "./kite-chain";

const address = `0x${"1".repeat(40)}`;
const other = `0x${"2".repeat(40)}`;
const token = `0x${"3".repeat(40)}`;
const env = {
  AFC_OFFLINE: "0",
  KITE_USDC_ADDRESS: token,
  KITESCAN_API_BASE: "https://kite.test/api/v2",
};
function transfer(index: number) {
  return {
    transaction_hash: `0x${"4".repeat(64)}`,
    log_index: index,
    timestamp: "2026-11-01T00:00:00.000000Z",
    from: { hash: address },
    to: { hash: other },
    token: { address_hash: token, decimals: "6" },
    total: { value: "1234567", decimals: "6" },
  };
}
test("maps documented transfers without losing separate logs from one transaction", async () => {
  const result = await readKiteEvents(address, {
    env,
    fetch: async () =>
      Response.json({
        items: [transfer(1), transfer(2)],
        next_page_params: null,
      }),
  });
  expect(result.complete).toBe(true);
  expect(result.events).toHaveLength(3);
  expect(result.events[1].amount?.value).toBe("1.234567");
  expect(result.events[1].simulated).toBe(false);
  expect(new Set(result.events.map((e) => e.event_id)).size).toBe(3);
  const again = await readKiteEvents(address, {
    env,
    fetch: async () =>
      Response.json({
        items: [transfer(1), transfer(2)],
        next_page_params: null,
      }),
  });
  expect(again.events).toEqual(result.events);
});
test("paginates using only documented cursors and deduplicates overlapping pages", async () => {
  let calls = 0;
  const result = await readKiteEvents(address, {
    env,
    fetch: async (url) => {
      calls++;
      if (calls === 2)
        expect(new URL(String(url)).searchParams.get("index")).toBe("2");
      return Response.json({
        items: [transfer(1)],
        next_page_params: calls === 1 ? { index: 2 } : null,
      });
    },
  });
  expect(calls).toBe(2);
  expect(result.events).toHaveLength(2);
});
test("synthetic fixture provenance stays simulated and unavailable providers fail clearly", async () => {
  const result = await readKiteEvents(address, {
    env: { ...env, AFC_OFFLINE: "1" },
    fixture: {
      simulated: true,
      pages: [{ items: [transfer(1)], next_page_params: null }],
    },
  });
  expect(
    result.events.every((e) => e.simulated && e.source === "simulator"),
  ).toBe(true);
  await expect(
    readKiteEvents(address, {
      env,
      fetch: async () => new Response("", { status: 403 }),
    }),
  ).rejects.toThrow("HTTP 403");
  await expect(
    readKiteEvents(address, { env: { ...env, AFC_OFFLINE: "1" } }),
  ).rejects.toThrow("No recorded Kite history");
  await expect(readKiteEvents("0xinvalid", { env })).rejects.toThrow("20-byte");
});
