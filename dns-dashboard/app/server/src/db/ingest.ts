import { errorMessage } from '../http.ts';
import type { Poller, ServerState } from '../poller.ts';
import { type LogEntry, filterListNames, normalizeItem } from '../querylog.ts';
import type { History } from './history.ts';

const FIRST_PAGE = 100;
const PAGE = 500;
const MAX_PAGES = 20;
const BACKFILL_PAGES = 40;
const CLEANUP_INTERVAL_MS = 3600_000;

/** Copies new query log entries of every server into raw.db and keeps the rollups current. */
export class Ingestor {
  private timer?: NodeJS.Timeout;
  private lastCleanup = 0;
  private readonly history: History;
  private readonly poller: Poller;

  constructor(history: History, poller: Poller) {
    this.history = history;
    this.poller = poller;
  }

  start() {
    const run = async () => {
      await this.runOnce();
      this.timer = setTimeout(run, this.poller.config.querylogPollInterval * 1000);
    };
    void run();
  }

  stop() {
    clearTimeout(this.timer);
  }

  async runOnce(now = Date.now()) {
    await Promise.all(this.poller.servers.filter((s) => s.online).map((s) => this.ingestServer(s, now)));
    try {
      this.history.rollup();
      if (now - this.lastCleanup > CLEANUP_INTERVAL_MS) {
        this.history.cleanup(now);
        this.lastCleanup = now;
      }
    } catch (err) {
      console.error('rollup/cleanup failed:', errorMessage(err));
    }
  }

  private async ingestServer(s: ServerState, now: number) {
    const id = s.cfg.id;
    const key = `ql_last_${id}`;
    const lastUs = Number(this.history.getMeta(key) ?? 0);
    const firstRun = lastUs === 0;
    const stopAtUs = firstRun ? (now - this.history.rawDays * 24 * 3600_000) * 1000 : lastUs;
    const lists = filterListNames(s.filtering);

    const fresh: LogEntry[] = [];
    let olderThan: string | undefined;
    try {
      for (let page = 0; page < (firstRun ? BACKFILL_PAGES : MAX_PAGES); page++) {
        const limit = page === 0 && !firstRun ? FIRST_PAGE : PAGE;
        const res = await s.client.querylog({ limit, olderThan });
        let reachedKnown = false;
        for (const item of res.data ?? []) {
          const e = normalizeItem(id, item, lists);
          if (e.tsUs <= stopAtUs) {
            reachedKnown = true;
            break;
          }
          fresh.push(e);
        }
        if (reachedKnown || (res.data?.length ?? 0) < limit || !res.oldest) break;
        olderThan = res.oldest;
      }
    } catch (err) {
      console.error(`querylog ${id}:`, errorMessage(err));
    }
    if (!fresh.length) return;
    this.history.insertQueries(fresh);
    this.history.setMeta(key, String(Math.max(...fresh.map((e) => e.tsUs))));
  }
}
