import type { Metadata } from "next"
import Link from "next/link"
import { LegalDoc, Section, companyLabel } from "@/components/legal/legal-doc"
import { loadLegalCompany } from "@/lib/legal/company"

export const metadata: Metadata = { title: "서비스 이용약관 — Omnis" }
// 회사 정보를 DB 에서 읽는다(lib/legal/company.ts)
export const dynamic = "force-dynamic"

/** 서비스 이용약관 — 사내 서비스(임직원 · 회사가 계정을 준 사람)를 전제로 쓴다 */
export default async function TermsPage() {
  const c = await loadLegalCompany()
  const who = companyLabel(c)

  return (
    <LegalDoc title="서비스 이용약관" current="terms">
      <Section title="제1조 (목적)">
        <p>
          이 약관은 {who}(이하 「회사」)가 제공하는 사내 업무 시스템 옴니스(Omnis, 이하 「서비스」)를 이용하는 조건과 절차, 회사와 이용자의 권리 ·
          의무를 정합니다.
        </p>
      </Section>

      <Section title="제2조 (이용자와 계정)">
        <ul>
          <li>서비스는 회사 임직원과 회사가 계정을 만들어 준 사람(이하 「이용자」)만 이용할 수 있습니다. 계정은 관리자가 만듭니다.</li>
          <li>관리자가 정해 준 임시 비밀번호는 처음 이용할 때 본인만 아는 비밀번호로 바꿔야 합니다.</li>
          <li>계정은 본인만 쓰며, 다른 사람에게 빌려주거나 함께 쓸 수 없습니다.</li>
          <li>퇴사 · 계약 종료 등으로 이용 자격이 없어지면 회사는 계정을 끕니다.</li>
        </ul>
      </Section>

      <Section title="제3조 (서비스 내용)">
        <ul>
          <li>사내 채팅(단톡방 · 1:1 · 업무 대화), 업무 관리, 일정, 첨부 파일 보관, 지식 카드, 주간보고, 거래처 · 지식재산권 기록</li>
          <li>AI 옴니스: 회사의 대화 · 업무 · 문서를 정리해 지식으로 만들고, 물음에 답하며, 이용자가 확인한 작업을 대신 합니다.</li>
          <li>이용자가 직접 연결하는 외부 AI 연결(Omnis MCP)</li>
        </ul>
      </Section>

      <Section title="제4조 (공개 범위)">
        <ul>
          <li>업무 카드와 지식 카드는 회사 안의 모든 이용자에게 공개됩니다.</li>
          <li>단톡방 · 1:1 대화는 그 방에 든 사람만, 옴니스와의 1:1 대화는 본인만 서비스 화면에서 읽을 수 있습니다.</li>
          <li>AI 옴니스는 이용자가 볼 수 있는 범위 안의 정보로만 답합니다.</li>
        </ul>
      </Section>

      <Section title="제5조 (이용자의 의무)">
        <ul>
          <li>서비스에서 얻은 회사의 정보는 업무에만 쓰고, 회사의 허락 없이 회사 밖으로 내보내지 않습니다.</li>
          <li>다른 사람의 개인정보는 업무에 필요한 만큼만 올립니다.</li>
          <li>법령이나 회사 규정에 어긋나는 내용, 다른 사람의 권리를 침해하는 내용을 올리지 않습니다.</li>
          <li>서비스의 보안을 시험하거나 우회하지 않습니다.</li>
        </ul>
      </Section>

      <Section title="제6조 (AI 기능 이용 시 유의)">
        <ul>
          <li>AI 의 답은 틀리거나 빠질 수 있습니다. 중요한 판단 · 외부 제출 전에는 원문(출처)을 확인합니다.</li>
          <li>AI 가 기록을 만들거나 바꾸는 작업은 이용자가 확인 카드로 승인한 뒤에만 실행됩니다. 승인한 작업의 결과는 승인한 이용자가 확인합니다.</li>
          <li>AI 기능은 사람별 사용량 한도 안에서 씁니다.</li>
        </ul>
      </Section>

      <Section title="제7조 (게시물과 기록)">
        <ul>
          <li>이용자가 업무로 올린 글 · 파일 · 업무 기록은 회사의 업무 기록이며, 계정을 끈 뒤에도 회사가 보존할 수 있습니다.</li>
          <li>이용자는 자기 글을 고치거나 지울 수 있습니다. 지운 글은 대화에 지웠다는 표시만 남습니다.</li>
        </ul>
      </Section>

      <Section title="제8조 (서비스의 변경 · 중단)">
        <ul>
          <li>회사는 점검 · 장애 · 업체 사정으로 서비스를 잠시 멈출 수 있으며, 가능하면 미리 서비스 안에 알립니다.</li>
          <li>회사는 업무에 맞게 서비스의 기능을 바꾸거나 없앨 수 있습니다.</li>
        </ul>
      </Section>

      <Section title="제9조 (개인정보)">
        <p>
          개인정보의 처리는{" "}
          <Link href="/privacy" className="underline underline-offset-4">
            개인정보 처리방침
          </Link>
          을 따릅니다.
        </p>
      </Section>

      <Section title="제10조 (책임)">
        <ul>
          <li>회사는 서비스를 안정적으로 제공하려고 노력하며, 회사의 고의 또는 중대한 과실로 이용자에게 생긴 손해를 책임집니다.</li>
          <li>이용자가 이 약관이나 회사 규정을 어겨 생긴 손해는 그 이용자가 책임집니다.</li>
        </ul>
      </Section>

      <Section title="제11조 (약관의 변경 · 준거법)">
        <ul>
          <li>회사는 이 약관을 바꿀 수 있으며, 바꾸면 시행 7일 전부터 서비스 안에 알립니다.</li>
          <li>이 약관은 대한민국 법을 따릅니다.</li>
        </ul>
      </Section>

      <p className="text-[12.5px] text-muted-foreground">
        {c.name}
        {c.representative ? ` · 대표 ${c.representative}` : ""}
        {c.address ? ` · ${c.address}` : ""}
      </p>
    </LegalDoc>
  )
}
