/**
 * In-memory stand-in for the Supabase client used in unit tests.
 *
 * The application talks to Supabase through `getSupabase()` (a lazily built
 * supabase-js client). Tests replace that client with this fake so the api modules
 * under test run unchanged: the same `.from(...).select(...).eq(...)` chains, the
 * same `.rpc(...)` calls, the same Storage and Edge Function surfaces.
 *
 * Only the behaviour the application actually uses is implemented, and it is
 * deliberately literal: filters, ordering and ranges are applied to plain row
 * arrays, so a test that seeds `tables.profiles` gets back exactly the rows the real
 * PostgREST would for the same query shape.
 */

export type Row = Record<string, unknown>;

type Filter = (row: Row) => boolean;

export type FakeAuth = {
  session: { access_token: string; refresh_token: string; user: { id: string } } | null;
  user: {
    id: string;
    email?: string | null;
    phone?: string | null;
    email_confirmed_at?: string | null;
    phone_confirmed_at?: string | null;
    created_at?: string;
    user_metadata?: Record<string, unknown>;
  } | null;
  credentials?: { email: string; password: string } | null;
};

type OrderBy = { column: string; ascending: boolean };

const clone = (value: Row): Row => ({ ...value });

class FakeQuery implements PromiseLike<{ data: unknown; error: unknown; count: number | null }> {
  private filters: Filter[] = [];
  private orders: OrderBy[] = [];
  private rangeFromTo: [number, number] | null = null;
  private limitCount: number | null = null;
  private wantsCount = false;
  private headOnly = false;
  private mutation: { kind: "insert" | "update" | "delete" | "upsert"; payload: Row | Row[]; onConflict?: string } | null =
    null;
  private returning = false;
  private mode: "select" | "single" | "maybeSingle" = "select";

  constructor(
    private readonly db: FakeDb,
    private readonly table: string
  ) {}

  select(_columns?: string, options?: { count?: "exact"; head?: boolean }): this {
    this.wantsCount = options?.count === "exact";
    this.headOnly = options?.head === true;
    if (this.mutation) this.returning = true;
    return this;
  }

  insert(payload: Row | Row[]): this {
    this.mutation = { kind: "insert", payload };
    return this;
  }

  upsert(payload: Row | Row[], options?: { onConflict?: string }): this {
    this.mutation = { kind: "upsert", payload, onConflict: options?.onConflict };
    return this;
  }

  update(payload: Row): this {
    this.mutation = { kind: "update", payload };
    return this;
  }

