import { env, applyD1Migrations, SELF } from "cloudflare:test";
import { beforeAll, describe, it, expect } from "vitest";
import { createSession } from "../src/webapp/lib/session";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

describe("Local application readiness", () => {
  it("responds to health checks", async () => {
    const response = await SELF.fetch("https://example.com/health");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("OK");
  });

  it("requires login before showing the application", async () => {
    const response = await SELF.fetch("https://example.com/", { redirect: "manual" });
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://example.com/login");
  });

  it("renders the Google login screen", async () => {
    const response = await SELF.fetch("https://example.com/login");
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('href="/auth/login"');
  });

  it("initializes an empty database without injecting test customers", async () => {
    const columns = await env.DB.prepare("PRAGMA table_info(bookings)").all<{ name: string }>();
    expect(columns.results.map(column => column.name)).toContain("revision_no_more_at");
    const count = await env.DB.prepare("SELECT COUNT(*) AS total FROM customers").first<{ total: number }>();
    expect(count?.total).toBe(0);
  });

  it("loads the migrated dashboard with a valid local session", async () => {
    const { sessionId } = await createSession(env.DB, "local-test@example.com");
    const response = await SELF.fetch("https://example.com/api/dashboard/bookings", {
      headers: { Cookie: `session_id=${sessionId}` },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/json");
  });
});
