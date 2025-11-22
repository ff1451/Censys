import * as dotenv from "dotenv";

dotenv.config();

/* -------------------------------------------------------------------------- */
/* 환경 변수 및 상수                                                              */
/* -------------------------------------------------------------------------- */

const API_BASE = "https://api.platform.censys.io/v3";
const API_TOKEN = process.env.CENSYS_API_TOKEN;
const ORG_ID = process.env.CENSYS_ORG_ID;

if (!API_TOKEN) {
  console.error("❌ CENSYS_API_TOKEN이 설정되어 있지 않습니다. .env 파일을 확인하세요.");
  process.exit(1);
}

type HttpMethod = "GET" | "POST";

interface CensysRequestOptions {
  method?: HttpMethod;
  body?: unknown;
  accept?: string;
}

/* -------------------------------------------------------------------------- */
/* 공통 유틸 함수                                                                */
/* -------------------------------------------------------------------------- */

async function censysRequest<T = any>(path: string, options: CensysRequestOptions = {}): Promise<T> {
  const url = `${API_BASE}${path}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${API_TOKEN}`,
    Accept: options.accept ?? "application/json",
    "Content-Type": "application/json",
  };

  if (ORG_ID) {
    headers["X-Organization-ID"] = ORG_ID;
  }

  const res = await fetch(url, {
    method: options.method ?? "GET",
    headers,
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });

  if (!res.ok) {
    const text = await res.text();

    if (res.status === 402 || res.status === 403) {
      throw new Error(
        `HTTP ${res.status} – 이 엔드포인트는 Starter/Enterprise(유료) 또는 추가 권한이 필요한 것 같습니다.\n` +
          `응답 내용: ${text}`,
      );
    }

    throw new Error(`HTTP ${res.status}: ${text}`);
  }

  return res.json() as Promise<T>;
}

// Censys 응답의 공통 패턴: { result: ... } 혹은 바로 객체
function normalizeResult<T = any>(data: any): T {
  return (data.result ?? data) as T;
}

/* -------------------------------------------------------------------------- */
/* 1) 단일 Host 조회                                                            */
/*    GET /v3/global/asset/host/{ip}                                          */
/* -------------------------------------------------------------------------- */

async function getHost(ip: string) {
  return censysRequest(`/global/asset/host/${ip}`, {
    method: "GET",
    accept: "application/vnd.censys.api.v3.host.v1+json",
  });
}

/* -------------------------------------------------------------------------- */
/* 2) Search                                                                  */
/*    POST /v3/global/search/query                                            */
/* -------------------------------------------------------------------------- */

interface SearchOptions {
  pageSize?: number;
  pageToken?: string;
}

async function searchAssets(query: string, options: SearchOptions = {}) {
  const { pageSize = 5, pageToken } = options;

  const body: Record<string, unknown> = {
    query,
    page_size: pageSize,
    fields: [
      "host.ip",
      "host.location.country",
      "host.location.city",
      "host.services.port",
      "host.services.service_name",
    ],
  };

  if (pageToken) {
    body.page_token = pageToken;
  }

  return censysRequest(`/global/search/query`, {
    method: "POST",
    body,
  });
}

/* -------------------------------------------------------------------------- */
/* 3) Aggregate                                                              */
/*    POST /v3/global/search/aggregate                                        */
/* -------------------------------------------------------------------------- */

interface AggregateOptions {
  filterByQuery?: boolean;   // filter_by_query
  countByLevel?: string;     // count_by_level (예: 'host.services.port')
}

async function aggregateAssets(
  query: string,
  field: string,
  numBuckets = 5,
  options: AggregateOptions = {},
) {
  const body: Record<string, unknown> = {
    query,
    field,
    number_of_buckets: numBuckets,
  };

  if (options.filterByQuery !== undefined) {
    body.filter_by_query = options.filterByQuery;
  }

  if (options.countByLevel) {
    body.count_by_level = options.countByLevel;
  }

  return censysRequest(`/global/search/aggregate`, {
    method: "POST",
    body,
  });
}

/* -------------------------------------------------------------------------- */
/* 출력 유틸: Host                                                              */
/* -------------------------------------------------------------------------- */

