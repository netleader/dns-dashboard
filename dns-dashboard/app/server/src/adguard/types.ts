// Subset of the AdGuard Home /control API (openapi/openapi.yaml) used by the dashboard.

export interface AgStatus {
  dns_addresses: string[];
  dns_port: number;
  http_port: number;
  protection_enabled: boolean;
  protection_disabled_duration?: number;
  running: boolean;
  version: string;
  language?: string;
  dhcp_available?: boolean;
  start_time?: number;
}

/** Top lists come as arrays of single-key objects: [{ "example.com": 12 }, …]. */
export type AgTopArray = Array<Record<string, number>>;

export interface AgStats {
  time_units: 'hours' | 'days';
  num_dns_queries: number;
  num_blocked_filtering: number;
  num_replaced_safebrowsing: number;
  num_replaced_safesearch: number;
  num_replaced_parental: number;
  avg_processing_time: number;
  top_queried_domains: AgTopArray;
  top_clients: AgTopArray;
  top_blocked_domains: AgTopArray;
  top_upstreams_responses?: AgTopArray;
  top_upstreams_avg_time?: AgTopArray;
  dns_queries: number[];
  blocked_filtering: number[];
  replaced_safebrowsing: number[];
  replaced_parental: number[];
}

export interface AgDnsAnswer {
  type: string;
  value: string;
  ttl: number;
}

export interface AgQueryLogItem {
  answer?: AgDnsAnswer[] | null;
  original_answer?: AgDnsAnswer[] | null;
  cached?: boolean;
  upstream?: string;
  answer_dnssec?: boolean;
  client: string;
  client_id?: string;
  client_info?: { name?: string; disallowed?: boolean; whois?: Record<string, string> };
  client_proto?: string;
  elapsedMs?: string;
  question: { class?: string; name: string; unicode_name?: string; type: string };
  rules?: Array<{ filter_list_id: number; text: string }>;
  reason: string;
  service_name?: string;
  status?: string;
  time: string;
}

export interface AgQueryLog {
  oldest: string;
  data: AgQueryLogItem[];
}

export interface AgFilter {
  enabled: boolean;
  id: number;
  name: string;
  url: string;
  rules_count: number;
  last_updated?: string;
}

export interface AgFilterStatus {
  enabled: boolean;
  interval: number;
  filters: AgFilter[] | null;
  whitelist_filters: AgFilter[] | null;
  user_rules: string[] | null;
}

export interface AgClient {
  name: string;
  ids: string[];
  tags?: string[] | null;
  use_global_settings?: boolean;
  filtering_enabled?: boolean;
  parental_enabled?: boolean;
  safebrowsing_enabled?: boolean;
  use_global_blocked_services?: boolean;
  blocked_services?: string[] | null;
  upstreams?: string[] | null;
  ignore_querylog?: boolean;
  ignore_statistics?: boolean;
}

export interface AgAutoClient {
  ip: string;
  name: string;
  source: string;
}

export interface AgClients {
  clients: AgClient[] | null;
  auto_clients: AgAutoClient[] | null;
  supported_tags?: string[];
}

export interface AgDnsInfo {
  upstream_dns: string[];
  bootstrap_dns?: string[];
  fallback_dns?: string[];
  upstream_mode?: string;
  protection_enabled: boolean;
  protection_disabled_until?: string | null;
  blocking_mode?: string;
  ratelimit?: number;
  cache_enabled?: boolean;
  cache_size?: number;
  cache_optimistic?: boolean;
  dnssec_enabled?: boolean;
  edns_cs_enabled?: boolean;
  disable_ipv6?: boolean;
}

export interface AgVersionInfo {
  disabled: boolean;
  new_version?: string;
  announcement?: string;
  announcement_url?: string;
  can_autoupdate?: boolean;
}

export interface AgRewrite {
  domain: string;
  answer: string;
  enabled?: boolean;
}

export interface AgBlockedServices {
  ids: string[];
  schedule?: unknown;
}

export interface AgAccessList {
  allowed_clients: string[] | null;
  disallowed_clients: string[] | null;
  blocked_hosts: string[] | null;
}

export interface AgCheckHost {
  reason: string;
  rules?: Array<{ filter_list_id: number; text: string }>;
  service_name?: string;
}
