/**
 * Minimal Metabase REST API client.
 *
 * Auth: Metabase API key (Settings → Admin → API Keys), sent as `x-api-key`.
 * Docs: https://www.metabase.com/docs/latest/api-documentation
 */

export interface MetabaseConfig {
  /** Base URL of the Metabase instance, e.g. https://metabase.example.com */
  url: string;
  /** Metabase API key */
  apiKey: string;
  /** Request timeout in ms (default 30s) */
  timeoutMs?: number;
}

export interface DashboardSummary {
  id: number;
  name: string;
  description: string | null;
  collection: string | null;
  updated_at: string | null;
}

export interface CardSummary {
  id: number;
  name: string;
  description: string | null;
  display: string | null;
}

export interface DashboardDetail extends DashboardSummary {
  cards: CardSummary[];
}

export type Row = Record<string, unknown>;

export class MetabaseError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "MetabaseError";
  }
}

export class MetabaseClient {
  private readonly base: string;

  constructor(private readonly config: MetabaseConfig) {
    if (!config.url) throw new MetabaseError("METABASE_URL is not set");
    if (!config.apiKey) throw new MetabaseError("METABASE_API_KEY is not set");
    this.base = config.url.replace(/\/+$/, "");
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.timeoutMs ?? 30_000,
    );
    try {
      const res = await fetch(`${this.base}${path}`, {
        ...init,
        headers: {
          "x-api-key": this.config.apiKey,
          "content-type": "application/json",
          ...(init?.headers ?? {}),
        },
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new MetabaseError(
          `Metabase API ${res.status} on ${path}: ${body.slice(0, 300)}`,
          res.status,
        );
      }
      return (await res.json()) as T;
    } catch (err) {
      if (err instanceof MetabaseError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      throw new MetabaseError(`Request to Metabase failed (${path}): ${msg}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  /** List all dashboards visible to the API key. */
  async listDashboards(search?: string): Promise<DashboardSummary[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = await this.request<any[]>("/api/dashboard");
    let items = raw.map((d) => ({
      id: d.id as number,
      name: (d.name as string) ?? "(unnamed)",
      description: (d.description as string | null) ?? null,
      collection: d.collection?.name ?? null,
      updated_at: (d.updated_at as string | null) ?? null,
    }));
    if (search) {
      const q = search.toLowerCase();
      items = items.filter(
        (d) =>
          d.name.toLowerCase().includes(q) ||
          (d.description ?? "").toLowerCase().includes(q),
      );
    }
    return items;
  }

  /** Get a dashboard with its cards. */
  async getDashboard(dashboardId: number): Promise<DashboardDetail> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = await this.request<any>(`/api/dashboard/${dashboardId}`);
    const dashcards: unknown[] = d.dashcards ?? d.ordered_cards ?? [];
    const cards: CardSummary[] = [];
    for (const dc of dashcards as Array<Record<string, unknown>>) {
      const card = dc.card as Record<string, unknown> | undefined;
      if (!card || typeof card.id !== "number") continue; // text/heading tiles
      cards.push({
        id: card.id,
        name: (card.name as string) ?? "(unnamed card)",
        description: (card.description as string | null) ?? null,
        display: (card.display as string | null) ?? null,
      });
    }
    return {
      id: d.id,
      name: d.name ?? "(unnamed)",
      description: d.description ?? null,
      collection: d.collection?.name ?? null,
      updated_at: d.updated_at ?? null,
      cards,
    };
  }

  /** Run a saved question (card) and return its rows as JSON objects. */
  async getCardRows(cardId: number): Promise<Row[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = await this.request<any>(`/api/card/${cardId}/query/json`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    if (!Array.isArray(raw)) {
      throw new MetabaseError(
        `Unexpected response shape from /api/card/${cardId}/query/json`,
      );
    }
    return raw as Row[];
  }

  /** Card metadata (name, display type). */
  async getCard(cardId: number): Promise<CardSummary> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = await this.request<any>(`/api/card/${cardId}`);
    return {
      id: c.id,
      name: c.name ?? "(unnamed card)",
      description: c.description ?? null,
      display: c.display ?? null,
    };
  }
}