  delete(): this {
    this.mutation = { kind: "delete", payload: {} };
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  is(column: string, value: null): this {
    this.filters.push((row) => (row[column] ?? null) === value);
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): this {
    this.orders.push({ column, ascending: options?.ascending !== false });
    return this;
  }

  range(from: number, to: number): this {
    this.rangeFromTo = [from, to];
    return this;
  }

  limit(count: number): this {
    this.limitCount = count;
    return this;
  }

  single(): this {
    this.mode = "single";
    return this;
  }

  maybeSingle(): this {
    this.mode = "maybeSingle";
    return this;
  }

  private rows(): Row[] {
    return this.db.tables[this.table] ?? (this.db.tables[this.table] = []);
  }

  private resolve(): { data: unknown; error: unknown; count: number | null } {
    const table = this.rows();

    if (this.mutation) {
      const applied = this.applyMutation(table);
      const data = this.returning || this.mutation.kind === "insert" ? applied : null;
      return { data: data === null ? null : this.finish(Array.isArray(data) ? data : [data]), error: null, count: null };
    }

    let matched = table.filter((row) => this.filters.every((filter) => filter(row)));
    const count = this.wantsCount ? matched.length : null;
    if (this.orders.length > 0) {
      matched = [...matched].sort((a, b) => {
        for (const { column, ascending } of this.orders) {
          const left = a[column] as string | number;
          const right = b[column] as string | number;
          if (left === right) continue;
          const comparison = left < right ? -1 : 1;
          return ascending ? comparison : -comparison;
        }
        return 0;
      });
    }
    if (this.rangeFromTo) {
      const [from, to] = this.rangeFromTo;
      matched = matched.slice(from, to + 1);
    }
    if (this.limitCount !== null) matched = matched.slice(0, this.limitCount);

    if (this.headOnly) return { data: null, error: null, count: count ?? matched.length };
    return { data: this.finish(matched), error: null, count };
  }

  private applyMutation(table: Row[]): Row | Row[] {
    const mutation = this.mutation!;
    const payload = Array.isArray(mutation.payload) ? mutation.payload.map(clone) : clone(mutation.payload);

    if (mutation.kind === "insert" || mutation.kind === "upsert") {
      const incoming = Array.isArray(payload) ? payload : [payload];
      const inserted: Row[] = [];
      for (const row of incoming) {
        const prepared: Row = { id: row.id ?? crypto.randomUUID(), created_at: row.created_at ?? new Date().toISOString(), ...row };
        const conflictColumns = mutation.onConflict?.split(",").map((part) => part.trim());
        const existingIndex = conflictColumns
          ? table.findIndex((current) => conflictColumns.every((column) => current[column] === prepared[column]))
          : -1;
        if (existingIndex >= 0) {
          table[existingIndex] = { ...table[existingIndex], ...prepared };
          inserted.push(table[existingIndex]);
        } else {
          table.push(prepared);
          inserted.push(prepared);
        }
      }
      return Array.isArray(payload) ? inserted : inserted[0];
    }

    if (mutation.kind === "update") {
      const updated: Row[] = [];
      for (const row of table) {
        if (this.filters.every((filter) => filter(row))) {
          Object.assign(row, payload);
          updated.push(row);
        }
      }
      return updated;
    }

    const removed: Row[] = [];
    for (let index = table.length - 1; index >= 0; index -= 1) {
      if (this.filters.every((filter) => filter(table[index]))) {
        removed.unshift(table.splice(index, 1)[0]);
      }
    }
    return removed;
  }

  private finish(rows: Row[]): unknown {
    if (this.mode === "single") {
      if (rows.length !== 1) {
        return null;
      }
      return rows[0];
    }
    if (this.mode === "maybeSingle") {
      return rows[0] ?? null;
    }
    return rows;
  }

  then<TResult1 = { data: unknown; error: unknown; count: number | null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: unknown; count: number | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.resolve()).then(onfulfilled, onrejected);
  }
}

class FakeRpc implements PromiseLike<{ data: unknown; error: unknown }> {
  private mode: "many" | "single" | "maybeSingle" = "many";

  constructor(
    private readonly db: FakeDb,
    private readonly fn: string,
    private readonly args: Record<string, unknown> | undefined
  ) {}

  single(): this {
    this.mode = "single";
    return this;
  }

  maybeSingle(): this {
    this.mode = "maybeSingle";
    return this;
  }

  private resolve(): { data: unknown; error: unknown } {
    const handler = this.db.rpcs[this.fn];
    if (!handler) return { data: null, error: { message: `no fake RPC registered for ${this.fn}`, code: "PGRST000" } };
    const value = handler(this.args ?? {});
    if (this.mode === "single" || this.mode === "maybeSingle") {
      if (Array.isArray(value)) return { data: value[0] ?? null, error: null };
      return { data: value ?? null, error: null };
    }
    return { data: value, error: null };
  }

  then<TResult1 = { data: unknown; error: unknown }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.resolve()).then(onfulfilled, onrejected);
  }
}

export type FakeDb = {
  tables: Record<string, Row[]>;
  rpcs: Record<string, (args: Record<string, unknown>) => unknown>;
  functions: Record<string, (body: unknown) => unknown>;
  storage: { uploads: { bucket: string; path: string }[]; signedUrl: string | null; uploadError: unknown };
  auth: FakeAuth;
};

function emptyState(): FakeDb {
  return {
    tables: {},
    rpcs: {},
    functions: {},
    storage: { uploads: [], signedUrl: "https://signed.example/object", uploadError: null },
    auth: { session: null, user: null, credentials: null },
  };
}

export type FakeRealtimeHandler = { filter: Record<string, unknown>; handler: (payload: unknown) => void };

export class FakeSupabase {
  readonly state: FakeDb = emptyState();
  /** Every `postgres_changes` handler registered on a realtime channel, in order. */
  readonly realtimeHandlers: FakeRealtimeHandler[] = [];
  private subscribers: ((event: string) => void)[] = [];

