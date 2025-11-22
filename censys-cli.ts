// censys-cli.ts
import * as dotenv from "dotenv";

dotenv.config();

const API_BASE = "https://api.platform.censys.io/v3";
const API_TOKEN = process.env.CENSYS_API_TOKEN;
const ORG_ID = process.env.CENSYS_ORG_ID;

if (!API_TOKEN) {
  console.error("❌ CENSYS_API_TOKEN이 설정되어 있지 않습니다. .env 파일을 확인하세요.");
  process.exit(1);
}

async function getHost(ip: string) {
  const url = `${API_BASE}/global/asset/host/${ip}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${API_TOKEN}`,
    Accept: "application/vnd.censys.api.v3.host.v1+json",
  };

  if (ORG_ID) {
    headers["X-Organization-ID"] = ORG_ID;
  }

  const res = await fetch(url, {
    method: "GET",
    headers,
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`API Error: ${res.status} - ${errorText}`);
  }

  return res.json();
}

async function main() {
  const ip = process.argv[2];

  if (!ip) {
    console.log("사용법: npx ts-node censys-cli.ts <IP 주소>");
    process.exit(1);
  }

   try {
    console.log(`🔍 Censys에서 ${ip} 조회 중...\n`);
    const data: any = await getHost(ip);

    // 필요하면 응답 구조 확인용
    // console.log(JSON.stringify(data, null, 2));

    const result = data.result ?? data;
    const resource = result.resource ?? result; // ← 예시 JSON에 맞춰 한 단계 더 들어감

    console.log("=== Host 정보 ===");

    // IP
    console.log("IP:", resource.ip ?? ip);

    // 위치 정보
    const loc = resource.location ?? {};
    console.log(
      "위치:",
      [
        loc.country ?? "-",
        loc.province ?? "",
        loc.city ?? "",
      ]
        .filter(Boolean)
        .join(" / ") || "-"
    );
    console.log("타임존:", loc.timezone ?? "-");
    if (loc.coordinates) {
      console.log(
        "좌표:",
        `(${loc.coordinates.latitude ?? "?"}, ${loc.coordinates.longitude ?? "?"})`
      );
    }

    // AS 정보
    const as = resource.autonomous_system ?? {};
    console.log("\n[Autonomous System]");
    console.log("  ASN:", as.asn ?? "-");
    console.log("  이름:", as.name ?? "-");
    console.log("  설명:", as.description ?? "-");
    console.log("  BGP 프리픽스:", as.bgp_prefix ?? "-");
    console.log("  국가 코드:", as.country_code ?? "-");

    // WHOIS 조직 정보
    const org = resource.whois?.organization ?? {};
    console.log("\n[WHOIS Organization]");
    console.log("  이름:", org.name ?? "-");
    console.log("  주소:", [
      org.street,
      org.city,
      org.state,
      org.postal_code,
      org.country,
    ]
      .filter(Boolean)
      .join(", ") || "-");

    const abuse = (org.abuse_contacts ?? [])[0];
    console.log("  Abuse 연락처:", abuse?.email ?? "-");

    // 서비스 / 포트 정보
    const services: any[] = Array.isArray(resource.services)
      ? resource.services
      : [];
    console.log("\n[서비스]");
    console.log("  서비스 개수:", resource.service_count ?? services.length);

    if (!services.length) {
      console.log("  (서비스 정보 없음)");
    } else {
      for (const s of services) {
        console.log(
          `  - 포트 ${s.port} / 프로토콜 ${s.protocol} / 트랜스포트 ${s.transport_protocol}`
        );
        if (s.cwmp?.server) {
          console.log(`    · CWMP 서버: ${s.cwmp.server}`);
        }
      }
    }

    // DNS 정보
    const dns = resource.dns ?? {};
    console.log("\n[DNS]");
    const rdnsNames: string[] = dns.reverse_dns?.names ?? [];
    console.log(
      "  Reverse DNS:",
      rdnsNames.length ? rdnsNames.join(", ") : "-"
    );

    const names: string[] = dns.names ?? [];
    console.log("  연결된 도메인 개수:", names.length);
    if (names.length) {
      console.log(
        "  예시 도메인:",
        names.slice(0, 5).join(", ") +
          (names.length > 5 ? ` ...(+${names.length - 5}개)` : "")
      );
    }
  } catch (err: any) {
    console.error("\n❌ 조회 실패:");
    console.error(err.message);
  }
}

main();