function printHostResult(ipInput: string, data: any) {
  const result = normalizeResult<any>(data);
  const resource = result.resource ?? result;

  console.log("=== Host 정보 ===");
  console.log("IP:", resource.ip ?? ipInput);

  const loc = resource.location ?? {};
  const locationStr =
    [loc.country, loc.province, loc.city].filter(Boolean).join(" / ") || "-";

  console.log("위치:", locationStr);
  console.log("타임존:", loc.timezone ?? "-");

  if (loc.coordinates) {
    console.log(
      "좌표:",
      `(${loc.coordinates.latitude ?? "?"}, ${loc.coordinates.longitude ?? "?"})`,
    );
  }

  const asn = resource.autonomous_system ?? {};
  console.log("\n[Autonomous System]");
  console.log("  ASN:", asn.asn ?? "-");
  console.log("  이름:", asn.name ?? "-");
  console.log("  설명:", asn.description ?? "-");
  console.log("  BGP 프리픽스:", asn.bgp_prefix ?? "-");
  console.log("  국가 코드:", asn.country_code ?? "-");

  const org = resource.whois?.organization ?? {};
  console.log("\n[WHOIS Organization]");
  console.log("  이름:", org.name ?? "-");
  const orgAddr =
    [org.street, org.city, org.state, org.postal_code, org.country]
      .filter(Boolean)
      .join(", ") || "-";
  console.log("  주소:", orgAddr);
  const abuse = (org.abuse_contacts ?? [])[0];
  console.log("  Abuse 이메일:", abuse?.email ?? "-");

  const services: any[] = Array.isArray(resource.services) ? resource.services : [];
  console.log("\n[서비스]");
  console.log("  서비스 개수:", resource.service_count ?? services.length);

  if (!services.length) {
    console.log("  (서비스 정보 없음)");
  } else {
    for (const s of services) {
      console.log(
        `  - 포트 ${s.port} / 프로토콜 ${s.protocol ?? "-"} / 트랜스포트 ${s.transport_protocol ?? "-"}`,
      );
    }
  }

  const dns = resource.dns ?? {};
  console.log("\n[DNS]");
  const rdnsNames: string[] = dns.reverse_dns?.names ?? [];
  console.log("  Reverse DNS:", rdnsNames.length ? rdnsNames.join(", ") : "-");

  const names: string[] = dns.names ?? [];
  console.log("  연결된 도메인 개수:", names.length);
  if (names.length) {
    console.log(
      "  예시 도메인:",
      names.slice(0, 5).join(", ") +
        (names.length > 5 ? ` ... (+${names.length - 5}개)` : ""),
    );
  }
}

/* -------------------------------------------------------------------------- */
/* 출력 유틸: Search                                                            */
/* -------------------------------------------------------------------------- */

function extractAssetFromHit(hit: any) {
  if (hit.host_v1) return { kind: "host", asset: hit.host_v1.resource ?? hit.host_v1 };
  if (hit.certificate_v1) return { kind: "certificate", asset: hit.certificate_v1.resource ?? hit.certificate_v1 };
  if (hit.web_property_v1) return { kind: "web_property", asset: hit.web_property_v1.resource ?? hit.web_property_v1 };

  const key = Object.keys(hit).find((k) => k.endsWith("_v1"));
  if (key && hit[key]) {
    return { kind: key.replace("_v1", ""), asset: hit[key].resource ?? hit[key] };
  }

  return { kind: "unknown", asset: hit.resource ?? hit };
}

function printSearchResult(data: any) {
  const result = normalizeResult<any>(data);

  const total = result.total ?? result.total_hits ?? "?";
  const hits: any[] = result.hits ?? [];

  console.log("=== Search 결과 ===");
  console.log("총 매칭 개수:", total);
  console.log("표시된 개수:", hits.length);
  console.log("");

  hits.forEach((hit, idx) => {
    const { kind, asset } = extractAssetFromHit(hit);

    console.log(`[#${idx + 1}] (${kind})`);

    if (kind === "host") {
      const ip = asset.ip;
      const loc = asset.location ?? {};
      const ports = Array.isArray(asset.services)
        ? Array.from(new Set(asset.services.map((s: any) => s.port)))
        : [];

      if (ip) console.log("  IP:", ip);
      if (loc.country || loc.city) {
        console.log(
          "  위치:",
          [loc.country, loc.province, loc.city].filter(Boolean).join(" / "),
        );
      }
      if (ports.length) {
        console.log("  포트:", ports.join(", "));
      }
    } else if (kind === "certificate") {
      const names: string[] = asset.names ?? [];
      console.log("  도메인:", names.slice(0, 5).join(", ") || "-");
      console.log("  SHA256:", asset.fingerprint_sha256 ?? "-");
    } else if (kind === "web_property") {
      console.log("  이름:", asset.name ?? "-");
      console.log("  도메인:", (asset.domains ?? []).slice(0, 5).join(", ") || "-");
    } else {
      console.log("  (알 수 없는 타입, raw asset 출력)");
      console.dir(asset, { depth: 3 });
    }

    console.log("");
  });

  if (result.page_token ?? result.links?.next) {
    console.log("다음 페이지 토큰:", result.page_token ?? result.links.next);
  }
}