  reset(): void {
    const fresh = emptyState();
    this.state.tables = fresh.tables;
    this.state.rpcs = fresh.rpcs;
    this.state.functions = fresh.functions;
    this.state.storage = fresh.storage;
    this.state.auth = fresh.auth;
    this.subscribers = [];
    this.realtimeHandlers.length = 0;
  }

  get from() {
    return (table: string) => new FakeQuery(this.state, table);
  }

  get rpc() {
    return (fn: string, args?: Record<string, unknown>) => new FakeRpc(this.state, fn, args);
  }

  readonly auth = {
    getSession: async () => ({ data: { session: this.state.auth.session }, error: null }),
    getUser: async () =>
      this.state.auth.user
        ? { data: { user: this.state.auth.user }, error: null }
        : { data: { user: null }, error: { message: "not signed in" } },
    signInWithPassword: async ({ email, password }: { email: string; password: string }) => {
      const credentials = this.state.auth.credentials;
      if (credentials && credentials.email === email && credentials.password === password) {
        return { data: { user: this.state.auth.user, session: this.state.auth.session }, error: null };
      }
      return { data: { user: null, session: null }, error: { message: "Invalid login credentials", status: 400 } };
    },
    signUp: async () => ({ data: { user: this.state.auth.user, session: null }, error: null }),
    verifyOtp: async () => ({
      data: { user: this.state.auth.user, session: this.state.auth.session },
      error: null,
    }),
    resend: async () => ({ data: {}, error: null }),
    refreshSession: async () => ({ data: { session: this.state.auth.session }, error: null }),
    signOut: async () => {
      this.state.auth.session = null;
      for (const notify of this.subscribers) notify("SIGNED_OUT");
      return { error: null };
    },
    onAuthStateChange: (callback: (event: string) => void) => {
      this.subscribers.push(callback);
      return { data: { subscription: { unsubscribe: () => undefined } } };
    },
  };

  readonly storage = {
    from: (bucket: string) => ({
      upload: async (path: string) => {
        if (this.state.storage.uploadError) return { data: null, error: this.state.storage.uploadError };
        this.state.storage.uploads.push({ bucket, path });
        return { data: { path }, error: null };
      },
      createSignedUrl: async (path: string) =>
        this.state.storage.signedUrl
          ? { data: { signedUrl: `${this.state.storage.signedUrl}/${path}` }, error: null }
          : { data: null, error: { message: "sign failed" } },
      remove: async () => ({ data: [], error: null }),
    }),
  };

  readonly functions = {
    invoke: async (name: string, options?: { body?: unknown }) => {
      const handler = this.state.functions[name];
      if (!handler) return { data: null, error: { message: `no fake function registered for ${name}` } };
      return { data: handler(options?.body ?? null), error: null };
    },
  };

  readonly channel = (_name: string) => ({
    on: (_type: string, filter: Record<string, unknown>, handler: (payload: unknown) => void) => {
      this.realtimeHandlers.push({ filter, handler });
    },
    subscribe: (callback?: (status: string) => void) => {
      callback?.("SUBSCRIBED");
    },
    unsubscribe: async () => undefined,
  });
}

export const fakeSupabase = new FakeSupabase();

/** Seeds a signed-in session plus its `profiles` row. */
export function seedAuth(profile: Row = { id: "u1", username: "rabby" }): void {
  const id = String(profile.id ?? "u1");
  fakeSupabase.state.auth.user = {
    id,
    email: `${profile.username ?? "user"}@example.com`,
    email_confirmed_at: "2026-01-01T00:00:00.000Z",
    phone_confirmed_at: "2026-01-01T00:00:00.000Z",
    created_at: "2026-01-01T00:00:00.000Z",
    user_metadata: { username: profile.username ?? "user" },
  };
  fakeSupabase.state.auth.session = { access_token: "test-access", refresh_token: "test-refresh", user: { id } };
  fakeSupabase.state.tables.profiles = [
    {
      id,
      username: profile.username ?? "user",
      role: profile.role ?? "member",
      is_suspended: false,
      deleted_at: null,
      created_at: "2026-01-01T00:00:00.000Z",
      ...profile,
    },
  ];
}

export { clone };