/* -------------------------------------------------------------------------- */
/* 출력 유틸: Aggregate                                                         */
/* -------------------------------------------------------------------------- */

function printAggregateResult(data: any) {
  const result = normalizeResult<any>(data);
  const buckets: any[] = result.buckets ?? result.aggregations ?? [];

  console.log("=== Aggregate 결과 ===");
  if (!buckets.length) {
    console.log("(버킷 없음)");
    return;
  }

  for (const b of buckets) {
    console.log(
      `  값: ${b.key ?? b.value ?? "(알 수 없음)"} / 개수: ${
        b.count ?? b.doc_count ?? "?"
      }`,
    );
  }
}

/* -------------------------------------------------------------------------- */
/* CLI 파싱 & 실행                                                              */
/* -------------------------------------------------------------------------- */

type Command = "host" | "search" | "aggregate";

function isKnownCommand(cmd: string | undefined): cmd is Command {
  return cmd === "host" || cmd === "search" || cmd === "aggregate";
}

function printUsage() {
  console.log("사용법:");
  console.log("  Host 조회(명시):  npx ts-node censys-cli.ts host <IP>");
  console.log("  Host 조회(축약):  npx ts-node censys-cli.ts <IP>");
  console.log('  검색(query):      npx ts-node censys-cli.ts search "<쿼리>" [pageSize]');
  console.log('  집계(aggregate):  npx ts-node censys-cli.ts aggregate "<쿼리>" "<필드>" [버킷수]');
  console.log('  예:               npx ts-node censys-cli.ts aggregate "host.services:(service_name:\\"HTTP\\")" "host.services.port" 5');
}

async function main() {
  const [, , arg1, ...rest] = process.argv;

  // 인자가 없으면 사용법 출력
  if (!arg1) {
    printUsage();
    process.exit(0);
  }

  // 알려진 명령어면 그대로 사용, 아니면 arg1을 IP로 보고 host 조회로 처리
  const command: Command = isKnownCommand(arg1) ? arg1 : "host";

  if (command === "host") {
    const ip = isKnownCommand(arg1) ? rest[0] : arg1;

    if (!ip) {
      printUsage();
      process.exit(1);
    }

    try {
      console.log(`🔍 Censys에서 ${ip} 조회 중...\n`);
      const data = await getHost(ip);
      printHostResult(ip, data);
    } catch (err: any) {
      console.error("\n❌ Host 조회 실패:");
      console.error(err.message);
    }
    return;
  }

  if (command === "search") {
    const query = rest[0];
    const pageSize = rest[1] ? Number(rest[1]) : 5;

    if (!query) {
      console.log('사용법: npx ts-node censys-cli.ts search "<쿼리>" [pageSize]');
      process.exit(1);
    }

    try {
      console.log(`🔍 Search 쿼리 실행 중...\n쿼리: ${query}\n`);
      const data = await searchAssets(query, { pageSize });
      printSearchResult(data);
    } catch (err: any) {
      console.error("\n❌ Search 실패:");
      console.error(err.message);
    }
    return;
  }

  if (command === "aggregate") {
    const query = rest[0];
    const field = rest[1];
    const numBuckets = rest[2] ? Number(rest[2]) : 5;

    if (!query || !field) {
      console.log('사용법: npx ts-node censys-cli.ts aggregate "<쿼리>" "<필드>" [버킷수]');
      console.log('예:     npx ts-node censys-cli.ts aggregate "host.services:(service_name:\\"HTTP\\")" "host.services.port" 5');
      process.exit(1);
    }

    try {
      console.log(`🔍 Aggregate 실행 중...\n쿼리: ${query}\n필드: ${field}\n버킷 수: ${numBuckets}\n`);
      const data = await aggregateAssets(query, field, numBuckets);
      printAggregateResult(data);
    } catch (err: any) {
      console.error("\n❌ Aggregate 실패:");
      console.error(err.message);
    }
    return;
  }
}

main().catch((err) => {
  console.error("예상치 못한 오류가 발생했습니다:");
  console.error(err);
  process.exit(1);
});
